/**
 * File ingestion & analysis engine (Phase 1)
 * -------------------------------------------
 * Turns user-uploaded files into model-ready content, entirely client-side.
 *
 *  - Text / code / md / json / csv / yaml ... -> raw text
 *  - Images                                   -> data URL for vision models
 *  - PDF                                      -> extracted text (pdfjs-dist)
 *  - Word (.docx)                             -> extracted text (mammoth)
 *  - Excel / CSV (.xlsx/.xls)                 -> per-sheet CSV text (xlsx)
 *  - ZIP                                      -> recursively process entries (jszip)
 *  - Audio / Video                            -> transcription via Whisper (deferred)
 *
 * Heavy libs are dynamically imported so they never run during SSR and only
 * load in the browser when a matching file is actually dropped in.
 */

import { v4 as uuidv4 } from 'uuid'

export type AttachmentKind =
  | 'text'
  | 'image'
  | 'pdf'
  | 'word'
  | 'excel'
  | 'archive'
  | 'audio'
  | 'video'
  | 'unknown'

export type AttachmentStatus = 'pending' | 'processing' | 'ready' | 'error'

export interface Attachment {
  id: string
  name: string
  kind: AttachmentKind
  mime: string
  size: number
  /** Image data URL (base64) — sent to vision-capable models as image_url. */
  dataUrl?: string
  /** Extracted/transcribed text — injected into the prompt as context. */
  extractedText?: string
  status: AttachmentStatus
  error?: string
  /** pages, sheets, entries, duration, etc. */
  meta?: Record<string, unknown>
}

// ── Limits ────────────────────────────────────────────────────────────
export const MAX_FILE_BYTES = 50 * 1024 * 1024 // 50 MB per file
export const MAX_EXTRACTED_CHARS = 200_000 // cap injected text per file
const MAX_ZIP_ENTRIES = 100
const MAX_ZIP_DEPTH = 2

// ── Extension / MIME classification ───────────────────────────────────
const TEXT_EXTS = new Set([
  'txt', 'md', 'markdown', 'rtf', 'log', 'csv', 'tsv', 'json', 'jsonl', 'yaml', 'yml',
  'xml', 'html', 'htm', 'css', 'scss', 'js', 'jsx', 'ts', 'tsx', 'mjs', 'cjs',
  'py', 'rb', 'go', 'rs', 'java', 'kt', 'c', 'h', 'cpp', 'hpp', 'cc', 'cs', 'php',
  'swift', 'sh', 'bash', 'zsh', 'sql', 'toml', 'ini', 'env', 'conf', 'dockerfile',
  'vue', 'svelte', 'astro', 'r', 'lua', 'pl', 'dart', 'scala', 'clj', 'ex', 'exs',
])
const IMAGE_EXTS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'avif'])
const AUDIO_EXTS = new Set(['mp3', 'wav', 'm4a', 'ogg', 'oga', 'flac', 'aac', 'opus', 'wma'])
const VIDEO_EXTS = new Set(['mp4', 'webm', 'mov', 'mkv', 'avi', 'm4v', 'wmv', 'flv'])
// zip → jszip (fast, no wasm); everything else → libarchive.js (wasm)
const ARCHIVE_EXTS = new Set([
  'zip', 'rar', '7z', '7zip', 'tar', 'gz', 'tgz', 'bz2', 'tbz2', 'xz', 'txz',
  'lz', 'lzma', 'cab', 'iso', 'cpio', 'ar',
])

export function extOf(name: string): string {
  const dot = name.lastIndexOf('.')
  return dot >= 0 ? name.slice(dot + 1).toLowerCase() : ''
}

export function kindFromFile(name: string, mime: string): AttachmentKind {
  const ext = extOf(name)
  if (mime.startsWith('image/') || IMAGE_EXTS.has(ext)) return 'image'
  if (mime.startsWith('audio/') || AUDIO_EXTS.has(ext)) return 'audio'
  if (mime.startsWith('video/') || VIDEO_EXTS.has(ext)) return 'video'
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf'
  if (ext === 'docx' || ext === 'doc' || mime.includes('wordprocessingml')) return 'word'
  if (ext === 'xlsx' || ext === 'xls' || mime.includes('spreadsheetml') || ext === 'csv') {
    return ext === 'csv' ? 'text' : 'excel'
  }
  if (ARCHIVE_EXTS.has(ext) || mime === 'application/zip') return 'archive'
  if (TEXT_EXTS.has(ext) || mime.startsWith('text/')) return 'text'
  return 'unknown'
}

function clamp(text: string): string {
  if (text.length <= MAX_EXTRACTED_CHARS) return text
  return text.slice(0, MAX_EXTRACTED_CHARS) + `\n\n…[truncated, ${text.length - MAX_EXTRACTED_CHARS} more chars]`
}

// ── Per-type extractors (browser-only, dynamically imported) ──────────

async function readAsText(blob: Blob): Promise<string> {
  return clamp(await blob.text())
}

async function readAsDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const fr = new FileReader()
    fr.onload = () => resolve(fr.result as string)
    fr.onerror = () => reject(fr.error)
    fr.readAsDataURL(blob)
  })
}

// pdf.js ships wasm loaders that use `import.meta.url`, which Next/webpack
// cannot bundle in this target. We load it as native browser ESM from a CDN
// (webpackIgnore keeps it out of the build graph). Version is pinned to the
// installed pdfjs-dist so the worker matches the library.
const PDFJS_VERSION = '6.0.227'
const PDFJS_CDN = `https://cdn.jsdelivr.net/npm/pdfjs-dist@${PDFJS_VERSION}/build`
let pdfjsModule: any = null

async function loadPdfjs(): Promise<any> {
  if (pdfjsModule) return pdfjsModule
  const mod: any = await import(/* webpackIgnore: true */ `${PDFJS_CDN}/pdf.min.mjs`)
  mod.GlobalWorkerOptions.workerSrc = `${PDFJS_CDN}/pdf.worker.min.mjs`
  pdfjsModule = mod
  return mod
}

async function extractPdf(blob: Blob): Promise<{ text: string; pages: number }> {
  const pdfjs: any = await loadPdfjs()
  const data = new Uint8Array(await blob.arrayBuffer())
  const doc = await pdfjs.getDocument({ data }).promise
  let out = ''
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i)
    const content = await page.getTextContent()
    const strings = content.items.map((it: any) => it.str)
    out += strings.join(' ') + '\n\n'
    if (out.length > MAX_EXTRACTED_CHARS) break
  }
  return { text: clamp(out.trim()), pages: doc.numPages }
}

async function extractWord(blob: Blob): Promise<string> {
  const mammoth: any = await import('mammoth')
  const arrayBuffer = await blob.arrayBuffer()
  const result = await mammoth.extractRawText({ arrayBuffer })
  return clamp(result.value || '')
}

async function extractExcel(blob: Blob): Promise<{ text: string; sheets: string[] }> {
  const XLSX: any = await import('xlsx')
  const wb = XLSX.read(await blob.arrayBuffer(), { type: 'array' })
  const parts: string[] = []
  for (const name of wb.SheetNames) {
    const csv = XLSX.utils.sheet_to_csv(wb.Sheets[name])
    parts.push(`### Sheet: ${name}\n${csv}`)
    if (parts.join('\n').length > MAX_EXTRACTED_CHARS) break
  }
  return { text: clamp(parts.join('\n\n')), sheets: wb.SheetNames }
}

type ArchiveEntry = { name: string; blob: Blob }

/** ZIP entries via jszip (fast, no wasm). */
async function getZipEntries(blob: Blob): Promise<ArchiveEntry[]> {
  const JSZip: any = (await import('jszip')).default
  const zip = await JSZip.loadAsync(await blob.arrayBuffer())
  const names = Object.keys(zip.files).filter((n) => !zip.files[n].dir).slice(0, MAX_ZIP_ENTRIES)
  const out: ArchiveEntry[] = []
  for (const name of names) out.push({ name, blob: await zip.files[name].async('blob') })
  return out
}

// RAR (v4/v5), 7z, tar, gz, xz… via libarchive.js. Its main module embeds an
// emscripten runtime that uses `import.meta.url`, which Next/webpack cannot
// bundle — so we load it as native browser ESM from a CDN (webpackIgnore keeps
// it out of the build graph). The worker + wasm are served from /public
// (same-origin) to avoid cross-origin Worker restrictions.
const LIBARCHIVE_VERSION = '2.0.2'
let libarchiveReady = false
let libarchiveArchive: any = null
async function loadLibarchive(): Promise<any> {
  if (libarchiveArchive) return libarchiveArchive
  const mod: any = await import(
    /* webpackIgnore: true */ `https://cdn.jsdelivr.net/npm/libarchive.js@${LIBARCHIVE_VERSION}/dist/libarchive.js`
  )
  libarchiveArchive = mod.Archive
  return libarchiveArchive
}

async function getLibarchiveEntries(blob: Blob, name: string): Promise<ArchiveEntry[]> {
  const Archive: any = await loadLibarchive()
  if (!libarchiveReady) {
    Archive.init({ workerUrl: '/libarchive/worker-bundle.js' })
    libarchiveReady = true
  }
  const file = blob instanceof File ? blob : new File([blob], name)
  const archive = await Archive.open(file)
  const tree = await archive.extractFiles()
  const out: ArchiveEntry[] = []
  const walk = (node: any, prefix: string) => {
    for (const key of Object.keys(node)) {
      if (out.length >= MAX_ZIP_ENTRIES) return
      const val = node[key]
      const path = prefix ? `${prefix}/${key}` : key
      if (val instanceof File) {
        out.push({ name: path, blob: val })
      } else if (val && typeof val === 'object') {
        walk(val, path)
      }
    }
  }
  walk(tree, '')
  return out
}

async function extractArchive(blob: Blob, name: string, depth = 0): Promise<{ text: string; entries: number }> {
  const entries = extOf(name) === 'zip'
    ? await getZipEntries(blob)
    : await getLibarchiveEntries(blob, name)

  const parts: string[] = []
  let count = 0
  for (const entry of entries) {
    const kind = kindFromFile(entry.name, '')
    parts.push(`\n----- ${entry.name} -----`)
    count++
    try {
      if (kind === 'text') {
        parts.push(clamp(await entry.blob.text()))
      } else if (kind === 'image') {
        parts.push('[image file — open individually to analyze with vision]')
      } else if ((kind === 'pdf' || kind === 'word' || kind === 'excel' || kind === 'archive') && depth < MAX_ZIP_DEPTH) {
        const sub = await dispatch(entry.name, '', entry.blob, depth + 1)
        parts.push(sub.extractedText || `[${kind} — not extracted]`)
      } else {
        parts.push(`[${kind} file — skipped]`)
      }
    } catch (e: any) {
      parts.push(`[error reading entry: ${e?.message || 'unknown'}]`)
    }
    if (parts.join('\n').length > MAX_EXTRACTED_CHARS) break
  }
  return { text: clamp(parts.join('\n')), entries: count }
}

// Internal: extract text for a blob without building a full Attachment (archive recursion).
async function dispatch(name: string, mime: string, blob: Blob, depth = 0): Promise<Partial<Attachment>> {
  const kind = kindFromFile(name, mime)
  switch (kind) {
    case 'text': return { extractedText: await readAsText(blob) }
    case 'pdf': { const r = await extractPdf(blob); return { extractedText: r.text, meta: { pages: r.pages } } }
    case 'word': return { extractedText: await extractWord(blob) }
    case 'excel': { const r = await extractExcel(blob); return { extractedText: r.text, meta: { sheets: r.sheets } } }
    case 'archive': { const r = await extractArchive(blob, name, depth); return { extractedText: r.text, meta: { entries: r.entries } } }
    default: return {}
  }
}

// ── Audio / video transcription (Whisper, OpenAI-compatible) ──────────

export interface TranscriptionConfig {
  apiKey: string
  /** OpenAI-compatible base URL. Default: Groq. */
  baseUrl?: string
  /** Whisper model id. Default: whisper-large-v3 (Groq). */
  model?: string
}

/** Whisper endpoints cap upload size at 25 MB. */
export const TRANSCRIBE_MAX_BYTES = 25 * 1024 * 1024

/**
 * Transcribe an audio/video file via an OpenAI-compatible /audio/transcriptions
 * endpoint. Groq & OpenAI both accept common video containers (mp4/webm/mov)
 * and extract the audio track server-side, so no local ffmpeg is needed for them.
 */
export async function transcribeMedia(
  blob: Blob,
  filename: string,
  cfg: TranscriptionConfig,
): Promise<string> {
  const baseUrl = (cfg.baseUrl || 'https://api.groq.com/openai/v1').replace(/\/+$/, '')
  const model = cfg.model || 'whisper-large-v3'
  const form = new FormData()
  form.append('file', blob, filename)
  form.append('model', model)
  form.append('response_format', 'text')

  const res = await fetch(`${baseUrl}/audio/transcriptions`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${cfg.apiKey}` },
    body: form,
  })
  if (!res.ok) {
    const detail = await res.text().catch(() => '')
    throw new Error(`Transcription failed (${res.status}): ${detail.slice(0, 200)}`)
  }
  return (await res.text()).trim()
}

// ── Public API ────────────────────────────────────────────────────────

export interface ProcessOptions {
  /** When set, audio/video files are transcribed via Whisper. */
  transcription?: TranscriptionConfig
}

/**
 * Process a File into a model-ready Attachment. Never throws — errors are
 * captured on the returned attachment so the UI can show per-file status.
 */
export async function processFile(file: File, opts: ProcessOptions = {}): Promise<Attachment> {
  const base: Attachment = {
    id: uuidv4(),
    name: file.name,
    kind: kindFromFile(file.name, file.type),
    mime: file.type || 'application/octet-stream',
    size: file.size,
    status: 'processing',
  }

  if (file.size > MAX_FILE_BYTES) {
    return { ...base, status: 'error', error: `File too large (max ${Math.round(MAX_FILE_BYTES / 1024 / 1024)} MB)` }
  }

  try {
    switch (base.kind) {
      case 'image': {
        const dataUrl = await readAsDataUrl(file)
        return { ...base, dataUrl, status: 'ready' }
      }
      case 'text': {
        const extractedText = await readAsText(file)
        return { ...base, extractedText, status: 'ready' }
      }
      case 'pdf': {
        const { text, pages } = await extractPdf(file)
        return { ...base, extractedText: text, meta: { pages }, status: 'ready' }
      }
      case 'word': {
        const extractedText = await extractWord(file)
        return { ...base, extractedText, status: 'ready' }
      }
      case 'excel': {
        const { text, sheets } = await extractExcel(file)
        return { ...base, extractedText: text, meta: { sheets }, status: 'ready' }
      }
      case 'archive': {
        const { text, entries } = await extractArchive(file, file.name)
        return { ...base, extractedText: text, meta: { entries }, status: 'ready' }
      }
      case 'audio':
      case 'video': {
        if (opts.transcription?.apiKey) {
          if (file.size > TRANSCRIBE_MAX_BYTES) {
            return { ...base, status: 'error', error: `Media too large to transcribe (max ${Math.round(TRANSCRIBE_MAX_BYTES / 1024 / 1024)} MB)` }
          }
          const text = await transcribeMedia(file, file.name, opts.transcription)
          return {
            ...base,
            status: 'ready',
            extractedText: clamp(`[Transcript of ${file.name}]\n${text}`),
            meta: { transcribed: true },
          }
        }
        return {
          ...base,
          status: 'ready',
          extractedText: `[${base.kind} file "${file.name}" attached — add a Whisper API key in Settings to transcribe it]`,
          meta: { needsTranscription: true },
        }
      }
      default:
        return { ...base, status: 'error', error: 'Unsupported file type' }
    }
  } catch (e: any) {
    return { ...base, status: 'error', error: e?.message || 'Failed to process file' }
  }
}

/** Build the text block injected into the user prompt from ready attachments. */
export function buildAttachmentContext(attachments: Attachment[]): string {
  const docs = attachments.filter((a) => a.status === 'ready' && a.extractedText)
  if (docs.length === 0) return ''
  let out = '\n\n<attached_files>\n'
  for (const a of docs) {
    out += `\n<file name="${a.name}" type="${a.kind}">\n${a.extractedText}\n</file>\n`
  }
  out += '</attached_files>\n'
  return out
}

/** Multimodal image parts (OpenAI/OpenRouter format) for vision models. */
export function buildVisionParts(attachments: Attachment[]): Array<{ type: 'image_url'; image_url: { url: string } }> {
  return attachments
    .filter((a) => a.status === 'ready' && a.kind === 'image' && a.dataUrl)
    .map((a) => ({ type: 'image_url' as const, image_url: { url: a.dataUrl! } }))
}

export function kindIcon(kind: AttachmentKind): string {
  switch (kind) {
    case 'image': return '🖼️'
    case 'pdf': return '📄'
    case 'word': return '📝'
    case 'excel': return '📊'
    case 'archive': return '🗜️'
    case 'audio': return '🎵'
    case 'video': return '🎬'
    case 'text': return '📃'
    default: return '📎'
  }
}

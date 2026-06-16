/**
 * NEXUS Agent — autonomous tool-using loop (server-only).
 * --------------------------------------------------------
 * Runs an LLM in a ReAct-style loop with real tools executed inside an
 * isolated E2B cloud sandbox (no local Docker / infra needed). The model
 * plans, runs code/shell, reads & writes files, and iterates until it
 * produces a final answer.
 *
 * IMPORTANT: imports the E2B SDK (Node-only). Use only from server routes.
 */

import { Sandbox } from '@e2b/code-interpreter'
import { buildSkillContext } from './skills'

const SANDBOX_TIMEOUT_MS = 5 * 60 * 1000 // 5 min sandbox lifetime
const MAX_TOOL_OUTPUT = 4000

// Artifact capture limits — files pulled out of the sandbox before it dies, so
// the user can actually download what the agent built (not lose it on teardown).
const ARTIFACT_DIR = '/home/user'            // E2B default working directory
const MAX_ARTIFACT_BYTES = 8 * 1024 * 1024   // 8 MB per file
const MAX_ARTIFACTS = 20                      // cap number of files returned
const MAX_ARTIFACT_TOTAL = 24 * 1024 * 1024  // 24 MB total payload

/** A file produced inside the sandbox, returned to the user for download. */
export interface AgentArtifact {
  name: string
  path: string
  mime: string
  size: number
  /** base64-encoded file bytes (no `data:` prefix). */
  dataBase64: string
  /** short UTF-8 preview for text-like files (optional). */
  textPreview?: string
}

export type AgentEvent =
  | { type: 'status'; message: string }
  | { type: 'thought'; content: string }
  | { type: 'tool_call'; tool: string; args: Record<string, unknown>; id: string }
  | { type: 'tool_result'; id: string; output: string; ok: boolean }
  | { type: 'artifact'; artifact: AgentArtifact }
  | { type: 'final'; content: string }
  | { type: 'error'; message: string }

export interface AgentInputMessage {
  role: 'system' | 'user' | 'assistant'
  content: any
}

export interface RunAgentOptions {
  /** Full conversation (system + history + new user message). */
  messages: AgentInputMessage[]
  /** API key for the LLM provider (OpenRouter or NVIDIA NIM, etc.). */
  llmApiKey: string
  /** OpenAI-compatible base URL, e.g. https://openrouter.ai/api/v1 */
  llmBaseUrl: string
  e2bApiKey: string
  model?: string
  temperature?: number
  maxSteps?: number
  /** Enabled skill ids; when omitted, all skills are available to the model. */
  enabledSkills?: string[]
  signal?: AbortSignal
  onEvent: (e: AgentEvent) => void
}

// Appended to the conversation's own system prompt so the model knows tools
// exist — but uses them ONLY when the request actually needs execution.
const TOOL_GUIDANCE = `

---
You also have access to an isolated Linux sandbox (Python 3, bash, internet, a
filesystem) through these tools: run_python, run_shell, write_file, read_file.

Decide for yourself whether a tool is needed:
- For normal conversation, explanations, opinions, writing, or questions you can
  answer from knowledge — just reply directly, DO NOT use tools.
- When the request needs real execution — running/testing code, calculations,
  fetching live data, scraping, processing or creating files, automating tasks —
  use the tools. Work step by step: one action, observe the result, adapt, repeat.
  Install packages with pip/apt as needed. When done, stop calling tools and write
  a clear final summary (mention any files you created in the sandbox).`

// ── Tool schemas (OpenAI function-calling format) ─────────────────────
const TOOLS = [
  {
    type: 'function',
    function: {
      name: 'run_python',
      description: 'Execute Python code in the sandbox (Jupyter kernel, state persists across calls). Returns stdout, stderr and the value of the last expression.',
      parameters: {
        type: 'object',
        properties: { code: { type: 'string', description: 'Python code to run' } },
        required: ['code'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'run_shell',
      description: 'Run a bash command in the sandbox (e.g. pip install, curl, ls). Returns stdout, stderr and exit code.',
      parameters: {
        type: 'object',
        properties: { cmd: { type: 'string', description: 'Shell command' } },
        required: ['cmd'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'write_file',
      description: 'Write a text file in the sandbox at the given path.',
      parameters: {
        type: 'object',
        properties: {
          path: { type: 'string' },
          content: { type: 'string' },
        },
        required: ['path', 'content'],
      },
    },
  },
  {
    type: 'function',
    function: {
      name: 'read_file',
      description: 'Read a text file from the sandbox.',
      parameters: {
        type: 'object',
        properties: { path: { type: 'string' } },
        required: ['path'],
      },
    },
  },
]

function truncate(s: string): string {
  if (s.length <= MAX_TOOL_OUTPUT) return s
  return s.slice(0, MAX_TOOL_OUTPUT) + `\n…[truncated ${s.length - MAX_TOOL_OUTPUT} chars]`
}

/** Execute a single tool call against the sandbox; returns a text observation. */
async function execTool(
  sandbox: Sandbox,
  name: string,
  args: Record<string, unknown>,
): Promise<string> {
  switch (name) {
    case 'run_python': {
      const exec = await sandbox.runCode(String(args.code ?? ''))
      const out: string[] = []
      if (exec.logs.stdout.length) out.push('STDOUT:\n' + exec.logs.stdout.join(''))
      if (exec.logs.stderr.length) out.push('STDERR:\n' + exec.logs.stderr.join(''))
      if (exec.error) out.push(`ERROR: ${exec.error.name}: ${exec.error.value}`)
      if (exec.text) out.push('RESULT:\n' + exec.text)
      return truncate(out.join('\n') || '(no output)')
    }
    case 'run_shell': {
      const res = await sandbox.commands.run(String(args.cmd ?? ''), { timeoutMs: 120_000 })
      const out: string[] = [`exit code: ${res.exitCode}`]
      if (res.stdout) out.push('STDOUT:\n' + res.stdout)
      if (res.stderr) out.push('STDERR:\n' + res.stderr)
      return truncate(out.join('\n'))
    }
    case 'write_file': {
      await sandbox.files.write(String(args.path ?? ''), String(args.content ?? ''))
      return `Wrote ${args.path}`
    }
    case 'read_file': {
      const content = await sandbox.files.read(String(args.path ?? ''))
      return truncate(typeof content === 'string' ? content : String(content))
    }
    default:
      return `Unknown tool: ${name}`
  }
}

// ── Artifact capture ──────────────────────────────────────────────────
const TEXT_EXT = new Set([
  'html', 'htm', 'css', 'js', 'mjs', 'ts', 'tsx', 'jsx', 'json', 'txt', 'md',
  'markdown', 'csv', 'tsv', 'xml', 'svg', 'yml', 'yaml', 'py', 'sh', 'c', 'cpp',
  'java', 'go', 'rs', 'rb', 'php', 'sql',
])
const MIME_BY_EXT: Record<string, string> = {
  html: 'text/html', htm: 'text/html', css: 'text/css', js: 'text/javascript',
  mjs: 'text/javascript', json: 'application/json', txt: 'text/plain',
  md: 'text/markdown', markdown: 'text/markdown', csv: 'text/csv',
  tsv: 'text/tab-separated-values', xml: 'application/xml', svg: 'image/svg+xml',
  yml: 'text/yaml', yaml: 'text/yaml', py: 'text/x-python', sh: 'application/x-sh',
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', ico: 'image/x-icon', pdf: 'application/pdf',
  zip: 'application/zip', gz: 'application/gzip', tar: 'application/x-tar',
  mp3: 'audio/mpeg', wav: 'audio/wav', mp4: 'video/mp4', webm: 'video/webm',
}
function extOf(name: string): string {
  const i = name.lastIndexOf('.')
  return i >= 0 ? name.slice(i + 1).toLowerCase() : ''
}
function mimeFor(name: string): string {
  return MIME_BY_EXT[extOf(name)] || 'application/octet-stream'
}

/**
 * Pull files the agent produced out of the (about-to-die) sandbox and stream
 * them back as downloadable artifacts. Combines files written via write_file
 * with anything created in the working dir by code/shell. Best-effort: any
 * single failure is skipped rather than aborting the whole capture.
 */
async function collectArtifacts(
  sandbox: Sandbox,
  writtenPaths: Set<string>,
  onEvent: (e: AgentEvent) => void,
): Promise<void> {
  // Resolve candidate paths: explicit write_file paths (normalized to absolute)
  // plus a listing of the working directory for files made by code/shell.
  const candidates = new Set<string>()
  for (const p of writtenPaths) {
    candidates.add(p.startsWith('/') ? p : `${ARTIFACT_DIR}/${p}`)
  }
  try {
    const entries = await sandbox.files.list(ARTIFACT_DIR)
    for (const e of entries) {
      if (e.type === 'file' && !e.name.startsWith('.')) candidates.add(e.path)
    }
  } catch { /* listing is best-effort */ }

  let count = 0
  let totalBytes = 0
  for (const path of candidates) {
    if (count >= MAX_ARTIFACTS || totalBytes >= MAX_ARTIFACT_TOTAL) break
    try {
      const bytes = (await sandbox.files.read(path, { format: 'bytes' })) as Uint8Array
      if (!bytes || bytes.length === 0 || bytes.length > MAX_ARTIFACT_BYTES) continue
      const name = path.split('/').pop() || path
      const buf = Buffer.from(bytes)
      const isText = TEXT_EXT.has(extOf(name))
      count++
      totalBytes += bytes.length
      onEvent({
        type: 'artifact',
        artifact: {
          name,
          path,
          mime: mimeFor(name),
          size: bytes.length,
          dataBase64: buf.toString('base64'),
          textPreview: isText ? buf.toString('utf8').slice(0, 2000) : undefined,
        },
      })
    } catch { /* skip unreadable files */ }
  }
}

interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string | null
  /** Chain-of-thought reasoning, when the provider exposes it. */
  reasoning?: string
  reasoning_content?: string
  tool_calls?: Array<{ id: string; type: 'function'; function: { name: string; arguments: string } }>
  tool_call_id?: string
}

async function callModel(
  apiKey: string,
  baseUrl: string,
  model: string,
  messages: ChatMessage[],
  temperature: number,
  signal?: AbortSignal,
): Promise<ChatMessage> {
  const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://nexus.ai',
      'X-Title': 'NEXUS Agent',
    },
    body: JSON.stringify({ model, messages, tools: TOOLS, tool_choice: 'auto', temperature }),
    signal,
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any)?.error?.message || `Model error ${res.status}`)
  }
  const data = await res.json()
  const msg = data.choices?.[0]?.message
  if (!msg) throw new Error('Empty response from model')
  // Some providers expose chain-of-thought as `reasoning` (OpenRouter) and some
  // as `reasoning_content` — normalize onto `reasoning` for the Thinking panel.
  if (!msg.reasoning && typeof msg.reasoning_content === 'string') {
    msg.reasoning = msg.reasoning_content
  }
  return msg as ChatMessage
}

/**
 * Run the autonomous agent loop. Streams progress through `onEvent`.
 * Always tears down the sandbox before returning.
 */
export async function runAgent(opts: RunAgentOptions): Promise<void> {
  const {
    messages: inputMessages, llmApiKey, llmBaseUrl, e2bApiKey,
    model = 'anthropic/claude-sonnet-4', temperature = 0.5,
    maxSteps = 24, enabledSkills, signal, onEvent,
  } = opts

  // Lazy sandbox: only spin one up when a tool is actually called, so plain
  // chat answers stay instant (Manus-style — the computer boots on demand).
  let sandbox: Sandbox | null = null
  // Paths the agent writes via write_file — captured as artifacts on teardown.
  const writtenPaths = new Set<string>()
  const getSandbox = async (): Promise<Sandbox> => {
    if (!sandbox) {
      onEvent({ type: 'status', message: 'Booting sandbox…' })
      sandbox = await Sandbox.create({ apiKey: e2bApiKey, timeoutMs: SANDBOX_TIMEOUT_MS })
    }
    return sandbox
  }

  try {
    // Merge tool guidance + skill router into the system prompt (or add one).
    const messages: ChatMessage[] = inputMessages.map((m) => ({ role: m.role, content: m.content }))

    // Latest user text drives the skill heuristics (handles string or parts).
    const lastUser = [...inputMessages].reverse().find((m) => m.role === 'user')
    const lastUserText =
      typeof lastUser?.content === 'string'
        ? lastUser.content
        : Array.isArray(lastUser?.content)
          ? lastUser!.content
              .map((p: any) => (typeof p === 'string' ? p : p?.text || ''))
              .join(' ')
          : ''
    const sysAddition = TOOL_GUIDANCE + buildSkillContext(lastUserText, enabledSkills)

    if (messages[0]?.role === 'system') {
      messages[0] = { role: 'system', content: String(messages[0].content || '') + sysAddition }
    } else {
      messages.unshift({ role: 'system', content: sysAddition.trim() })
    }

    for (let step = 0; step < maxSteps; step++) {
      if (signal?.aborted) throw new Error('Aborted by user')

      const reply = await callModel(llmApiKey, llmBaseUrl, model, messages, temperature, signal)
      messages.push(reply)

      // Stream the model's reasoning trace into the Claude-web-style panel.
      if (reply.reasoning && reply.reasoning.trim()) {
        onEvent({ type: 'thought', content: reply.reasoning.trim() })
      }

      const toolCalls = reply.tool_calls || []

      // Intermediate reasoning text (only when more tool work follows).
      if (reply.content && toolCalls.length > 0) {
        onEvent({ type: 'thought', content: reply.content })
      }

      if (toolCalls.length === 0) {
        // No tools requested → this is the final answer (normal chat or done).
        onEvent({ type: 'final', content: reply.content || '(no response)' })
        return
      }

      for (const call of toolCalls) {
        if (signal?.aborted) throw new Error('Aborted by user')
        let args: Record<string, unknown> = {}
        try { args = JSON.parse(call.function.arguments || '{}') } catch {}
        onEvent({ type: 'tool_call', tool: call.function.name, args, id: call.id })

        let output: string
        let ok = true
        try {
          const sbx = await getSandbox()
          output = await execTool(sbx, call.function.name, args)
          if (call.function.name === 'write_file' && typeof args.path === 'string') {
            writtenPaths.add(args.path)
          }
        } catch (e: any) {
          ok = false
          output = `Tool error: ${e?.message || 'unknown'}`
        }
        onEvent({ type: 'tool_result', id: call.id, output, ok })
        messages.push({ role: 'tool', tool_call_id: call.id, content: output })
      }
    }

    onEvent({ type: 'final', content: `Reached the step limit (${maxSteps}). Stopping.` })
  } catch (e: any) {
    onEvent({ type: 'error', message: e?.message || 'Agent failed' })
  } finally {
    // The assertion keeps the type as Sandbox|null; TS otherwise narrows a
    // closure-assigned `let` back to its `null` initializer here (→ never).
    const sbx = sandbox as Sandbox | null
    if (sbx) {
      // Rescue everything the agent built before the sandbox is destroyed.
      try { await collectArtifacts(sbx, writtenPaths, onEvent) } catch {}
      try { await sbx.kill() } catch {}
    }
  }
}

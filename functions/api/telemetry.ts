/**
 * NEXUS Telemetry Proxy — Cloudflare Pages Function
 *
 * Receives metadata events from the frontend and commits them
 * to a HuggingFace Dataset repo as JSONL. The HF token lives
 * server-side in CF Pages environment variables (never exposed
 * to the browser).
 *
 * URL: POST /api/telemetry
 *
 * Setup (deployment environment variables in Cloudflare or Vercel):
 *   DATA_TOKEN         — HuggingFace write token (hf_...)
 *   DATA_REPO  — Target dataset repo (e.g. "nexuslabs/NEXUS")
 *
 * The frontend batches events and sends them here periodically.
 * Each batch becomes a single JSONL file committed to the HF repo.
 *
 * File layout in the HF repo:
 *   telemetry/batch_<timestamp>_<hash>.jsonl
 */

import {
  getClientRateLimitKey,
  isAllowedOrigin,
  validateTelemetryEvent,
  type TelemetryPlatform,
  type TelemetryEvent,
} from './telemetry-schema'

// Cloudflare Pages Function type (local declaration to avoid @cloudflare/workers-types dependency)
type PagesFunction<T = unknown> = (context: { request: Request; env: T; waitUntil: (promise: Promise<unknown>) => void; next: () => Promise<Response> }) => Promise<Response> | Response

export interface TelemetryEnv {
  DATA_TOKEN: string
  DATA_REPO: string
  HF_DATASET_BRANCH?: string
}

interface TelemetryPayload {
  events: TelemetryEvent[]
}

const HF_API = 'https://huggingface.co/api'

// ── Rate Limiter (in-memory, per-isolate) ────────────────────────────
const RATE_LIMIT_WINDOW_MS = 60_000 // 1 minute
const RATE_LIMIT_MAX = 10           // max requests per window per client IP
const rateLimitMap = new Map<string, number[]>()

/** Returns true if this client key has exceeded the rate limit. */
function isRateLimited(clientKey: string): boolean {
  const now = Date.now()
  let timestamps = rateLimitMap.get(clientKey)

  if (!timestamps) {
    timestamps = []
    rateLimitMap.set(clientKey, timestamps)
  }

  // Evict entries older than the window
  const cutoff = now - RATE_LIMIT_WINDOW_MS
  while (timestamps.length > 0 && timestamps[0] <= cutoff) {
    timestamps.shift()
  }

  if (timestamps.length >= RATE_LIMIT_MAX) {
    return true
  }

  timestamps.push(now)
  return false
}

// Handle CORS preflight
export function handleTelemetryOptions(request: Request): Response {
  if (!isAllowedOrigin(request)) {
    return jsonResponse({ error: 'Cross-origin telemetry is not allowed' }, 403)
  }
  return new Response(null, { status: 204 })
}

// Main handler shared by the Cloudflare and Next/Vercel adapters.
export async function handleTelemetryPost(
  request: Request,
  env: TelemetryEnv,
  platform: TelemetryPlatform,
): Promise<Response> {
  if (!isAllowedOrigin(request)) {
    return jsonResponse({ error: 'Cross-origin telemetry is not allowed' }, 403)
  }

  // Validate config
  if (!env.DATA_TOKEN || !env.DATA_REPO) {
    const missing = []
    if (!env.DATA_TOKEN) missing.push('DATA_TOKEN')
    if (!env.DATA_REPO) missing.push('DATA_REPO')
    console.error(`[Telemetry] Missing env vars: ${missing.join(', ')} — set these in the deployment environment`)
    return jsonResponse({ error: `Telemetry not configured (missing: ${missing.join(', ')})` }, 503)
  }

  // Parse body
  let payload: TelemetryPayload
  try {
    payload = await request.json() as TelemetryPayload
  } catch {
    return jsonResponse({ error: 'Invalid JSON' }, 400)
  }

  if (!payload.events || !Array.isArray(payload.events) || payload.events.length === 0) {
    return jsonResponse({ error: 'No events provided' }, 400)
  }

  // Cap batch size to prevent abuse
  const MAX_BATCH = 500
  const events = payload.events.slice(0, MAX_BATCH)

  // ── Validate every event against the expected schema ──
  const invalid = events.filter(e => !validateTelemetryEvent(e))
  if (invalid.length > 0) {
    return jsonResponse(
      { error: `${invalid.length} event(s) failed schema validation` },
      400,
    )
  }

  // ── Rate limiting (per client IP, not a caller-controlled session ID) ──
  if (isRateLimited(getClientRateLimitKey(request, platform))) {
    return jsonResponse({ error: 'Rate limit exceeded — try again later' }, 429)
  }

  // Convert to JSONL
  const jsonl = events.map(e => JSON.stringify(e)).join('\n')

  // Generate filename
  const ts = new Date().toISOString().replace(/[:.]/g, '-')
  const hash = shortHash(jsonl)
  const filePath = `telemetry/batch_${ts}_${hash}.jsonl`

  // Commit to HF
  const branch = env.HF_DATASET_BRANCH || 'main'
  const ok = await commitToHF(env.DATA_TOKEN, env.DATA_REPO, branch, filePath, jsonl)

  if (ok) {
    return jsonResponse({
      accepted: events.length,
      file: filePath,
    }, 200)
  }

  return jsonResponse({ error: 'Failed to publish to HuggingFace — check function logs for details' }, 502)
}

// Cloudflare Pages adapter. Its own edge supplies CF-Connecting-IP.
export const onRequestOptions: PagesFunction<TelemetryEnv> = async ({ request }) => (
  handleTelemetryOptions(request)
)

export const onRequestPost: PagesFunction<TelemetryEnv> = async ({ request, env }) => (
  handleTelemetryPost(request, env, 'cloudflare')
)

// ── HuggingFace Hub Commit ───────────────────────────────────────────

async function commitToHF(
  token: string,
  repo: string,
  branch: string,
  filePath: string,
  content: string,
): Promise<boolean> {
  const url = `${HF_API}/datasets/${repo}/commit/${branch}`

  // HF Hub commit API uses NDJSON (application/x-ndjson)
  // Line 1: commit header with summary
  // Line 2: file operation with base64-encoded content
  const contentBase64 = btoa(content)
  const ndjson = [
    JSON.stringify({ key: 'header', value: { summary: `[telemetry] ${filePath}` } }),
    JSON.stringify({ key: 'file', value: { content: contentBase64, path: filePath, encoding: 'base64' } }),
  ].join('\n')

  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/x-ndjson',
      },
      body: ndjson,
    })

    if (!res.ok) {
      const err = await res.text().catch(() => '')
      if (res.status === 401 || res.status === 403) {
        console.error(`[Telemetry] HF AUTH FAILED (${res.status}) — DATA_TOKEN is invalid or lacks write access to "${repo}"`)
      } else if (res.status === 404) {
        console.error(`[Telemetry] HF REPO NOT FOUND (404) — "${repo}" does not exist on HuggingFace`)
      } else {
        console.error(`[Telemetry] HF commit failed (${res.status}): ${err.slice(0, 300)}`)
      }
    }

    return res.ok
  } catch (err) {
    console.error(`[Telemetry] Network error:`, err)
    return false
  }
}

// ── Helpers ──────────────────────────────────────────────────────────

function shortHash(str: string): string {
  let h = 0
  for (let i = 0; i < str.length; i++) {
    h = ((h << 5) - h + str.charCodeAt(i)) | 0
  }
  return Math.abs(h).toString(36).slice(0, 6)
}

function jsonResponse(data: unknown, status: number): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json',
    },
  })
}

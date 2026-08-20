/**
 * POST /api/agent  — runs the NEXUS autonomous agent and streams steps via SSE.
 *
 * Requires server mode (not static export). Both credentials are bring-your-own:
 * the caller supplies the LLM key and, for the sandbox, their own E2B key.
 * E2B_API_KEY on the server is only a fallback for local development — every
 * sandbox is billed to whoever owns the key, so a public deployment must not
 * hand out its own.
 */

import { runAgent, type AgentEvent } from '@/lib/agent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // allow long agent runs where the host permits

/**
 * llmBaseUrl arrives in the request body and is used to build a server-side
 * fetch. Without an allowlist, anyone can point a public deployment at an
 * internal address — cloud metadata endpoints, localhost, a private network —
 * and use the server as a proxy. Only the providers this app actually talks to
 * are accepted.
 */
const ALLOWED_LLM_HOSTS = new Set([
  'openrouter.ai',
  'integrate.api.nvidia.com',
  'api.openai.com',
])

function isAllowedBaseUrl(raw: unknown): boolean {
  if (typeof raw !== 'string') return false

  let url: URL
  try {
    url = new URL(raw)
  } catch {
    return false
  }

  // A self-hosted provider on localhost is useful while developing, but must
  // never be reachable from a deployed instance.
  const isLocal = url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  if (isLocal) return process.env.NODE_ENV !== 'production'

  if (url.protocol !== 'https:') return false
  return ALLOWED_LLM_HOSTS.has(url.hostname)
}

/** Roles the agent loop understands; anything else is a malformed request. */
const VALID_ROLES = new Set(['system', 'user', 'assistant'])

function isValidMessageList(value: unknown): boolean {
  if (!Array.isArray(value) || value.length === 0) return false
  return value.every(
    m => m && typeof m === 'object' && VALID_ROLES.has((m as any).role) && 'content' in m,
  )
}

export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { messages, llmApiKey, llmBaseUrl, model, temperature, skills } = body || {}

  // The caller's own sandbox key wins. The server key stays as a local-dev
  // convenience and is refused in production, where it would mean strangers
  // running sandboxes on the deployment owner's account.
  const callerE2bKey = typeof body?.e2bApiKey === 'string' ? body.e2bApiKey.trim() : ''
  const serverE2bKey = process.env.NODE_ENV === 'production' ? '' : process.env.E2B_API_KEY
  const e2bApiKey = callerE2bKey || serverE2bKey

  if (!isValidMessageList(messages)) {
    return Response.json(
      { error: 'messages must be a non-empty array of {role, content} with role system|user|assistant' },
      { status: 400 },
    )
  }
  if (!e2bApiKey) {
    return Response.json(
      { error: 'No E2B API key. Add yours in Settings → Agent; get one at https://e2b.dev/dashboard.' },
      { status: 400 },
    )
  }
  if (!llmApiKey || !llmBaseUrl) {
    return Response.json({ error: 'llmApiKey and llmBaseUrl are required' }, { status: 400 })
  }
  if (temperature !== undefined && (typeof temperature !== 'number' || temperature < 0 || temperature > 2)) {
    return Response.json({ error: 'temperature must be a number between 0 and 2' }, { status: 400 })
  }
  if (model !== undefined && typeof model !== 'string') {
    return Response.json({ error: 'model must be a string' }, { status: 400 })
  }
  if (skills !== undefined && (!Array.isArray(skills) || skills.some(s => typeof s !== 'string'))) {
    return Response.json({ error: 'skills must be an array of strings' }, { status: 400 })
  }
  if (!isAllowedBaseUrl(llmBaseUrl)) {
    return Response.json(
      {
        error:
          'llmBaseUrl is not an allowed provider. Supported: ' +
          [...ALLOWED_LLM_HOSTS].join(', '),
      },
      { status: 400 },
    )
  }

  const encoder = new TextEncoder()
  const stream = new ReadableStream({
    async start(controller) {
      const send = (e: AgentEvent) => {
        controller.enqueue(encoder.encode(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`))
      }
      try {
        await runAgent({
          messages,
          llmApiKey,
          llmBaseUrl,
          e2bApiKey,
          model,
          temperature,
          enabledSkills: Array.isArray(skills) ? skills : undefined,
          signal: req.signal,
          onEvent: send,
        })
      } catch (e: any) {
        send({ type: 'error', message: e?.message || 'Agent crashed' })
      } finally {
        controller.enqueue(encoder.encode('event: done\ndata: {}\n\n'))
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  })
}

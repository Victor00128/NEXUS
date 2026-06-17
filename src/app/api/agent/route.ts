/**
 * POST /api/agent  — runs the NEXUS autonomous agent and streams steps via SSE.
 *
 * Requires server mode (not static export). The E2B key is read from the server
 * environment (E2B_API_KEY); the OpenRouter key is passed by the client.
 */

import { runAgent, type AgentEvent } from '@/lib/agent'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'
export const maxDuration = 300 // allow long agent runs where the host permits

export async function POST(req: Request) {
  let body: any
  try {
    body = await req.json()
  } catch {
    return Response.json({ error: 'Invalid JSON body' }, { status: 400 })
  }

  const { messages, llmApiKey, llmBaseUrl, model, temperature, skills } = body || {}
  const e2bApiKey = process.env.E2B_API_KEY

  if (!Array.isArray(messages) || messages.length === 0) {
    return Response.json({ error: 'messages (non-empty array) is required' }, { status: 400 })
  }
  if (!e2bApiKey) {
    return Response.json(
      { error: 'Agent not configured: E2B_API_KEY is missing on the server (.env.local).' },
      { status: 500 },
    )
  }
  if (!llmApiKey || !llmBaseUrl) {
    return Response.json({ error: 'llmApiKey and llmBaseUrl are required' }, { status: 400 })
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

/**
 * Browser client for the NEXUS Agent SSE endpoint (/api/agent).
 */
import type { AgentEvent, AgentArtifact } from './agent'

export type { AgentEvent, AgentArtifact }

export interface AgentChatMessage {
  role: 'system' | 'user' | 'assistant'
  content: any
}

export interface StreamAgentOptions {
  messages: AgentChatMessage[]
  llmApiKey: string
  llmBaseUrl: string
  model?: string
  temperature?: number
  /** Enabled skill ids the model may auto-select from. */
  skills?: string[]
  signal?: AbortSignal
}

/**
 * Start an agentic chat turn and invoke `onEvent` for each streamed step.
 * Resolves when the stream ends (event: done).
 */
export async function streamAgent(
  opts: StreamAgentOptions,
  onEvent: (e: AgentEvent) => void,
): Promise<void> {
  const res = await fetch('/api/agent', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      messages: opts.messages,
      llmApiKey: opts.llmApiKey,
      llmBaseUrl: opts.llmBaseUrl,
      model: opts.model,
      temperature: opts.temperature,
      skills: opts.skills,
    }),
    signal: opts.signal,
  })

  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error((err as any)?.error || `Agent request failed (${res.status})`)
  }
  const reader = res.body?.getReader()
  if (!reader) throw new Error('No response stream from agent')

  const decoder = new TextDecoder()
  let buffer = ''

  while (true) {
    const { done, value } = await reader.read()
    if (done) break
    buffer += decoder.decode(value, { stream: true })
    const chunks = buffer.split('\n\n')
    buffer = chunks.pop() || ''
    for (const chunk of chunks) {
      const lines = chunk.split('\n')
      let event = ''
      let data = ''
      for (const line of lines) {
        if (line.startsWith('event: ')) event = line.slice(7).trim()
        else if (line.startsWith('data: ')) data += line.slice(6)
      }
      if (event === 'done') return
      if (!data) continue
      try {
        onEvent(JSON.parse(data) as AgentEvent)
      } catch {
        /* skip malformed */
      }
    }
  }
}

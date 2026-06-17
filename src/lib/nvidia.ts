/**
 * NVIDIA NIM API Integration
 * Routes requests to NVIDIA-hosted models via NIM API
 */

// Routed through the same-origin proxy rewrite (next.config.js) because
// NVIDIA NIM does not send CORS headers — a direct browser fetch is blocked.
const NVIDIA_API_URL = '/__nvidia/v1/chat/completions/'

export const NVIDIA_MODELS = [
  { id: 'nvidia/llama-3.1-nemotron-70b-instruct', name: 'Nemotron 70B', provider: 'NVIDIA' },
  { id: 'nvidia/llama-3.1-nemotron-51b-instruct', name: 'Nemotron 51B', provider: 'NVIDIA' },
  { id: 'nvidia/mistral-large-2411', name: 'Mistral Large', provider: 'NVIDIA' },
  { id: 'nvidia/llama-3.3-nemotron-super-49b-v1', name: 'Nemotron Super 49B', provider: 'NVIDIA' },
  { id: 'nvidia/deepseek-llm-r1', name: 'DeepSeek R1', provider: 'NVIDIA' },
  { id: 'nvidia/qwen2.5-72b-instruct', name: 'Qwen 2.5 72B', provider: 'NVIDIA' },
  { id: 'nvidia/phi-4', name: 'Phi-4', provider: 'NVIDIA' },
  { id: 'nvidia/llama-3.2-3b-instruct', name: 'Llama 3.2 3B', provider: 'NVIDIA' },
  { id: 'nvidia/llama-3.2-1b-instruct', name: 'Llama 3.2 1B', provider: 'NVIDIA' },
] as const

import { NVIDIA_MODEL_PREFIX, toRealModelId } from './models'

/**
 * True when a model is served by NVIDIA NIM.
 *
 * Routing is by operator prefix (`nim:`), NOT by vendor prefix — NVIDIA NIM
 * hosts models from many vendors (meta/…, qwen/…), so the old `nvidia/` check
 * mis-routed most NVIDIA models to OpenRouter.
 */
export function isNvidiaModel(modelId: string): boolean {
  return modelId.startsWith(NVIDIA_MODEL_PREFIX)
}

export function formatNvidiaError(status: number, errorMessage?: string): string {
  const msg = (errorMessage || '').toLowerCase()

  if (status === 401 || msg.includes('invalid') || msg.includes('unauthorized')) {
    return 'Your NVIDIA API key is invalid or expired. Go to Settings → NVIDIA API Key and enter a valid key from [build.nvidia.com](https://build.nvidia.com).'
  }
  if (status === 429 || msg.includes('rate limit') || msg.includes('too many requests')) {
    return 'Rate limited by NVIDIA NIM API. Wait a moment and try again.'
  }
  if (status === 404 || msg.includes('not found')) {
    return 'The selected NVIDIA model is currently unavailable. Try a different model.'
  }
  if (status >= 500) {
    return 'NVIDIA NIM API is experiencing server issues. Try again in a moment.'
  }
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return 'The request to NVIDIA timed out. Try again or switch to a different model.'
  }

  return errorMessage || `NVIDIA API error (${status}). Check your API key and network connection.`
}

interface NvidiaMessage {
  role: 'system' | 'user' | 'assistant'
  content: string
}

interface NvidiaSendMessageOptions {
  messages: NvidiaMessage[]
  model: string
  apiKey: string
  signal?: AbortSignal
  temperature?: number
  maxTokens?: number
  top_p?: number
  frequency_penalty?: number
  presence_penalty?: number
}

export async function sendNvidiaMessage({
  messages,
  model,
  apiKey,
  signal,
  temperature = 0.7,
  maxTokens = 4096,
  top_p,
  frequency_penalty,
  presence_penalty,
}: NvidiaSendMessageOptions): Promise<string> {
  if (!apiKey) {
    throw new Error('No NVIDIA API key set. Go to Settings → NVIDIA API Key and enter your key from [build.nvidia.com](https://build.nvidia.com).')
  }

  const body: Record<string, unknown> = {
    model: toRealModelId(model),
    messages,
    temperature,
    max_tokens: maxTokens,
  }

  if (top_p !== undefined) body.top_p = top_p
  if (frequency_penalty !== undefined) body.frequency_penalty = frequency_penalty
  if (presence_penalty !== undefined) body.presence_penalty = presence_penalty

  const response = await fetch(NVIDIA_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(formatNvidiaError(response.status, (errorData as any).error?.message || (errorData as any).detail))
  }

  const data = await response.json()

  if (!data.choices || data.choices.length === 0) {
    throw new Error('No response from NVIDIA model')
  }

  return data.choices[0].message.content
}

export async function* streamNvidiaMessage({
  messages,
  model,
  apiKey,
  signal,
  temperature = 0.7,
  maxTokens = 4096,
  top_p,
  frequency_penalty,
  presence_penalty,
}: NvidiaSendMessageOptions): AsyncGenerator<string, void, unknown> {
  if (!apiKey) {
    throw new Error('No NVIDIA API key set. Go to Settings → NVIDIA API Key and enter your key from [build.nvidia.com](https://build.nvidia.com).')
  }

  const body: Record<string, unknown> = {
    model: toRealModelId(model),
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true,
  }

  if (top_p !== undefined) body.top_p = top_p
  if (frequency_penalty !== undefined) body.frequency_penalty = frequency_penalty
  if (presence_penalty !== undefined) body.presence_penalty = presence_penalty

  const response = await fetch(NVIDIA_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'text/event-stream',
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(formatNvidiaError(response.status, (errorData as any).error?.message || (errorData as any).detail))
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body from NVIDIA stream')

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed || trimmed === 'data: [DONE]') continue
        if (!trimmed.startsWith('data: ')) continue

        try {
          const json = JSON.parse(trimmed.slice(6))
          const content = json.choices?.[0]?.delta?.content
          if (content) {
            yield content
          }
        } catch {
          // Skip invalid JSON chunks
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

export async function validateNvidiaApiKey(apiKey: string): Promise<boolean> {
  try {
    const response = await fetch('/__nvidia/v1/models/', {
      headers: {
        'Authorization': `Bearer ${apiKey}`,
      },
    })
    return response.ok
  } catch {
    return false
  }
}

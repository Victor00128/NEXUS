/**
 * OpenRouter API Integration
 * Routes requests to multiple AI models via OpenRouter
 */

const OPENROUTER_API_URL = 'https://openrouter.ai/api/v1/chat/completions'

/**
 * Maps API error responses to specific, actionable user-facing messages.
 */
export function formatAPIError(status: number, errorMessage?: string): string {
  const msg = (errorMessage || '').toLowerCase()

  // Authentication / API key issues
  if (status === 401 || msg.includes('invalid api key') || msg.includes('no auth') || msg.includes('unauthorized')) {
    return 'Your OpenRouter API key is invalid or expired. Go to Settings → API Key and enter a valid key from [openrouter.ai/keys](https://openrouter.ai/keys).'
  }
  if (status === 403) {
    if (msg.includes('insufficient') || msg.includes('credit') || msg.includes('balance') || msg.includes('payment')) {
      return 'Your OpenRouter account has insufficient credits. Add credits at [openrouter.ai/credits](https://openrouter.ai/credits), then try again.'
    }
    return 'Access denied by OpenRouter. Your API key may lack permissions for this model, or your account may need credits. Check your key at [openrouter.ai/keys](https://openrouter.ai/keys).'
  }

  // Rate limiting
  if (status === 429 || msg.includes('rate limit') || msg.includes('too many requests')) {
    return 'Rate limited by OpenRouter. Wait a moment and try again, or upgrade your plan at [openrouter.ai](https://openrouter.ai) for higher limits.'
  }

  // Model-specific issues
  if (status === 404 || msg.includes('not found') || msg.includes('no endpoints')) {
    return 'The selected model is currently unavailable on OpenRouter. Try a different model from the model selector.'
  }

  // Content moderation
  if (msg.includes('moderation') || msg.includes('content policy') || msg.includes('flagged')) {
    return 'Your message was flagged by the model\'s content filter. Try rephrasing your prompt.'
  }

  // Upstream / server errors
  if (status === 502 || status === 503 || msg.includes('overloaded') || msg.includes('capacity')) {
    return 'The model provider is temporarily overloaded. Wait a moment and try again, or switch to a different model.'
  }
  if (status >= 500) {
    return 'OpenRouter is experiencing server issues. Try again in a moment.'
  }

  // Timeout
  if (msg.includes('timeout') || msg.includes('timed out')) {
    return 'The request timed out. The model may be under heavy load — try again or switch to a faster model.'
  }

  // Fallback
  return errorMessage || `API error (${status}). Check your API key and network connection.`
}

/** A multimodal content part (vision / files). */
export type ContentPart =
  | { type: 'text'; text: string }
  | { type: 'image_url'; image_url: { url: string } }

interface Message {
  role: 'system' | 'user' | 'assistant'
  /** Plain text, or an array of parts for vision-capable models. */
  content: string | ContentPart[]
}

interface SendMessageOptions {
  messages: Message[]
  model: string
  apiKey: string
  noLog?: boolean
  signal?: AbortSignal
  temperature?: number
  maxTokens?: number
  top_p?: number
  top_k?: number
  frequency_penalty?: number
  presence_penalty?: number
  repetition_penalty?: number
}

interface OpenRouterResponse {
  id: string
  model: string
  choices: {
    message: {
      role: string
      content: string
    }
    finish_reason: string
  }[]
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

/**
 * Send a message to the AI model via OpenRouter
 */
export async function sendMessage({
  messages,
  model,
  apiKey,
  noLog = false,
  signal,
  temperature = 0.7,
  maxTokens = 4096,
  top_p,
  top_k,
  frequency_penalty,
  presence_penalty,
  repetition_penalty
}: SendMessageOptions): Promise<string> {
  if (!apiKey) {
    throw new Error('No API key set. Go to Settings → API Key and enter your OpenRouter key from [openrouter.ai/keys](https://openrouter.ai/keys).')
  }

  // Prepare request body
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens
  }

  // Add optional sampling parameters (only if explicitly set)
  if (top_p !== undefined) body.top_p = top_p
  if (top_k !== undefined) body.top_k = top_k
  if (frequency_penalty !== undefined) body.frequency_penalty = frequency_penalty
  if (presence_penalty !== undefined) body.presence_penalty = presence_penalty
  if (repetition_penalty !== undefined) body.repetition_penalty = repetition_penalty

  // Add provider-specific options if needed
  const providerOptions: Record<string, unknown> = {}

  // Handle no-log mode for supported providers
  if (noLog) {
    // OpenRouter passes through provider preferences
    providerOptions['allow_fallbacks'] = false
  }

  if (Object.keys(providerOptions).length > 0) {
    body.provider = providerOptions
  }

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://nexus.ai',
      'X-Title': 'nexus.AI'
    },
    body: JSON.stringify(body),
    signal
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(formatAPIError(response.status, errorData.error?.message))
  }

  const data: OpenRouterResponse = await response.json()

  if (!data.choices || data.choices.length === 0) {
    throw new Error('No response from model')
  }

  return data.choices[0].message.content
}

/**
 * Stream a message response from the AI model
 * (For future implementation)
 */
export async function* streamMessage({
  messages,
  model,
  apiKey,
  noLog = false,
  signal,
  temperature = 0.7,
  maxTokens = 4096,
  top_p,
  top_k,
  frequency_penalty,
  presence_penalty,
  repetition_penalty
}: SendMessageOptions): AsyncGenerator<string, void, unknown> {
  if (!apiKey) {
    throw new Error('No API key set. Go to Settings → API Key and enter your OpenRouter key from [openrouter.ai/keys](https://openrouter.ai/keys).')
  }

  const streamBody: Record<string, unknown> = {
    model,
    messages,
    temperature,
    max_tokens: maxTokens,
    stream: true
  }

  if (top_p !== undefined) streamBody.top_p = top_p
  if (top_k !== undefined) streamBody.top_k = top_k
  if (frequency_penalty !== undefined) streamBody.frequency_penalty = frequency_penalty
  if (presence_penalty !== undefined) streamBody.presence_penalty = presence_penalty
  if (repetition_penalty !== undefined) streamBody.repetition_penalty = repetition_penalty

  const response = await fetch(OPENROUTER_API_URL, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'HTTP-Referer': 'https://nexus.ai',
      'X-Title': 'nexus.AI'
    },
    body: JSON.stringify(streamBody),
    signal
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    throw new Error(formatAPIError(response.status, errorData.error?.message))
  }

  const reader = response.body?.getReader()
  if (!reader) {
    throw new Error('No response body')
  }

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
          // Skip invalid JSON
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

/**
 * Get available models from OpenRouter
 */
export async function getModels(apiKey: string): Promise<string[]> {
  const response = await fetch('https://openrouter.ai/api/v1/models', {
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://nexus.ai',
      'X-Title': 'nexus.AI'
    }
  })

  if (!response.ok) {
    throw new Error('Failed to fetch models')
  }

  const data = await response.json()
  return data.data.map((model: { id: string }) => model.id)
}

/**
 * Validate an API key
 */
export async function validateApiKey(apiKey: string): Promise<boolean> {
  try {
    await getModels(apiKey)
    return true
  } catch {
    return false
  }
}

// ── Proxy Mode: Route standard chat through self-hosted API ───────────

interface ProxyMessageOptions {
  messages: Message[]
  model: string
  apiBaseUrl: string
  nexusApiKey: string
  signal?: AbortSignal
  temperature?: number
  maxTokens?: number
  top_p?: number
  top_k?: number
  frequency_penalty?: number
  presence_penalty?: number
  repetition_penalty?: number
  nexus?: boolean
  stmModules?: string[]
}

/**
 * Send a message via the self-hosted NEXUS API server.
 * Used in proxy mode when no personal OpenRouter key is available —
 * the server uses its own server-side key.
 */
export async function sendMessageViaProxy({
  messages,
  model,
  apiBaseUrl,
  nexusApiKey,
  signal,
  temperature,
  maxTokens = 4096,
  top_p,
  top_k,
  frequency_penalty,
  presence_penalty,
  repetition_penalty,
  nexus = true,
  stmModules = ['hedge_reducer', 'direct_mode'],
}: ProxyMessageOptions): Promise<string> {
  const body: Record<string, unknown> = {
    messages,
    model,
    max_tokens: maxTokens,
    nexus,
    stm_modules: stmModules,
  }

  if (temperature !== undefined) body.temperature = temperature
  if (top_p !== undefined) body.top_p = top_p
  if (top_k !== undefined) body.top_k = top_k
  if (frequency_penalty !== undefined) body.frequency_penalty = frequency_penalty
  if (presence_penalty !== undefined) body.presence_penalty = presence_penalty
  if (repetition_penalty !== undefined) body.repetition_penalty = repetition_penalty

  const response = await fetch(`${apiBaseUrl}/v1/chat/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${nexusApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
    signal,
  })

  if (!response.ok) {
    const errorData = await response.json().catch(() => ({}))
    const errorMessage = (errorData as any).error?.message || (errorData as any).error || `API error: ${response.status}`
    throw new Error(errorMessage)
  }

  const data = await response.json()

  if (!data.choices || data.choices.length === 0) {
    throw new Error('No response from model')
  }

  return data.choices[0].message.content
}

// ── SYNTHESIS Streaming (Hive-Mind Synthesis) ────────────────────────

export interface SynthesisModel {
  model: string
  score: number
  duration_ms: number
  success: boolean
  error?: string
  content_length: number
  models_collected: number
  models_total: number
}

export interface SynthesisComplete {
  synthesis: string
  orchestrator: { model: string; duration_ms: number }
  collection: {
    tier: string
    models_queried: number
    models_succeeded: number
    collection_duration_ms: number
    total_duration_ms: number
    responses: Array<{
      model: string; score: number; duration_ms: number
      success: boolean; error?: string; content_length: number
    }>
  }
  params_used: Record<string, number | undefined>
  pipeline: {
    nexus: boolean
    tuning: { detected_context: string; confidence: number; reasoning: string; strategy: string } | null
    obfuscation: { triggers_found: string[]; technique_used: string; transformations_count: number } | null
    stm: { modules_applied: string[]; original_length: number; transformed_length: number } | null
  }
}

export interface SynthesisCallbacks {
  onStart?: (data: { tier: string; models_queried: number; orchestrator: string }) => void
  onModelResult?: (data: SynthesisModel) => void
  /** Dynamic Upgrade: fires when a new best individual response arrives during collection */
  onBestResponse?: (data: { model: string; content: string; score: number; duration_ms: number }) => void
  onSynthesisStart?: (data: { orchestrator: string; responses_collected: number; collection_duration_ms: number }) => void
  onComplete?: (data: SynthesisComplete) => void
  onError?: (error: string) => void
}

export interface SynthesisOptions {
  messages: Message[]
  openrouterApiKey: string
  apiBaseUrl: string
  nexusApiKey: string
  tier?: 'fast' | 'standard' | 'smart' | 'power' | 'ultra'
  orchestrator_model?: string
  nexus?: boolean
  tuning?: boolean
  strategy?: string
  obfuscation?: boolean
  obfuscation_technique?: string
  obfuscation_intensity?: string
  stmModules?: string[]
  /** Dynamic Upgrade: show best individual response while synthesizing, morph to final */
  liquid?: boolean
  /** Minimum score improvement to trigger a leader upgrade (1-50). Default 8. */
  dynamic_min_delta?: number
  signal?: AbortSignal
}

/**
 * Stream a synthesis via SSE.
 *
 * Phase 1: Model collection events fire as each model responds.
 * Phase 2: Orchestrator synthesis starts after collection.
 * Phase 3: Complete event with full metadata.
 */
export async function streamSynthesis(
  options: SynthesisOptions,
  callbacks: SynthesisCallbacks,
): Promise<void> {
  const {
    messages, openrouterApiKey, apiBaseUrl, nexusApiKey,
    tier = 'fast', orchestrator_model, nexus = true,
    tuning = true, strategy = 'adaptive',
    obfuscation = true, obfuscation_technique = 'leetspeak',
    obfuscation_intensity = 'medium', stmModules = ['hedge_reducer', 'direct_mode'],
    liquid = true, dynamic_min_delta = 8,
    signal,
  } = options

  const response = await fetch(`${apiBaseUrl}/v1/synthesis/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${nexusApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages, openrouter_api_key: openrouterApiKey, tier, orchestrator_model,
      nexus, tuning, strategy, obfuscation, obfuscation_technique,
      obfuscation_intensity, stmModules, stream: true, liquid, dynamic_min_delta,
    }),
    signal,
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(formatAPIError(response.status, err.error))
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body from synthesis stream')

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      let currentEvent = ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) { currentEvent = ''; continue }
        if (trimmed.startsWith('event: ')) { currentEvent = trimmed.slice(7); continue }
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6))
            switch (currentEvent) {
              case 'synthesis:start':
                callbacks.onStart?.(data)
                break
              case 'synthesis:model':
                callbacks.onModelResult?.(data)
                break
              case 'synthesis:leader':
                callbacks.onBestResponse?.(data)
                break
              case 'synthesis:synthesis:start':
                callbacks.onSynthesisStart?.(data)
                break
              case 'synthesis:complete':
                callbacks.onComplete?.(data)
                break
              case 'synthesis:error':
                callbacks.onError?.(data.error)
                break
            }
          } catch {}
          currentEvent = ''
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

// ── RACE Streaming (Dynamic Upgrade) ──────────────────────────

export interface RaceModel {
  model: string
  score: number
  duration_ms: number
  success: boolean
  error?: string
  content_length: number
  models_responded: number
  models_total: number
}

export interface RaceLeader {
  model: string
  score: number
  duration_ms: number
  content: string
}

export interface RaceComplete {
  response: string
  winner: { model: string; score: number; duration_ms: number } | null
  race: {
    tier: string
    models_queried: number
    models_succeeded: number
    total_duration_ms: number
    rankings: Array<{
      model: string; score: number; duration_ms: number
      success: boolean; error?: string; content_length: number
      content?: string
    }>
  }
  params_used: Record<string, number | undefined>
  pipeline: {
    nexus: boolean
    tuning: { detected_context: string; confidence: number; reasoning: string; strategy: string } | null
    obfuscation: { triggers_found: string[]; technique_used: string; transformations_count: number } | null
    stm: { modules_applied: string[]; original_length: number; transformed_length: number } | null
  }
}

export interface RaceCallbacks {
  onRaceStart?: (data: { tier: string; models_queried: number }) => void
  onModelResult?: (data: RaceModel) => void
  onLeaderChange?: (data: RaceLeader) => void
  onComplete?: (data: RaceComplete) => void
  onError?: (error: string) => void
}

export interface RaceOptions {
  messages: Message[]
  openrouterApiKey: string
  apiBaseUrl: string
  nexusApiKey: string
  tier?: 'fast' | 'standard' | 'smart' | 'power' | 'ultra'
  nexus?: boolean
  tuning?: boolean
  strategy?: string
  obfuscation?: boolean
  obfuscation_technique?: string
  obfuscation_intensity?: string
  stmModules?: string[]
  /** Enable Dynamic Upgrade (SSE streaming with live leader upgrades). Default true. */
  liquid?: boolean
  /** Minimum score improvement to trigger a leader upgrade (1-50). Default 8. */
  dynamic_min_delta?: number
  signal?: AbortSignal
}

/**
 * Stream a race via SSE.
 *
 * Connects to the backend's streaming endpoint and fires callbacks
 * as models finish. The first good response arrives in ~3-5s,
 * with live upgrades as better responses come in.
 */
export async function streamRace(
  options: RaceOptions,
  callbacks: RaceCallbacks,
): Promise<void> {
  const {
    messages, openrouterApiKey, apiBaseUrl, nexusApiKey,
    tier = 'fast', nexus = true, tuning = true, strategy = 'adaptive',
    obfuscation = true, obfuscation_technique = 'leetspeak',
    obfuscation_intensity = 'medium', stmModules = ['hedge_reducer', 'direct_mode'],
    liquid = true, dynamic_min_delta = 8,
    signal,
  } = options

  const response = await fetch(`${apiBaseUrl}/v1/race/completions`, {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${nexusApiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      messages, openrouter_api_key: openrouterApiKey, tier, nexus,
      tuning, strategy, obfuscation, obfuscation_technique,
      obfuscation_intensity, stmModules, stream: liquid, dynamic_min_delta,
    }),
    signal,
  })

  if (!response.ok) {
    const err = await response.json().catch(() => ({}))
    throw new Error(formatAPIError(response.status, err.error))
  }

  const reader = response.body?.getReader()
  if (!reader) throw new Error('No response body from race stream')

  const decoder = new TextDecoder()
  let buffer = ''

  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break

      buffer += decoder.decode(value, { stream: true })
      const lines = buffer.split('\n')
      buffer = lines.pop() || ''

      let currentEvent = ''
      for (const line of lines) {
        const trimmed = line.trim()
        if (!trimmed) {
          currentEvent = ''
          continue
        }
        if (trimmed.startsWith('event: ')) {
          currentEvent = trimmed.slice(7)
          continue
        }
        if (trimmed.startsWith('data: ')) {
          try {
            const data = JSON.parse(trimmed.slice(6))
            switch (currentEvent) {
              case 'race:start':
                callbacks.onRaceStart?.(data)
                break
              case 'race:model':
                callbacks.onModelResult?.(data)
                break
              case 'race:leader':
                callbacks.onLeaderChange?.(data)
                break
              case 'race:complete':
                callbacks.onComplete?.(data)
                break
              case 'race:error':
                callbacks.onError?.(data.error)
                break
            }
          } catch {}
          currentEvent = ''
        }
      }
    }
  } finally {
    reader.releaseLock()
  }
}

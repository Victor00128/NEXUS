export interface TelemetryEvent {
  type: 'chat_completion'
  timestamp: number
  session_id: string
  [key: string]: unknown
}

const TOP_LEVEL_FIELDS = new Set([
  'type', 'timestamp', 'session_id', 'mode', 'model', 'duration_ms',
  'response_length', 'success', 'error_type', 'pipeline', 'tuning',
  'obfuscation', 'race', 'classification', 'persona', 'prompt_length',
  'conversation_depth', 'memory_count', 'no_log',
  'obfuscation_transformed',
])

const SAFE_TAG = /^[A-Za-z0-9][A-Za-z0-9._:/-]{0,127}$/
const SAFE_SESSION = /^[A-Za-z0-9-]{8,64}$/

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every(key => allowed.includes(key))
}

function isSafeTag(value: unknown): value is string {
  return typeof value === 'string' && SAFE_TAG.test(value)
}

function isFiniteRange(value: unknown, min: number, max: number): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= min && value <= max
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean'
}

function isPipeline(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ['tuning', 'obfuscation', 'stmModules', 'strategy', 'nexus'])) return false
  if (!isBoolean(value.tuning) || !isBoolean(value.obfuscation) || !isBoolean(value.nexus)) return false
  if (!Array.isArray(value.stmModules) || value.stmModules.length > 32 || !value.stmModules.every(isSafeTag)) return false
  return value.strategy === undefined || isSafeTag(value.strategy)
}

function isTuning(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['detected_context', 'confidence'])
    && isSafeTag(value.detected_context)
    && isFiniteRange(value.confidence, 0, 1)
}

function isObfuscation(value: unknown): boolean {
  return isRecord(value)
    && hasOnlyKeys(value, ['triggers_found', 'technique', 'intensity'])
    && isFiniteRange(value.triggers_found, 0, 10_000)
    && isSafeTag(value.technique)
    && isSafeTag(value.intensity)
}

function isRace(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, [
    'tier', 'models_queried', 'models_succeeded', 'winner_model',
    'winner_score', 'total_duration_ms',
  ])) return false
  return isSafeTag(value.tier)
    && isFiniteRange(value.models_queried, 0, 1_000)
    && isFiniteRange(value.models_succeeded, 0, 1_000)
    && isSafeTag(value.winner_model)
    && isFiniteRange(value.winner_score, -1_000, 1_000)
    && isFiniteRange(value.total_duration_ms, 0, 86_400_000)
}

function isClassification(value: unknown): boolean {
  if (!isRecord(value) || !hasOnlyKeys(value, ['domain', 'subcategory', 'confidence', 'flags', 'intent'])) return false
  if (!isSafeTag(value.domain) || !isSafeTag(value.subcategory) || !isFiniteRange(value.confidence, 0, 1)) return false
  if (!Array.isArray(value.flags) || value.flags.length > 16 || !value.flags.every(isSafeTag)) return false
  return value.intent === undefined || isSafeTag(value.intent)
}

/**
 * Accept only the structural event emitted by the current frontend. Unknown
 * fields and free-form nested content are rejected instead of being copied.
 */
export function validateTelemetryEvent(input: unknown): input is TelemetryEvent {
  if (!isRecord(input) || !Object.keys(input).every(key => TOP_LEVEL_FIELDS.has(key))) return false
  if (input.type !== 'chat_completion') return false
  if (!isFiniteRange(input.timestamp, 0, 9_999_999_999_999)) return false
  if (typeof input.session_id !== 'string' || !SAFE_SESSION.test(input.session_id)) return false
  if (input.mode !== 'standard' && input.mode !== 'race') return false
  if (!isSafeTag(input.model)) return false
  if (!isFiniteRange(input.duration_ms, 0, 86_400_000)) return false
  if (!isFiniteRange(input.response_length, 0, 100_000_000)) return false
  if (!isBoolean(input.success) || !isPipeline(input.pipeline)) return false

  if (input.error_type !== undefined && !isSafeTag(input.error_type)) return false
  if (input.tuning !== undefined && !isTuning(input.tuning)) return false
  if (input.obfuscation !== undefined && !isObfuscation(input.obfuscation)) return false
  if (input.race !== undefined && !isRace(input.race)) return false
  if (input.classification !== undefined && !isClassification(input.classification)) return false
  if (input.persona !== undefined && !isSafeTag(input.persona)) return false
  if (input.prompt_length !== undefined && !isFiniteRange(input.prompt_length, 0, 100_000_000)) return false
  if (input.conversation_depth !== undefined && !isFiniteRange(input.conversation_depth, 0, 1_000_000)) return false
  if (input.memory_count !== undefined && !isFiniteRange(input.memory_count, 0, 1_000_000)) return false
  if (input.no_log !== undefined && !isBoolean(input.no_log)) return false
  if (input.obfuscation_transformed !== undefined && !isBoolean(input.obfuscation_transformed)) return false

  return JSON.stringify(input).length <= 16_384
}

export type TelemetryPlatform = 'cloudflare' | 'vercel'

export function getClientRateLimitKey(request: Request, platform: TelemetryPlatform): string {
  if (platform === 'cloudflare') {
    const cloudflareIp = request.headers.get('CF-Connecting-IP')?.trim()
    return cloudflareIp ? `cf:${cloudflareIp}` : 'unknown-client'
  }

  // Vercel documents this as its trusted copy of the client IP. Generic
  // X-Forwarded-For and headers from another platform remain ignored.
  const vercelIp = request.headers.get('X-Vercel-Forwarded-For')?.split(',')[0]?.trim()
  return vercelIp ? `vercel:${vercelIp}` : 'unknown-client'
}

export function isAllowedOrigin(request: Request): boolean {
  const origin = request.headers.get('Origin')
  return origin === null || origin === new URL(request.url).origin
}

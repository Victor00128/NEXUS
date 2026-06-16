/**
 * Unified model registry.
 *
 * Models are fetched LIVE from whichever providers the user has a key for:
 *   - NVIDIA NIM  (https://integrate.api.nvidia.com/v1/models)
 *   - OpenRouter  (https://openrouter.ai/api/v1/models)
 *
 * Every model is tagged with the OPERATOR that serves it (NVIDIA vs
 * OpenRouter) so the UI can show where each one comes from, and so chat
 * routing can pick the right API + key.
 *
 * NVIDIA ids are namespaced with an `nim:` prefix because NVIDIA NIM serves
 * models from many vendors (meta/…, qwen/…, mistralai/…) whose bare ids would
 * otherwise be indistinguishable from the same model served by OpenRouter.
 * The prefix is the single source of truth for "which service runs this".
 */

export type Operator = 'NVIDIA' | 'OpenRouter'

export const NVIDIA_MODEL_PREFIX = 'nim:'

export interface UnifiedModel {
  /** Value stored in state (defaultModel / conversation.model). */
  id: string
  /** Real id to send to the provider API (operator prefix stripped). */
  realId: string
  /** Friendly display name. */
  name: string
  /** Which service serves this model — shown as a badge. */
  operator: Operator
  /** Who built the model (meta, qwen, anthropic, …). */
  vendor: string
  /** Context window label (e.g. "128K"), when known. */
  context?: string
}

export interface AvailableModelsResult {
  models: UnifiedModel[]
  errors: Partial<Record<Operator, string>>
}

// NVIDIA NIM sends no CORS headers, so the browser can't call it directly.
// In server mode (next dev / next start) we route through a same-origin proxy
// rewrite (see next.config.js) that forwards to integrate.api.nvidia.com.
// Trailing slash matches `trailingSlash: true` so there's no 308 redirect
// before the proxy rewrite forwards the request to NVIDIA.
const NVIDIA_MODELS_URL = '/__nvidia/v1/models/'
// OpenRouter supports CORS, so it's safe to call directly from the browser.
const OPENROUTER_MODELS_URL = 'https://openrouter.ai/api/v1/models'

function formatContext(tokens?: number): string | undefined {
  if (!tokens || tokens <= 0) return undefined
  if (tokens >= 1_000_000) return `${Math.round(tokens / 1_000_000)}M`
  if (tokens >= 1000) return `${Math.round(tokens / 1000)}K`
  return String(tokens)
}

function vendorFromId(id: string): string {
  const slash = id.indexOf('/')
  return slash > 0 ? id.slice(0, slash) : id
}

/** Turn "meta/llama-3.1-70b-instruct" into "Llama 3.1 70B Instruct". */
function prettifyName(id: string): string {
  const tail = id.includes('/') ? id.slice(id.indexOf('/') + 1) : id
  return tail
    .split(/[-_]/)
    .map((w) => (/^\d/.test(w) ? w.toUpperCase() : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(' ')
    .replace(/\bAi\b/g, 'AI')
}

/** True when an id is served by NVIDIA NIM (carries the operator prefix). */
export function isNvidiaOperatorId(id: string): boolean {
  return id.startsWith(NVIDIA_MODEL_PREFIX)
}

/** Strip the operator namespace prefix to get the real provider model id. */
export function toRealModelId(id: string): string {
  return id.startsWith(NVIDIA_MODEL_PREFIX) ? id.slice(NVIDIA_MODEL_PREFIX.length) : id
}

/** Fetch every model the NVIDIA NIM key can reach. */
export async function fetchNvidiaModels(apiKey: string, signal?: AbortSignal): Promise<UnifiedModel[]> {
  const res = await fetch(NVIDIA_MODELS_URL, {
    headers: { Authorization: `Bearer ${apiKey}` },
    signal,
  })
  if (!res.ok) throw new Error(`NVIDIA models request failed (${res.status})`)
  const data = await res.json()
  const list: any[] = Array.isArray(data?.data) ? data.data : []
  return list
    .filter((m) => m?.id)
    .map((m): UnifiedModel => {
      const realId = String(m.id)
      const ownedBy = typeof m.owned_by === 'string' && m.owned_by && m.owned_by !== 'system'
        ? m.owned_by
        : vendorFromId(realId)
      return {
        id: NVIDIA_MODEL_PREFIX + realId,
        realId,
        name: prettifyName(realId),
        operator: 'NVIDIA',
        vendor: ownedBy,
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/** Fetch every model the OpenRouter key can reach. */
export async function fetchOpenRouterModels(apiKey: string, signal?: AbortSignal): Promise<UnifiedModel[]> {
  const res = await fetch(OPENROUTER_MODELS_URL, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'HTTP-Referer': 'https://nexus.ai',
      'X-Title': 'nexus.AI',
    },
    signal,
  })
  if (!res.ok) throw new Error(`OpenRouter models request failed (${res.status})`)
  const data = await res.json()
  const list: any[] = Array.isArray(data?.data) ? data.data : []
  return list
    .filter((m) => m?.id)
    .map((m): UnifiedModel => {
      const realId = String(m.id)
      return {
        id: realId,
        realId,
        name: typeof m.name === 'string' && m.name ? m.name : prettifyName(realId),
        operator: 'OpenRouter',
        vendor: vendorFromId(realId),
        context: formatContext(typeof m.context_length === 'number' ? m.context_length : undefined),
      }
    })
    .sort((a, b) => a.name.localeCompare(b.name))
}

/**
 * Fetch the combined list of models for whatever keys are present.
 *
 * - Only NVIDIA key  → only NVIDIA models.
 * - Only OpenRouter  → only OpenRouter models.
 * - Both keys        → both sets, each tagged with its operator.
 *
 * One provider failing (bad/expired key, rate limit) never blocks the other:
 * its models are simply omitted and the error is reported per operator.
 */
export async function fetchAvailableModels(opts: {
  openrouterApiKey?: string
  nvidiaApiKey?: string
  signal?: AbortSignal
}): Promise<AvailableModelsResult> {
  const { openrouterApiKey, nvidiaApiKey, signal } = opts
  const models: UnifiedModel[] = []
  const errors: Partial<Record<Operator, string>> = {}
  const tasks: Array<Promise<void>> = []

  if (nvidiaApiKey) {
    tasks.push(
      fetchNvidiaModels(nvidiaApiKey, signal)
        .then((ms) => { models.push(...ms) })
        .catch((e) => { errors.NVIDIA = e?.message || 'Failed to load NVIDIA models' }),
    )
  }
  if (openrouterApiKey) {
    tasks.push(
      fetchOpenRouterModels(openrouterApiKey, signal)
        .then((ms) => { models.push(...ms) })
        .catch((e) => { errors.OpenRouter = e?.message || 'Failed to load OpenRouter models' }),
    )
  }

  await Promise.all(tasks)
  return { models, errors }
}

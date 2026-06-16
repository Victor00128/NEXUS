'use client'

import { useEffect, useState } from 'react'
import { useStore } from '@/store'
import { fetchAvailableModels, type Operator, type UnifiedModel } from '@/lib/models'

export interface UseAvailableModels {
  models: UnifiedModel[]
  loading: boolean
  errors: Partial<Record<Operator, string>>
  /** True once at least one provider key is present. */
  hasKeys: boolean
}

/**
 * Live model list driven by the user's API keys.
 *
 * Re-fetches whenever the OpenRouter or NVIDIA key changes:
 *   - no keys        → empty list (UI prompts to add a key)
 *   - one key        → that provider's models only
 *   - both keys      → the union, each tagged with its operator
 */
export function useAvailableModels(): UseAvailableModels {
  const apiKey = useStore((s) => s.apiKey)
  const nvidiaApiKey = useStore((s) => s.nvidiaApiKey)
  const isHydrated = useStore((s) => s.isHydrated)

  const [models, setModels] = useState<UnifiedModel[]>([])
  const [loading, setLoading] = useState(false)
  const [errors, setErrors] = useState<Partial<Record<Operator, string>>>({})

  const hasKeys = Boolean(apiKey || nvidiaApiKey)

  useEffect(() => {
    if (!isHydrated) return

    if (!hasKeys) {
      setModels([])
      setErrors({})
      setLoading(false)
      return
    }

    const controller = new AbortController()
    setLoading(true)

    fetchAvailableModels({
      openrouterApiKey: apiKey,
      nvidiaApiKey,
      signal: controller.signal,
    })
      .then((res) => {
        if (controller.signal.aborted) return
        setModels(res.models)
        setErrors(res.errors)
      })
      .catch(() => {
        if (controller.signal.aborted) return
        setModels([])
        setErrors({})
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false)
      })

    return () => controller.abort()
  }, [apiKey, nvidiaApiKey, isHydrated, hasKeys])

  return { models, loading, errors, hasKeys }
}

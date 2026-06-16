'use client'

import { useEffect, useMemo, useState } from 'react'
import { useStore } from '@/store'
import { useAvailableModels } from '@/hooks/useModels'
import { useT } from '@/lib/i18n'
import type { Operator, UnifiedModel } from '@/lib/models'
import { ChevronDown, Boxes, Loader2, AlertCircle } from 'lucide-react'

const OPERATOR_BADGE: Record<Operator, { label: string; className: string }> = {
  NVIDIA: {
    label: 'NVIDIA',
    className: 'bg-[#76b900]/15 text-[#76b900] border border-[#76b900]/40',
  },
  OpenRouter: {
    label: 'OpenRouter',
    className: 'bg-indigo-500/15 text-indigo-300 border border-indigo-400/40',
  },
}

// NVIDIA first, then OpenRouter.
const OPERATOR_ORDER: Operator[] = ['NVIDIA', 'OpenRouter']

function OperatorBadge({ operator }: { operator: Operator }) {
  const badge = OPERATOR_BADGE[operator]
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded font-semibold shrink-0 ${badge.className}`}>
      {badge.label}
    </span>
  )
}

export function ModelSelector() {
  const { defaultModel, setDefaultModel, setShowSettings } = useStore()
  const { models, loading, errors, hasKeys } = useAvailableModels()
  const [isOpen, setIsOpen] = useState(false)
  const t = useT()

  const activeModel = models.find((m) => m.id === defaultModel) || null

  // Keep the selection valid: if the stored default isn't in the available
  // list (key changed, stale persisted value, switched providers), fall back
  // to the first available model so the chat never points at a dead id.
  useEffect(() => {
    if (loading || models.length === 0) return
    if (!models.some((m) => m.id === defaultModel)) {
      setDefaultModel(models[0].id)
    }
  }, [models, loading, defaultModel, setDefaultModel])

  // Group models by operator for display.
  const groups = useMemo(() => {
    const byOp = new Map<Operator, UnifiedModel[]>()
    for (const m of models) {
      const arr = byOp.get(m.operator)
      if (arr) arr.push(m)
      else byOp.set(m.operator, [m])
    }
    return OPERATOR_ORDER.filter((op) => byOp.has(op)).map((op) => ({
      operator: op,
      models: byOp.get(op)!,
    }))
  }, [models])

  const errorEntries = Object.entries(errors) as [Operator, string][]

  const buttonLabel = !hasKeys
    ? 'Add an API key →'
    : loading && models.length === 0
      ? 'Loading models…'
      : activeModel
        ? activeModel.name
        : models.length === 0
          ? 'No models available'
          : 'Select a model'

  return (
    <div className="relative">
      <label className="text-xs theme-secondary mb-1 block">
        {t('sidebar.model')}
        {hasKeys && models.length > 0 && (
          <span className="theme-secondary opacity-60"> · {models.length} {t('sidebar.available')}</span>
        )}
      </label>
      <button
        onClick={() => (hasKeys ? setIsOpen(!isOpen) : setShowSettings(true))}
        className="w-full flex items-center justify-between px-3 py-2
          bg-theme-bg border border-theme-primary rounded-lg
          hover:glow-box transition-all text-sm"
      >
        <div className="flex items-center gap-2 min-w-0">
          {loading && models.length === 0 ? (
            <Loader2 className="w-4 h-4 animate-spin shrink-0" />
          ) : (
            <Boxes className="w-4 h-4 shrink-0 theme-secondary" />
          )}
          <span className="truncate">{buttonLabel}</span>
          {activeModel && <OperatorBadge operator={activeModel.operator} />}
        </div>
        {hasKeys && (
          <ChevronDown className={`w-4 h-4 shrink-0 transition-transform ${isOpen ? 'rotate-180' : ''}`} />
        )}
      </button>

      {isOpen && hasKeys && (
        <>
          {/* Backdrop */}
          <div className="fixed inset-0 z-10" onClick={() => setIsOpen(false)} />

          {/* Dropdown */}
          <div
            className="absolute top-full left-0 right-0 mt-1 z-20
              bg-theme-dim border border-theme-primary rounded-lg
              shadow-lg max-h-96 overflow-y-auto"
          >
            {/* Per-provider load errors (e.g. bad/expired key, rate limit) */}
            {errorEntries.map(([operator, message]) => (
              <div
                key={operator}
                className="flex items-start gap-2 px-3 py-2 text-xs text-red-400 border-b border-theme-primary/30"
              >
                <AlertCircle className="w-3.5 h-3.5 mt-0.5 shrink-0" />
                <span>
                  <span className="font-semibold">{OPERATOR_BADGE[operator].label}:</span> {message}
                </span>
              </div>
            ))}

            {loading && models.length === 0 && (
              <div className="flex items-center gap-2 px-3 py-4 text-sm theme-secondary">
                <Loader2 className="w-4 h-4 animate-spin" />
                Loading models…
              </div>
            )}

            {!loading && models.length === 0 && errorEntries.length === 0 && (
              <div className="px-3 py-4 text-sm theme-secondary">
                No models available for your API key.
              </div>
            )}

            {groups.map((group) => (
              <div key={group.operator}>
                {/* Operator section header */}
                <div className="sticky top-0 z-10 flex items-center justify-between gap-2 px-3 py-1.5
                  bg-theme-dim/95 backdrop-blur border-b border-theme-primary/30">
                  <OperatorBadge operator={group.operator} />
                  <span className="text-[10px] theme-secondary">{group.models.length} models</span>
                </div>

                {group.models.map((model) => (
                  <button
                    key={model.id}
                    onClick={() => {
                      setDefaultModel(model.id)
                      setIsOpen(false)
                    }}
                    className={`w-full flex items-start gap-3 px-3 py-2.5 text-left
                      hover:bg-theme-accent transition-colors
                      ${defaultModel === model.id ? 'bg-theme-accent' : ''}`}
                  >
                    <span
                      className="mt-1 w-1.5 h-1.5 rounded-full shrink-0"
                      style={{ backgroundColor: model.operator === 'NVIDIA' ? '#76b900' : '#818cf8' }}
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-sm truncate">{model.name}</span>
                        {model.context && (
                          <span className="text-xs px-1.5 py-0.5 bg-theme-accent rounded shrink-0">
                            {model.context}
                          </span>
                        )}
                      </div>
                      <div className="text-xs theme-secondary truncate">
                        {model.vendor} · {model.realId}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </>
      )}

      {/* No keys at all: nudge toward Settings */}
      {!hasKeys && (
        <button
          onClick={() => setShowSettings(true)}
          className="mt-1 text-xs theme-secondary hover:theme-primary transition-colors text-left"
        >
          Add your NVIDIA or OpenRouter key to load models →
        </button>
      )}
    </div>
  )
}

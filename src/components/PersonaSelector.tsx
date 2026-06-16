'use client'

import { useStore } from '@/store'
import { Zap, Hexagon } from 'lucide-react'
import { useT } from '@/lib/i18n'

export function PersonaSelector() {
  const { personas, currentPersona } = useStore()
  const t = useT()

  const activePersona = personas.find(p => p.id === currentPersona) || personas[0]

  // Single persona mode - just show the active status
  return (
    <div className="relative">
      <label className="text-xs theme-secondary mb-1 block">{t('sidebar.mode')}</label>
      <div
        className="w-full flex items-center justify-between px-3 py-2
          bg-theme-bg border border-theme-primary rounded-lg glow-box
          text-sm"
      >
        <div className="flex items-center gap-2">
          <Hexagon className="w-3.5 h-3.5 theme-primary" fill="currentColor" />
          <span className="font-semibold theme-primary">
            {activePersona.name}
          </span>
        </div>
        <div className="flex items-center gap-1 theme-primary">
          <Zap className="w-3 h-3" />
          <span className="text-xs">{t('sidebar.enabled')}</span>
        </div>
      </div>
    </div>
  )
}

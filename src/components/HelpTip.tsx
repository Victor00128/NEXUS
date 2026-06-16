'use client'

import { useState, useRef } from 'react'
import { HelpCircle } from 'lucide-react'

interface HelpTipProps {
  /** Tooltip text (already translated by the caller). */
  text: string
  className?: string
}

/**
 * A small "?" badge. Hovering (or focusing) it for ~1.5s reveals an
 * explanation bubble. The delay avoids flashing the tooltip on quick passes.
 */
export function HelpTip({ text, className = '' }: HelpTipProps) {
  const [open, setOpen] = useState(false)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)

  const show = () => {
    if (timer.current) clearTimeout(timer.current)
    timer.current = setTimeout(() => setOpen(true), 1500)
  }
  const hide = () => {
    if (timer.current) clearTimeout(timer.current)
    setOpen(false)
  }

  return (
    <span
      className={`relative inline-flex items-center align-middle ${className}`}
      onMouseEnter={show}
      onMouseLeave={hide}
      onFocus={show}
      onBlur={hide}
      tabIndex={0}
      role="button"
      aria-label="Help"
    >
      <HelpCircle className="w-3.5 h-3.5 theme-secondary hover:theme-primary cursor-help transition-colors" />
      {open && (
        <span
          role="tooltip"
          className="absolute left-1/2 top-full z-[60] mt-2 w-64 -translate-x-1/2
            rounded-lg border border-theme-primary bg-theme-dim px-3 py-2
            text-xs leading-relaxed theme-text shadow-xl pointer-events-none"
        >
          {text}
        </span>
      )}
    </span>
  )
}

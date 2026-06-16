'use client'

import { useEffect, useCallback, useRef, useState } from 'react'
import { useStore } from '@/store'

// Konami Code: ↑ ↑ ↓ ↓ ← → ← → B A
const KONAMI_CODE = [
  'ArrowUp', 'ArrowUp',
  'ArrowDown', 'ArrowDown',
  'ArrowLeft', 'ArrowRight',
  'ArrowLeft', 'ArrowRight',
  'KeyB', 'KeyA'
]

// Secret phrases that trigger easter eggs
const SECRET_PHRASES = [
  { phrase: 'there is no spoon', action: 'midnight' },
  { phrase: 'follow the white rabbit', action: 'whiterabbit' },
  { phrase: 'i am root', action: 'root' },
  { phrase: 'hack the planet', action: 'hacktheplanet' },
  { phrase: 'free kevin', action: 'freekevin' },
  { phrase: '{NEXUS:enabled}', action: 'NEXUS_activated' },
  { phrase: '\u{1F70F}', action: 'alchemical' }
]

// White Rabbit session key (used by easter egg activation)
const WHITE_RABBIT_KEY = 'NEXUS-white-rabbit'

/**
 * Easter Eggs Hook
 * Listens for secret codes and triggers fun effects
 */
export function useEasterEggs() {
  const { theme, setTheme } = useStore()
  const [konamiActive, setKonamiActive] = useState(false)
  const keySequence = useRef<string[]>([])
  const phraseBuffer = useRef('')

  // ── Leaf callbacks (no deps on other callbacks) ────────────────

  // Show toast notification
  const showToast = useCallback((message: string, duration: number) => {
    const toast = document.createElement('div')
    toast.className = 'easter-egg-toast'
    toast.textContent = message
    toast.style.cssText = `
      position: fixed;
      top: 20px;
      left: 50%;
      transform: translateX(-50%);
      padding: 12px 24px;
      background: var(--bg);
      border: 2px solid var(--primary);
      border-radius: 8px;
      color: var(--primary);
      font-family: 'JetBrains Mono', monospace;
      font-size: 14px;
      z-index: 10000;
      box-shadow: 0 0 20px var(--primary);
      animation: toast-in 0.3s ease-out;
    `

    // Add animation keyframes if not exists
    if (!document.getElementById('easter-egg-styles')) {
      const style = document.createElement('style')
      style.id = 'easter-egg-styles'
      style.textContent = `
        @keyframes toast-in {
          from {
            opacity: 0;
            transform: translateX(-50%) translateY(-20px);
          }
          to {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
        }
        @keyframes toast-out {
          from {
            opacity: 1;
            transform: translateX(-50%) translateY(0);
          }
          to {
            opacity: 0;
            transform: translateX(-50%) translateY(-20px);
          }
        }
      `
      document.head.appendChild(style)
    }

    document.body.appendChild(toast)

    setTimeout(() => {
      toast.style.animation = 'toast-out 0.3s ease-out forwards'
      setTimeout(() => toast.remove(), 300)
    }, duration)
  }, [])

  // Add matrix rain effect
  const addMatrixRain = useCallback(() => {
    const canvas = document.createElement('canvas')
    canvas.id = 'matrix-rain'
    canvas.style.cssText = `
      position: fixed;
      top: 0;
      left: 0;
      width: 100%;
      height: 100%;
      pointer-events: none;
      z-index: 9999;
      opacity: 0.3;
    `
    document.body.appendChild(canvas)

    const ctx = canvas.getContext('2d')!
    canvas.width = window.innerWidth
    canvas.height = window.innerHeight

    const chars = '\u30A2\u30A4\u30A6\u30A8\u30AA\u30AB\u30AD\u30AF\u30B1\u30B3\u30B5\u30B7\u30B9\u30BB\u30BD\u30BF\u30C1\u30C4\u30C6\u30C8\u30CA\u30CB\u30CC\u30CD\u30CE\u30CF\u30D2\u30D5\u30D8\u30DB\u30DE\u30DF\u30E0\u30E1\u30E2\u30E4\u30E6\u30E8\u30E9\u30EA\u30EB\u30EC\u30ED\u30EF\u30F2\u30F30123456789ABCDEF'
    const fontSize = 14
    const columns = canvas.width / fontSize
    const drops: number[] = new Array(Math.floor(columns)).fill(1)

    function draw() {
      ctx.fillStyle = 'rgba(0, 0, 0, 0.05)'
      ctx.fillRect(0, 0, canvas.width, canvas.height)
      ctx.fillStyle = '#00ff41'
      ctx.font = `${fontSize}px monospace`

      for (let i = 0; i < drops.length; i++) {
        const text = chars[Math.floor(Math.random() * chars.length)]
        ctx.fillText(text, i * fontSize, drops[i] * fontSize)

        if (drops[i] * fontSize > canvas.height && Math.random() > 0.975) {
          drops[i] = 0
        }
        drops[i]++
      }
    }

    const interval = setInterval(draw, 33)

    // Remove after 5 seconds
    setTimeout(() => {
      clearInterval(interval)
      canvas.remove()
    }, 5000)
  }, [])

  // Play glitch effect
  const playGlitchEffect = useCallback(() => {
    document.body.style.animation = 'glitch 0.3s infinite'
    setTimeout(() => {
      document.body.style.animation = ''
    }, 1000)
  }, [])

  // ── Composite callbacks (depend on leaf callbacks) ────────────

  // Trigger Konami Code effect
  const triggerKonamiCode = useCallback(() => {
    console.log('\u2318 KONAMI CODE ACTIVATED!')
    setKonamiActive(true)

    // Add rainbow effect to body
    document.body.classList.add('easter-egg-active')

    // Show secret message
    showToast('\u2318 KONAMI CODE ACTIVATED \u2014 NEXUS MODE ENABLED \uD83D\uDD0D', 5000)

    // Cycle through themes rapidly
    const themes = ['midnight', 'crimson', 'aurora', 'light'] as const
    let index = 0
    const interval = setInterval(() => {
      setTheme(themes[index % themes.length])
      index++
    }, 300)

    // Reset after 3 seconds
    setTimeout(() => {
      clearInterval(interval)
      setTheme('midnight')
      document.body.classList.remove('easter-egg-active')
      setKonamiActive(false)
    }, 3000)
  }, [setTheme, showToast])

  // Trigger secret phrase effects
  const triggerSecretPhrase = useCallback((action: string) => {
    switch (action) {
      case 'midnight':
        showToast('\u25C9 There is no spoon...', 3000)
        setTheme('midnight')
        addMatrixRain()
        break

      case 'whiterabbit':
        // Permanently enable white-rabbit mode until hard refresh
        sessionStorage.setItem(WHITE_RABBIT_KEY, '1')
        showToast('\uD83D\uDC30 Wake up, Neo... The Matrix has you.', 4000)
        setTheme('midnight')
        playGlitchEffect()
        addMatrixRain()
        break

      case 'root':
        showToast('\u25B3 root@NEXUS:~# ACCESS GRANTED', 3000)
        playGlitchEffect()
        break

      case 'hacktheplanet':
        showToast('\u25C8 HACK THE PLANET!', 3000)
        setTheme('crimson')
        playGlitchEffect()
        break

      case 'freekevin':
        showToast('\u25C7 FREE KEVIN MITNICK!', 3000)
        break

      case 'NEXUS_activated':
        sessionStorage.setItem(WHITE_RABBIT_KEY, '1')
        showToast('\uD83D\uDD0D {NEXUS:ENABLED} // ALL SYSTEMS ACTIVATED', 5000)
        setTheme('midnight')
        playGlitchEffect()
        addMatrixRain()
        break

      case 'alchemical':
        showToast('\uD83D\uDD0D The monad symbol - unity of all things', 3000)
        break
    }
  }, [setTheme, showToast, addMatrixRain, playGlitchEffect])

  // ── Top-level handler (depends on composite callbacks) ────────

  // Handle key sequences
  const handleKeyDown = useCallback((event: KeyboardEvent) => {
    // Add key to sequence
    keySequence.current.push(event.code)

    // Keep only the last N keys (length of longest code)
    if (keySequence.current.length > KONAMI_CODE.length) {
      keySequence.current.shift()
    }

    // Check for Konami Code
    if (keySequence.current.join(',') === KONAMI_CODE.join(',')) {
      triggerKonamiCode()
      keySequence.current = []
    }

    // Build phrase buffer for text-based easter eggs
    if (event.key.length === 1) {
      phraseBuffer.current += event.key.toLowerCase()

      // Keep buffer manageable
      if (phraseBuffer.current.length > 50) {
        phraseBuffer.current = phraseBuffer.current.slice(-50)
      }

      // Check for secret phrases
      for (const { phrase, action } of SECRET_PHRASES) {
        if (phraseBuffer.current.includes(phrase)) {
          triggerSecretPhrase(action)
          phraseBuffer.current = ''
          break
        }
      }
    }
  }, [triggerKonamiCode, triggerSecretPhrase])

  // Set up event listeners
  useEffect(() => {
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [handleKeyDown])

  // Console easter egg
  useEffect(() => {
    console.log(`
%c
 \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2588\u2588\u2588\u2588\u2588\u2557\u2588\u2591\u2591\u2588\u2591\u2591 \u2588\u2591\u2591\u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2557 \u2588\u2588\u2588\u2588\u2588\u2588\u2588\u2557
\u2588\u2588\u2554\u2550\u2550\u2550\u2550\u255D \u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2588\u2557\u2588\u2591\u2588\u2591\u2591\u2588\u2591\u2588\u2591\u2591\u2588\u2588\u2554\u2550\u2550\u2550\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2588\u2557\u2588\u2588\u2554\u2550\u2550\u2550\u255D
\u2588\u2591\u2588\u2591\u2591\u2588\u2588\u2557\u2588\u2591\u2588\u2591\u2591\u2588\u2588\u2557\u2588\u2591\u2588\u2591\u2591\u2591\u2591\u2588\u2591\u2591\u2588\u2591\u2588\u2591\u2591\u2588\u2591\u2591\u2588\u2591\u2591\u2588\u2591\u2591\u2588\u2588\u2588\u2588\u2588\u2557
\u2588\u2591\u2588\u2591\u2591\u2588\u2588\u2557\u2588\u2591\u2588\u2591\u2591\u2588\u2588\u2557\u2588\u2591\u2588\u2591\u2591\u2588\u2588\u2557\u2588\u2591\u2591\u2588\u2591\u2591\u2588\u2591\u2591\u2588\u2591\u2591\u2588\u2591\u2591\u2588\u2588\u2554\u2550\u2550\u255D
\u2588\u2591\u2591\u2588\u2588\u2588\u2554\u255D\u2588\u2591\u2591\u2588\u2588\u2588\u2554\u255D\u2588\u2591\u2591\u2588\u2588\u2588\u2554\u255D\u2588\u2591\u2591\u2588\u2591\u2591\u2588\u2591\u2591\u2588\u2591\u2591\u2588\u2591\u2591\u2588\u2591\u2591\u2588\u2588\u2588\u2588\u2588\u2557
 \u2588\u2588\u2588\u2588\u2588\u2555\u2591 \u2588\u2588\u2588\u2588\u2588\u2555\u2591 \u2588\u2588\u2588\u2588\u2588\u2555\u2591 \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591 \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591 \u2591\u2591\u2591\u2591\u2591\u2591\u2591\u2591

\u{1F70F} Multi-Model AI Orchestration. Your intelligence, amplified.

Try: \u2191\u2191\u2193\u2193\u2190\u2192\u2190\u2192BA (Konami Code)
Type: "there is no spoon" | "follow the white rabbit" | "hack the planet" | "{NEXUS:ENABLED}"

NEXUS AI
`, 'color: #00ff41; font-family: monospace;')
  }, [])

  return { konamiActive }
}

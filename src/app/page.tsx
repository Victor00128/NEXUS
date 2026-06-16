'use client'

import { useEffect, useState } from 'react'
import { Sidebar } from '@/components/Sidebar'
import { ChatArea } from '@/components/ChatArea'
import { SettingsModal } from '@/components/SettingsModal'
import { WelcomeScreen } from '@/components/WelcomeScreen'
import { useStore, useCurrentConversation } from '@/store'
import { useEasterEggs } from '@/hooks/useEasterEggs'
import { useApiAutoDetect } from '@/hooks/useApiAutoDetect'

export default function Home() {
  const {
    theme,
    showSettings,
    setShowSettings,
    apiKey,
    nvidiaApiKey,
    raceApiUrl,
    raceApiKey,
    isHydrated
  } = useStore()
  const currentConversation = useCurrentConversation()

  const [sidebarOpen, setSidebarOpen] = useState(true)

  // Initialize easter eggs
  useEasterEggs()

  // Auto-detect self-hosted API server at same origin
  useApiAutoDetect()

  // Proxy mode: API server available but no personal OpenRouter key
  const proxyMode = !apiKey && !!raceApiUrl && !!raceApiKey

  // Chat is usable with ANY provider key: OpenRouter, NVIDIA, or proxy.
  const canChat = !!apiKey || !!nvidiaApiKey || proxyMode

  // Sync theme class to <html> so CSS variables (scrollbar colours, etc.)
  // cascade to elements outside <main>
  useEffect(() => {
    const root = document.documentElement
    root.classList.remove('theme-midnight', 'theme-crimson', 'theme-aurora', 'theme-light')
    root.classList.add(`theme-${theme}`)
  }, [theme])

  // Don't render until hydrated to prevent mismatch
  if (!isHydrated) {
    return (
      <div className={`theme-${theme} theme-bg min-h-screen flex items-center justify-center`}>
        <div className="theme-primary text-xl font-mono">
          <span className="loading-dots">Initializing NEXUS AI</span>
        </div>
      </div>
    )
  }

  return (
    <main className={`theme-${theme} theme-bg theme-text min-h-screen flex relative overflow-hidden`}>
      {/* Scanline effect for Matrix/Hacker themes */}
      {(theme === 'midnight' || theme === 'crimson') && (
        <div className="scan-overlay pointer-events-none absolute inset-0 z-50" />
      )}

      {/* Sidebar */}
      <Sidebar
        isOpen={sidebarOpen}
        onToggle={() => setSidebarOpen(!sidebarOpen)}
      />

      {/* Main content */}
      <div className={`flex-1 flex flex-col transition-all duration-300 ${sidebarOpen ? 'ml-0' : 'ml-0'}`}>
        {!canChat || !currentConversation ? (
          <WelcomeScreen onOpenSettings={() => setShowSettings(true)} />
        ) : (
          <ChatArea />
        )}
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <SettingsModal onClose={() => setShowSettings(false)} />
      )}
    </main>
  )
}

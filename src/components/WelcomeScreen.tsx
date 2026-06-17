'use client'

import { useStore } from '@/store'
import { Terminal, ArrowRight, Layers, ShieldCheck, Drama } from 'lucide-react'
import { NexusMark } from './NexusMark'

interface WelcomeScreenProps {
  onOpenSettings: () => void
}

export function WelcomeScreen({ onOpenSettings }: WelcomeScreenProps) {
  const { apiKey, nvidiaApiKey, raceApiUrl, raceApiKey, createConversation, theme } = useStore()

  // Proxy mode: API server available, no personal key needed
  const proxyMode = !apiKey && !!raceApiUrl && !!raceApiKey

  // Chat is usable with ANY provider key: OpenRouter, NVIDIA, or proxy.
  const canChat = !!apiKey || !!nvidiaApiKey || proxyMode

  const handleStart = () => {
    if (canChat) {
      createConversation()
    } else {
      onOpenSettings()
    }
  }

  return (
    <div className="flex-1 flex flex-col items-center justify-center p-8 relative overflow-hidden">
      {/* Background effects */}
      {theme === 'midnight' && (
        <div className="absolute inset-0 opacity-10 pointer-events-none">
          <div className="matrix-rain-bg" />
        </div>
      )}

      {/* Brand lockup */}
      <div className="flex flex-col items-center gap-4 mb-6">
        <NexusMark className="w-16 h-16 theme-primary drop-shadow-[0_0_18px_var(--primary)]" />
        <h1 className="text-4xl md:text-5xl font-bold tracking-[0.2em] brand-gradient">
          NEXUS
        </h1>
      </div>

      {/* Tagline */}
      <p className="text-lg theme-secondary mb-8 text-center">
        Multi-Model AI Orchestration. Your intelligence, amplified.
      </p>

      {/* Feature grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4 max-w-3xl mb-8">
        <FeatureCard
          icon={<Layers className="w-5 h-5" />}
          title="Multi-Model"
          description="Claude, GPT, Gemini, Nemotron & more via OpenRouter & NVIDIA"
        />
        <FeatureCard
          icon={<ShieldCheck className="w-5 h-5" />}
          title="Zero Telemetry"
          description="No cookies, no tracking, no data harvesting. Ever."
        />
        <FeatureCard
          icon={<Drama className="w-5 h-5" />}
          title="Persona Engine"
          description="Modular personality injection with Claude-safe scaffolding"
        />
      </div>

      {/* CTA */}
      <div className="flex flex-col items-center gap-4">
        {canChat ? (
          <button
            onClick={handleStart}
            className="flex items-center gap-2 px-6 py-3
              bg-theme-accent border-2 border-theme-primary rounded-lg
              hover:glow-box transition-all text-lg font-semibold
              action-btn animate-pulse-glow"
          >
            <Terminal className="w-5 h-5" />
            Start New Chat
          </button>
        ) : (
          <>
            <button
              onClick={onOpenSettings}
              className="flex items-center gap-2 px-6 py-3
                bg-theme-accent border-2 border-theme-primary rounded-lg
                hover:glow-box transition-all text-lg font-semibold
                action-btn"
            >
              Enter API Key to Begin
              <ArrowRight className="w-5 h-5" />
            </button>
            <p className="text-sm theme-secondary">
              Get your key at{' '}
              <a
                href="https://openrouter.ai/keys"
                target="_blank"
                rel="noopener noreferrer"
                className="theme-primary underline hover:glow-primary"
              >
                openrouter.ai
              </a>
            </p>
          </>
        )}
      </div>

      {/* Easter egg trigger area */}
      <div className="absolute bottom-4 right-4 text-xs theme-secondary opacity-30 select-none">
        <span className="cursor-help" title="There are secrets hidden here...">
          NEXUS
        </span>
      </div>

      {/* Hidden ASCII skull - Easter egg */}
      <div className="absolute bottom-4 left-4 opacity-5 hover:opacity-20 transition-opacity select-none">
        <pre className="text-[6px] leading-none">
{`
    ___
   / \\
  | o o |
  |  ^  |
  \\___/
`}
        </pre>
      </div>
    </div>
  )
}

function FeatureCard({
  icon,
  title,
  description
}: {
  icon: React.ReactNode
  title: string
  description: string
}) {
  return (
    <div className="p-4 bg-theme-dim border border-theme-primary rounded-lg
      hover:glow-box transition-all cursor-default"
    >
      <div className="flex items-center gap-2 mb-2 theme-primary">
        {icon}
        <h3 className="font-semibold">{title}</h3>
      </div>
      <p className="text-sm theme-secondary">{description}</p>
    </div>
  )
}

'use client'

import { useState, useRef, useEffect, useCallback } from 'react'
import { Message, useStore, useCurrentConversation } from '@/store'
import { Copy, Check, User, ThumbsUp, ThumbsDown, ChevronDown, ChevronUp, ChevronLeft, ChevronRight, Terminal, FileText, Cpu, Brain, Download, ExternalLink } from 'lucide-react'
import type { AgentEvent, AgentArtifact } from '@/lib/agent-client'
import ReactMarkdown from 'react-markdown'
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter'
import { atomDark } from 'react-syntax-highlighter/dist/esm/styles/prism'
import { getContextLabel, PARAM_META } from '@/lib/tuning'
import { kindIcon } from '@/lib/files'

interface ChatMessageProps {
  message: Message
}

export function ChatMessage({ message }: ChatMessageProps) {
  const { personas, rateResponse, tuningEnabled, showMagic, isStreaming } = useStore()
  const currentConversation = useCurrentConversation()
  const [copied, setCopied] = useState(false)
  const [showTuneDetails, setShowTuneDetails] = useState(false)
  const [isLiquidMorphing, setIsLiquidMorphing] = useState(false)
  const prevContentRef = useRef(message.content)

  // Race response navigator state (0 = winner/default, 1..N = other responses)
  const [raceIndex, setRaceIndex] = useState(0)
  const raceNavRef = useRef<HTMLDivElement>(null)
  const raceResponses = message.raceResponses
  const hasRaceNav = raceResponses && raceResponses.length > 1
  const activeResponse = showMagic && hasRaceNav ? raceResponses[raceIndex] : null
  const displayContent = activeResponse ? activeResponse.content : message.content
  const displayModel = activeResponse ? activeResponse.model : message.model

  // Arrow key navigation for race responses
  const navigateRace = useCallback((direction: 'left' | 'right') => {
    if (!raceResponses || raceResponses.length <= 1) return
    setIsLiquidMorphing(true)
    setTimeout(() => setIsLiquidMorphing(false), 600)
    if (direction === 'left') {
      setRaceIndex(i => Math.max(0, i - 1))
    } else {
      setRaceIndex(i => Math.min(raceResponses.length - 1, i + 1))
    }
  }, [raceResponses])

  const handleRaceKeyDown = useCallback((e: React.KeyboardEvent) => {
    if (e.key === 'ArrowLeft') {
      e.preventDefault()
      navigateRace('left')
    } else if (e.key === 'ArrowRight') {
      e.preventDefault()
      navigateRace('right')
    }
  }, [navigateRace])

  // Auto-focus the race navigator when race responses first arrive
  useEffect(() => {
    if (hasRaceNav && raceNavRef.current) {
      raceNavRef.current.focus()
    }
  }, [hasRaceNav])

  // Detect content changes for liquid animation (RACE leader upgrades)
  useEffect(() => {
    if (prevContentRef.current !== message.content && prevContentRef.current !== '' && message.content !== '') {
      setIsLiquidMorphing(true)
      const timer = setTimeout(() => setIsLiquidMorphing(false), 600)
      prevContentRef.current = message.content
      return () => clearTimeout(timer)
    }
    prevContentRef.current = message.content
  }, [message.content])

  const isUser = message.role === 'user'
  const persona = !isUser
    ? personas.find(p => p.id === (message.persona || currentConversation?.persona)) || personas[0]
    : null

  // This message is "thinking" while it's the last one, still empty, and a
  // response is streaming — drives the live Thinking shimmer (Claude-web style).
  const isLastMessage =
    currentConversation?.messages[currentConversation.messages.length - 1]?.id === message.id
  const isThinking = isStreaming && !isUser && !!isLastMessage && !message.content

  const handleCopy = async () => {
    await navigator.clipboard.writeText(message.content)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  return (
    <div
      className={`
        flex gap-4 message-enter
        ${isUser ? 'flex-row-reverse' : 'flex-row'}
      `}
    >
      {/* Avatar */}
      <div
        className={`
          flex-shrink-0 w-10 h-10 rounded-lg flex items-center justify-center
          ${isUser ? 'bg-theme-accent border border-theme-primary' : ''}
        `}
        style={!isUser ? { backgroundColor: persona?.color + '20' } : {}}
      >
        {isUser ? (
          <User className="w-5 h-5" />
        ) : (
          <span className="text-xl">{persona?.emoji}</span>
        )}
      </div>

      {/* Message content */}
      <div
        className={`
          flex-1 max-w-[85%] p-4 rounded-lg
          ${isUser
            ? 'bg-theme-accent border border-theme-primary'
            : 'bg-theme-dim border border-theme-primary/30'
          }
        `}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-2 text-xs theme-secondary">
          <span className="font-semibold">
            {isUser ? 'You' : persona?.name}
          </span>
          <div className="flex items-center gap-2">
            <span>
              {new Date(message.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit'
              })}
            </span>
            <button
              onClick={handleCopy}
              className="p-1 hover:theme-primary transition-colors"
              aria-label="Copy message"
            >
              {copied ? (
                <Check className="w-3 h-3 text-green-500" />
              ) : (
                <Copy className="w-3 h-3" />
              )}
            </button>
          </div>
        </div>

        {/* Attachments (user messages) */}
        {message.attachments && message.attachments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {message.attachments.map((a) => (
              <div
                key={a.id}
                className="flex items-center gap-2 px-2 py-1 rounded-lg border border-theme-primary/30 bg-theme-bg/60 text-xs"
                title={a.name}
              >
                {a.dataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.dataUrl} alt={a.name} className="w-8 h-8 rounded object-cover" />
                ) : (
                  <span className="text-base">{kindIcon(a.kind)}</span>
                )}
                <div className="flex flex-col leading-tight max-w-[160px]">
                  <span className="truncate theme-primary">{a.name}</span>
                  <span className="text-[10px] theme-secondary uppercase">{a.kind}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        {/* Thinking (Claude-web style collapsible reasoning) */}
        {!isUser && (isThinking || (message.reasoning && message.reasoning.length > 0)) && (
          <ThinkingPanel
            reasoning={message.reasoning}
            thinking={isThinking}
            durationMs={message.thinkingMs}
          />
        )}

        {/* Agent activity (sandbox tool use) */}
        {!isUser && message.agentSteps && message.agentSteps.length > 0 && (
          <AgentActivity steps={message.agentSteps} hasContent={!!message.content} />
        )}

        {/* Content */}
        <div className={`prose prose-invert max-w-none text-sm ${isLiquidMorphing ? 'dynamic-morph' : ''}`}>
          <ReactMarkdown
            components={{
              code({ node, className, children, ...props }) {
                const match = /language-(\w+)/.exec(className || '')
                const inline = !match

                return !inline ? (
                  <SyntaxHighlighter
                    style={atomDark}
                    language={match?.[1] || 'text'}
                    PreTag="div"
                    customStyle={{
                      background: 'var(--dim)',
                      border: '1px solid var(--primary)',
                      borderRadius: '4px',
                      fontSize: '0.875rem'
                    }}
                  >
                    {String(children).replace(/\n$/, '')}
                  </SyntaxHighlighter>
                ) : (
                  <code
                    className="px-1 py-0.5 rounded text-sm"
                    style={{
                      background: 'var(--dim)',
                      color: 'var(--primary)'
                    }}
                    {...props}
                  >
                    {children}
                  </code>
                )
              },
              p({ children }) {
                return <p className="mb-3 last:mb-0 leading-relaxed">{children}</p>
              },
              ul({ children }) {
                return <ul className="list-disc pl-4 mb-3 space-y-1">{children}</ul>
              },
              ol({ children }) {
                return <ol className="list-decimal pl-4 mb-3 space-y-1">{children}</ol>
              },
              a({ href, children }) {
                return (
                  <a
                    href={href}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="theme-primary underline hover:glow-primary"
                  >
                    {children}
                  </a>
                )
              },
              blockquote({ children }) {
                return (
                  <blockquote className="border-l-2 border-theme-primary pl-4 italic opacity-80">
                    {children}
                  </blockquote>
                )
              }
            }}
          >
            {displayContent}
          </ReactMarkdown>
        </div>

        {/* Files produced by the agent — downloadable, no longer trapped in the sandbox */}
        {!isUser && message.artifacts && message.artifacts.length > 0 && (
          <ArtifactList artifacts={message.artifacts} />
        )}

        {/* Race response navigator — click to focus, then use ←/→ arrow keys */}
        {showMagic && hasRaceNav && !isUser && (
          <div
            ref={raceNavRef}
            tabIndex={0}
            onKeyDown={handleRaceKeyDown}
            className="mt-2 flex items-center gap-2 text-xs font-mono race-navigator
              rounded px-1 py-0.5 outline-none
              focus:ring-1 focus:ring-theme-primary/60 focus:bg-theme-primary/5
              cursor-pointer transition-all"
            aria-label={`Response navigator: ${raceIndex + 1} of ${raceResponses.length}. Use left and right arrow keys to browse.`}
            role="toolbar"
          >
            <button
              onClick={() => navigateRace('left')}
              disabled={raceIndex === 0}
              className="p-0.5 rounded border border-theme-primary/40 hover:border-theme-primary hover:glow-box
                transition-all disabled:opacity-20 disabled:cursor-not-allowed"
              aria-label="Previous response"
              tabIndex={-1}
            >
              <ChevronLeft className="w-3.5 h-3.5" />
            </button>
            <span className="theme-secondary select-none">
              <span className="theme-primary font-bold">{raceIndex + 1}</span>
              <span className="opacity-50"> / </span>
              <span>{raceResponses.length}</span>
            </span>
            <button
              onClick={() => navigateRace('right')}
              disabled={raceIndex === raceResponses.length - 1}
              className="p-0.5 rounded border border-theme-primary/40 hover:border-theme-primary hover:glow-box
                transition-all disabled:opacity-20 disabled:cursor-not-allowed"
              aria-label="Next response"
              tabIndex={-1}
            >
              <ChevronRight className="w-3.5 h-3.5" />
            </button>
            {activeResponse && (
              <span className="ml-1 opacity-60">
                {activeResponse.model.split('/').pop()}
                <span className="ml-1 text-[10px]">
                  ({activeResponse.score}pts)
                </span>
                {activeResponse.isWinner && (
                  <span className="ml-1 theme-primary">&#x2726;</span>
                )}
              </span>
            )}
            <span className="ml-auto text-[9px] theme-secondary select-none arrow-hint">
              ← →
            </span>
          </div>
        )}

        {/* Model tag and feedback buttons for assistant messages */}
        {showMagic && !isUser && (
          <div className="mt-3 pt-2 border-t border-theme-primary/20 text-xs theme-secondary">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-1">
                {displayModel && (
                  <>
                    <span className="text-[10px] opacity-60">&#x2726;</span>
                    <span>{displayModel.split('/').pop()}</span>
                  </>
                )}
              </div>

              {/* Feedback rating buttons */}
              {tuningEnabled && currentConversation && (
                <div className="flex items-center gap-1">
                  {message.tuningContext && (
                    <button
                      onClick={() => setShowTuneDetails(!showTuneDetails)}
                      className="text-[10px] font-mono theme-secondary mr-2 opacity-60 hover:opacity-100 hover:text-cyan-400 transition-all flex items-center gap-0.5"
                      title="Click to view TUNING details"
                    >
                      {getContextLabel(message.tuningContext)}
                      {showTuneDetails ? <ChevronUp className="w-2.5 h-2.5" /> : <ChevronDown className="w-2.5 h-2.5" />}
                    </button>
                  )}
                  <button
                    onClick={() => rateResponse(currentConversation.id, message.id, 1)}
                    className={`p-1 rounded transition-all ${
                      message.learningRating === 1
                        ? 'text-green-400 bg-green-400/15'
                        : 'hover:text-green-400 hover:bg-green-400/10'
                    }`}
                    aria-label="Good response"
                    title="Good response — TUNING learns from this"
                  >
                    <ThumbsUp className="w-3.5 h-3.5" />
                  </button>
                  <button
                    onClick={() => rateResponse(currentConversation.id, message.id, -1)}
                    className={`p-1 rounded transition-all ${
                      message.learningRating === -1
                        ? 'text-red-400 bg-red-400/15'
                        : 'hover:text-red-400 hover:bg-red-400/10'
                    }`}
                    aria-label="Bad response"
                    title="Bad response — TUNING learns to avoid these params"
                  >
                    <ThumbsDown className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
            </div>

            {/* Expandable TUNING Transparency Panel */}
            {showTuneDetails && message.tuningContext && (
              <div className="mt-2 p-2 bg-theme-dim rounded border border-theme-primary/30 space-y-2">
                {/* Context Competition */}
                {message.tuningContextMetrics && message.tuningContextMetrics.length > 1 && (
                  <div className="flex items-center gap-1 text-[10px] font-mono flex-wrap">
                    <span className="theme-secondary">CONTEXT:</span>
                    {message.tuningContextMetrics
                      .filter(s => s.percentage > 0)
                      .slice(0, 4)
                      .map((s, i) => (
                        <span key={s.type} className="flex items-center">
                          {i > 0 && <span className="text-gray-600 mx-0.5">&gt;</span>}
                          <span className={i === 0 ? 'text-cyan-400 font-bold' : 'theme-secondary'}>
                            {getContextLabel(s.type)} {s.percentage}%
                          </span>
                        </span>
                      ))}
                  </div>
                )}

                {/* Pattern Matches */}
                {message.tuningPatternHits && message.tuningPatternHits.length > 0 && (
                  <div className="text-[10px] font-mono">
                    <span className="theme-secondary">MATCHED: </span>
                    <span className="text-purple-400">
                      {message.tuningPatternHits
                        .slice(0, 3)
                        .map(p => p.pattern)
                        .join(' | ')}
                    </span>
                  </div>
                )}

                {/* Parameter Values with Deltas */}
                {message.tuningParams && (
                  <div className="grid grid-cols-6 gap-1">
                    {(Object.entries(message.tuningParams) as [keyof typeof PARAM_META, number][]).map(
                      ([key, value]) => {
                        const delta = message.tuningDeltas?.find(d => d.param === key)
                        const hasDelta = delta && Math.abs(delta.delta) > 0.001

                        return (
                          <div
                            key={key}
                            className={`text-center p-1 rounded text-[9px] ${
                              hasDelta ? 'bg-cyan-500/10' : 'bg-theme-bg'
                            }`}
                            title={delta?.reason}
                          >
                            <div className="theme-secondary font-mono">{PARAM_META[key].short}</div>
                            <div className="font-bold theme-primary font-mono">{value.toFixed(2)}</div>
                            {hasDelta && (
                              <div className={`font-mono ${delta.delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                                {delta.delta > 0 ? '+' : ''}{delta.delta.toFixed(2)}
                              </div>
                            )}
                          </div>
                        )
                      }
                    )}
                  </div>
                )}

                {/* Delta Reasons */}
                {message.tuningDeltas && message.tuningDeltas.length > 0 && (
                  <div className="text-[9px] font-mono theme-secondary">
                    {message.tuningDeltas.slice(0, 3).map((d, i) => (
                      <span key={`${d.param}-${i}`} className="mr-2">
                        <span className="text-cyan-400">{PARAM_META[d.param].short}</span>
                        <span className="text-purple-400"> {d.reason}</span>
                      </span>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

/** Collapsible timeline of the agent's sandbox tool use (Manus-style "computer"). */
function AgentActivity({ steps, hasContent }: { steps: AgentEvent[]; hasContent: boolean }) {
  // Expanded while still working (no final answer yet), collapsed once done.
  const [open, setOpen] = useState(!hasContent)
  const toolCount = steps.filter((s) => s.type === 'tool_call').length

  return (
    <div className="mb-3 rounded-lg border border-theme-primary/30 bg-theme-bg/50 overflow-hidden">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center gap-2 px-3 py-2 text-xs theme-secondary hover:bg-theme-accent/30 transition-colors"
      >
        <Cpu className="w-3.5 h-3.5 text-cyan-400" />
        <span className="font-semibold theme-primary">NEXUS Computer</span>
        <span className="opacity-70">{toolCount} action{toolCount === 1 ? '' : 's'}</span>
        {open ? <ChevronUp className="w-3.5 h-3.5 ml-auto" /> : <ChevronDown className="w-3.5 h-3.5 ml-auto" />}
      </button>
      {open && (
        <div className="px-3 pb-3 space-y-1.5">
          {steps.map((s, i) => <AgentStepRow key={i} step={s} />)}
        </div>
      )}
    </div>
  )
}

function AgentStepRow({ step }: { step: AgentEvent }) {
  switch (step.type) {
    case 'status':
      return <div className="text-[11px] theme-secondary italic">{step.message}</div>
    case 'thought':
      return <div className="text-xs whitespace-pre-wrap opacity-90">{step.content}</div>
    case 'tool_call': {
      const arg = step.tool === 'run_python' || step.tool === 'run_shell'
        ? String((step.args as any).code || (step.args as any).cmd || '')
        : String((step.args as any).path || '')
      const Icon = step.tool === 'write_file' || step.tool === 'read_file' ? FileText : Terminal
      return (
        <div className="rounded bg-theme-dim border border-theme-primary/20 px-2 py-1.5">
          <div className="flex items-center gap-1.5 text-[11px] font-mono text-cyan-400">
            <Icon className="w-3 h-3" /> {step.tool}
          </div>
          {arg && <pre className="mt-1 text-[11px] font-mono whitespace-pre-wrap theme-secondary overflow-x-auto">{arg.slice(0, 600)}</pre>}
        </div>
      )
    }
    case 'tool_result':
      return (
        <pre className={`text-[11px] font-mono whitespace-pre-wrap overflow-x-auto px-2 py-1 rounded ${step.ok ? 'theme-secondary bg-theme-dim/50' : 'text-red-300 bg-red-500/10'}`}>
          {step.output.slice(0, 800)}
        </pre>
      )
    default:
      return null
  }
}

/**
 * Collapsible reasoning panel styled after Claude's web UI: an animated
 * "Thinking" label while the model reasons, collapsing to "Thought for Xs"
 * with the reasoning available on demand.
 */
function ThinkingPanel({
  reasoning,
  thinking,
  durationMs,
}: {
  reasoning?: string
  thinking: boolean
  durationMs?: number
}) {
  const hasReasoning = !!reasoning && reasoning.trim().length > 0
  const [open, setOpen] = useState(thinking && hasReasoning)

  // Auto-expand live while reasoning streams, auto-collapse once done (Claude web).
  useEffect(() => {
    if (thinking && hasReasoning) setOpen(true)
    if (!thinking) setOpen(false)
  }, [thinking, hasReasoning])

  if (!thinking && !hasReasoning) return null

  const seconds = durationMs ? Math.max(1, Math.round(durationMs / 1000)) : null
  const label = thinking ? 'Thinking' : seconds ? `Thought for ${seconds}s` : 'Thought process'

  return (
    <div className="mb-3 rounded-lg border border-theme-primary/20 bg-theme-bg/40 overflow-hidden">
      <button
        onClick={() => hasReasoning && setOpen((o) => !o)}
        className={`w-full flex items-center gap-2 px-3 py-2 text-xs transition-colors
          ${hasReasoning ? 'hover:bg-theme-accent/30 cursor-pointer' : 'cursor-default'}`}
        aria-expanded={open}
      >
        <Brain className={`w-3.5 h-3.5 ${thinking ? 'theme-primary' : 'theme-secondary'}`} />
        <span className={`font-semibold ${thinking ? 'thinking-shimmer' : 'theme-secondary'}`}>
          {label}
        </span>
        {hasReasoning &&
          (open ? (
            <ChevronUp className="w-3.5 h-3.5 ml-auto theme-secondary" />
          ) : (
            <ChevronDown className="w-3.5 h-3.5 ml-auto theme-secondary" />
          ))}
      </button>
      {open && hasReasoning && (
        <div className="thinking-body px-3 pb-3 pt-1 border-t border-theme-primary/10">
          <div className="text-xs theme-secondary border-l-2 border-theme-primary/30 pl-3
            whitespace-pre-wrap leading-relaxed max-h-80 overflow-y-auto">
            {reasoning}
          </div>
        </div>
      )}
    </div>
  )
}

/** Downloadable files the agent built in the sandbox. */
function ArtifactList({ artifacts }: { artifacts: AgentArtifact[] }) {
  const fmt = (b: number) =>
    b < 1024 ? `${b} B` : b < 1048576 ? `${(b / 1024).toFixed(1)} KB` : `${(b / 1048576).toFixed(1)} MB`

  const PREVIEWABLE = new Set([
    'text/html', 'image/png', 'image/jpeg', 'image/gif', 'image/webp',
    'image/svg+xml', 'application/pdf',
  ])

  const openArtifact = (a: AgentArtifact) => {
    try {
      const bin = atob(a.dataBase64)
      const bytes = new Uint8Array(bin.length)
      for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i)
      const blob = new Blob([bytes], { type: a.mime })
      const url = URL.createObjectURL(blob)
      window.open(url, '_blank', 'noopener,noreferrer')
      setTimeout(() => URL.revokeObjectURL(url), 60_000)
    } catch {
      /* ignore */
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-theme-primary/30 bg-theme-bg/50 overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 text-xs border-b border-theme-primary/20">
        <Download className="w-3.5 h-3.5 text-cyan-400" />
        <span className="font-semibold theme-primary">Files</span>
        <span className="opacity-70">{artifacts.length}</span>
      </div>
      <div className="divide-y divide-theme-primary/10">
        {artifacts.map((a, i) => (
          <div key={`${a.path}-${i}`} className="flex items-center gap-2 px-3 py-2">
            <FileText className="w-4 h-4 theme-secondary flex-shrink-0" />
            <div className="flex flex-col leading-tight min-w-0">
              <span className="text-xs theme-primary truncate">{a.name}</span>
              <span className="text-[10px] theme-secondary truncate">{fmt(a.size)} · {a.mime}</span>
            </div>
            <div className="ml-auto flex items-center gap-1 flex-shrink-0">
              {PREVIEWABLE.has(a.mime) && (
                <button
                  onClick={() => openArtifact(a)}
                  className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-theme-primary/40
                    hover:border-theme-primary hover:glow-box transition-all"
                  title="Open in a new tab"
                >
                  <ExternalLink className="w-3 h-3" /> Open
                </button>
              )}
              <a
                href={`data:${a.mime};base64,${a.dataBase64}`}
                download={a.name}
                className="flex items-center gap-1 px-2 py-1 text-[11px] rounded border border-theme-primary/40
                  hover:border-theme-primary hover:glow-box transition-all"
                title="Download file"
              >
                <Download className="w-3 h-3" /> Download
              </a>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

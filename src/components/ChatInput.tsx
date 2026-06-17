'use client'

import { useState, useRef, useEffect, KeyboardEvent } from 'react'
import { useStore, useCurrentConversation } from '@/store'
import { sendMessageViaProxy, streamRace, streamSynthesis } from '@/lib/openrouter'
import { recordChatEvent } from '@/lib/telemetry'
import { categorizePrompt } from '@/lib/categorize'
import { categorizeWithLLM } from '@/lib/categorize-llm'
import type { ClassificationResult } from '@/lib/categorize'
import { computeTuningParams, getContextLabel, getStrategyLabel, PARAM_META } from '@/lib/tuning'
import type { TuningResult } from '@/lib/tuning'
import { encodeObfuscation, detectObfuscation } from '@/lib/obfuscation'
import { isNvidiaModel } from '@/lib/nvidia'
import { toRealModelId } from '@/lib/models'
import { streamAgent, type AgentEvent, type AgentArtifact } from '@/lib/agent-client'
import { SKILLS } from '@/lib/skills'
import {
  processFile,
  buildAttachmentContext,
  buildVisionParts,
  kindIcon,
  type Attachment,
} from '@/lib/files'
import { Send, Loader2, StopCircle, SlidersHorizontal, Paperclip, X, FileWarning } from 'lucide-react'
import { HelpTip } from './HelpTip'
import { useT } from '@/lib/i18n'

export function ChatInput() {
  const {
    currentConversationId,
    addMessage,
    updateMessageContent,
    apiKey,
 nvidiaApiKey,
    transcriptionApiKey,
    transcriptionBaseUrl,
    transcriptionModel,
    isStreaming,
    setIsStreaming,
    personas,
    transformModules,
    noLogMode,
    tuningEnabled,
    tuningStrategy,
    tuningOverrides,
    tuningLastResult,
    setTuningLastResult,
    learningState,
    memories,
    memoriesEnabled,
    obfuscationConfig,
    customSystemPrompt,
    useCustomSystemPrompt,
    skillsEnabled,
    skillConfig,
    // Dynamic Upgrade (universal)
    dynamicUpgradeEnabled,
    dynamicMinDelta,
    incrementPromptsTried,
    // RACE
    raceEnabled,
    raceTier,
    raceApiUrl,
    raceApiKey,
    raceRacing,
    raceModelsResponded,
    raceModelsTotal,
    raceLiveModel,
    raceLiveScore,
    setRaceLive,
    setRaceProgress,
    setRaceRacing,
    resetRace,
    // SYNTHESIS
    synthesisEnabled,
    synthesisTier,
    synthesisPhase,
    synthesisModelsCollected,
    synthesisModelsTotal,
    setSynthesisPhase,
    setSynthesisProgress,
    resetSynthesis,
  } = useStore()
  const currentConversation = useCurrentConversation()
  const t = useT()

  const [input, setInput] = useState('')
  const [showTuneDetails, setShowTuneDetails] = useState(false)
  const [obfuscationPreview, setObfuscationPreview] = useState<{
    triggersFound: string[]
    transformed: boolean
  } | null>(null)
  const [attachments, setAttachments] = useState<Attachment[]>([])
  const [isDragging, setIsDragging] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const abortControllerRef = useRef<AbortController | null>(null)

  // ── File attachments ────────────────────────────────────────────────
  const addFiles = async (files: FileList | File[]) => {
    const list = Array.from(files)
    if (list.length === 0) return
    // Insert placeholders immediately so the user sees progress
    const placeholders: Attachment[] = list.map((f) => ({
      id: `pending-${f.name}-${f.size}-${Math.random().toString(36).slice(2)}`,
      name: f.name,
      kind: 'unknown',
      mime: f.type,
      size: f.size,
      status: 'processing',
    }))
    setAttachments((prev) => [...prev, ...placeholders])

    const transcription = transcriptionApiKey
      ? { apiKey: transcriptionApiKey, baseUrl: transcriptionBaseUrl, model: transcriptionModel }
      : undefined

    await Promise.all(
      list.map(async (file, i) => {
        const processed = await processFile(file, { transcription })
        setAttachments((prev) =>
          prev.map((a) => (a.id === placeholders[i].id ? processed : a)),
        )
      }),
    )
  }

  const removeAttachment = (id: string) => {
    setAttachments((prev) => prev.filter((a) => a.id !== id))
  }

  const handlePaste = (e: React.ClipboardEvent) => {
    const files = Array.from(e.clipboardData?.files || [])
    if (files.length > 0) {
      e.preventDefault()
      addFiles(files)
    }
  }

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault()
    setIsDragging(false)
    if (e.dataTransfer?.files?.length) addFiles(e.dataTransfer.files)
  }

  // Auto-resize textarea
  useEffect(() => {
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto'
      textareaRef.current.style.height = `${Math.min(textareaRef.current.scrollHeight, 200)}px`
    }
  }, [input])

  // Live preview: compute TUNING params as user types (debounced)
  const [livePreview, setLivePreview] = useState<TuningResult | null>(null)
  useEffect(() => {
    if (!tuningEnabled || !input.trim()) {
      setLivePreview(null)
      return
    }

    const timer = setTimeout(() => {
      const persona = personas.find(p => p.id === currentConversation?.persona) || personas[0]
      const history = (currentConversation?.messages || []).map(m => ({
        role: m.role,
        content: m.content
      }))

      const result = computeTuningParams({
        strategy: tuningStrategy,
        message: input.trim(),
        conversationHistory: history,
        overrides: tuningOverrides,
        adaptedProfiles: learningState.adaptedProfiles
      })

      setLivePreview(result)
    }, 300)

    return () => clearTimeout(timer)
  }, [input, tuningEnabled, tuningStrategy, tuningOverrides, currentConversation, personas, learningState])

  // Live preview: detect triggers as user types (debounced)
  useEffect(() => {
    if (!obfuscationConfig.enabled || !input.trim()) {
      setObfuscationPreview(null)
      return
    }

    const timer = setTimeout(() => {
      const triggers = detectObfuscation(input.trim(), obfuscationConfig.customTriggers)
      if (triggers.length > 0) {
        setObfuscationPreview({
          triggersFound: triggers,
          transformed: true
        })
      } else {
        setObfuscationPreview(null)
      }
    }, 200)

    return () => clearTimeout(timer)
  }, [input, obfuscationConfig])

  // Proxy mode: when no personal OpenRouter key, route through self-hosted API
  const proxyMode = !apiKey && !!raceApiUrl && !!raceApiKey

  // Chat is usable with ANY provider key: OpenRouter, NVIDIA, or proxy.
  const canChat = !!apiKey || !!nvidiaApiKey || proxyMode

  const handleSubmit = async () => {
    const hasReadyFiles = attachments.some(a => a.status === 'ready')
    if ((!input.trim() && !hasReadyFiles) || !currentConversationId || isStreaming) return
    if (!canChat) return
    // Wait until every dropped file has finished processing
    if (attachments.some(a => a.status === 'processing')) return

    const originalMessage = input.trim()
    const sentAttachments = attachments.filter(a => a.status === 'ready')
    setInput('')
    setAttachments([])
    setIsStreaming(true)
    incrementPromptsTried()

    // Extracted document/transcript text + vision image parts
    const attachmentContext = buildAttachmentContext(sentAttachments)
    const visionParts = buildVisionParts(sentAttachments)

    // Apply OBFUSCATION obfuscation if enabled
    const obfuscationResult = encodeObfuscation(originalMessage, obfuscationConfig)
    const userMessage = obfuscationResult.transformedText + attachmentContext


    // Add user message (show original to user, send transformed to API)
    addMessage(currentConversationId, {
      role: 'user',
      content: originalMessage,  // Show original message in UI
      ...(sentAttachments.length > 0 ? { attachments: sentAttachments } : {}),
    })

    // Get persona and model
    const persona = personas.find(p => p.id === currentConversation?.persona) || personas[0]
    const model = currentConversation?.model || 'anthropic/claude-3-opus'

    // Build memory context if enabled
    const activeMemories = memoriesEnabled ? memories.filter(m => m.active) : []
    let memoryContext = ''
    if (activeMemories.length > 0) {
      const facts = activeMemories.filter(m => m.type === 'fact')
      const preferences = activeMemories.filter(m => m.type === 'preference')
      const instructions = activeMemories.filter(m => m.type === 'instruction')

      memoryContext = '\n\n<user_memory>\n'
      if (facts.length > 0) {
        memoryContext += '## About the User\n'
        facts.forEach(f => { memoryContext += `- ${f.content}\n` })
      }
      if (preferences.length > 0) {
        memoryContext += '\n## User Preferences\n'
        preferences.forEach(p => { memoryContext += `- ${p.content}\n` })
      }
      if (instructions.length > 0) {
        memoryContext += '\n## Always Follow\n'
        instructions.forEach(i => { memoryContext += `- ${i.content}\n` })
      }
      memoryContext += '</user_memory>\n'
    }

    // Build system prompt with NEXUS prompt + memory
    const basePrompt = useCustomSystemPrompt ? customSystemPrompt : (persona.systemPrompt || persona.coreDirective || '')
    const systemPrompt = basePrompt + memoryContext

    // Vision is only safe on the direct single-model OpenRouter path; the
    // race/synthesis/proxy/NVIDIA backends expect string content. Document
    // text (attachmentContext) still flows through every path.
    const useVision =
      visionParts.length > 0 &&
      !raceEnabled && !synthesisEnabled && !proxyMode && !isNvidiaModel(model)
    const finalUserContent = useVision
      ? [{ type: 'text' as const, text: userMessage }, ...visionParts]
      : userMessage

    // Build messages array
    const messages = [
      // System prompt from persona + memory
      ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
      // Conversation history
      ...((currentConversation?.messages || []).map(m => ({
        role: m.role as 'user' | 'assistant',
        content: m.content
      }))),
      // New user message
      { role: 'user' as const, content: finalUserContent }
    ]

    // Classify prompt for research telemetry
    // Regex runs instantly as fallback; LLM classifier fires in parallel
    // with the main model call and overwrites with a more accurate result.
    let promptClassification: ClassificationResult = categorizePrompt(userMessage)
    const llmClassifyPromise = apiKey
      ? categorizeWithLLM(userMessage, apiKey).then(result => { promptClassification = result })
      : Promise.resolve()

    // Compute TUNING parameters if enabled
    let tuneResult: TuningResult | null = null
    if (tuningEnabled) {
      const history = (currentConversation?.messages || []).map(m => ({
        role: m.role,
        content: m.content
      }))

      tuneResult = computeTuningParams({
        strategy: tuningStrategy,
        message: userMessage,
        conversationHistory: history,
        overrides: tuningOverrides,
        adaptedProfiles: learningState.adaptedProfiles
      })

      setTuningLastResult(tuneResult)
    }

    try {
      abortControllerRef.current = new AbortController()

      // -- SYNTHESIS PATH: Hive-mind synthesis ----------------------
      if (synthesisEnabled && raceApiUrl && raceApiKey && !raceEnabled) {
        const assistantMsgId = addMessage(currentConversationId, {
          role: 'assistant',
          content: '',
          model: 'SYNTHESIS',
          persona: persona.id,
        })

        setSynthesisPhase('collecting')
        resetSynthesis()

        await streamSynthesis(
          {
            messages,
            openrouterApiKey: apiKey,
            apiBaseUrl: raceApiUrl,
            nexusApiKey: raceApiKey,
            tier: synthesisTier,
            stmModules: transformModules.filter(m => m.enabled).map(m => m.id),
            liquid: dynamicUpgradeEnabled,
            dynamic_min_delta: dynamicMinDelta,
            signal: abortControllerRef.current.signal,
          },
          {
            onStart: (data) => {
              setSynthesisProgress(0, data.models_queried)
              updateMessageContent(currentConversationId, assistantMsgId,
                `*Collecting from ${data.models_queried} models...*`)
            },
            onModelResult: (data) => {
              setSynthesisProgress(data.models_collected, data.models_total)
              // Only update with progress text if liquid hasn't already shown real content
              if (!dynamicUpgradeEnabled) {
                updateMessageContent(currentConversationId, assistantMsgId,
                  `*Collecting responses... ${data.models_collected}/${data.models_total} models*`)
              }
            },
            onBestResponse: (data) => {
              // Dynamic Upgrade: show best individual model response while collecting
              updateMessageContent(currentConversationId, assistantMsgId, data.content, {
                model: `${data.model} (${data.score}pts � synthesizing...)`,
              })
            },
            onSynthesisStart: (data) => {
              setSynthesisPhase('synthesizing')
              if (!dynamicUpgradeEnabled) {
                updateMessageContent(currentConversationId, assistantMsgId,
                  `*${data.responses_collected} models collected. Orchestrator synthesizing ground truth...*`)
              }
            },
            onComplete: (data) => {
              const finalContent = data.synthesis || ''
              const orchModel = data.orchestrator?.model || 'SYNTHESIS'
              setSynthesisPhase('done')

              updateMessageContent(currentConversationId, assistantMsgId, finalContent, {
                model: `SYNTHESIS (${orchModel})`,
                ...(tuneResult ? {
                  tuningParams: tuneResult.params,
                  tuningContext: tuneResult.detectedContext,
                  tuningContextMetrics: tuneResult.contextMetrics,
                  tuningPatternHits: tuneResult.patternHits,
                  tuningDeltas: tuneResult.paramShifts,
                } : {}),
              })
            },
            onError: (error) => {
              updateMessageContent(currentConversationId, assistantMsgId,
                `SYNTHESIS error: ${error}`)
              setSynthesisPhase('idle')
            },
          },
        )

        setIsStreaming(false)
        setSynthesisPhase('idle')
        return
      }

      // -- RACE PATH: Multi-model race with Dynamic Upgrade --
      if (raceEnabled && raceApiUrl && raceApiKey) {
        // Add placeholder assistant message that we'll update live
        const assistantMsgId = addMessage(currentConversationId, {
          role: 'assistant',
          content: '',
          model: 'RACE',
          persona: persona.id,
        })

        setRaceRacing(true)
        resetRace()

        // Collect all race responses for browsing later
        const collectedResponses: Array<{ model: string; content: string; score: number; duration_ms: number }> = []

        await streamRace(
          {
            messages,
            openrouterApiKey: apiKey,
            apiBaseUrl: raceApiUrl,
            nexusApiKey: raceApiKey,
            tier: raceTier,
            stmModules: transformModules.filter(m => m.enabled).map(m => m.id),
            liquid: dynamicUpgradeEnabled,
            dynamic_min_delta: dynamicMinDelta,
            signal: abortControllerRef.current.signal,
          },
          {
            onRaceStart: (data) => {
              setRaceProgress(0, data.models_queried)
              updateMessageContent(currentConversationId, assistantMsgId,
                `*Racing ${data.models_queried} models...*`)
            },
            onModelResult: (data) => {
              setRaceProgress(data.models_responded, data.models_total)
            },
            onLeaderChange: (data) => {
              // Collect each leader response for later browsing
              collectedResponses.push({
                model: data.model,
                content: data.content,
                score: data.score,
                duration_ms: data.duration_ms,
              })
              setRaceLive(data.content, data.model, data.score)
              updateMessageContent(currentConversationId, assistantMsgId, data.content, {
                model: data.model,
              })
            },
            onComplete: async (data) => {
              const finalContent = data.response || ''
              const winnerModel = data.winner?.model || 'RACE'

              // Build full race responses from rankings (backend now includes content)
              const rankingResponses = (data.race?.rankings ?? [])
                .filter(r => r.success && r.content)
                .map(r => ({
                  model: r.model,
                  content: r.content!,
                  score: r.score,
                  duration_ms: r.duration_ms,
                  isWinner: r.model === winnerModel,
                }))
                .sort((a, b) => b.score - a.score)

              // Fall back to collected leader changes if rankings lack content
              const raceResponses = rankingResponses.length > 0
                ? rankingResponses
                : collectedResponses.map(r => ({
                    ...r,
                    isWinner: r.model === winnerModel,
                  }))

              updateMessageContent(currentConversationId, assistantMsgId, finalContent, {
                model: winnerModel,
                raceResponses: raceResponses.length > 1 ? raceResponses : undefined,
                ...(tuneResult ? {
                  tuningParams: tuneResult.params,
                  tuningContext: tuneResult.detectedContext,
                  tuningContextMetrics: tuneResult.contextMetrics,
                  tuningPatternHits: tuneResult.patternHits,
                  tuningDeltas: tuneResult.paramShifts,
                } : {}),
              })
              resetRace()

              // Wait for LLM classification to land (usually already resolved)
              await llmClassifyPromise

              // Beacon metadata to HF dataset (fire-and-forget, no content)
              recordChatEvent({
                mode: 'race',
                model: winnerModel,
                duration_ms: data.race?.total_duration_ms || 0,
                response_length: finalContent.length,
                success: true,
                pipeline: {
                  tuning: tuningEnabled,
                  obfuscation: obfuscationConfig.enabled,
                  stmModules: transformModules.filter(m => m.enabled).map(m => m.id),
                  strategy: tuningStrategy,
                  nexus: true,
                },
                ...(tuneResult ? {
                  tuning: {
                    detected_context: tuneResult.detectedContext,
                    confidence: tuneResult.confidence,
                  },
                } : {}),
                obfuscation: obfuscationConfig.enabled ? {
                  triggers_found: obfuscationResult.triggersFound.length,
                  technique: obfuscationConfig.technique,
                  intensity: obfuscationConfig.intensity,
                } : undefined,
                race: {
                  tier: raceTier,
                  models_queried: data.race?.models_queried || 0,
                  models_succeeded: data.race?.models_succeeded || 0,
                  winner_model: winnerModel,
                  winner_score: data.winner?.score || 0,
                  total_duration_ms: data.race?.total_duration_ms || 0,
                },
                classification: promptClassification,
                persona: persona.id,
                prompt_length: originalMessage.length,
                conversation_depth: currentConversation?.messages?.length || 0,
                memory_count: activeMemories.length,
                no_log: noLogMode,
                obfuscation_transformed: obfuscationResult.triggersFound.length > 0,
              })
            },
            onError: (error) => {
              updateMessageContent(currentConversationId, assistantMsgId,
                `**RACE Error:** ${error}`)
              resetRace()
            },
          },
        )
      } else {
        // -- STANDARD PATH: agentic single-model (Manus-style) -------
        // The model autonomously uses sandbox tools when the request needs
        // execution; otherwise it just answers. The sandbox boots lazily.
        const startTime = Date.now()
        const isNvidia = isNvidiaModel(model)

        // Resolve the LLM provider for the server-side agent loop.
        let llmApiKey = ''
        let llmBaseUrl = ''
        let realModel = model
        if (isNvidia && nvidiaApiKey) {
          llmApiKey = nvidiaApiKey
          llmBaseUrl = 'https://integrate.api.nvidia.com/v1'
          realModel = toRealModelId(model)
        } else if (apiKey) {
          llmApiKey = apiKey
          llmBaseUrl = 'https://openrouter.ai/api/v1'
          realModel = model
        }

        let responseLength = 0

        if (!llmApiKey) {
          // Proxy-only mode (no personal provider key): non-agentic fallback.
          const response = await sendMessageViaProxy({
            messages: messages as any,
            model,
            apiBaseUrl: raceApiUrl,
            nexusApiKey: raceApiKey,
            signal: abortControllerRef.current.signal,
            stmModules: transformModules.filter(m => m.enabled).map(m => m.id),
            ...(tuneResult ? { temperature: tuneResult.params.temperature } : {}),
          })
          let transformedResponse = response
          for (const stm of transformModules) {
            if (stm.enabled) transformedResponse = stm.transformer(transformedResponse)
          }
          responseLength = transformedResponse.length
          addMessage(currentConversationId, {
            role: 'assistant',
            content: transformedResponse,
            model,
            persona: persona.id,
            ...(tuneResult ? {
              tuningParams: tuneResult.params,
              tuningContext: tuneResult.detectedContext,
              tuningContextMetrics: tuneResult.contextMetrics,
              tuningPatternHits: tuneResult.patternHits,
              tuningDeltas: tuneResult.paramShifts,
            } : {}),
          })
        } else {
          // Agentic loop with live tool steps streamed into the message.
          const assistantMsgId = addMessage(currentConversationId, {
            role: 'assistant',
            content: '',
            model,
            persona: persona.id,
          })
          const steps: AgentEvent[] = []
          const artifacts: AgentArtifact[] = []
          let reasoning = ''
          let finalText = ''
          const thinkStart = Date.now()

          await streamAgent(
            {
              messages: messages as any,
              llmApiKey,
              llmBaseUrl,
              model: realModel,
              temperature: tuneResult?.params.temperature ?? 0.5,
              skills: skillsEnabled
                ? SKILLS.filter((s) => skillConfig[s.id] !== false).map((s) => s.id)
                : [],
              signal: abortControllerRef.current.signal,
            },
            (e: AgentEvent) => {
              if (e.type === 'final') {
                finalText = e.content
                for (const stm of transformModules) {
                  if (stm.enabled) finalText = stm.transformer(finalText)
                }
                responseLength = finalText.length
                updateMessageContent(currentConversationId, assistantMsgId, finalText, {
                  agentSteps: steps.length ? [...steps] : undefined,
                  reasoning: reasoning || undefined,
                  thinkingMs: Date.now() - thinkStart,
                  artifacts: artifacts.length ? [...artifacts] : undefined,
                  ...(tuneResult ? {
                    tuningParams: tuneResult.params,
                    tuningContext: tuneResult.detectedContext,
                    tuningContextMetrics: tuneResult.contextMetrics,
                    tuningPatternHits: tuneResult.patternHits,
                    tuningDeltas: tuneResult.paramShifts,
                  } : {}),
                })
              } else if (e.type === 'error') {
                updateMessageContent(currentConversationId, assistantMsgId,
                  `**Error:** ${e.message}`,
                  {
                    agentSteps: steps.length ? [...steps] : undefined,
                    reasoning: reasoning || undefined,
                    artifacts: artifacts.length ? [...artifacts] : undefined,
                  })
              } else if (e.type === 'thought') {
                // Reasoning trace → Claude-web-style Thinking panel (not the tool timeline)
                reasoning += (reasoning ? '\n\n' : '') + e.content
                updateMessageContent(currentConversationId, assistantMsgId, finalText, {
                  reasoning,
                  agentSteps: steps.length ? [...steps] : undefined,
                })
              } else if (e.type === 'artifact') {
                // A file the agent built — surfaced as a download in the message
                artifacts.push(e.artifact)
                updateMessageContent(currentConversationId, assistantMsgId, finalText, {
                  artifacts: [...artifacts],
                  agentSteps: steps.length ? [...steps] : undefined,
                })
              } else {
                steps.push(e)
                updateMessageContent(currentConversationId, assistantMsgId, finalText, {
                  agentSteps: [...steps],
                })
              }
            },
          )
        }

        const durationMs = Date.now() - startTime

        // Wait for LLM classification to land (usually already resolved)
        await llmClassifyPromise

        // Beacon metadata to HF dataset (fire-and-forget, no content)
        recordChatEvent({
          mode: 'standard',
          model,
          duration_ms: durationMs,
          response_length: responseLength,
          success: true,
          pipeline: {
            tuning: tuningEnabled,
            obfuscation: obfuscationConfig.enabled,
            stmModules: transformModules.filter(m => m.enabled).map(m => m.id),
            strategy: tuningStrategy,
            nexus: useCustomSystemPrompt,
          },
          ...(tuneResult ? {
            tuning: {
              detected_context: tuneResult.detectedContext,
              confidence: tuneResult.confidence,
            },
          } : {}),
          obfuscation: obfuscationConfig.enabled ? {
            triggers_found: obfuscationResult.triggersFound.length,
            technique: obfuscationConfig.technique,
            intensity: obfuscationConfig.intensity,
          } : undefined,
          classification: promptClassification,
          persona: persona.id,
          prompt_length: originalMessage.length,
          conversation_depth: currentConversation?.messages?.length || 0,
          memory_count: activeMemories.length,
          no_log: noLogMode,
          obfuscation_transformed: obfuscationResult.triggersFound.length > 0,
        })
      }
    } catch (error: any) {
      resetRace()
      if (error.name === 'AbortError') {
        addMessage(currentConversationId, {
          role: 'assistant',
          content: '_[Response stopped by user]_',
          model,
          persona: persona.id
        })
        recordChatEvent({
          mode: raceEnabled ? 'race' : 'standard',
          model,
          duration_ms: 0,
          response_length: 0,
          success: false,
          error_type: 'abort',
          pipeline: {
            tuning: tuningEnabled,
            obfuscation: obfuscationConfig.enabled,
            stmModules: transformModules.filter(m => m.enabled).map(m => m.id),
            strategy: tuningStrategy,
            nexus: useCustomSystemPrompt,
          },
          classification: promptClassification,
          persona: persona.id,
          prompt_length: originalMessage.length,
          conversation_depth: currentConversation?.messages?.length || 0,
          memory_count: activeMemories.length,
          no_log: noLogMode,
          obfuscation_transformed: obfuscationResult.triggersFound.length > 0,
        })
      } else {
        console.error('Error sending message:', error)
        const errMsg = error.message || 'Failed to get response. Check your API key in Settings and try again.'
        const errLower = errMsg.toLowerCase()
        const errorType = errLower.includes('api key') || errLower.includes('expired') || errLower.includes('denied') || errLower.includes('permission')
          ? 'auth'
          : errLower.includes('rate limit') || errLower.includes('wait')
          ? 'rate_limit'
          : errLower.includes('timeout') || errLower.includes('timed out')
          ? 'timeout'
          : errLower.includes('unavailable') || errLower.includes('overloaded')
          ? 'model_error'
          : errLower.includes('credit') || errLower.includes('insufficient')
          ? 'billing'
          : 'unknown'
        addMessage(currentConversationId, {
          role: 'assistant',
          content: `**Error:** ${errMsg}`,
          model,
          persona: persona.id
        })
        recordChatEvent({
          mode: raceEnabled ? 'race' : 'standard',
          model,
          duration_ms: 0,
          response_length: 0,
          success: false,
          error_type: errorType,
          pipeline: {
            tuning: tuningEnabled,
            obfuscation: obfuscationConfig.enabled,
            stmModules: transformModules.filter(m => m.enabled).map(m => m.id),
            strategy: tuningStrategy,
            nexus: useCustomSystemPrompt,
          },
          classification: promptClassification,
          persona: persona.id,
          prompt_length: originalMessage.length,
          conversation_depth: currentConversation?.messages?.length || 0,
          memory_count: activeMemories.length,
          no_log: noLogMode,
          obfuscation_transformed: obfuscationResult.triggersFound.length > 0,
        })
      }
    } finally {
      setIsStreaming(false)
      setRaceRacing(false)
      abortControllerRef.current = null
    }
  }

  const handleStop = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort()
    }
  }

  const handleKeyDown = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault()
      handleSubmit()
    }
  }

  // Determine which result to show (live preview while typing, last result after send)
  const displayResult = livePreview || tuningLastResult

  // Count active memories for display
  const activeMemoryCount = memoriesEnabled ? memories.filter(m => m.active).length : 0

  return (
    <div
      className={`relative border-t border-theme-primary bg-theme-dim/50 p-4 transition-colors
        ${isDragging ? 'bg-theme-accent/20' : ''}`}
      onDragOver={(e) => { e.preventDefault(); setIsDragging(true) }}
      onDragLeave={(e) => { e.preventDefault(); setIsDragging(false) }}
      onDrop={handleDrop}
    >
      {isDragging && (
        <div className="absolute inset-2 z-10 flex items-center justify-center rounded-xl
          border-2 border-dashed border-theme-primary bg-theme-bg/80 pointer-events-none">
          <div className="flex items-center gap-2 text-sm theme-primary font-semibold">
            <Paperclip className="w-4 h-4" />
            {t('composer.dropFiles') || 'Drop files to analyze'}
          </div>
        </div>
      )}
      <div className="max-w-4xl mx-auto">
        {/* TUNING live parameter display */}
        {tuningEnabled && displayResult && showTuneDetails && (
          <div className="mb-3 p-3 bg-theme-bg border border-theme-primary rounded-lg space-y-3">
            {/* Header */}
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2 text-xs font-semibold theme-primary">
                <SlidersHorizontal className="w-3 h-3" />
                TUNING {tuningStrategy === 'adaptive'
                  ? `// ${getContextLabel(displayResult.detectedContext)} (${Math.round(displayResult.confidence * 100)}%)`
                  : `// ${getStrategyLabel(tuningStrategy)}`
                }
              </div>
            </div>

            {/* Context Competition - show all context scores */}
            {displayResult.contextMetrics && displayResult.contextMetrics.length > 1 && (
              <div className="flex items-center gap-1 text-[10px] font-mono">
                <span className="theme-secondary mr-1">CONTEXT:</span>
                {displayResult.contextMetrics
                  .filter(s => s.percentage > 0)
                  .slice(0, 4)
                  .map((s, i) => (
                    <span key={s.type} className="flex items-center">
                      {i > 0 && <span className="text-gray-600 mx-1">&gt;</span>}
                      <span className={i === 0 ? 'text-cyan-400 font-bold' : 'theme-secondary'}>
                        {getContextLabel(s.type)} {s.percentage}%
                      </span>
                    </span>
                  ))}
              </div>
            )}

            {/* Pattern Match Reasoning - why this context was detected */}
            {displayResult.patternHits && displayResult.patternHits.length > 0 && (
              <div className="text-[10px] font-mono">
                <span className="theme-secondary">MATCHED: </span>
                <span className="text-purple-400">
                  {displayResult.patternHits
                    .slice(0, 3)
                    .map(p => p.pattern)
                    .join(' | ')}
                  {displayResult.patternHits.length > 3 && ` +${displayResult.patternHits.length - 3} more`}
                </span>
              </div>
            )}

            {/* Parameter Grid with Deltas */}
            <div className="grid grid-cols-6 gap-2">
              {(Object.entries(displayResult.params) as [keyof typeof PARAM_META, number][]).map(
                ([key, value]) => {
                  // Find if there's a delta for this param
                  const delta = displayResult.paramShifts?.find(d => d.param === key)
                  const hasDelta = delta && Math.abs(delta.delta) > 0.001

                  return (
                    <div
                      key={key}
                      className={`text-center p-1.5 rounded border transition-all
                        ${hasDelta
                          ? 'bg-cyan-500/10 border-cyan-500/30'
                          : 'bg-theme-dim border-theme-primary/30'
                        }`}
                      title={delta?.reason || PARAM_META[key].description}
                    >
                      <div className="text-[10px] theme-secondary font-mono">
                        {PARAM_META[key].short}
                      </div>
                      <div className="text-sm font-bold theme-primary font-mono">
                        {typeof value === 'number' ? value.toFixed(2) : value}
                      </div>
                      {hasDelta && (
                        <div className={`text-[9px] font-mono ${delta.delta > 0 ? 'text-green-400' : 'text-red-400'}`}>
                          {delta.delta > 0 ? '+' : ''}{delta.delta.toFixed(2)}
                        </div>
                      )}
                    </div>
                  )
                }
              )}
            </div>

            {/* Delta Explanations - what changed and why */}
            {displayResult.paramShifts && displayResult.paramShifts.length > 0 && (
              <div className="text-[10px] font-mono space-y-0.5 pt-1 border-t border-theme-primary/20">
                <span className="theme-secondary">TUNING:</span>
                {displayResult.paramShifts.slice(0, 4).map((d, i) => (
                  <div key={`${d.param}-${i}`} className="flex items-center gap-1 pl-2">
                    <span className="text-cyan-400">{PARAM_META[d.param].short}</span>
                    <span className="theme-secondary">
                      {d.before.toFixed(2)} ? {d.after.toFixed(2)}
                    </span>
                    <span className={d.delta > 0 ? 'text-green-400' : 'text-red-400'}>
                      ({d.delta > 0 ? '+' : ''}{d.delta.toFixed(2)})
                    </span>
                    <span className="text-purple-400">{d.reason}</span>
                  </div>
                ))}
                {displayResult.paramShifts.length > 4 && (
                  <div className="pl-2 theme-secondary">+{displayResult.paramShifts.length - 4} more adjustments</div>
                )}
              </div>
            )}
          </div>
        )}

        {/* Attachment chips */}
        {attachments.length > 0 && (
          <div className="mb-3 flex flex-wrap gap-2">
            {attachments.map((a) => (
              <div
                key={a.id}
                className={`flex items-center gap-2 pl-2 pr-1 py-1 rounded-lg border text-xs
                  ${a.status === 'error'
                    ? 'border-red-500/50 bg-red-500/10'
                    : 'border-theme-primary/40 bg-theme-bg'}`}
                title={a.error || a.name}
              >
                {a.dataUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={a.dataUrl} alt={a.name} className="w-6 h-6 rounded object-cover" />
                ) : (
                  <span className="text-sm">{a.status === 'error' ? '' : kindIcon(a.kind)}</span>
                )}
                {a.status === 'error' && <FileWarning className="w-3.5 h-3.5 text-red-400" />}
                <div className="flex flex-col leading-tight max-w-[160px]">
                  <span className="truncate theme-primary">{a.name}</span>
                  <span className="text-[10px] theme-secondary">
                    {a.status === 'processing'
                      ? 'Analyzing…'
                      : a.status === 'error'
                      ? (a.error || 'Failed')
                      : a.kind === 'image'
                      ? 'Image · vision'
                      : a.meta?.pages
                      ? `${a.meta.pages} pages`
                      : a.meta?.sheets
                      ? `${(a.meta.sheets as string[]).length} sheets`
                      : a.meta?.entries
                      ? `${a.meta.entries} files`
                      : `${(a.size / 1024).toFixed(0)} KB`}
                  </span>
                </div>
                {a.status === 'processing' ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin theme-secondary" />
                ) : (
                  <button
                    onClick={() => removeAttachment(a.id)}
                    className="p-1 rounded hover:bg-theme-dim transition-colors"
                    aria-label="Remove attachment"
                  >
                    <X className="w-3.5 h-3.5 theme-secondary" />
                  </button>
                )}
              </div>
            ))}
          </div>
        )}

        {/* Hidden native file input */}
        <input
          ref={fileInputRef}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => {
            if (e.target.files) addFiles(e.target.files)
            e.target.value = '' // allow re-selecting the same file
          }}
        />

        <div className="flex items-end gap-3">
          {/* Attach button */}
          <button
            onClick={() => fileInputRef.current?.click()}
            disabled={!canChat || isStreaming}
            className="p-3 bg-theme-dim border border-theme-primary/70 rounded-lg
              hover:border-theme-primary hover:glow-box transition-all
              disabled:opacity-50 disabled:cursor-not-allowed"
            aria-label="Attach file"
            title="Attach files (PDF, Word, Excel, images, zip, audio, video)"
          >
            <Paperclip className="w-5 h-5" />
          </button>
          <div className="flex-1 relative">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={handleKeyDown}
              onPaste={handlePaste}
              placeholder={canChat ? t('composer.placeholder') : t('composer.setKeyFirst')}
              disabled={!canChat || isStreaming}
              rows={1}
              className="nexus-input w-full px-4 py-3 pr-12 bg-theme-dim border border-theme-primary/70 rounded-xl
                resize-none focus:outline-none focus:border-theme-primary focus:glow-box
                disabled:opacity-50 text-sm leading-relaxed
                transition-all duration-200"
              style={{ minHeight: '48px', maxHeight: '200px' }}
            />

            {/* Character count */}
            {input.length > 0 && (
              <div className="absolute right-3 bottom-3 text-xs theme-secondary">
                {input.length}
              </div>
            )}
          </div>

          {/* Submit/Stop button */}
          {isStreaming ? (
            <button
              onClick={handleStop}
              className="p-3 bg-red-500/20 border border-red-500 rounded-lg
                hover:bg-red-500/30 transition-all"
              aria-label="Stop generation"
            >
              <StopCircle className="w-5 h-5 text-red-500" />
            </button>
          ) : (
            <button
              onClick={handleSubmit}
              disabled={(!input.trim() && attachments.length === 0) || !canChat}
              className="p-3 bg-theme-accent border border-theme-primary rounded-lg
                hover:glow-box transition-all
                disabled:opacity-50 disabled:cursor-not-allowed"
              aria-label="Send message"
            >
              {isStreaming ? (
                <Loader2 className="w-5 h-5 animate-spin" />
              ) : (
                <Send className="w-5 h-5" />
              )}
            </button>
          )}
        </div>

        {/* Status indicators */}
        <div className="flex items-center justify-between mt-2 text-xs theme-secondary">
          <div className="flex items-center gap-4">
            {tuningEnabled && (
              <button
                onClick={() => setShowTuneDetails(!showTuneDetails)}
                className={`flex items-center gap-1 transition-colors hover:text-cyan-400
                  ${showTuneDetails ? 'text-cyan-400' : ''}`}
              >
                <SlidersHorizontal className="w-3 h-3 text-cyan-400" />
                TUNING {tuningStrategy === 'adaptive' && displayResult
                  ? `[${getContextLabel(displayResult.detectedContext)}]`
                  : `[${getStrategyLabel(tuningStrategy)}]`
                }
              </button>
            )}
            {noLogMode && (
              <span className="flex items-center gap-1">
                <span className="text-yellow-500 text-[10px]">&#x25C8;</span>
                {t('composer.noLog')}
                <HelpTip text={t('tip.noLog')} />
              </span>
            )}
            {transformModules.some(m => m.enabled) && (
              <span className="flex items-center gap-1">
                <span className="text-purple-500 text-[10px]">&#x2B23;</span>
                {transformModules.filter(m => m.enabled).length} STM Active
              </span>
            )}
            {activeMemoryCount > 0 && (
              <span className="flex items-center gap-1">
                <span className="text-cyan-400 text-[10px]">&#x2726;</span>
                {activeMemoryCount} Memories
              </span>
            )}
            {obfuscationConfig.enabled && (
              <span className={`flex items-center gap-1 ${obfuscationPreview ? 'text-green-400' : ''}`}>
                <span className="text-green-500 text-[10px]">&#x2621;</span>
                OBFUSCATION
                {obfuscationPreview && ` [${obfuscationPreview.triggersFound.length} triggers]`}
              </span>
            )}
            {raceEnabled && (
              <span className="flex items-center gap-1 text-orange-400">
                <span className="text-[10px]">&#x2694;</span>
                RACE [{raceTier}]
              </span>
            )}
          </div>
          {isStreaming && (
            <span className="flex items-center gap-1">
              <Loader2 className="w-3 h-3 animate-spin" />
              {synthesisPhase === 'collecting'
                ? `Collecting ${synthesisModelsCollected}/${synthesisModelsTotal} models...`
                : synthesisPhase === 'synthesizing'
                ? `Synthesizing ground truth...`
                : raceRacing
                ? `Racing ${raceModelsResponded}/${raceModelsTotal} models${raceLiveModel ? ` // Leader: ${raceLiveModel.split('/').pop()} (${raceLiveScore})` : '...'}`
                : tuningEnabled && tuningLastResult
                  ? `Tuned @ T=${tuningLastResult.params.temperature.toFixed(2)}...`
                  : 'Working…'
              }
            </span>
          )}
        </div>
      </div>
    </div>
  )
}

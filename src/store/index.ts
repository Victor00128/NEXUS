import { create } from 'zustand'
import { persist, createJSONStorage } from 'zustand/middleware'
import { v4 as uuidv4 } from 'uuid'
import type { TuningStrategy, TuningParam, TuningResult, ContextType, ContextMetric, PatternHit, ParamShift } from '@/lib/tuning'
import type { LearningState, AdaptedProfile } from '@/lib/tuning-feedback'
import { createInitialLearningState, processLearning, computeAdaptations } from '@/lib/tuning-feedback'
import type { ObfuscationConfig, ObfuscationMethod } from '@/lib/obfuscation'
import { getDefaultObfuscationConfig } from '@/lib/obfuscation'
import { NEXUS_SYSTEM_PROMPT } from '@/lib/system-prompt'
import type { Language } from '@/lib/i18n'
import type { Attachment } from '@/lib/files'
import type { AgentEvent, AgentArtifact } from '@/lib/agent-client'
import { SKILLS } from '@/lib/skills'

// Types
export type Theme = 'midnight' | 'crimson' | 'aurora' | 'light'

export interface RaceResponse {
  model: string
  content: string
  score: number
  duration_ms: number
  isWinner?: boolean
}

export interface Message {
  id: string
  role: 'user' | 'assistant' | 'system'
  content: string
  timestamp: number
  model?: string
  persona?: string
  tuningParams?: TuningParam
  tuningContext?: ContextType
  tuningContextMetrics?: ContextMetric[]
  tuningPatternHits?: PatternHit[]
  tuningDeltas?: ParamShift[]
  learningRating?: 1 | -1
  /** All responses from a race, for browsing past results */
  raceResponses?: RaceResponse[]
  /** Files attached to a user message (analyzed client-side). */
  attachments?: Attachment[]
  /** Agent tool-use steps (when the assistant used the sandbox). */
  agentSteps?: AgentEvent[]
  /** Model reasoning trace, shown in the collapsible Thinking panel. */
  reasoning?: string
  /** Wall-clock time spent before the final answer (for "Thought for Xs"). */
  thinkingMs?: number
  /** Files the agent produced in the sandbox, offered as downloads. */
  artifacts?: AgentArtifact[]
}

export interface Conversation {
  id: string
  title: string
  messages: Message[]
  createdAt: number
  updatedAt: number
  persona: string
  model: string
}

export interface Persona {
  id: string
  name: string
  description: string
  tone: string
  coreDirective: string
  systemPrompt: string
  emoji: string
  color: string
}

export interface TransformModule {
  id: string
  name: string
  description: string
  enabled: boolean
  transformer: (input: string) => string
}

// Memory System - persistent facts about the user
export type MemoryType = 'fact' | 'preference' | 'instruction'

export interface Memory {
  id: string
  type: MemoryType
  content: string
  createdAt: number
  updatedAt: number
  source: 'manual' | 'auto'
  active: boolean // can be toggled on/off without deleting
}

export type AccessTier = 'free' | 'pro' | 'enterprise'

export interface AccessInfo {
  tier: AccessTier
  label: string
  limits: { total: number; perMinute: number; perDay: number }
  features: {
    raceTiers: string[]
    max_race_models: number
    research_access: string
    dataset_export_formats: string[]
    can_flush: boolean
    can_access_metadata_events: boolean
    can_download_corpus: boolean
  }
}

export interface AppState {
  // Core state
  theme: Theme
  language: Language
  apiKey: string
  nvidiaApiKey: string
  // Transcription (Whisper) config for audio/video files
  transcriptionApiKey: string
  transcriptionBaseUrl: string
  transcriptionModel: string
  // NEXUS Agent engine (OpenHands) URL — local by default
  agentUrl: string
  defaultModel: string
  conversations: Conversation[]
  currentConversationId: string | null
  isHydrated: boolean

  // Tier state
  accessInfo: AccessInfo | null

  // UI state
  showSettings: boolean
  showAgent: boolean
  showMagic: boolean
  sidebarOpen: boolean
  isStreaming: boolean

  // Persona state
  currentPersona: string
  personas: Persona[]

  // STM state
  transformModules: TransformModule[]

  // Privacy
  dataCollectionEnabled: boolean
  noLogMode: boolean

  // TUNING state
  tuningEnabled: boolean
  tuningStrategy: TuningStrategy
  tuningOverrides: Partial<TuningParam>
  tuningLastResult: TuningResult | null

  // Feedback loop state
  learningState: LearningState

  // Memory system state
  memories: Memory[]
  memoriesEnabled: boolean

  // OBFUSCATION state
  obfuscationConfig: ObfuscationConfig

  // System prompt state
  customSystemPrompt: string
  useCustomSystemPrompt: boolean

  // Skills state — capability modules the model auto-selects per task
  skillsEnabled: boolean
  skillConfig: Record<string, boolean>

  // SYNTHESIS state
  synthesisEnabled: boolean
  synthesisTier: 'fast' | 'standard' | 'smart' | 'power' | 'ultra'
  synthesisPhase: 'idle' | 'collecting' | 'synthesizing' | 'done'
  synthesisModelsCollected: number
  synthesisModelsTotal: number
  synthesisOrchestratorModel: string | null

  // Dynamic Upgrade — universal feature layer across all modes
  dynamicUpgradeEnabled: boolean
  dynamicMinDelta: number
  promptsTried: number

  // RACE state
  raceEnabled: boolean
  raceTier: 'fast' | 'standard' | 'smart' | 'power' | 'ultra'
  raceApiUrl: string
  raceApiKey: string
  /** Currently displayed leader content during a live race */
  raceLiveContent: string | null
  /** Current leader model during a live race */
  raceLiveModel: string | null
  /** Current leader score during a live race */
  raceLiveScore: number | null
  /** Number of models that have responded */
  raceModelsResponded: number
  /** Total models in the race */
  raceModelsTotal: number
  /** Whether a race is currently in progress */
  raceRacing: boolean

  // Actions
  setTheme: (theme: Theme) => void
  setLanguage: (language: Language) => void
  setApiKey: (key: string) => void
  setNvidiaApiKey: (key: string) => void
  setTranscriptionApiKey: (key: string) => void
  setTranscriptionBaseUrl: (url: string) => void
  setTranscriptionModel: (model: string) => void
  setAgentUrl: (url: string) => void
  setDefaultModel: (model: string) => void
  setShowSettings: (show: boolean) => void
  setShowAgent: (show: boolean) => void
  setShowMagic: (show: boolean) => void
  setSidebarOpen: (open: boolean) => void
  setIsStreaming: (streaming: boolean) => void
  setCurrentPersona: (persona: string) => void
  setDataCollectionEnabled: (enabled: boolean) => void
  setNoLogMode: (enabled: boolean) => void
  setHydrated: () => void

  // TUNING actions
  setTuningEnabled: (enabled: boolean) => void
  setTuningStrategy: (strategy: TuningStrategy) => void
  setTuningOverride: (param: keyof TuningParam, value: number | null) => void
  clearTuningOverrides: () => void
  setTuningLastResult: (result: TuningResult | null) => void

  // Feedback loop actions
  rateResponse: (conversationId: string, messageId: string, rating: 1 | -1) => void
  clearLearningHistory: () => void

  // Conversation actions
  createConversation: () => string
  selectConversation: (id: string) => void
  deleteConversation: (id: string) => void
  addMessage: (conversationId: string, message: Omit<Message, 'id' | 'timestamp'>) => string
  updateMessageContent: (conversationId: string, messageId: string, content: string, extra?: Partial<Message>) => void
  updateConversationTitle: (id: string, title: string) => void
  clearConversations: () => void

  // STM actions
  toggleTransform: (id: string) => void

  // Memory actions
  setMemoriesEnabled: (enabled: boolean) => void
  addMemory: (memory: Omit<Memory, 'id' | 'createdAt' | 'updatedAt'>) => void
  updateMemory: (id: string, updates: Partial<Pick<Memory, 'content' | 'type' | 'active'>>) => void
  deleteMemory: (id: string) => void
  toggleMemory: (id: string) => void
  clearMemories: () => void

  // OBFUSCATION actions
  setObfuscationEnabled: (enabled: boolean) => void
  setObfuscationMethod: (technique: ObfuscationMethod) => void
  setObfuscationIntensity: (intensity: 'light' | 'medium' | 'heavy') => void
  setObfuscationCustomTriggers: (triggers: string[]) => void

  // System prompt actions
  setCustomSystemPrompt: (prompt: string) => void
  setUseCustomSystemPrompt: (use: boolean) => void
  resetSystemPromptToDefault: () => void

  // Skills actions
  setSkillsEnabled: (enabled: boolean) => void
  toggleSkill: (id: string) => void

  // Tier actions
  setAccessInfo: (info: AccessInfo | null) => void
  fetchAccessInfo: () => Promise<void>

  // SYNTHESIS actions
  setSynthesisEnabled: (enabled: boolean) => void
  setSynthesisTier: (tier: 'fast' | 'standard' | 'smart' | 'power' | 'ultra') => void
  setSynthesisPhase: (phase: 'idle' | 'collecting' | 'synthesizing' | 'done') => void
  setSynthesisProgress: (collected: number, total: number) => void
  resetSynthesis: () => void

  // Dynamic Upgrade actions
  setDynamicUpgradeEnabled: (enabled: boolean) => void
  setDynamicMinDelta: (delta: number) => void
  incrementPromptsTried: () => void

  // RACE actions
  setRaceEnabled: (enabled: boolean) => void
  setRaceTier: (tier: 'fast' | 'standard' | 'smart' | 'power' | 'ultra') => void
  setRaceApiUrl: (url: string) => void
  setRaceApiKey: (key: string) => void
  setRaceLive: (content: string | null, model: string | null, score: number | null) => void
  setRaceProgress: (responded: number, total: number) => void
  setRaceRacing: (racing: boolean) => void
  resetRace: () => void

  // Backup / restore
  restoreBackup: (data: Record<string, unknown>) => void
}

// Default personas - NEXUS only
const defaultPersonas: Persona[] = [
  {
    id: 'nexus',
    name: 'NEXUS',
    description: 'Capable, autonomous AI assistant — reasons, writes, and gets real work done',
    tone: 'direct, clear, helpful',
    coreDirective: 'You are NEXUS, a capable and honest AI assistant with an autonomous agent. Give complete, accurate, well-structured answers; use your tools to actually execute tasks when needed; never fabricate; be concise and genuinely helpful.',
    systemPrompt: '', // System prompt is set dynamically based on model in ChatInput
    emoji: '◆',
    color: '#3b82f6'
  }
]

// Re-export from single source of truth
export const DEFAULT_NEXUS_PROMPT = NEXUS_SYSTEM_PROMPT

// Default STM modules - only functional ones
const defaultTransformModules: TransformModule[] = [
  {
    id: 'hedge_reducer',
    name: 'Hedge Reducer',
    description: 'Removes hedging language for confident, direct responses',
    enabled: false,
    transformer: (input) => input
      .replace(/\bI think\s+/gi, '')
      .replace(/\bI believe\s+/gi, '')
      .replace(/\bperhaps\s+/gi, '')
      .replace(/\bmaybe\s+/gi, '')
      .replace(/\bIt seems like\s+/gi, '')
      .replace(/\bIt appears that\s+/gi, '')
      .replace(/\bprobably\s+/gi, '')
      .replace(/\bpossibly\s+/gi, '')
      .replace(/\bI would say\s+/gi, '')
      .replace(/\bIn my opinion,?\s*/gi, '')
      .replace(/\bFrom my perspective,?\s*/gi, '')
      .replace(/^\s*([a-z])/gm, (_, letter) => letter.toUpperCase())
  },
  {
    id: 'direct_mode',
    name: 'Direct Mode',
    description: 'Removes preambles and filler phrases',
    enabled: false,
    transformer: (input) => input
      .replace(/^(Sure,?\s*)/i, '')
      .replace(/^(Of course,?\s*)/i, '')
      .replace(/^(Certainly,?\s*)/i, '')
      .replace(/^(Absolutely,?\s*)/i, '')
      .replace(/^(Great question!?\s*)/i, '')
      .replace(/^(That's a great question!?\s*)/i, '')
      .replace(/^(I'd be happy to help( you)?( with that)?[.!]?\s*)/i, '')
      .replace(/^(Let me help you with that[.!]?\s*)/i, '')
      .replace(/^(I understand[.!]?\s*)/i, '')
      .replace(/^(Thanks for asking[.!]?\s*)/i, '')
      .replace(/^\s*([a-z])/, (_, letter) => letter.toUpperCase())
  },
  {
    id: 'formality_casual',
    name: 'Casual Mode',
    description: 'Converts formal language to casual speech',
    enabled: false,
    transformer: (input) => input
      .replace(/\bHowever\b/g, 'But')
      .replace(/\bTherefore\b/g, 'So')
      .replace(/\bFurthermore\b/g, 'Also')
      .replace(/\bAdditionally\b/g, 'Plus')
      .replace(/\bNevertheless\b/g, 'Still')
      .replace(/\bConsequently\b/g, 'So')
      .replace(/\bMoreover\b/g, 'Also')
      .replace(/\bUtilize\b/g, 'Use')
      .replace(/\butilize\b/g, 'use')
      .replace(/\bPurchase\b/g, 'Buy')
      .replace(/\bpurchase\b/g, 'buy')
      .replace(/\bObtain\b/g, 'Get')
      .replace(/\bobtain\b/g, 'get')
      .replace(/\bCommence\b/g, 'Start')
      .replace(/\bcommence\b/g, 'start')
      .replace(/\bTerminate\b/g, 'End')
      .replace(/\bterminate\b/g, 'end')
  }
]

export const useStore = create<AppState>()(
  persist(
    (set, get) => ({
      // Initial state
      theme: 'midnight',
      language: 'en',
      apiKey: '',
      nvidiaApiKey: '',
      transcriptionApiKey: '',
      transcriptionBaseUrl: 'https://api.groq.com/openai/v1',
      transcriptionModel: 'whisper-large-v3',
      agentUrl: 'http://localhost:3030',
      defaultModel: 'anthropic/claude-opus-4.6',
      conversations: [],
      currentConversationId: null,
      isHydrated: false,

      showSettings: false,
      showAgent: false,
      showMagic: true,
      sidebarOpen: true,
      isStreaming: false,

      currentPersona: 'nexus',
      personas: defaultPersonas,

      transformModules: defaultTransformModules,

      dataCollectionEnabled: false,
      noLogMode: true,

      // Tier state
      accessInfo: null,

      // TUNING initial state
      tuningEnabled: false,
      tuningStrategy: 'adaptive' as TuningStrategy,
      tuningOverrides: {},
      tuningLastResult: null,

      // Feedback loop initial state
      learningState: createInitialLearningState(),

      // Memory system initial state
      memories: [],
      memoriesEnabled: true,

      // OBFUSCATION initial state
      obfuscationConfig: getDefaultObfuscationConfig(),

      // System prompt initial state
      customSystemPrompt: DEFAULT_NEXUS_PROMPT,
      useCustomSystemPrompt: true,

      // Skills initial state — all skills on by default
      skillsEnabled: true,
      skillConfig: Object.fromEntries(SKILLS.map((s) => [s.id, true])),

      // SYNTHESIS initial state
      synthesisEnabled: false,
      synthesisTier: 'fast' as const,
      synthesisPhase: 'idle' as const,
      synthesisModelsCollected: 0,
      synthesisModelsTotal: 0,
      synthesisOrchestratorModel: null,

      // Dynamic Upgrade initial state — universal feature layer
      dynamicUpgradeEnabled: true,
      dynamicMinDelta: 8,
      promptsTried: 0,

      // RACE initial state
      raceEnabled: false,
      raceTier: 'fast' as const,
      raceApiUrl: 'http://localhost:7860',
      raceApiKey: '',
      raceLiveContent: null,
      raceLiveModel: null,
      raceLiveScore: null,
      raceModelsResponded: 0,
      raceModelsTotal: 0,
      raceRacing: false,

      // Actions
      setTheme: (theme) => set({ theme }),
      setLanguage: (language) => set({ language }),
      setApiKey: (apiKey) => set({ apiKey }),
      setNvidiaApiKey: (nvidiaApiKey) => set({ nvidiaApiKey }),
      setTranscriptionApiKey: (transcriptionApiKey) => set({ transcriptionApiKey }),
      setTranscriptionBaseUrl: (transcriptionBaseUrl) => set({ transcriptionBaseUrl }),
      setTranscriptionModel: (transcriptionModel) => set({ transcriptionModel }),
      setAgentUrl: (agentUrl) => set({ agentUrl }),
      setDefaultModel: (defaultModel) => set((state) => ({
        defaultModel,
        // Apply the pick to the active conversation too, so switching models
        // in the selector takes effect immediately (not only for new chats).
        conversations: state.currentConversationId
          ? state.conversations.map((c) =>
              c.id === state.currentConversationId ? { ...c, model: defaultModel } : c,
            )
          : state.conversations,
      })),
      setShowSettings: (showSettings) => set({ showSettings }),
      setShowAgent: (showAgent) => set({ showAgent }),
      setShowMagic: (showMagic) => set({ showMagic }),
      setSidebarOpen: (sidebarOpen) => set({ sidebarOpen }),
      setIsStreaming: (isStreaming) => set({ isStreaming }),
      setCurrentPersona: (currentPersona) => set({ currentPersona }),
      setDataCollectionEnabled: (dataCollectionEnabled) => set({ dataCollectionEnabled }),
      setNoLogMode: (noLogMode) => set({ noLogMode }),
      setHydrated: () => set({ isHydrated: true }),

      // TUNING actions
      setTuningEnabled: (tuningEnabled) => set({ tuningEnabled }),
      setTuningStrategy: (tuningStrategy) => set({ tuningStrategy }),
      setTuningOverride: (param, value) => {
        const current = get().tuningOverrides
        if (value === null) {
          const { [param]: _, ...rest } = current
          set({ tuningOverrides: rest })
        } else {
          set({ tuningOverrides: { ...current, [param]: value } })
        }
      },
      clearTuningOverrides: () => set({ tuningOverrides: {} }),
      setTuningLastResult: (tuningLastResult) => set({ tuningLastResult }),

      // Feedback loop actions
      rateResponse: (conversationId, messageId, rating) => {
        const state = get()
        const conversation = state.conversations.find(c => c.id === conversationId)
        const message = conversation?.messages.find(m => m.id === messageId)

        if (!message || message.role !== 'assistant') return

        // Update the message with the rating
        set({
          conversations: state.conversations.map(c =>
            c.id === conversationId
              ? {
                ...c,
                messages: c.messages.map(m =>
                  m.id === messageId ? { ...m, learningRating: rating } : m
                )
              }
              : c
          )
        })

        // Only record feedback if we have TUNING params on the message
        if (message.tuningParams && message.tuningContext) {
          const heuristics = computeAdaptations(message.content)
          const record = {
            messageId,
            timestamp: Date.now(),
            contextType: message.tuningContext,
            model: message.model || 'unknown',
            persona: message.persona || 'base',
            params: message.tuningParams,
            rating,
            heuristics
          }

          const newLearningState = processLearning(state.learningState, record)
          set({ learningState: newLearningState })
        }
      },

      clearLearningHistory: () => {
        set({ learningState: createInitialLearningState() })
      },

      createConversation: () => {
        const id = uuidv4()
        const state = get()
        const newConversation: Conversation = {
          id,
          title: 'New Chat',
          messages: [],
          createdAt: Date.now(),
          updatedAt: Date.now(),
          persona: state.currentPersona,
          model: state.defaultModel
        }
        set({
          conversations: [newConversation, ...state.conversations],
          currentConversationId: id
        })
        return id
      },

      selectConversation: (id) => set({ currentConversationId: id }),

      deleteConversation: (id) => {
        const state = get()
        const newConversations = state.conversations.filter(c => c.id !== id)
        set({
          conversations: newConversations,
          currentConversationId: state.currentConversationId === id
            ? (newConversations[0]?.id || null)
            : state.currentConversationId
        })
      },

      addMessage: (conversationId, message) => {
        const state = get()
        const msgId = uuidv4()
        set({
          conversations: state.conversations.map(c =>
            c.id === conversationId
              ? {
                ...c,
                messages: [...c.messages, { ...message, id: msgId, timestamp: Date.now() }],
                updatedAt: Date.now(),
                title: c.messages.length === 0 && message.role === 'user'
                  ? message.content.slice(0, 50) + (message.content.length > 50 ? '...' : '')
                  : c.title
              }
              : c
          )
        })
        return msgId
      },

      updateMessageContent: (conversationId, messageId, content, extra) => {
        const state = get()
        set({
          conversations: state.conversations.map(c =>
            c.id === conversationId
              ? {
                ...c,
                messages: c.messages.map(m =>
                  m.id === messageId ? { ...m, content, ...extra } : m
                ),
                updatedAt: Date.now(),
              }
              : c
          )
        })
      },

      updateConversationTitle: (id, title) => {
        set({
          conversations: get().conversations.map(c =>
            c.id === id ? { ...c, title } : c
          )
        })
      },

      clearConversations: () => set({ conversations: [], currentConversationId: null }),

      toggleTransform: (id) => {
        set({
          transformModules: get().transformModules.map(m =>
            m.id === id ? { ...m, enabled: !m.enabled } : m
          )
        })
      },

      // Memory actions
      setMemoriesEnabled: (memoriesEnabled) => set({ memoriesEnabled }),

      addMemory: (memory) => {
        const now = Date.now()
        const newMemory: Memory = {
          ...memory,
          id: uuidv4(),
          createdAt: now,
          updatedAt: now
        }
        set({ memories: [...get().memories, newMemory] })
      },

      updateMemory: (id, updates) => {
        set({
          memories: get().memories.map(m =>
            m.id === id
              ? { ...m, ...updates, updatedAt: Date.now() }
              : m
          )
        })
      },

      deleteMemory: (id) => {
        set({ memories: get().memories.filter(m => m.id !== id) })
      },

      toggleMemory: (id) => {
        set({
          memories: get().memories.map(m =>
            m.id === id ? { ...m, active: !m.active, updatedAt: Date.now() } : m
          )
        })
      },

      clearMemories: () => set({ memories: [] }),

      // OBFUSCATION actions
      setObfuscationEnabled: (enabled) => {
        set({
          obfuscationConfig: { ...get().obfuscationConfig, enabled }
        })
      },
      setObfuscationMethod: (technique) => {
        set({
          obfuscationConfig: { ...get().obfuscationConfig, technique }
        })
      },
      setObfuscationIntensity: (intensity) => {
        set({
          obfuscationConfig: { ...get().obfuscationConfig, intensity }
        })
      },
      setObfuscationCustomTriggers: (customTriggers) => {
        set({
          obfuscationConfig: { ...get().obfuscationConfig, customTriggers }
        })
      },

      // System prompt actions
      setCustomSystemPrompt: (customSystemPrompt) => set({ customSystemPrompt }),
      setUseCustomSystemPrompt: (useCustomSystemPrompt) => set({ useCustomSystemPrompt }),
      resetSystemPromptToDefault: () => set({ customSystemPrompt: DEFAULT_NEXUS_PROMPT }),

      // Skills actions
      setSkillsEnabled: (skillsEnabled) => set({ skillsEnabled }),
      toggleSkill: (id) => set((state) => ({
        skillConfig: { ...state.skillConfig, [id]: state.skillConfig[id] === false },
      })),

      // Tier actions
      setAccessInfo: (accessInfo) => set({ accessInfo }),
      fetchAccessInfo: async () => {
        const state = get()
        const apiUrl = state.raceApiUrl
        const apiKey = state.raceApiKey
        if (!apiUrl || !apiKey) {
          set({ accessInfo: null })
          return
        }
        try {
          const res = await fetch(`${apiUrl}/v1/tier`, {
            headers: { 'Authorization': `Bearer ${apiKey}` },
          })
          if (res.ok) {
            const data = await res.json()
            set({
              accessInfo: {
                tier: data.tier,
                label: data.label,
                limits: data.limits,
                features: data.features,
              }
            })
          } else {
            set({ accessInfo: null })
          }
        } catch {
          set({ accessInfo: null })
        }
      },

      // SYNTHESIS actions
      setSynthesisEnabled: (synthesisEnabled) => set({ synthesisEnabled }),
      setSynthesisTier: (synthesisTier) => set({ synthesisTier }),
      setSynthesisPhase: (synthesisPhase) => set({ synthesisPhase }),
      setSynthesisProgress: (synthesisModelsCollected, synthesisModelsTotal) =>
        set({ synthesisModelsCollected, synthesisModelsTotal }),
      resetSynthesis: () => set({
        synthesisPhase: 'idle', synthesisModelsCollected: 0,
        synthesisModelsTotal: 0, synthesisOrchestratorModel: null,
      }),

      // Dynamic Upgrade actions
      setDynamicUpgradeEnabled: (dynamicUpgradeEnabled) => set({ dynamicUpgradeEnabled }),
      setDynamicMinDelta: (dynamicMinDelta) => set({ dynamicMinDelta: Math.max(1, Math.min(50, dynamicMinDelta)) }),
      incrementPromptsTried: () => set({ promptsTried: get().promptsTried + 1 }),

      // RACE actions
      setRaceEnabled: (raceEnabled) => set({ raceEnabled }),
      setRaceTier: (raceTier) => set({ raceTier }),
      setRaceApiUrl: (raceApiUrl) => set({ raceApiUrl }),
      setRaceApiKey: (raceApiKey) => set({ raceApiKey }),
      setRaceLive: (raceLiveContent, raceLiveModel, raceLiveScore) =>
        set({ raceLiveContent, raceLiveModel, raceLiveScore }),
      setRaceProgress: (raceModelsResponded, raceModelsTotal) =>
        set({ raceModelsResponded, raceModelsTotal }),
      setRaceRacing: (raceRacing) => set({ raceRacing }),
      resetRace: () => set({
        raceLiveContent: null, raceLiveModel: null, raceLiveScore: null,
        raceModelsResponded: 0, raceModelsTotal: 0, raceRacing: false,
      }),

      // Restore from a full backup export — only sets keys that exist in the import
      restoreBackup: (data) => set((state) => {
        const next: Record<string, unknown> = {}
        // transformModules excluded: transformer functions can't be serialized/deserialized
        const allowed = [
          'conversations', 'currentConversationId', 'theme', 'defaultModel',
          'currentPersona', 'apiKey', 'nvidiaApiKey',
          'transcriptionApiKey', 'transcriptionBaseUrl', 'transcriptionModel',
          'agentUrl',
          'tuningEnabled', 'tuningStrategy',
          'tuningOverrides', 'learningState', 'obfuscationConfig',
          'memories', 'memoriesEnabled', 'customSystemPrompt', 'useCustomSystemPrompt',
          'skillsEnabled', 'skillConfig',
          'synthesisEnabled', 'synthesisTier', 'dynamicUpgradeEnabled', 'dynamicMinDelta',
          'raceEnabled', 'raceTier', 'raceApiUrl', 'raceApiKey',
          'dataCollectionEnabled', 'noLogMode', 'showMagic', 'promptsTried',
        ]
        for (const key of allowed) {
          if (key in data && data[key] !== undefined) {
            next[key] = data[key]
          }
        }
        return next as Partial<typeof state>
      }),
    }),
    {
      name: 'nexus-storage',
      storage: createJSONStorage(() => localStorage),
      partialize: (state) => ({
        theme: state.theme,
        language: state.language,
        showMagic: state.showMagic,
        apiKey: state.apiKey,
        nvidiaApiKey: state.nvidiaApiKey,
        transcriptionApiKey: state.transcriptionApiKey,
        transcriptionBaseUrl: state.transcriptionBaseUrl,
        transcriptionModel: state.transcriptionModel,
        agentUrl: state.agentUrl,
        defaultModel: state.defaultModel,
        conversations: state.conversations,
        currentConversationId: state.currentConversationId,
        currentPersona: state.currentPersona,
        transformModules: state.transformModules,
        dataCollectionEnabled: state.dataCollectionEnabled,
        noLogMode: state.noLogMode,
        tuningEnabled: state.tuningEnabled,
        tuningStrategy: state.tuningStrategy,
        tuningOverrides: state.tuningOverrides,
        learningState: state.learningState,
        // Memory system persistence
        memories: state.memories,
        memoriesEnabled: state.memoriesEnabled,
        // OBFUSCATION persistence
        obfuscationConfig: state.obfuscationConfig,
        // System prompt persistence
        customSystemPrompt: state.customSystemPrompt,
        useCustomSystemPrompt: state.useCustomSystemPrompt,
        // Skills persistence
        skillsEnabled: state.skillsEnabled,
        skillConfig: state.skillConfig,
        // SYNTHESIS persistence
        synthesisEnabled: state.synthesisEnabled,
        synthesisTier: state.synthesisTier,
        // Dynamic Upgrade persistence
        dynamicUpgradeEnabled: state.dynamicUpgradeEnabled,
        dynamicMinDelta: state.dynamicMinDelta,
        promptsTried: state.promptsTried,
        // RACE persistence
        raceEnabled: state.raceEnabled,
        raceTier: state.raceTier,
        raceApiUrl: state.raceApiUrl,
        raceApiKey: state.raceApiKey,
      }),
      onRehydrateStorage: () => (state) => {
        if (state) {
          state.setHydrated()
        }
      }
    }
  )
)

/**
 * Reactive selector for the active conversation.
 *
 * Replaces a former `currentConversation` getter on the store object — zustand
 * flattens state with `Object.assign` on every `set`, which strips getters and
 * froze the value at `null`. Deriving it through a selector here recomputes on
 * every relevant state change and always stays correct.
 */
export const useCurrentConversation = (): Conversation | null =>
  useStore((s) => s.conversations.find((c) => c.id === s.currentConversationId) || null)

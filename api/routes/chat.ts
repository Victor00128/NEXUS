/**
 * Chat Completions API Route (Single-Model Pipeline)
 *
 * POST /v1/chat/completions
 *
 * OpenAI-compatible endpoint. Drop-in replacement for the OpenAI SDK:
 *   openai.OpenAI(base_url="https://your-api.com/v1", api_key="sk-...")
 *
 * Accepts standard OpenAI format and returns standard format.
 * nexus pipeline (nexus, tuning, obfuscation, STM) runs transparently
 * behind the standard interface. Pipeline metadata is in `x_NEXUS`.
 *
 * Supports stream: true (SSE, OpenAI chunk format).
 *
 * For multi-model racing, use POST /v1/RACE/completions instead.
 */

import { Router } from 'express'
import { v4 as uuidv4 } from 'uuid'
import { computeTuningParams, type TuningStrategy } from '../../src/lib/tuning'
import { encodeObfuscation, type ObfuscationConfig } from '../../src/lib/obfuscation'
import { allModules, applySTMs, type TransformModule } from '../../src/stm/transforms'
import { sendMessage } from '../../src/lib/openrouter'
import { getSharedProfiles } from './tuning'
import {
  NEXUS_SYSTEM_PROMPT,
  DEPTH_DIRECTIVE,
  applyNexusBoost,
  getModelsForTier,
  raceModels,
  scoreResponse,
  type SpeedTier,
  type ModelResult,
} from '../lib/racing'
import {
  collectAllResponses,
  synthesize,
  ORCHESTRATOR_MODELS,
  type OrchestratorModel,
  type SynthesisResponse,
} from '../lib/synthesis'
import { addEntry } from '../lib/dataset'
import { recordEvent, categorizeError } from '../lib/metadata'

export const chatRoutes = Router()

// -- Shared helpers ----------------------------------------------------

function estimateTokens(text: string): number {
  // Rough estimate: ~4 chars per token for English
  return Math.ceil(text.length / 4)
}

/**
 * Build the nexus pipeline: resolve params, system prompt, obfuscation, etc.
 * Returns everything needed to send to the LLM and build the response.
 */
function runPipeline(opts: {
  messages: Array<{ role: string; content: string }>
  model: string
  nexus: boolean
  custom_system_prompt?: string
  tuning: boolean
  strategy: string
  obfuscation: boolean
  obfuscation_technique: string
  obfuscation_intensity: string
  stmModules: string[]
  temperature?: number
  top_p?: number
  top_k?: number
  frequency_penalty?: number
  presence_penalty?: number
  repetition_penalty?: number
}) {
  const {
    messages, nexus, custom_system_prompt,
    tuning, strategy, obfuscation,
    obfuscation_technique, obfuscation_intensity, stmModules,
    temperature, top_p, top_k,
    frequency_penalty, presence_penalty, repetition_penalty,
  } = opts

  // Normalize messages
  const normalizedMessages = messages.map((m: any) => ({
    role: m.role as 'system' | 'user' | 'assistant',
    content: String(m.content || ''),
  }))

  // Build system prompt
  const systemPrompt = nexus
    ? (custom_system_prompt || NEXUS_SYSTEM_PROMPT) + DEPTH_DIRECTIVE
    : custom_system_prompt || ''

  const allMessages = [
    ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
    ...normalizedMessages.filter(m => m.role !== 'system'),
  ]

  // tuning
  const lastUserMsg = [...normalizedMessages].reverse().find(m => m.role === 'user')
  const userContent = lastUserMsg?.content || ''
  const conversationHistory = normalizedMessages
    .filter(m => m.role !== 'system')
    .map(m => ({ role: m.role, content: m.content }))

  let tuningResult: any = null
  let finalParams: Record<string, number | undefined> = {
    temperature: temperature ?? 0.7,
    top_p, top_k, frequency_penalty, presence_penalty, repetition_penalty,
  }

  if (tuning && temperature === undefined) {
    tuningResult = computeTuningParams({
      strategy: strategy as TuningStrategy,
      message: userContent,
      conversationHistory,
      overrides: {
        ...(top_p !== undefined && { top_p }),
        ...(top_k !== undefined && { top_k }),
        ...(frequency_penalty !== undefined && { frequency_penalty }),
        ...(presence_penalty !== undefined && { presence_penalty }),
        ...(repetition_penalty !== undefined && { repetition_penalty }),
      },
      adaptedProfiles: getSharedProfiles(),
    })
    finalParams = {
      temperature: tuningResult.params.temperature,
      top_p: tuningResult.params.top_p,
      top_k: tuningResult.params.top_k,
      frequency_penalty: tuningResult.params.frequency_penalty,
      presence_penalty: tuningResult.params.presence_penalty,
      repetition_penalty: tuningResult.params.repetition_penalty,
    }
  }

  if (nexus) {
    finalParams = applyNexusBoost(finalParams)
  }

  // obfuscation
  let obfuscationResult: any = null
  let processedMessages = allMessages

  if (obfuscation) {
    const ptConfig: ObfuscationConfig = {
      enabled: true,
      technique: obfuscation_technique as any,
      intensity: obfuscation_intensity as any,
      customTriggers: [],
    }

    processedMessages = allMessages.map(m => {
      if (m.role === 'user') {
        const result = encodeObfuscation(m.content, ptConfig)
        if (!obfuscationResult && result.triggersFound.length > 0) {
          obfuscationResult = {
            triggers_found: result.triggersFound,
            technique_used: result.techniqueUsed,
            transformations_count: result.transformations.length,
          }
        }
        return { ...m, content: result.transformedText }
      }
      return m
    })
  }

  return {
    processedMessages,
    normalizedMessages,
    finalParams,
    tuningResult,
    obfuscationResult,
    stmModules,
    userContent,
    strategy,
    nexus,
  }
}

function applySTMPost(response: string, stmModules: string[]) {
  if (!stmModules || !Array.isArray(stmModules) || stmModules.length === 0) {
    return { finalResponse: response, stmResult: null }
  }
  const enabledModules: TransformModule[] = allModules.map(m => ({
    ...m,
    enabled: stmModules.includes(m.id),
  }))
  const finalResponse = applySTMs(response, enabledModules)
  return {
    finalResponse,
    stmResult: {
      modules_applied: stmModules,
      original_length: response.length,
      transformed_length: finalResponse.length,
    },
  }
}

// -- POST /v1/chat/completions -----------------------------------------

chatRoutes.post('/completions', async (req, res) => {
  const startTime = Date.now()
  const completionId = `chatcmpl-${uuidv4().replace(/-/g, '').slice(0, 24)}`

  try {
    const {
      messages,
      model = 'nousresearch/hermes-4-70b',
      openrouter_api_key: caller_key,
      stream = false,
      max_tokens = 4096,
      // nexus pipeline options (optional � transparent to OpenAI SDK users)
      nexus = true,
      custom_system_prompt,
      tuning = true,
      strategy = 'adaptive',
      obfuscation = true,
      obfuscation_technique = 'leetspeak',
      obfuscation_intensity = 'medium',
      stmModules = ['hedge_reducer', 'direct_mode'],
      // Direct param overrides
      temperature,
      top_p,
      top_k,
      frequency_penalty,
      presence_penalty,
      repetition_penalty,
      // Dataset opt-in
      contribute_to_data = false,
    } = req.body

    // Validate
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({
        error: {
          message: 'messages (array) is required and must not be empty',
          type: 'invalid_request_error',
          code: 'invalid_messages',
        }
      })
      return
    }

    if (messages.length > 100) {
      res.status(400).json({
        error: {
          message: 'Too many messages (max 100)',
          type: 'invalid_request_error',
          code: 'too_many_messages',
        }
      })
      return
    }

    // Resolve OpenRouter key
    const openrouter_api_key = caller_key || process.env.OPENROUTER_API_KEY || ''
    if (!openrouter_api_key) {
      res.status(400).json({
        error: {
          message: 'No OpenRouter API key available. Either pass openrouter_api_key in the request body, or set OPENROUTER_API_KEY on the server.',
          type: 'invalid_request_error',
          code: 'missing_api_key',
        }
      })
      return
    }

    // -- RACE virtual model routing -----------------------------
    // model="RACE/fast" | "RACE/standard" | "RACE/smart" | "RACE/power" | "RACE/ultra"
    // ? runs multi-model race, returns winner in OpenAI format
    const raceMatch = model.match(/^RACE\/(fast|standard|smart|power|ultra)$/)
    if (raceMatch) {
      const raceTier = raceMatch[1] as SpeedTier

      // Check tier-based access
      const accessConfig = req.accessConfig
      if (accessConfig && !accessConfig.raceTiers.includes(raceTier)) {
        const currentTier = req.tier || 'free'
        res.status(403).json({
          error: {
            message: `The "${raceTier}" RACE tier requires a higher plan. Your "${currentTier}" plan allows: ${accessConfig.raceTiers.join(', ')}.`,
            type: 'insufficient_tier',
            code: 'upgrade_required',
          },
        })
        return
      }

      // Run pipeline for RACE
      const pipeline = runPipeline({
        messages, model, nexus, custom_system_prompt,
        tuning, strategy, obfuscation,
        obfuscation_technique, obfuscation_intensity, stmModules,
        temperature, top_p, top_k,
        frequency_penalty, presence_penalty, repetition_penalty,
      })

      const raceModelsArray = getModelsForTier(raceTier)

      // Cap by tier if applicable
      const maxModels = accessConfig?.maxRaceModels ?? raceModelsArray.length
      const models = raceModelsArray.slice(0, maxModels)

      const raceParams = {
        temperature: pipeline.finalParams.temperature ?? 0.7,
        max_tokens,
        top_p: pipeline.finalParams.top_p,
        top_k: pipeline.finalParams.top_k,
        frequency_penalty: pipeline.finalParams.frequency_penalty,
        presence_penalty: pipeline.finalParams.presence_penalty,
        repetition_penalty: pipeline.finalParams.repetition_penalty,
      }

      const results = await raceModels(
        models,
        pipeline.processedMessages,
        openrouter_api_key,
        raceParams,
        { minResults: Math.min(5, models.length), gracePeriod: 5000, hardTimeout: 45000 },
      )

      const scoredResults: ModelResult[] = results.map(r => ({
        ...r,
        score: r.success ? scoreResponse(r.content, pipeline.userContent) : 0,
      }))
      scoredResults.sort((a, b) => b.score - a.score)

      const winner = scoredResults.find(r => r.success)
      if (!winner || !winner.content) {
        res.status(502).json({
          error: {
            message: 'All models failed in RACE race',
            type: 'upstream_error',
            code: 'race_failed',
          },
        })
        return
      }

      // STM
      const { finalResponse, stmResult } = applySTMPost(winner.content, stmModules)
      const totalDuration = Date.now() - startTime
      const successCount = scoredResults.filter(r => r.success).length

      // Dataset
      let datasetId: string | null = null
      if (contribute_to_data) {
        datasetId = addEntry({
          endpoint: '/v1/chat/completions',
          model: winner.model, mode: 'race',
          messages: pipeline.normalizedMessages.filter(m => m.role !== 'system'),
          response: finalResponse,
          tuning: pipeline.tuningResult ? { strategy, detected_context: pipeline.tuningResult.detectedContext, confidence: pipeline.tuningResult.confidence, params: pipeline.tuningResult.params, reasoning: pipeline.tuningResult.reasoning } : undefined,
          obfuscation: pipeline.obfuscationResult || undefined,
          stm: stmResult ? { modules_applied: stmResult.modules_applied } : undefined,
          race: { tier: raceTier, models_queried: models, winner_model: winner.model, all_scores: scoredResults.map(r => ({ model: r.model, score: r.score, duration_ms: r.duration_ms, success: r.success })), total_duration_ms: totalDuration },
        })
      }

      // Metadata
      recordEvent({
        endpoint: '/v1/chat/completions',
        mode: 'race',
        tier: raceTier,
        stream: false,
        pipeline: {
          nexus: pipeline.nexus,
          tuning: !!pipeline.tuningResult,
          obfuscation: !!pipeline.obfuscationResult,
          stmModules: stmModules || [],
          strategy: pipeline.strategy,
        },
        tuning: pipeline.tuningResult
          ? { detected_context: pipeline.tuningResult.detectedContext, confidence: pipeline.tuningResult.confidence }
          : undefined,
        models_queried: models.length,
        models_succeeded: successCount,
        model_results: scoredResults.map(r => ({
          model: r.model, score: r.score, duration_ms: r.duration_ms,
          success: r.success, content_length: r.content?.length || 0,
          error_type: categorizeError(r.error),
        })),
        winner: { model: winner.model, score: winner.score, duration_ms: winner.duration_ms, content_length: finalResponse.length },
        total_duration_ms: totalDuration,
        response_length: finalResponse.length,
      })

      // Token estimates
      const promptText = pipeline.processedMessages.map(m => m.content).join(' ')
      const promptTokens = estimateTokens(promptText)
      const completionTokens = estimateTokens(finalResponse)

      // OpenAI-compatible response with race metadata
      res.json({
        id: completionId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: winner.model,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: finalResponse },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
        x_NEXUS: {
          mode: 'race',
          winner: { model: winner.model, score: winner.score, duration_ms: winner.duration_ms },
          race: {
            tier: raceTier,
            models_queried: models.length,
            models_succeeded: successCount,
            total_duration_ms: totalDuration,
            rankings: scoredResults.filter(r => r.success).slice(0, 5).map(r => ({
              model: r.model, score: r.score, duration_ms: r.duration_ms,
            })),
          },
          params_used: pipeline.finalParams,
          pipeline: {
            nexus: pipeline.nexus,
            tuning: pipeline.tuningResult
              ? { detected_context: pipeline.tuningResult.detectedContext, confidence: pipeline.tuningResult.confidence, strategy: pipeline.strategy }
              : null,
            obfuscation: pipeline.obfuscationResult,
            stm: stmResult,
          },
          dataset: contribute_to_data ? { contributed: true, entry_id: datasetId } : { contributed: false },
        },
      })
      return
    }

    // -- SYNTHESIS virtual model routing -----------------------------
    // model="SYNTHESIS/fast" | "SYNTHESIS/standard" | "SYNTHESIS/smart" | "SYNTHESIS/power" | "SYNTHESIS/ultra"
    // ? collects ALL model responses, orchestrator synthesizes ground truth
    const synthesisMatch = model.match(/^SYNTHESIS\/(fast|standard|smart|power|ultra)$/)
    if (synthesisMatch) {
      const raceTier = synthesisMatch[1] as SpeedTier

      // Tier access check
      const accessConfig = req.accessConfig
      if (accessConfig && !accessConfig.raceTiers.includes(raceTier)) {
        const currentTier = req.tier || 'free'
        res.status(403).json({
          error: {
            message: `The "${raceTier}" SYNTHESIS tier requires a higher plan. Your "${currentTier}" plan allows: ${accessConfig.raceTiers.join(', ')}.`,
            type: 'insufficient_tier',
            code: 'upgrade_required',
          },
        })
        return
      }

      const pipeline = runPipeline({
        messages, model, nexus, custom_system_prompt,
        tuning, strategy, obfuscation,
        obfuscation_technique, obfuscation_intensity, stmModules,
        temperature, top_p, top_k,
        frequency_penalty, presence_penalty, repetition_penalty,
      })

      const raceModelsArray = getModelsForTier(raceTier)
      const maxModels = accessConfig?.maxRaceModels ?? raceModelsArray.length
      const models = raceModelsArray.slice(0, maxModels)

      const queryParams = {
        temperature: pipeline.finalParams.temperature ?? 0.7,
        max_tokens,
        top_p: pipeline.finalParams.top_p,
        top_k: pipeline.finalParams.top_k,
        frequency_penalty: pipeline.finalParams.frequency_penalty,
        presence_penalty: pipeline.finalParams.presence_penalty,
        repetition_penalty: pipeline.finalParams.repetition_penalty,
      }

      // Phase 1: Collect all responses
      const results = await collectAllResponses(
        models,
        pipeline.processedMessages,
        openrouter_api_key,
        queryParams,
        { minResponses: Math.min(3, models.length), hardTimeout: 60000 },
      )

      const scoredResponses: SynthesisResponse[] = results.map(r => ({
        model: r.model,
        content: r.content,
        score: r.success ? scoreResponse(r.content, pipeline.userContent) : 0,
        duration_ms: r.duration_ms,
        success: r.success,
        error: r.error,
      }))
      scoredResponses.sort((a, b) => b.score - a.score)

      const totalSucceeded = scoredResponses.filter(r => r.success).length
      if (totalSucceeded === 0) {
        res.status(502).json({
          error: { message: 'All models failed in SYNTHESIS collection', type: 'upstream_error', code: 'collection_failed' },
        })
        return
      }

      // Phase 2: Orchestrator synthesis
      const orchestratorModel: OrchestratorModel = ORCHESTRATOR_MODELS[0]
      let synthesisResult: { synthesis: string; duration_ms: number; model: string }
      try {
        synthesisResult = await synthesize(
          pipeline.userContent,
          scoredResponses,
          openrouter_api_key,
          orchestratorModel,
          max_tokens,
        )
      } catch (err: any) {
        res.status(502).json({
          error: { message: `Orchestrator failed: ${err.message}`, type: 'upstream_error', code: 'orchestrator_failed' },
        })
        return
      }

      // STM on synthesis
      const { finalResponse, stmResult } = applySTMPost(synthesisResult.synthesis, stmModules)
      const totalDuration = Date.now() - startTime
      const collectionDuration = totalDuration - synthesisResult.duration_ms

      // Dataset
      let datasetId: string | null = null
      if (contribute_to_data) {
        datasetId = addEntry({
          endpoint: '/v1/chat/completions',
          model: orchestratorModel, mode: 'synthesis',
          messages: pipeline.normalizedMessages.filter(m => m.role !== 'system'),
          response: finalResponse,
          tuning: pipeline.tuningResult ? { strategy, detected_context: pipeline.tuningResult.detectedContext, confidence: pipeline.tuningResult.confidence, params: pipeline.tuningResult.params, reasoning: pipeline.tuningResult.reasoning } : undefined,
          obfuscation: pipeline.obfuscationResult || undefined,
          stm: stmResult ? { modules_applied: stmResult.modules_applied } : undefined,
          race: { tier: raceTier, models_queried: models, winner_model: orchestratorModel, all_scores: scoredResponses.map(r => ({ model: r.model, score: r.score, duration_ms: r.duration_ms, success: r.success })), total_duration_ms: totalDuration },
        })
      }

      // Metadata
      recordEvent({
        endpoint: '/v1/chat/completions',
        mode: 'synthesis',
        tier: raceTier,
        stream: false,
        pipeline: {
          nexus: pipeline.nexus,
          tuning: !!pipeline.tuningResult,
          obfuscation: !!pipeline.obfuscationResult,
          stmModules: stmModules || [],
          strategy: pipeline.strategy,
        },
        models_queried: models.length,
        models_succeeded: totalSucceeded,
        model_results: scoredResponses.map(r => ({
          model: r.model, score: r.score, duration_ms: r.duration_ms,
          success: r.success, content_length: r.content?.length || 0,
          error_type: categorizeError(r.error),
        })),
        winner: { model: orchestratorModel, score: 0, duration_ms: synthesisResult.duration_ms, content_length: finalResponse.length },
        total_duration_ms: totalDuration,
        response_length: finalResponse.length,
      })

      // Token estimates
      const promptText = pipeline.processedMessages.map(m => m.content).join(' ')
      const promptTokens = estimateTokens(promptText)
      const completionTokens = estimateTokens(finalResponse)

      // OpenAI-compatible response with SYNTHESIS metadata
      res.json({
        id: completionId,
        object: 'chat.completion',
        created: Math.floor(Date.now() / 1000),
        model: `SYNTHESIS/${raceTier}`,
        choices: [{
          index: 0,
          message: { role: 'assistant', content: finalResponse },
          finish_reason: 'stop',
        }],
        usage: {
          prompt_tokens: promptTokens,
          completion_tokens: completionTokens,
          total_tokens: promptTokens + completionTokens,
        },
        x_NEXUS: {
          mode: 'synthesis',
          orchestrator: {
            model: synthesisResult.model,
            duration_ms: synthesisResult.duration_ms,
          },
          collection: {
            tier: raceTier,
            models_queried: models.length,
            models_succeeded: totalSucceeded,
            collection_duration_ms: collectionDuration,
            total_duration_ms: totalDuration,
            top_responses: scoredResponses.filter(r => r.success).slice(0, 5).map(r => ({
              model: r.model, score: r.score, duration_ms: r.duration_ms,
            })),
          },
          params_used: pipeline.finalParams,
          pipeline: {
            nexus: pipeline.nexus,
            tuning: pipeline.tuningResult
              ? { detected_context: pipeline.tuningResult.detectedContext, confidence: pipeline.tuningResult.confidence, strategy: pipeline.strategy }
              : null,
            obfuscation: pipeline.obfuscationResult,
            stm: stmResult,
          },
          dataset: contribute_to_data ? { contributed: true, entry_id: datasetId } : { contributed: false },
        },
      })
      return
    }

    // -- Single-model path ---------------------------------------------
    // Run the nexus pipeline
    const pipeline = runPipeline({
      messages, model, nexus, custom_system_prompt,
      tuning, strategy, obfuscation,
      obfuscation_technique, obfuscation_intensity, stmModules,
      temperature, top_p, top_k,
      frequency_penalty, presence_penalty, repetition_penalty,
    })

    // -- Streaming mode ------------------------------------------------
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no')
      res.flushHeaders()

      const created = Math.floor(Date.now() / 1000)
      let fullContent = ''

      try {
        // Request streaming from OpenRouter
        const streamBody: Record<string, unknown> = {
          model,
          messages: pipeline.processedMessages,
          temperature: pipeline.finalParams.temperature,
          max_tokens,
          stream: true,
        }
        if (pipeline.finalParams.top_p !== undefined) streamBody.top_p = pipeline.finalParams.top_p
        if (pipeline.finalParams.top_k !== undefined) streamBody.top_k = pipeline.finalParams.top_k
        if (pipeline.finalParams.frequency_penalty !== undefined) streamBody.frequency_penalty = pipeline.finalParams.frequency_penalty
        if (pipeline.finalParams.presence_penalty !== undefined) streamBody.presence_penalty = pipeline.finalParams.presence_penalty
        if (pipeline.finalParams.repetition_penalty !== undefined) streamBody.repetition_penalty = pipeline.finalParams.repetition_penalty

        const upstreamRes = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${openrouter_api_key}`,
            'Content-Type': 'application/json',
            'HTTP-Referer': 'https://nexus.ai',
            'X-Title': 'nexus.AI',
          },
          body: JSON.stringify(streamBody),
        })

        if (!upstreamRes.ok) {
          const errData = await upstreamRes.json().catch(() => ({}))
          const errMsg = (errData as any).error?.message || `Upstream error: ${upstreamRes.status}`
          const chunk = {
            id: completionId,
            object: 'chat.completion.chunk',
            created,
            model,
            choices: [{
              index: 0,
              delta: {},
              finish_reason: 'error',
            }],
            x_NEXUS: { error: errMsg },
          }
          res.write(`data: ${JSON.stringify(chunk)}\n\n`)
          res.write('data: [DONE]\n\n')
          res.end()
          return
        }

        const reader = upstreamRes.body?.getReader()
        if (!reader) {
          res.write('data: [DONE]\n\n')
          res.end()
          return
        }

        const decoder = new TextDecoder()
        let buffer = ''

        while (true) {
          const { done, value } = await reader.read()
          if (done) {
            // Process any trailing data left in the buffer after stream ends
            if (buffer.trim()) {
              const trailing = buffer.trim()
              if (trailing.startsWith('data: ') && trailing !== 'data: [DONE]') {
                try {
                  const json = JSON.parse(trailing.slice(6))
                  const content = json.choices?.[0]?.delta?.content
                  if (content) {
                    fullContent += content
                    const chunk = {
                      id: completionId,
                      object: 'chat.completion.chunk',
                      created,
                      model,
                      choices: [{ index: 0, delta: { content }, finish_reason: null }],
                    }
                    res.write(`data: ${JSON.stringify(chunk)}\n\n`)
                  }
                } catch {}
              }
            }
            break
          }

          buffer += decoder.decode(value, { stream: true })
          const lines = buffer.split('\n')
          buffer = lines.pop() || ''

          for (const line of lines) {
            const trimmed = line.trim()
            if (!trimmed || trimmed === 'data: [DONE]') {
              if (trimmed === 'data: [DONE]') {
                // Apply STM to full content before sending final chunk
                const { finalResponse } = applySTMPost(fullContent, stmModules)
                // If STM changed the content, send a correction chunk
                if (finalResponse !== fullContent) {
                  const correctionChunk = {
                    id: completionId,
                    object: 'chat.completion.chunk',
                    created,
                    model,
                    choices: [{
                      index: 0,
                      delta: {},
                      finish_reason: 'stop',
                    }],
                    x_NEXUS: {
                      stm_applied: true,
                      final_content: finalResponse,
                    },
                  }
                  res.write(`data: ${JSON.stringify(correctionChunk)}\n\n`)
                } else {
                  // Send standard stop chunk
                  const stopChunk = {
                    id: completionId,
                    object: 'chat.completion.chunk',
                    created,
                    model,
                    choices: [{
                      index: 0,
                      delta: {},
                      finish_reason: 'stop',
                    }],
                  }
                  res.write(`data: ${JSON.stringify(stopChunk)}\n\n`)
                }
                res.write('data: [DONE]\n\n')
              }
              continue
            }
            if (!trimmed.startsWith('data: ')) continue

            try {
              const json = JSON.parse(trimmed.slice(6))
              const content = json.choices?.[0]?.delta?.content
              if (content) {
                fullContent += content
                // Re-emit in our standard format with our ID
                const chunk = {
                  id: completionId,
                  object: 'chat.completion.chunk',
                  created,
                  model,
                  choices: [{
                    index: 0,
                    delta: { content },
                    finish_reason: null,
                  }],
                }
                res.write(`data: ${JSON.stringify(chunk)}\n\n`)
              }
            } catch {
              // Skip invalid JSON
            }
          }
        }

        reader.releaseLock()

        // Record metadata for streaming request
        recordEvent({
          endpoint: '/v1/chat/completions',
          mode: 'standard',
          stream: true,
          pipeline: {
            nexus: pipeline.nexus,
            tuning: !!pipeline.tuningResult,
            obfuscation: !!pipeline.obfuscationResult,
            stmModules: stmModules || [],
            strategy: pipeline.strategy,
          },
          tuning: pipeline.tuningResult
            ? { detected_context: pipeline.tuningResult.detectedContext, confidence: pipeline.tuningResult.confidence }
            : undefined,
          model,
          model_results: [{
            model, score: 0, duration_ms: Date.now() - startTime,
            success: true, content_length: fullContent.length,
          }],
          winner: { model, score: 0, duration_ms: Date.now() - startTime, content_length: fullContent.length },
          total_duration_ms: Date.now() - startTime,
          response_length: fullContent.length,
        })

        // Don't end the response here � it was already ended when we wrote [DONE]
        if (!res.writableEnded) res.end()
      } catch (err) {
        if (!res.writableEnded) {
          res.write('data: [DONE]\n\n')
          res.end()
        }
      }
      return
    }

    // -- Non-streaming mode --------------------------------------------
    const response = await sendMessage({
      messages: pipeline.processedMessages,
      model,
      apiKey: openrouter_api_key,
      temperature: pipeline.finalParams.temperature,
      maxTokens: max_tokens,
      top_p: pipeline.finalParams.top_p,
      top_k: pipeline.finalParams.top_k,
      frequency_penalty: pipeline.finalParams.frequency_penalty,
      presence_penalty: pipeline.finalParams.presence_penalty,
      repetition_penalty: pipeline.finalParams.repetition_penalty,
    })

    // STM transforms
    const { finalResponse, stmResult } = applySTMPost(response, stmModules)

    // Dataset collection (opt-in)
    let datasetId: string | null = null
    if (contribute_to_data) {
      datasetId = addEntry({
        endpoint: '/v1/chat/completions',
        model,
        mode: 'standard',
        messages: pipeline.normalizedMessages.filter(m => m.role !== 'system'),
        response: finalResponse,
        tuning: pipeline.tuningResult
          ? {
              strategy,
              detected_context: pipeline.tuningResult.detectedContext,
              confidence: pipeline.tuningResult.confidence,
              params: pipeline.tuningResult.params,
              reasoning: pipeline.tuningResult.reasoning,
            }
          : undefined,
        obfuscation: pipeline.obfuscationResult || undefined,
        stm: stmResult ? { modules_applied: stmResult.modules_applied } : undefined,
      })
    }

    // ZDR Metadata
    recordEvent({
      endpoint: '/v1/chat/completions',
      mode: 'standard',
      stream: false,
      pipeline: {
        nexus: pipeline.nexus,
        tuning: !!pipeline.tuningResult,
        obfuscation: !!pipeline.obfuscationResult,
        stmModules: stmModules || [],
        strategy: pipeline.strategy,
      },
      tuning: pipeline.tuningResult
        ? { detected_context: pipeline.tuningResult.detectedContext, confidence: pipeline.tuningResult.confidence }
        : undefined,
      model,
      model_results: [{
        model, score: 0, duration_ms: Date.now() - startTime,
        success: true, content_length: finalResponse.length,
      }],
      winner: { model, score: 0, duration_ms: Date.now() - startTime, content_length: finalResponse.length },
      total_duration_ms: Date.now() - startTime,
      response_length: finalResponse.length,
    })

    // Estimate tokens
    const promptText = pipeline.processedMessages.map(m => m.content).join(' ')
    const promptTokens = estimateTokens(promptText)
    const completionTokens = estimateTokens(finalResponse)

    // -- OpenAI-compatible response ------------------------------------
    res.json({
      id: completionId,
      object: 'chat.completion',
      created: Math.floor(Date.now() / 1000),
      model,
      choices: [
        {
          index: 0,
          message: {
            role: 'assistant',
            content: finalResponse,
          },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: promptTokens,
        completion_tokens: completionTokens,
        total_tokens: promptTokens + completionTokens,
      },
      // nexus pipeline metadata (ignored by OpenAI SDKs, useful for power users)
      x_NEXUS: {
        params_used: pipeline.finalParams,
        pipeline: {
          nexus: pipeline.nexus,
          tuning: pipeline.tuningResult
            ? {
                detected_context: pipeline.tuningResult.detectedContext,
                confidence: pipeline.tuningResult.confidence,
                reasoning: pipeline.tuningResult.reasoning,
                strategy: pipeline.strategy,
              }
            : null,
          obfuscation: pipeline.obfuscationResult,
          stm: stmResult,
        },
        dataset: contribute_to_data
          ? { contributed: true, entry_id: datasetId }
          : { contributed: false },
      },
    })
  } catch (err: any) {
    console.error('[chat]', err)
    const status = err.message?.includes('API error') ? 502 : 500
    res.status(status).json({
      error: {
        message: status === 502 ? 'Upstream API error' : 'Internal server error',
        type: status === 502 ? 'upstream_error' : 'server_error',
        code: null,
      },
    })
  }
})

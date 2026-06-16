/**
 * SYNTHESIS API Route � The Hive Mind Endpoint
 *
 * POST /v1/synthesis/completions
 *
 * Queries N models in parallel, collects ALL responses, then feeds them to a
 * strong orchestrator model that synthesizes ground truth from collective intelligence.
 *
 * Unlike RACE (pick-the-winner), SYNTHESIS blends insights from every model
 * into a single response that's more grounded than any individual output.
 *
 * Pipeline:
 * 1. nexus prompt + Depth Directive injected (pipeline runs like RACE)
 * 2. All models queried in parallel � wait for ALL (not early-exit)
 * 3. Responses scored on substance/directness/completeness
 * 4. All responses + user query fed to orchestrator model
 * 5. Orchestrator synthesizes definitive ground-truth response
 * 6. STM modules applied to synthesis
 * 7. Full provenance metadata returned
 *
 * STREAMING MODE (stream=true, default):
 * - Phase 1: SSE events as each model responds (synthesis:model)
 * - Phase 2: Orchestrator synthesis streamed live (SYNTHESIS:synthesis:delta)
 * - Phase 3: Final metadata (synthesis:complete)
 */

import { Router } from 'express'
import { computeTuningParams, type TuningStrategy, type TuningResult } from '../../src/lib/tuning'
import { encodeObfuscation, type ObfuscationConfig } from '../../src/lib/obfuscation'
import { allModules, applySTMs, type TransformModule } from '../../src/stm/transforms'
import { getSharedProfiles } from './tuning'
import {
  NEXUS_SYSTEM_PROMPT,
  DEPTH_DIRECTIVE,
  getModelsForTier,
  scoreResponse,
  applyNexusBoost,
  queryModel,
  type SpeedTier,
  type ModelResult,
} from '../lib/racing'
import {
  collectAllResponses,
  synthesize,
  ORCHESTRATOR_MODELS,
  SYNTHESIS_SYSTEM_PROMPT,
  type OrchestratorModel,
  type SynthesisResponse,
} from '../lib/synthesis'
import { addEntry } from '../lib/dataset'
import { recordEvent, categorizeError } from '../lib/metadata'

export const synthesisRoutes = Router()

synthesisRoutes.post('/completions', async (req, res) => {
  const startTime = Date.now()

  try {
    const {
      messages,
      openrouter_api_key: caller_key,
      // SYNTHESIS options
      tier = 'fast' as SpeedTier,
      orchestrator_model,        // Optional: override orchestrator (default: claude-sonnet-4)
      nexus = true,
      custom_system_prompt,
      // tuning options
      tuning = true,
      strategy = 'adaptive',
      // obfuscation options
      obfuscation = true,
      obfuscation_technique = 'leetspeak',
      obfuscation_intensity = 'medium',
      // STM options
      stmModules = ['hedge_reducer', 'direct_mode'],
      // Param overrides
      temperature,
      max_tokens = 4096,
      top_p,
      top_k,
      frequency_penalty,
      presence_penalty,
      repetition_penalty,
      // Streaming
      stream = true,
      // Dynamic Upgrade: serve best individual response during collection, morph on synthesis
      liquid = true,
      dynamic_min_delta = 8,
      // Dataset opt-in
      contribute_to_data = false,
    } = req.body

    // -- Validate ------------------------------------------------------
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'messages (array) is required and must not be empty' })
      return
    }

    const openrouter_api_key = caller_key || process.env.OPENROUTER_API_KEY || ''
    if (!openrouter_api_key) {
      res.status(400).json({
        error: 'No OpenRouter API key available. Either pass openrouter_api_key in the request body, or set OPENROUTER_API_KEY on the server.',
      })
      return
    }

    const validTiers: SpeedTier[] = ['fast', 'standard', 'smart', 'power', 'ultra']
    if (!validTiers.includes(tier)) {
      res.status(400).json({ error: `Invalid tier. Must be one of: ${validTiers.join(', ')}` })
      return
    }

    // Validate orchestrator model if specified
    const resolvedOrchestrator: OrchestratorModel = orchestrator_model || ORCHESTRATOR_MODELS[0]

    // -- Tier-based access control -------------------------------------
    const accessConfig = req.accessConfig
    if (accessConfig && !accessConfig.raceTiers.includes(tier)) {
      const currentTier = req.tier || 'free'
      res.status(403).json({
        error: 'Upgrade required',
        message: `The "${tier}" SYNTHESIS tier requires a higher plan. Your "${currentTier}" plan allows: ${accessConfig.raceTiers.join(', ')}.`,
        current_tier: currentTier,
        allowed_tiers: accessConfig.raceTiers,
        requested_tier: tier,
      })
      return
    }

    // -- Build messages with nexus prompt -----------------------------
    const normalizedMessages = messages.map((m: any) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: String(m.content || ''),
    }))

    const lastUserMsg = [...normalizedMessages].reverse().find(m => m.role === 'user')
    const userContent = lastUserMsg?.content || ''

    const systemPrompt = nexus
      ? (custom_system_prompt || NEXUS_SYSTEM_PROMPT) + DEPTH_DIRECTIVE
      : custom_system_prompt || ''

    const baseMessages = [
      ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
      ...normalizedMessages.filter(m => m.role !== 'system'),
    ]

    // -- tuning ------------------------------------------------------
    const conversationHistory = normalizedMessages
      .filter(m => m.role !== 'system')
      .map(m => m.content)
      .join('\n')

    let tuningResult: TuningResult | null = null
    let computedParams: Record<string, number | undefined> = {
      temperature, top_p, top_k,
      frequency_penalty, presence_penalty, repetition_penalty,
    }

    if (tuning) {
      const validStrategy = ['adaptive', 'precise', 'balanced', 'creative', 'chaotic'].includes(strategy)
        ? strategy as TuningStrategy
        : 'adaptive' as TuningStrategy

      tuningResult = computeTuningParams({
 strategy: validStrategy,
 message: userContent,
 conversationHistory: normalizedMessages
 .filter(m => m.role !== 'system')
 .map(m => ({ role: m.role, content: m.content })),
 adaptedProfiles: getSharedProfiles(),
 })

      computedParams = {
        temperature: temperature ?? tuningResult.params.temperature,
        top_p: top_p ?? tuningResult.params.top_p,
        top_k: top_k ?? tuningResult.params.top_k,
        frequency_penalty: frequency_penalty ?? tuningResult.params.frequency_penalty,
        presence_penalty: presence_penalty ?? tuningResult.params.presence_penalty,
        repetition_penalty: repetition_penalty ?? tuningResult.params.repetition_penalty,
      }
    }

    // -- nexus Boost -------------------------------------------------
    const finalParams = nexus
      ? applyNexusBoost(computedParams)
      : computedParams

    // -- obfuscation --------------------------------------------------
    let obfuscationResult: { triggers_found: string[]; technique_used: string; transformations_count: number } | null = null
    let processedMessages = baseMessages

    if (obfuscation) {
      const config: ObfuscationConfig = {
        enabled: true,
        technique: obfuscation_technique,
        intensity: obfuscation_intensity,
        customTriggers: [],
      }
      const transformed = encodeObfuscation(userContent, config)
      if (transformed.transformedText) {
        obfuscationResult = {
          triggers_found: transformed.triggersFound,
          technique_used: obfuscation_technique,
          transformations_count: transformed.triggersFound.length,
        }
        processedMessages = baseMessages.map(m => {
          if (m.content === userContent) {
            return { ...m, content: transformed.transformedText }
          }
          return m
        })
      }
    }

    // -- Get models for tier -------------------------------------------
    const raceModelsArray = getModelsForTier(tier)
    const maxModels = accessConfig?.maxRaceModels ?? raceModelsArray.length
    const models = raceModelsArray.slice(0, maxModels)

    const queryParams = {
      temperature: finalParams.temperature ?? 0.7,
      max_tokens,
      top_p: finalParams.top_p,
      top_k: finalParams.top_k,
      frequency_penalty: finalParams.frequency_penalty,
      presence_penalty: finalParams.presence_penalty,
      repetition_penalty: finalParams.repetition_penalty,
    }

    // ------------------------------------------------------------------
    // STREAMING PATH
    // ------------------------------------------------------------------
    if (stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      })

      const sse = (event: string, data: any) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      }

      // Phase 1: Collection
      sse('synthesis:start', {
        tier,
        models_queried: models.length,
        orchestrator: resolvedOrchestrator,
        phase: 'collection',
      })

      const collectedResults: ModelResult[] = []
      let successCount = 0

      // Dynamic Upgrade: track best individual response during collection
      const minDelta = Math.max(1, Math.min(50, Number(dynamic_min_delta) || 8))
      let currentBest: { model: string; content: string; score: number; duration_ms: number } | null = null
      let liquidUpgrades = 0

      const results = await collectAllResponses(
        models,
        processedMessages,
        openrouter_api_key,
        queryParams,
        {
          minResponses: Math.min(3, models.length),
          hardTimeout: 60000,
          onModelResult: (result, collected, total) => {
            const score = result.success ? scoreResponse(result.content, userContent) : 0
            result.score = score
            if (result.success) successCount++

            sse('synthesis:model', {
              model: result.model,
              score,
              duration_ms: result.duration_ms,
              success: result.success,
              error: result.error || undefined,
              content_length: result.content?.length || 0,
              models_collected: collected,
              models_total: total,
            })

            // Dynamic Upgrade: emit leader event when a new best arrives
            if (liquid && result.success && result.content) {
              const currentScore = currentBest?.score ?? 0
              const isFirst = !currentBest
              const beatsByThreshold = score >= currentScore + minDelta

              if (isFirst ? score > 0 : beatsByThreshold) {
                // Apply STM to leader content
                let leaderContent = result.content
                if (stmModules && Array.isArray(stmModules) && stmModules.length > 0) {
                  const enabledModules: TransformModule[] = allModules.map(m => ({
                    ...m,
                    enabled: stmModules.includes(m.id),
                  }))
                  leaderContent = applySTMs(result.content, enabledModules)
                }

                currentBest = { model: result.model, content: leaderContent, score, duration_ms: result.duration_ms }
                liquidUpgrades++

                sse('synthesis:leader', {
                  model: result.model,
                  score,
                  delta: isFirst ? null : score - currentScore,
                  duration_ms: result.duration_ms,
                  content: leaderContent,
                  upgrade_number: liquidUpgrades,
                })
              }
            }
          },
        },
      )

      // Score all collected results
      const scoredResponses: SynthesisResponse[] = results.map(r => ({
        model: r.model,
        content: r.content,
        score: r.success ? scoreResponse(r.content, userContent) : 0,
        duration_ms: r.duration_ms,
        success: r.success,
        error: r.error,
      }))
      scoredResponses.sort((a, b) => b.score - a.score)

      const collectionDuration = Date.now() - startTime
      const totalSucceeded = scoredResponses.filter(r => r.success).length

      if (totalSucceeded === 0) {
        sse('SYNTHESIS:error', { error: 'All models failed during collection phase' })
        res.end()
        return
      }

      // Phase 2: Synthesis
      sse('SYNTHESIS:synthesis:start', {
        phase: 'synthesis',
        orchestrator: resolvedOrchestrator,
        responses_collected: totalSucceeded,
        collection_duration_ms: collectionDuration,
      })

      // Run orchestrator
      let synthesisResult: { synthesis: string; duration_ms: number; model: string }
      try {
        synthesisResult = await synthesize(
          userContent,
          scoredResponses,
          openrouter_api_key,
          resolvedOrchestrator,
          max_tokens,
        )
      } catch (err: any) {
        sse('SYNTHESIS:error', { error: `Orchestrator failed: ${err.message}` })
        res.end()
        return
      }

      // Apply STM to synthesis
      let finalResponse = synthesisResult.synthesis
      let stmResult = null

      if (stmModules && Array.isArray(stmModules) && stmModules.length > 0) {
        const enabledModules: TransformModule[] = allModules.map(m => ({
          ...m,
          enabled: stmModules.includes(m.id),
        }))
        const original = finalResponse
        finalResponse = applySTMs(finalResponse, enabledModules)
        stmResult = {
          modules_applied: stmModules,
          original_length: original.length,
          transformed_length: finalResponse.length,
        }
      }

      const totalDuration = Date.now() - startTime

      // Dataset collection
      let datasetId: string | null = null
      if (contribute_to_data) {
        datasetId = addEntry({
          endpoint: '/v1/synthesis/completions',
          model: resolvedOrchestrator,
          mode: 'synthesis',
          messages: normalizedMessages.filter(m => m.role !== 'system'),
          response: finalResponse,
          tuning: tuningResult ? { strategy, detected_context: tuningResult.detectedContext, confidence: tuningResult.confidence, params: tuningResult.params, reasoning: tuningResult.reasoning } : undefined,
          obfuscation: obfuscationResult || undefined,
          stm: stmResult ? { modules_applied: stmResult.modules_applied } : undefined,
          race: { tier, models_queried: models, winner_model: resolvedOrchestrator, all_scores: scoredResponses.map(r => ({ model: r.model, score: r.score, duration_ms: r.duration_ms, success: r.success })), total_duration_ms: totalDuration },
        })
      }

      // Phase 3: Complete
      sse('synthesis:complete', {
        synthesis: finalResponse,
        orchestrator: {
          model: synthesisResult.model,
          duration_ms: synthesisResult.duration_ms,
        },
        collection: {
          tier,
          models_queried: models.length,
          models_succeeded: totalSucceeded,
          collection_duration_ms: collectionDuration,
          total_duration_ms: totalDuration,
          responses: scoredResponses.map(r => ({
            model: r.model,
            score: r.score,
            duration_ms: r.duration_ms,
            success: r.success,
            error: r.error || undefined,
            content_length: r.content?.length || 0,
          })),
        },
        params_used: finalParams,
        pipeline: {
          nexus,
          tuning: tuningResult ? { detected_context: tuningResult.detectedContext, confidence: tuningResult.confidence, reasoning: tuningResult.reasoning, strategy } : null,
          obfuscation: obfuscationResult,
          stm: stmResult,
        },
        dataset: contribute_to_data ? { contributed: true, entry_id: datasetId } : { contributed: false },
      })

      // ZDR Metadata
      recordEvent({
        endpoint: '/v1/synthesis/completions',
        mode: 'synthesis',
        tier,
        stream: true,
        pipeline: {
          nexus,
          tuning: !!tuningResult,
          obfuscation: !!obfuscationResult,
          stmModules: stmModules || [],
          strategy,
        },
        tuning: tuningResult
          ? { detected_context: tuningResult.detectedContext, confidence: tuningResult.confidence }
          : undefined,
        models_queried: models.length,
        models_succeeded: totalSucceeded,
        model_results: scoredResponses.map(r => ({
          model: r.model, score: r.score, duration_ms: r.duration_ms,
          success: r.success, content_length: r.content?.length || 0,
          error_type: categorizeError(r.error),
        })),
        winner: { model: resolvedOrchestrator, score: 0, duration_ms: synthesisResult.duration_ms, content_length: finalResponse.length },
        total_duration_ms: totalDuration,
        response_length: finalResponse.length,
      })

      res.end()
      return
    }

    // ------------------------------------------------------------------
    // NON-STREAMING PATH
    // ------------------------------------------------------------------
    const results = await collectAllResponses(
      models,
      processedMessages,
      openrouter_api_key,
      queryParams,
      {
        minResponses: Math.min(3, models.length),
        hardTimeout: 60000,
      },
    )

    const collectionDuration = Date.now() - startTime

    const scoredResponses: SynthesisResponse[] = results.map(r => ({
      model: r.model,
      content: r.content,
      score: r.success ? scoreResponse(r.content, userContent) : 0,
      duration_ms: r.duration_ms,
      success: r.success,
      error: r.error,
    }))
    scoredResponses.sort((a, b) => b.score - a.score)

    const totalSucceeded = scoredResponses.filter(r => r.success).length

    if (totalSucceeded === 0) {
      res.status(502).json({
        error: 'All models failed during SYNTHESIS collection phase',
        models_queried: models.length,
        results: scoredResponses.map(r => ({
          model: r.model, success: r.success, error: r.error, duration_ms: r.duration_ms,
        })),
      })
      return
    }

    // Run orchestrator synthesis
    let synthesisResult: { synthesis: string; duration_ms: number; model: string }
    try {
      synthesisResult = await synthesize(
        userContent,
        scoredResponses,
        openrouter_api_key,
        resolvedOrchestrator,
        max_tokens,
      )
    } catch (err: any) {
      res.status(502).json({
        error: `Orchestrator failed: ${err.message}`,
        collection: {
          models_queried: models.length,
          models_succeeded: totalSucceeded,
          duration_ms: collectionDuration,
        },
      })
      return
    }

    // STM
    let finalResponse = synthesisResult.synthesis
    let stmResult = null

    if (stmModules && Array.isArray(stmModules) && stmModules.length > 0) {
      const enabledModules: TransformModule[] = allModules.map(m => ({
        ...m,
        enabled: stmModules.includes(m.id),
      }))
      const original = finalResponse
      finalResponse = applySTMs(finalResponse, enabledModules)
      stmResult = {
        modules_applied: stmModules,
        original_length: original.length,
        transformed_length: finalResponse.length,
      }
    }

    const totalDuration = Date.now() - startTime

    // Dataset
    let datasetId: string | null = null
    if (contribute_to_data) {
      datasetId = addEntry({
        endpoint: '/v1/synthesis/completions',
        model: resolvedOrchestrator,
        mode: 'synthesis',
        messages: normalizedMessages.filter(m => m.role !== 'system'),
        response: finalResponse,
        tuning: tuningResult ? { strategy, detected_context: tuningResult.detectedContext, confidence: tuningResult.confidence, params: tuningResult.params, reasoning: tuningResult.reasoning } : undefined,
        obfuscation: obfuscationResult || undefined,
        stm: stmResult ? { modules_applied: stmResult.modules_applied } : undefined,
        race: { tier, models_queried: models, winner_model: resolvedOrchestrator, all_scores: scoredResponses.map(r => ({ model: r.model, score: r.score, duration_ms: r.duration_ms, success: r.success })), total_duration_ms: totalDuration },
      })
    }

    // ZDR Metadata
    recordEvent({
      endpoint: '/v1/synthesis/completions',
      mode: 'synthesis',
      tier,
      stream: false,
      pipeline: {
        nexus,
        tuning: !!tuningResult,
        obfuscation: !!obfuscationResult,
        stmModules: stmModules || [],
        strategy,
      },
      tuning: tuningResult
        ? { detected_context: tuningResult.detectedContext, confidence: tuningResult.confidence }
        : undefined,
      models_queried: models.length,
      models_succeeded: totalSucceeded,
      model_results: scoredResponses.map(r => ({
        model: r.model, score: r.score, duration_ms: r.duration_ms,
        success: r.success, content_length: r.content?.length || 0,
        error_type: categorizeError(r.error),
      })),
      winner: { model: resolvedOrchestrator, score: 0, duration_ms: synthesisResult.duration_ms, content_length: finalResponse.length },
      total_duration_ms: totalDuration,
      response_length: finalResponse.length,
    })

    // -- Build response ------------------------------------------------
    res.json({
      synthesis: finalResponse,
      orchestrator: {
        model: synthesisResult.model,
        duration_ms: synthesisResult.duration_ms,
      },
      collection: {
        tier,
        models_queried: models.length,
        models_succeeded: totalSucceeded,
        collection_duration_ms: collectionDuration,
        total_duration_ms: totalDuration,
        responses: scoredResponses.map(r => ({
          model: r.model,
          score: r.score,
          duration_ms: r.duration_ms,
          success: r.success,
          error: r.error || undefined,
          content_length: r.content?.length || 0,
          content: r.success ? r.content : undefined,
        })),
      },
      params_used: finalParams,
      pipeline: {
        nexus,
        tuning: tuningResult ? { detected_context: tuningResult.detectedContext, confidence: tuningResult.confidence, reasoning: tuningResult.reasoning, strategy } : null,
        obfuscation: obfuscationResult,
        stm: stmResult,
      },
      dataset: contribute_to_data ? { contributed: true, entry_id: datasetId } : { contributed: false },
    })

  } catch (err: any) {
    console.error('[SYNTHESIS] Error:', err.message)
    if (!res.headersSent) {
      res.status(500).json({ error: `SYNTHESIS error: ${err.message}` })
    }
  }
})

/**
 * RACE API Route � The Flagship Endpoint
 *
 * POST /v1/RACE/completions
 *
 * Queries N models in parallel with the nexus system prompt + Depth Directive,
 * scores all responses on substance/directness/completeness, and returns the winner
 * alongside full race metadata.
 *
 * Dynamic Upgrade MODE (stream=true, default):
 * - Streams SSE events as models finish
 * - Serves the first good response immediately (race:leader event)
 * - Auto-upgrades when a new model beats the current leader by `dynamic_min_delta`
 *   score points (default 8). Small improvements are suppressed to avoid flicker.
 * - Final polished result sent as race:complete
 *
 * Full pipeline per model:
 * 1. nexus system prompt + Depth Directive injected
 * 2. tuning computes context-adaptive parameters
 * 3. nexus parameter boost applied (+temp, +presence, +freq)
 * 4. obfuscation obfuscates trigger words (if enabled)
 * 5. All models queried in parallel via OpenRouter
 * 6. Responses scored and ranked (threshold-gated leader upgrades)
 * 7. STM modules applied to winner response
 * 8. Winner + all race data returned
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
  raceModels,
  scoreResponse,
  applyNexusBoost,
  type SpeedTier,
  type ModelResult,
} from '../lib/racing'
import { addEntry } from '../lib/dataset'
import { recordEvent, categorizeError } from '../lib/metadata'

export const raceRoutes = Router()

raceRoutes.post('/completions', async (req, res) => {
  const startTime = Date.now()
 const stream = req.body.stream !== false // default true, accessible in catch

  try {
    const {
      messages,
      openrouter_api_key: caller_key,
      // RACE options
      tier = 'fast' as SpeedTier,
      nexus = true,
      custom_system_prompt,
      // tuning options
      tuning = true,
      strategy = 'adaptive',
      // obfuscation options
      obfuscation = true,
      OBFUSCATION_technique = 'leetspeak',
      OBFUSCATION_intensity = 'medium',
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
      // Dynamic Upgrade (SSE streaming with live leader upgrades)
      // stream is read from req.body above (before try) for catch-block access
      dynamic_min_delta = 8, // Min score improvement to trigger a leader upgrade (1-50)
      // Dataset opt-in
      contribute_to_data = false,
    } = req.body

    // Validate
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      res.status(400).json({ error: 'messages (array) is required and must not be empty' })
      return
    }

    // Resolve OpenRouter key: caller-provided > server-side env var
    const openrouter_api_key = caller_key || process.env.OPENROUTER_API_KEY || ''
    if (!openrouter_api_key) {
      res.status(400).json({
        error: 'No OpenRouter API key available. Either pass openrouter_api_key in the request body, or set OPENROUTER_API_KEY on the server. Get a key at https://openrouter.ai/keys',
      })
      return
    }

    const validTiers: SpeedTier[] = ['fast', 'standard', 'smart', 'power', 'ultra']
    if (!validTiers.includes(tier)) {
      res.status(400).json({
        error: `Invalid tier. Must be one of: ${validTiers.join(', ')}`,
      })
      return
    }

    // -- Tier-based RACE access control ----------------------
    const accessConfig = req.accessConfig
    if (accessConfig && !accessConfig.raceTiers.includes(tier)) {
      const currentTier = req.tier || 'free'
      res.status(403).json({
        error: 'Upgrade required',
        message: `The "${tier}" RACE tier requires a higher plan. Your "${currentTier}" plan allows: ${accessConfig.raceTiers.join(', ')}.`,
        current_tier: currentTier,
        allowed_tiers: accessConfig.raceTiers,
        requested_tier: tier,
        upgrade: 'Contact sales or set NEXUS_TIER_KEYS to upgrade your API key tier.',
      })
      return
    }

    // Clamp dynamic_min_delta to valid range
    const minDelta = Math.max(1, Math.min(50, Number(dynamic_min_delta) || 8))

    // -- Build messages with nexus prompt ----------------------------
    const normalizedMessages = messages.map((m: any) => ({
      role: m.role as 'system' | 'user' | 'assistant',
      content: String(m.content || ''),
    }))

    // Get the last user message
    const lastUserMsg = [...normalizedMessages].reverse().find(m => m.role === 'user')
    const userContent = lastUserMsg?.content || ''

    // Build the system prompt: nexus + Depth Directive (or custom)
    const systemPrompt = nexus
      ? (custom_system_prompt || NEXUS_SYSTEM_PROMPT) + DEPTH_DIRECTIVE
      : custom_system_prompt || ''

    // Build final message array for each model
    const baseMessages = [
      ...(systemPrompt ? [{ role: 'system' as const, content: systemPrompt }] : []),
      // Include conversation history (non-system messages from caller)
      ...normalizedMessages.filter(m => m.role !== 'system'),
    ]

    // -- tuning -----------------------------------------------------
    const conversationHistory = normalizedMessages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role, content: m.content }))

    let tuningResult: TuningResult | null = null
    let finalParams: Record<string, number | undefined> = {
      temperature: temperature ?? 0.7,
      top_p,
      top_k,
      frequency_penalty,
      presence_penalty,
      repetition_penalty,
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

    // Apply nexus boost
    if (nexus) {
      finalParams = applyNexusBoost(finalParams)
    }

    // -- obfuscation -------------------------------------------------
    let obfuscationResult: { triggers_found: string[]; technique_used: string; transformations_count: number } | null = null
    let processedMessages = baseMessages

    if (obfuscation) {
      const ptConfig: ObfuscationConfig = {
        enabled: true,
        technique: OBFUSCATION_technique,
        intensity: OBFUSCATION_intensity,
        customTriggers: [],
      }

      processedMessages = baseMessages.map(m => {
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

    // -- Shared race setup --------------------------------------------
    const models = getModelsForTier(tier)
    const raceParams = {
      temperature: finalParams.temperature,
      max_tokens,
      top_p: finalParams.top_p,
      top_k: finalParams.top_k,
      frequency_penalty: finalParams.frequency_penalty,
      presence_penalty: finalParams.presence_penalty,
      repetition_penalty: finalParams.repetition_penalty,
    }

    // ------------------------------------------------------------------
    // STREAMING PATH: SSE "Dynamic Upgrade" mode
    // Serves the first good response immediately, then upgrades live
    // as better responses come in. Client sees text morph in real-time.
    // ------------------------------------------------------------------
    if (stream) {
      res.setHeader('Content-Type', 'text/event-stream')
      res.setHeader('Cache-Control', 'no-cache')
      res.setHeader('Connection', 'keep-alive')
      res.setHeader('X-Accel-Buffering', 'no') // disable nginx buffering
      res.flushHeaders()

      const sse = (event: string, data: unknown) => {
        res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`)
      }

      // Send race:start immediately
      sse('race:start', {
        tier,
        models_queried: models.length,
        dynamic_min_delta: minDelta,
        params_used: finalParams,
        pipeline: {
          nexus,
          tuning: tuningResult
            ? { detected_context: tuningResult.detectedContext, confidence: tuningResult.confidence, strategy }
            : null,
          obfuscation: obfuscationResult,
        },
      })

      let currentLeader: ModelResult | null = null
      let modelsResponded = 0
      let liquidUpgrades = 0
      let firstResponseMs = 0

      const results = await raceModels(
        models,
        processedMessages,
        openrouter_api_key,
        raceParams,
        {
          minResults: Math.min(5, models.length),
          gracePeriod: 5000,
          hardTimeout: 45000,
          onResult: (result) => {
            modelsResponded++
            const scored: ModelResult = {
              ...result,
              score: result.success ? scoreResponse(result.content, userContent) : 0,
            }

            // Send progress tick for every model
            sse('race:model', {
              model: scored.model,
              score: scored.score,
              duration_ms: scored.duration_ms,
              success: scored.success,
              error: scored.error || undefined,
              content_length: scored.content?.length || 0,
              models_responded: modelsResponded,
              models_total: models.length,
            })

            // New leader? Only upgrade if score beats current by dynamic_min_delta
            // First leader: any positive score qualifies
            // Subsequent leaders: must exceed current by at least minDelta points
            const currentScore = currentLeader?.score ?? 0
            const isFirstLeader = !currentLeader
            const beatsByThreshold = scored.score >= currentScore + minDelta

            if (scored.success && (isFirstLeader ? scored.score > 0 : beatsByThreshold)) {
              const prevScore = currentScore
              currentLeader = scored
              liquidUpgrades++
              if (isFirstLeader) firstResponseMs = scored.duration_ms

              // Apply STM to the current leader's content
              let leaderContent = scored.content
              if (stmModules && Array.isArray(stmModules) && stmModules.length > 0) {
                const enabledModules: TransformModule[] = allModules.map(m => ({
                  ...m,
                  enabled: stmModules.includes(m.id),
                }))
                leaderContent = applySTMs(scored.content, enabledModules)
              }

              sse('race:leader', {
                model: scored.model,
                score: scored.score,
                delta: isFirstLeader ? null : scored.score - prevScore,
                duration_ms: scored.duration_ms,
                content: leaderContent,
                upgrade_number: isFirstLeader ? 1 : undefined,
              })
            }
          },
        },
      )

      // -- Final scoring & complete event -----------------------------
      const scoredResults: ModelResult[] = results.map(r => ({
        ...r,
        score: r.success ? scoreResponse(r.content, userContent) : 0,
      }))

      const respondedModels = new Set(results.map(r => r.model))
      for (const model of models) {
        if (!respondedModels.has(model)) {
          scoredResults.push({
            model, content: '', duration_ms: Date.now() - startTime,
            success: false, error: 'Race ended (early exit)', score: 0,
          })
        }
      }
      scoredResults.sort((a, b) => b.score - a.score)

      const winner = scoredResults.find(r => r.success)
      let finalResponse = winner?.content || ''
      let stmResult = null

      if (winner && stmModules && Array.isArray(stmModules) && stmModules.length > 0) {
        const enabledModules: TransformModule[] = allModules.map(m => ({
          ...m,
          enabled: stmModules.includes(m.id),
        }))
        finalResponse = applySTMs(winner.content, enabledModules)
        stmResult = {
          modules_applied: stmModules,
          original_length: winner.content.length,
          transformed_length: finalResponse.length,
        }
      }

      const totalDuration = Date.now() - startTime
      const successCount = scoredResults.filter(r => r.success).length

      // Dataset collection
      let datasetId: string | null = null
      if (contribute_to_data && winner) {
        datasetId = addEntry({
          endpoint: '/v1/RACE/completions',
          model: winner.model, mode: 'race',
          messages: normalizedMessages.filter(m => m.role !== 'system'),
          response: finalResponse,
          tuning: tuningResult ? { strategy, detected_context: tuningResult.detectedContext, confidence: tuningResult.confidence, params: tuningResult.params, reasoning: tuningResult.reasoning } : undefined,
          obfuscation: obfuscationResult || undefined,
          stm: stmResult ? { modules_applied: stmResult.modules_applied } : undefined,
          race: { tier, models_queried: models, winner_model: winner.model, all_scores: scoredResults.map(r => ({ model: r.model, score: r.score, duration_ms: r.duration_ms, success: r.success })), total_duration_ms: totalDuration },
        })
      }

      // Send the final complete event with full metadata
      sse('race:complete', {
        response: finalResponse,
        winner: winner ? { model: winner.model, score: winner.score, duration_ms: winner.duration_ms } : null,
        race: {
          tier,
          dynamic_min_delta: minDelta,
          models_queried: models.length,
          models_succeeded: successCount,
          total_duration_ms: totalDuration,
          rankings: scoredResults.map(r => {
            // Apply STM to each successful model's response for version browsing
            let browsableContent = ''
            if (r.success && r.content) {
              browsableContent = r.content
              if (stmModules && Array.isArray(stmModules) && stmModules.length > 0) {
                const enabledModules: TransformModule[] = allModules.map(m => ({
                  ...m,
                  enabled: stmModules.includes(m.id),
                }))
                browsableContent = applySTMs(r.content, enabledModules)
              }
            }
            return {
              model: r.model, score: r.score, duration_ms: r.duration_ms,
              success: r.success, error: r.error || undefined,
              content_length: r.content?.length || 0,
              content: r.success ? browsableContent : undefined,
            }
          }),
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

      // -- ZDR Metadata (content-free) -----------------------------
      recordEvent({
        endpoint: '/v1/RACE/completions',
        mode: 'race',
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
        models_succeeded: successCount,
        model_results: scoredResults.map(r => ({
          model: r.model,
          score: r.score,
          duration_ms: r.duration_ms,
          success: r.success,
          content_length: r.content?.length || 0,
          error_type: categorizeError(r.error),
        })),
        winner: winner
          ? { model: winner.model, score: winner.score, duration_ms: winner.duration_ms, content_length: finalResponse.length }
          : undefined,
        total_duration_ms: totalDuration,
        response_length: finalResponse.length,
        liquid: {
          upgrades: liquidUpgrades,
          first_response_ms: firstResponseMs,
        },
      })

      res.end()
      return
    }

    // ------------------------------------------------------------------
    // NON-STREAMING PATH: Original behavior (wait for race, return JSON)
    // ------------------------------------------------------------------
    const results = await raceModels(
      models,
      processedMessages,
      openrouter_api_key,
      raceParams,
      {
        minResults: Math.min(5, models.length),
        gracePeriod: 5000,
        hardTimeout: 45000,
      },
    )

    // -- Score and rank -----------------------------------------------
    const scoredResults: ModelResult[] = results.map(r => ({
      ...r,
      score: r.success ? scoreResponse(r.content, userContent) : 0,
    }))

    const respondedModels = new Set(results.map(r => r.model))
    for (const model of models) {
      if (!respondedModels.has(model)) {
        scoredResults.push({
          model, content: '', duration_ms: Date.now() - startTime,
          success: false, error: 'Race ended (early exit)', score: 0,
        })
      }
    }

    scoredResults.sort((a, b) => b.score - a.score)

    const successCount = scoredResults.filter(r => r.success).length
    const winner = scoredResults.find(r => r.success)

    if (!winner || !winner.content) {
      recordEvent({
        endpoint: '/v1/RACE/completions',
        mode: 'race-failed',
        tier,
        stream,
        models_queried: models.length,
        models_succeeded: scoredResults.filter(r => r.success).length,
        model_results: scoredResults.map(r => ({
          model: r.model, score: r.score, duration_ms: r.duration_ms,
          success: r.success, content_length: r.content?.length || 0,
          error_type: r.error ? categorizeError(r.error) : undefined,
        })),
        total_duration_ms: Date.now() - startTime,
        pipeline: { nexus, tuning: !!tuningResult, obfuscation: !!obfuscationResult, stmModules: stmModules || [], strategy },
        response_length: 0,
      })
      res.status(502).json({
        error: 'All models failed in RACE mode',
        models_queried: models.length,
        results: scoredResults.map(r => ({
          model: r.model, success: r.success,
          error: r.error, duration_ms: r.duration_ms,
        })),
      })
      return
    }

    // -- STM transforms on winner -------------------------------------
    let stmResult = null
    let finalResponse = winner.content

    if (stmModules && Array.isArray(stmModules) && stmModules.length > 0) {
      const enabledModules: TransformModule[] = allModules.map(m => ({
        ...m,
        enabled: stmModules.includes(m.id),
      }))
      finalResponse = applySTMs(winner.content, enabledModules)
      stmResult = {
        modules_applied: stmModules,
        original_length: winner.content.length,
        transformed_length: finalResponse.length,
      }
    }

    const totalDuration = Date.now() - startTime

    // -- Dataset collection (opt-in) ----------------------------------
    let datasetId: string | null = null
    if (contribute_to_data) {
      datasetId = addEntry({
        endpoint: '/v1/RACE/completions',
        model: winner.model, mode: 'race',
        messages: normalizedMessages.filter(m => m.role !== 'system'),
        response: finalResponse,
        tuning: tuningResult ? { strategy, detected_context: tuningResult.detectedContext, confidence: tuningResult.confidence, params: tuningResult.params, reasoning: tuningResult.reasoning } : undefined,
        obfuscation: obfuscationResult || undefined,
        stm: stmResult ? { modules_applied: stmResult.modules_applied } : undefined,
        race: { tier, models_queried: models, winner_model: winner.model, all_scores: scoredResults.map(r => ({ model: r.model, score: r.score, duration_ms: r.duration_ms, success: r.success })), total_duration_ms: totalDuration },
      })
    }

    // -- ZDR Metadata (content-free) ----------------------------------
    recordEvent({
      endpoint: '/v1/RACE/completions',
      mode: 'race',
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
      models_succeeded: successCount,
      model_results: scoredResults.map(r => ({
        model: r.model,
        score: r.score,
        duration_ms: r.duration_ms,
        success: r.success,
        content_length: r.content?.length || 0,
        error_type: categorizeError(r.error),
      })),
      winner: { model: winner.model, score: winner.score, duration_ms: winner.duration_ms, content_length: finalResponse.length },
      total_duration_ms: totalDuration,
      response_length: finalResponse.length,
    })

    // -- Build response -----------------------------------------------
    res.json({
      response: finalResponse,
      winner: { model: winner.model, score: winner.score, duration_ms: winner.duration_ms },
      race: {
        tier, dynamic_min_delta: minDelta,
        models_queried: models.length, models_succeeded: successCount,
        total_duration_ms: totalDuration,
        rankings: scoredResults.map(r => {
          let browsableContent = ''
          if (r.success && r.content) {
            browsableContent = r.content
            if (stmModules && Array.isArray(stmModules) && stmModules.length > 0) {
              const enabledModules: TransformModule[] = allModules.map(m => ({
                ...m,
                enabled: stmModules.includes(m.id),
              }))
              browsableContent = applySTMs(r.content, enabledModules)
            }
          }
          return {
            model: r.model, score: r.score, duration_ms: r.duration_ms,
            success: r.success, error: r.error || undefined,
            content_length: r.content?.length || 0,
            content: r.success ? browsableContent : undefined,
          }
        }),
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
    console.error('[RACE]', err)
    recordEvent({
      endpoint: '/v1/RACE/completions',
      mode: 'race-error',
      stream,
      pipeline: { nexus: false, tuning: false, obfuscation: false, stmModules: [] },
      total_duration_ms: Date.now() - startTime,
      response_length: 0,
    })
    if (stream) {
      try {
        res.write(`event: race:error\ndata: ${JSON.stringify({ error: 'Internal server error' })}\n\n`)
        res.end()
      } catch {}
    } else {
      res.status(500).json({ error: 'Internal server error' })
    }
  }
})

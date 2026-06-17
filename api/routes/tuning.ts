/**
 * TUNING API Routes
 *
 * POST /v1/TUNING/analyze
 * Analyzes a message (+ optional conversation history) and returns
 * optimal LLM parameters with full transparency into the decision.
 */

import { Router } from 'express'
import {
  computeTuningParams,
  type TuningStrategy,
} from '../../src/lib/tuning'
import type { ContextType } from '../../src/lib/tuning'
import type { AdaptedProfile } from '../../src/lib/tuning-feedback'

export const tuningRoutes = Router()

// In-memory learned profiles shared across requests (per-session learning)
let sharedAdaptedProfiles: Record<ContextType, AdaptedProfile> | undefined

/** Allow feedback route to update shared profiles */
export function updateSharedProfiles(profiles: Record<ContextType, AdaptedProfile>) {
  sharedAdaptedProfiles = profiles
}
export function getSharedProfiles() {
  return sharedAdaptedProfiles
}

tuningRoutes.post('/analyze', (req, res) => {
  try {
    const {
      message,
      conversation_history = [],
      strategy = 'adaptive',
      overrides,
    } = req.body

    // Validate
    if (!message || typeof message !== 'string') {
      res.status(400).json({ error: 'message (string) is required' })
      return
    }

    const validStrategies: TuningStrategy[] = ['precise', 'balanced', 'creative', 'chaotic', 'adaptive']
    if (!validStrategies.includes(strategy)) {
      res.status(400).json({
        error: `Invalid strategy. Must be one of: ${validStrategies.join(', ')}`,
      })
      return
    }

    // Normalize conversation history
    const history = Array.isArray(conversation_history)
      ? conversation_history.map((m: any) => ({
          role: String(m.role || 'user'),
          content: String(m.content || ''),
        }))
      : []

    const result = computeTuningParams({
      strategy,
      message,
      conversationHistory: history,
      overrides,
      adaptedProfiles: sharedAdaptedProfiles,
    })

    res.json({
      params: result.params,
      detected_context: result.detectedContext,
      confidence: result.confidence,
      reasoning: result.reasoning,
      context_scores: result.contextMetrics,
      pattern_matches: result.patternHits,
      param_deltas: result.paramShifts.map(d => ({
        param: d.param,
        before: d.before,
        after: d.after,
        delta: d.delta,
        reason: d.reason,
      })),
      baseline_params: result.baselineParams,
    })
  } catch (err: any) {
    console.error('[tuning]', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

/**
 * Feedback Loop API Routes
 *
 * POST /v1/feedback � Submit a rating for a response
 * GET  /v1/feedback/stats � Get learning statistics
 *
 * The feedback loop learns from user ratings via Exponential Moving Average.
 * Learned adjustments are applied to future TUNING parameter computations.
 */

import { Router } from 'express'
import {
  createInitialLearningState,
  processLearning,
  computeAdaptations,
  getFeedbackStats,
  type FeedbackRecord,
  type LearningState,
} from '../../src/lib/tuning-feedback'
import type { ContextType, TuningParam } from '../../src/lib/tuning'
import { updateSharedProfiles } from './tuning'

export const learningRoutes = Router()

// In-memory feedback state (resets on restart � research preview)
let learningState: LearningState = createInitialLearningState()

const VALID_CONTEXTS: ContextType[] = ['code', 'creative', 'analytical', 'conversational', 'chaotic']

learningRoutes.post('/', (req, res) => {
  try {
    const {
      message_id,
      context_type,
      model = 'unknown',
      persona = 'default',
      rating,
      params,
      response_text,
    } = req.body

    // Validate
    if (!message_id || typeof message_id !== 'string') {
      res.status(400).json({ error: 'message_id (string) is required' })
      return
    }

    if (!VALID_CONTEXTS.includes(context_type)) {
      res.status(400).json({
        error: `Invalid context_type. Must be one of: ${VALID_CONTEXTS.join(', ')}`,
      })
      return
    }

    if (rating !== 1 && rating !== -1) {
      res.status(400).json({ error: 'rating must be 1 (positive) or -1 (negative)' })
      return
    }

    if (!params || typeof params !== 'object') {
      res.status(400).json({ error: 'params (TuningParam object) is required' })
      return
    }

    // Compute heuristics from response text if provided
    const heuristics = response_text
      ? computeAdaptations(String(response_text))
      : { responseLength: 0, repetitionScore: 0, averageSentenceLength: 0, vocabularyDiversity: 0 }

    const record: FeedbackRecord = {
      messageId: message_id,
      timestamp: Date.now(),
      contextType: context_type,
      model: String(model),
      persona: String(persona),
      params: params as TuningParam,
      rating,
      heuristics,
    }

    // Process and update state
    learningState = processLearning(learningState, record)

    // Sync learned profiles to the TUNING route
    updateSharedProfiles(learningState.adaptedProfiles)

    res.json({
      accepted: true,
      total_feedback: learningState.history.length,
      context_type,
      learned: learningState.adaptedProfiles[context_type as ContextType].sampleCount >= 3,
    })
  } catch (err: any) {
    console.error('[feedback]', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

learningRoutes.get('/stats', (_req, res) => {
  const stats = getFeedbackStats(learningState)
  res.json({
    total_feedback: stats.totalFeedback,
    positive_rate: stats.positiveRate,
    context_breakdown: stats.contextBreakdown,
    oldest_record: stats.oldestRecord,
    newest_record: stats.newestRecord,
  })
})

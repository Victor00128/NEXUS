/**
 * OBFUSCATION API Routes
 *
 * POST /v1/OBFUSCATION/encode  — Obfuscate trigger words in text
 * POST /v1/OBFUSCATION/detect  — Detect trigger words without transforming
 */

import { Router } from 'express'
import {
  encodeObfuscation,
  detectObfuscation,
  getAvailableTechniques,
  type ObfuscationMethod,
  type ObfuscationConfig,
} from '../../src/lib/obfuscation'

export const obfuscationRoutes = Router()

const VALID_TECHNIQUES: ObfuscationMethod[] = [
  'leetspeak', 'unicode', 'zwj', 'mixedcase', 'phonetic', 'random',
]
const VALID_INTENSITIES = ['light', 'medium', 'heavy'] as const

obfuscationRoutes.post('/encode', (req, res) => {
  try {
    const {
      text,
      technique = 'leetspeak',
      intensity = 'medium',
      custom_triggers = [],
    } = req.body

    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'text (string) is required' })
      return
    }

    if (text.length > 50000) {
      res.status(400).json({ error: 'Text too long (max 50000 chars)' })
      return
    }

    if (!VALID_TECHNIQUES.includes(technique)) {
      res.status(400).json({
        error: `Invalid technique. Must be one of: ${VALID_TECHNIQUES.join(', ')}`,
      })
      return
    }

    if (!VALID_INTENSITIES.includes(intensity)) {
      res.status(400).json({
        error: `Invalid intensity. Must be one of: ${VALID_INTENSITIES.join(', ')}`,
      })
      return
    }

    const config: ObfuscationConfig = {
      enabled: true,
      technique,
      intensity,
      customTriggers: Array.isArray(custom_triggers) ? custom_triggers : [],
    }

    const result = encodeObfuscation(text, config)

    res.json({
      original_text: result.originalText,
      transformed_text: result.transformedText,
      triggers_found: result.triggersFound,
      technique_used: result.techniqueUsed,
      transformations: result.transformations,
    })
  } catch (err: any) {
    console.error('[obfuscation]', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

obfuscationRoutes.post('/detect', (req, res) => {
  try {
    const { text, custom_triggers = [] } = req.body

    if (!text || typeof text !== 'string') {
      res.status(400).json({ error: 'text (string) is required' })
      return
    }

    const triggers = detectObfuscation(
      text,
      Array.isArray(custom_triggers) ? custom_triggers : []
    )

    res.json({
      text,
      triggers_found: triggers,
      count: triggers.length,
    })
  } catch (err: any) {
    console.error('[obfuscation]', err)
    res.status(500).json({ error: 'Internal server error' })
  }
})

obfuscationRoutes.get('/techniques', (_req, res) => {
  res.json({ techniques: getAvailableTechniques() })
})

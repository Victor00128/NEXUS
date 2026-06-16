/**
 * Dataset API Routes
 *
 * GET    /v1/dataset/stats    — Dataset statistics
 * GET    /v1/dataset/export   — Export full dataset as JSON (JSONL-compatible)
 * DELETE /v1/dataset/:id      — Delete a specific entry (for GDPR-style right to delete)
 */

import { Router } from 'express'
import { getDataset, getDatasetStats, deleteEntry } from '../lib/dataset'

export const dataRoutes = Router()

dataRoutes.get('/stats', (_req, res) => {
  res.json(getDatasetStats())
})

dataRoutes.get('/export', (req, res) => {
  const format = req.query.format || 'json'
  const dataset = getDataset()

  if (format === 'jsonl') {
    // JSONL format — one JSON object per line, ideal for HF Datasets
    res.setHeader('Content-Type', 'application/x-ndjson')
    res.setHeader('Content-Disposition', 'attachment; filename="NEXUS-dataset.jsonl"')
    const lines = dataset.map(entry => JSON.stringify(entry))
    res.send(lines.join('\n') + '\n')
  } else {
    // Standard JSON array
    res.setHeader('Content-Type', 'application/json')
    res.setHeader('Content-Disposition', 'attachment; filename="NEXUS-dataset.json"')
    res.json({
      metadata: {
        name: 'NEXUS Research Dataset',
        description: 'Opt-in collection of LLM interactions with TUNING, OBFUSCATION, and RACE pipeline metadata.',
        license: 'AGPL-3.0',
        source: 'https://huggingface.co/datasets/nexuslabs/NEXUS',
        exported_at: new Date().toISOString(),
        total_entries: dataset.length,
      },
      data: dataset,
    })
  }
})

dataRoutes.delete('/:id', (req, res) => {
  const { id } = req.params
  const deleted = deleteEntry(id)

  if (deleted) {
    res.json({ deleted: true, id })
  } else {
    res.status(404).json({ error: 'Entry not found', id })
  }
})

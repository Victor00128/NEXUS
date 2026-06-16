/**
 * NEXUS AI Research API
 *
 * Exposes the core engines (tuning, Obfuscation, STM, Feedback Loop)
 * and the flagship RACE multi-model racing mode as a REST API.
 *
 * Includes opt-in dataset collection for building an open source research dataset.
 * Enterprise paywall: tier-based access control (free/pro/enterprise).
 *
 * Designed for deployment on Hugging Face Spaces (Docker) or any container host.
 */

import express from 'express'
import cors from 'cors'
import helmet from 'helmet'
import { rateLimit } from './middleware/rateLimit'
import { apiKeyAuth } from './middleware/auth'
import { tierGate } from './middleware/tierGate'
import { tuningRoutes } from './routes/tuning'
import { obfuscationRoutes } from './routes/obfuscation'
import { transformRoutes } from './routes/transform'
import { chatRoutes } from './routes/chat'
import { learningRoutes } from './routes/feedback'
import { raceRoutes } from './routes/racing'
import { synthesisRoutes } from './routes/synthesis'
import { dataRoutes } from './routes/dataset'
import { metadataRoutes } from './routes/metadata'
import { researchRoutes } from './routes/research'
import { isPublisherEnabled, startPeriodicFlush, shutdownFlush, getPublisherStatus } from './lib/data-publisher'
import { TIER_CONFIGS } from './lib/tiers'
import { RACE_MODELS } from './lib/racing'
import type { AccessConfig } from './lib/tiers'

const app = express()
const PORT = parseInt(process.env.PORT || '7860', 10) // HF Spaces default

// -- Middleware ---------------------------------------------------------
// CORS: Allow configured origins. When self-hosting, set CORS_ORIGIN=* to allow all.
const corsOrigins = process.env.CORS_ORIGIN === '*'
  ? true // Allow all origins (self-hosted / behind reverse proxy)
  : [process.env.CORS_ORIGIN || 'https://nexus.ai', ...(process.env.DATA_SPACE_URL ? [process.env.DATA_SPACE_URL] : [])].filter(Boolean)
app.use(cors({ origin: corsOrigins, credentials: false }))

// Security headers via helmet
app.use(helmet({
  contentSecurityPolicy: {
    directives: {
      defaultSrc: ["'none'"],
      scriptSrc: ["'self'", "'unsafe-inline'"],
      styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
      fontSrc: ['https://fonts.gstatic.com'],
      connectSrc: ["'self'", 'https://openrouter.ai', 'https://*.openrouter.ai', 'https://*.huggingface.co'],
      imgSrc: ["'self'", 'data:', 'blob:'],
      baseUri: ["'none'"],
      formAction: ["'none'"],
      frameAncestors: ["'none'"],
    },
  },
  crossOriginOpenerPolicy: { policy: 'same-origin' },
  crossOriginResourcePolicy: { policy: 'same-origin' },
  frameguard: { action: 'deny' },
  hsts: { maxAge: 31536000, includeSubDomains: true, preload: true },
  referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  permittedCrossDomainPolicies: false,
  xXssProtection: false, // X-XSS-Protection: 0 (modern best practice - CSP replaces it)
}))

// Permissions-Policy (not covered by helmet)
app.use((_req, res, next) => {
  res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), magnetometer=(), gyroscope=(), accelerometer=()')
  next()
})

app.use(express.json({ limit: '1mb' }))

// -- Health / Info (no auth required) ----------------------------------
app.get('/v1/health', (_req, res) => {
  res.json({ status: 'ok', timestamp: Date.now() })
})

app.get('/v1/info', (_req, res) => {
  res.json({
    name: 'NEXUS AI Research API',
    version: '0.4.0',
    description: 'RACE multi-model racing with Dynamic Upgrade live upgrades, context-adaptive parameter tuning, text transformation, obfuscation, opt-in open dataset collection, and full Research API for querying the published corpus on HuggingFace.',
    license: 'AGPL-3.0',
    flagship: 'POST /v1/race/completions',
    synthesis: 'POST /v1/synthesis/completions',
    defaults: {
      stream: true,
      dynamic_min_delta: 8,
      note: 'Streaming (Dynamic Upgrade) is ON by default. The first good response is served immediately via SSE, then auto-upgraded when a better model beats the current leader by dynamic_min_delta score points.',
    },
    tiers: {
      free: { label: 'Free', limits: TIER_CONFIGS.free.rateLimit, race: TIER_CONFIGS.free.raceTiers, research: TIER_CONFIGS.free.researchAccess },
      pro: { label: 'Pro', limits: TIER_CONFIGS.pro.rateLimit, race: TIER_CONFIGS.pro.raceTiers, research: TIER_CONFIGS.pro.researchAccess },
      enterprise: { label: 'Enterprise', limits: TIER_CONFIGS.enterprise.rateLimit, race: TIER_CONFIGS.enterprise.raceTiers, research: TIER_CONFIGS.enterprise.researchAccess },
    },
    endpoints: {
      'GET /v1/tier': 'Check your current tier, limits, and feature access',
      'POST /v1/race/completions': 'RACE: Race N models in parallel with Dynamic Upgrade (stream=true default). First good response served immediately, auto-upgrades live.',
      'POST /v1/synthesis/completions': 'Synthesis: Collect ALL model responses, orchestrator synthesizes ground truth from collective intelligence.',
      'POST /v1/chat/completions': 'Single-model pipeline with tuning + obfuscation + STM. Also supports model="race/*" and model="synthesis/*" virtual models.',
      'POST /v1/tuning/analyze': 'Analyze message context and compute optimal LLM parameters',
      'POST /v1/obfuscation/encode': 'Obfuscate trigger words in text',
      'POST /v1/obfuscation/detect': 'Detect trigger words in text',
      'POST /v1/transform': 'Apply semantic transformation modules to text',
      'POST /v1/feedback': 'Submit quality feedback for the EMA learning loop',
      'GET /v1/dataset/stats': 'Dataset collection statistics (Pro+)',
      'GET /v1/dataset/export': 'Export the open research dataset (Pro+)',
      'GET /v1/metadata/stats': 'ZDR usage analytics (models, latency, pipeline stats - no content)',
      'GET /v1/metadata/events': 'Raw metadata event log (Enterprise only)',
      'GET /v1/research/info': 'Research dataset schema, repo info (Pro+)',
      'GET /v1/research/stats': 'Aggregate stats across all published HF batches (Pro+)',
      'GET /v1/research/batches': 'List all published batch files (Pro+)',
      'GET /v1/research/batch/*': 'Read a specific batch file (Pro+)',
      'GET /v1/research/query': 'Query the full corpus with filters (Enterprise)',
      'POST /v1/research/flush': 'Force-flush in-memory buffers to HuggingFace (Enterprise)',
      'GET /v1/research/download': 'Download full corpus as streaming JSONL (Enterprise)',
      'GET /v1/research/combined-stats': 'Combined in-memory + published stats (Pro+)',
    },
    authentication: {
      openrouter_key: process.env.openrouter_api_key
        ? 'Server-provided (callers do NOT need their own OpenRouter key)'
        : 'Caller must provide openrouter_api_key in request body',
      api_key: 'Send Authorization: Bearer <your-api-key> (if server has NEXUS_API_KEY set)',
      tier_assignment: 'Set NEXUS_TIER_KEYS="enterprise:key1,pro:key2" to assign tiers to keys',
    },
    dataset: {
      note: 'Opt-in per request via contribute_to_data: true. No PII stored. Exportable as JSONL for HuggingFace Datasets.',
    },
    auto_publish: getPublisherStatus(),
    source: 'https://github.com/nexuslabs/nexus-ai',
  })
})

// -- Models Endpoint (OpenAI-compatible) -------------------------------
// Enterprise users need this for SDK model discovery

app.get('/v1/models', (_req, res) => {
  const allModels = [
    ...RACE_MODELS.fast,
    ...RACE_MODELS.standard,
    ...RACE_MODELS.smart,
  ]

  const created = Math.floor(Date.now() / 1000)

  // Virtual RACE models - race N models, return the best
  const virtualModels = [
    { id: 'race/fast', owned_by: 'nexus-ai' },
    { id: 'race/standard', owned_by: 'nexus-ai' },
    { id: 'race/smart', owned_by: 'nexus-ai' },
    { id: 'race/power', owned_by: 'nexus-ai' },
    { id: 'race/ultra', owned_by: 'nexus-ai' },
    // Synthesis - hive-mind synthesis from all models
    { id: 'synthesis/fast', owned_by: 'nexus-ai' },
    { id: 'synthesis/standard', owned_by: 'nexus-ai' },
    { id: 'synthesis/smart', owned_by: 'nexus-ai' },
    { id: 'synthesis/power', owned_by: 'nexus-ai' },
    { id: 'synthesis/ultra', owned_by: 'nexus-ai' },
  ]

  res.json({
    object: 'list',
    data: [
      // Virtual RACE models first
      ...virtualModels.map(m => ({
        id: m.id,
        object: 'model' as const,
        created,
        owned_by: m.owned_by,
      })),
      // Individual models
      ...allModels.map(id => ({
        id,
        object: 'model' as const,
        created,
        owned_by: id.split('/')[0] || 'unknown',
      })),
    ],
  })
})

// -- Tier Info Endpoint (authenticated) --------------------------------
app.get('/v1/tier', apiKeyAuth, (req, res) => {
  const tier = req.tier || 'free'
  const config: AccessConfig = req.accessConfig!
  res.json({
    tier: config.name,
    label: config.label,
    limits: config.rateLimit,
    features: {
      raceTiers: config.raceTiers,
      max_race_models: config.maxRaceModels,
      research_access: config.researchAccess,
      dataset_export_formats: config.datasetExportFormats,
      can_flush: config.canFlush,
      can_access_metadata_events: config.canAccessMetadataEvents,
      can_download_corpus: config.canDownloadCorpus,
    },
    upgrade: tier !== 'enterprise'
      ? 'Contact sales or set NEXUS_TIER_KEYS to upgrade your API key tier.'
      : undefined,
  })
})

// -- Core routes (all tiers) -------------------------------------------
app.use('/v1/race', apiKeyAuth, rateLimit, raceRoutes)
app.use('/v1/synthesis', apiKeyAuth, rateLimit, synthesisRoutes)
app.use('/v1/chat', apiKeyAuth, rateLimit, chatRoutes)
app.use('/v1/tuning', apiKeyAuth, rateLimit, tuningRoutes)
app.use('/v1/obfuscation', apiKeyAuth, rateLimit, obfuscationRoutes)
app.use('/v1/transform', apiKeyAuth, rateLimit, transformRoutes)
app.use('/v1/feedback', apiKeyAuth, rateLimit, learningRoutes)

// -- Gated routes ------------------------------------------------------
// Dataset: Pro+ for export, stats accessible by all
app.use('/v1/dataset', apiKeyAuth, rateLimit, tierGate('dataset:export'), dataRoutes)

// Metadata: stats open to all auth'd users, events gated to Enterprise
app.use('/v1/metadata', apiKeyAuth, metadataRoutes) // individual route-level gating in metadata routes

// Research: Pro+ for read access, Enterprise for full access
app.use('/v1/research', apiKeyAuth, rateLimit, tierGate('research:read'), researchRoutes)

// -- 404 ---------------------------------------------------------------
app.use((_req, res) => {
  res.status(404).json({ error: 'Not found. See GET /v1/info for available endpoints.' })
})

// -- Error handler -----------------------------------------------------
app.use((err: Error, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('[API Error]', err.message)
  res.status(500).json({ error: 'Internal server error' })
})

// -- Start -------------------------------------------------------------
app.listen(PORT, '0.0.0.0', () => {
  const hfStatus = isPublisherEnabled()
    ? `ON -> ${process.env.DATA_REPO}`
    : 'OFF (set DATA_TOKEN + DATA_REPO to enable)'

  console.log(`
NEXUS AI Research API v0.4.0
Listening on http://0.0.0.0:${PORT}

TIERS:
  FREE        5 req total, 10/min, 50/day
  PRO         unlimited, 60/min, 1000/day
  ENTERPRISE  unlimited, 300/min, 10000/day

FLAGSHIP:
  POST /v1/race/completions       Multi-model racing
  POST /v1/synthesis/completions  Hive-mind synthesis

ENGINES (all tiers):
  POST /v1/chat/completions       Single-model + tuning
  POST /v1/tuning/analyze         Context analysis
  POST /v1/obfuscation/encode     Text obfuscation
  POST /v1/transform              STM transforms
  POST /v1/feedback               Feedback loop

GATED (Pro+):
  GET /v1/dataset/export          Export dataset
  GET /v1/research/stats          Published corpus stats
  GET /v1/research/batches        List HF batch files

GATED (Enterprise):
  GET /v1/research/query          Query full corpus
  GET /v1/research/download       Download corpus (JSONL)
  POST /v1/research/flush         Force-flush to HF
  GET /v1/metadata/events         Raw metadata event log

TIER CHECK:
  GET /v1/tier                    Your tier + limits

AUTO-PUBLISH: ${hfStatus}
`)

  if (!process.env.nexus_API_KEY && !process.env.nexus_API_KEYS) {
    console.warn('  WARNING: No NEXUS_API_KEY or NEXUS_API_KEYS set - all routes are unauthenticated!')
  }

  if (!process.env.nexus_TIER_KEYS) {
    console.warn('  WARNING: No NEXUS_TIER_KEYS set - all keys default to free tier')
  }

  if (!process.env.DATA_TOKEN) {
    console.warn('  WARNING: DATA_TOKEN not set - auto-publish to HuggingFace is DISABLED')
  } else if (!process.env.DATA_REPO) {
    console.warn('  WARNING: DATA_REPO not set - auto-publish to HuggingFace is DISABLED (token is set but no target repo)')
  }

  // Start periodic HF flush (no-op if not configured)
  startPeriodicFlush()
})

// -- Graceful Shutdown -------------------------------------------------
// Flush remaining metadata/dataset to HF before the container dies

async function gracefulShutdown(signal: string) {
  console.log(`\n[${signal}] Shutting down...`)
  await shutdownFlush()
  process.exit(0)
}

process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

export default app

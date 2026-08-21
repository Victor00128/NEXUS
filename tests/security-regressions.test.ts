import assert from 'node:assert/strict'
import test from 'node:test'

import { datasetContributionResult, isExplicitDataContribution } from '../api/lib/consent'
import {
  getClientRateLimitKey,
  isAllowedOrigin,
  validateTelemetryEvent,
} from '../functions/api/telemetry-schema'

const validEvent = {
  type: 'chat_completion',
  timestamp: 1_800_000_000_000,
  session_id: '123e4567-e89b-12d3-a456-426614174000',
  mode: 'standard',
  model: 'google/gemini-2.5-flash',
  duration_ms: 500,
  response_length: 120,
  success: true,
  pipeline: {
    tuning: true,
    obfuscation: false,
    stmModules: ['direct_mode'],
    strategy: 'adaptive',
    nexus: true,
  },
}

test('dataset publication requires the literal boolean true', () => {
  assert.equal(isExplicitDataContribution(true), true)
  assert.equal(isExplicitDataContribution(false), false)
  assert.equal(isExplicitDataContribution('true'), false)
  assert.equal(isExplicitDataContribution('false'), false)
  assert.equal(isExplicitDataContribution(1), false)
  assert.equal(isExplicitDataContribution({}), false)
})

test('dataset response reports contribution only after an entry is created', () => {
  assert.deepEqual(datasetContributionResult(null), { contributed: false })
  assert.deepEqual(datasetContributionResult('dataset-entry-1'), {
    contributed: true,
    entry_id: 'dataset-entry-1',
  })
})

test('telemetry accepts the current structural event shape', () => {
  assert.equal(validateTelemetryEvent(validEvent), true)
})

test('telemetry rejects injected nested content and unknown fields', () => {
  assert.equal(validateTelemetryEvent({
    ...validEvent,
    pipeline: { ...validEvent.pipeline, prompt: 'private message' },
  }), false)
  assert.equal(validateTelemetryEvent({ ...validEvent, prompt: 'private message' }), false)
  assert.equal(validateTelemetryEvent({
    ...validEvent,
    classification: {
      domain: 'benign',
      subcategory: 'coding',
      confidence: 0.9,
      flags: ['safe'],
      details: { prompt: 'private message' },
    },
  }), false)
})

test('telemetry rejects cross-origin requests and rate limits by network identity', () => {
  const sameOrigin = new Request('https://nexus.example/api/telemetry', {
    headers: { Origin: 'https://nexus.example', 'CF-Connecting-IP': '203.0.113.7' },
  })
  const crossOrigin = new Request('https://nexus.example/api/telemetry', {
    headers: { Origin: 'https://attacker.example' },
  })

  assert.equal(isAllowedOrigin(sameOrigin), true)
  assert.equal(isAllowedOrigin(crossOrigin), false)
  assert.equal(getClientRateLimitKey(sameOrigin, 'cloudflare'), 'cf:203.0.113.7')
  assert.notEqual(
    getClientRateLimitKey(new Request('https://nexus.example/api/telemetry', {
      headers: { 'X-Vercel-Forwarded-For': '198.51.100.9' },
    }), 'vercel'),
    getClientRateLimitKey(new Request('https://nexus.example/api/telemetry', {
      headers: { 'X-Vercel-Forwarded-For': '198.51.100.10' },
    }), 'vercel'),
  )
  assert.equal(getClientRateLimitKey(new Request('https://nexus.example/api/telemetry', {
    headers: { 'X-Forwarded-For': '198.51.100.9' },
  }), 'vercel'), 'unknown-client')

  const mixedHeaders = new Request('https://nexus.example/api/telemetry', {
    headers: {
      'CF-Connecting-IP': '203.0.113.7',
      'X-Vercel-Forwarded-For': '198.51.100.9',
    },
  })
  assert.equal(getClientRateLimitKey(mixedHeaders, 'cloudflare'), 'cf:203.0.113.7')
  assert.equal(getClientRateLimitKey(mixedHeaders, 'vercel'), 'vercel:198.51.100.9')
})

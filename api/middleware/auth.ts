/**
 * API Key Authentication Middleware
 *
 * Research preview uses a simple bearer token scheme.
 * Keys are loaded from the NEXUS_API_KEYS environment variable
 * (comma-separated list) or a single NEXUS_API_KEY.
 *
 * If neither is set, auth is disabled so local development needs no setup.
 * In production that would leave every route open, so the server refuses to
 * start instead — misconfiguration should be loud, not silently permissive.
 *
 * After authentication, the request is annotated with:
 *   - req.apiKeyId     hashed key for rate-limit bucketing
 *   - req.tier         resolved tier (free/pro/enterprise)
 *   - req.accessConfig full tier configuration object
 */

import type { Request, Response, NextFunction } from 'express'
import { timingSafeEqual, createHash } from 'crypto'
import { resolveTier, getAccessConfig } from '../lib/tiers'

function getValidKeys(): string[] | null {
  const multi = process.env.NEXUS_API_KEYS
  if (multi) {
    const keys = multi.split(',').map(k => k.trim()).filter(Boolean)
    if (keys.length > 0) return keys
  }
  const single = process.env.NEXUS_API_KEY
  if (single) {
    return [single.trim()]
  }
  return null // Auth disabled
}

/** Constant-time comparison of two strings (prevents timing attacks). */
function safeEqual(a: string, b: string): boolean {
  // Hash both inputs to fixed-length buffers so we never leak key length
  // via early return on length mismatch.
  const hashA = createHash('sha256').update(a).digest()
  const hashB = createHash('sha256').update(b).digest()
  return timingSafeEqual(hashA, hashB)
}

/** Hash a key for safe use as a rate-limit bucket identifier. */
function hashKey(key: string): string {
  return createHash('sha256').update(key).digest('hex').slice(0, 16)
}

const IS_PRODUCTION = process.env.NODE_ENV === 'production'

// H-1: Fail fast in production, warn in development.
if (!getValidKeys()) {
  if (IS_PRODUCTION) {
    throw new Error(
      '[NEXUS] Refusing to start: NEXUS_API_KEY or NEXUS_API_KEYS must be set ' +
      'when NODE_ENV=production. Running without keys would expose every ' +
      '/v1 route — including the paid tiers — to anonymous callers.',
    )
  }
  console.warn(
    '[NEXUS] WARNING: No API keys configured (NEXUS_API_KEYS / NEXUS_API_KEY). ' +
    'Auth is disabled — all requests will be allowed. Development only.',
  )
}

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  const validKeys = getValidKeys()

  // Belt and braces: the startup check above already refuses to boot without
  // keys in production, but never let the open path be reachable there.
  if (!validKeys && IS_PRODUCTION) {
    res.status(503).json({ error: 'Server misconfigured: authentication is not available.' })
    return
  }

  // If no keys configured, allow all requests (local dev mode)
  if (!validKeys) {
    req.apiKeyId = 'anonymous'
    const tier = resolveTier(null)
    req.tier = tier
    req.accessConfig = getAccessConfig(tier)
    next()
    return
  }

  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({
      error: 'Missing or invalid Authorization header. Use: Bearer <your-api-key>',
    })
    return
  }

  const key = authHeader.slice(7).trim()

  // C-1: Constant-time comparison to prevent timing attacks
  const match = validKeys.some(valid => safeEqual(key, valid))
  if (!match) {
    res.status(403).json({ error: 'Invalid API key' })
    return
  }

  // H-2: Hash the full key for rate-limit bucketing (never expose raw key material)
  req.apiKeyId = hashKey(key)

  // T-1: Resolve tier from raw key
  const tier = resolveTier(key)
  req.tier = tier
  req.accessConfig = getAccessConfig(tier)

  next()
}

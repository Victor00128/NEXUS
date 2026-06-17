/**
 * Extend Express Request with NEXUS middleware properties.
 * Eliminates unsafe `(req as any)` casts throughout the codebase.
 */

import type { Tier, AccessConfig } from '../lib/tiers'

declare global {
  namespace Express {
    interface Request {
      /** Hashed API key identifier for rate-limit bucketing */
      apiKeyId?: string
      /** Resolved tier for this request */
      tier?: Tier
      /** Full tier configuration */
      accessConfig?: AccessConfig
    }
  }
}

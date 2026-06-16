import type { AccessConfig, Tier } from './lib/tiers'

declare global {
  namespace Express {
    interface Request {
      accessConfig?: AccessConfig
      tier?: Tier
    }
  }
}
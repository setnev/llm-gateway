import { RateLimitConfig } from '../types';

// ============================================================
// RateLimiter
//
// Implements a token bucket algorithm for per-tenant rate limiting.
//
// Current state: IN-MEMORY ONLY — does not survive process restart
// and does not work correctly across multiple instances.
//
// Known issues:
//   - TODO: Token refill is currently calculated lazily (on check),
//     but the refill math has not been implemented yet.
//   - TODO: The bucket state needs to be moved to Redis for
//     multi-instance deployments. See issue #12.
//   - TODO: Burst allowance is tracked but never actually enforced.
//
// The interface is intentionally designed so the storage backend
// can be swapped (in-memory → Redis) without changing callers.
// ============================================================

export interface RateLimitResult {
  allowed: boolean;
  remainingRequests: number;
  resetInMs: number;
  limitType: 'per_minute' | 'per_day' | 'burst';
}

interface BucketState {
  tokens: number;
  lastRefillAt: number;       // unix ms
  dailyUsed: number;
  dailyWindowStart: number;   // unix ms, start of current day window
}

export class RateLimiter {
  private buckets: Map<string, BucketState> = new Map();

  constructor() {}

  // TODO: Implement token bucket check with lazy refill.
  // The refill rate should be: config.requestsPerMinute tokens per 60 seconds.
  // If the bucket doesn't exist yet, initialize it at full capacity.
  // Must check daily cap BEFORE minute-level bucket.
  // Returns RateLimitResult.
  check(_tenantId: string, _config: RateLimitConfig): RateLimitResult {
    throw new Error('Not implemented: RateLimiter.check()');
  }

  // TODO: Consume one token from the bucket for tenantId.
  // Should only be called after check() returns allowed: true.
  // Must be atomic in single-process context.
  consume(_tenantId: string): void {
    throw new Error('Not implemented: RateLimiter.consume()');
  }

  // Returns current bucket state for a tenant (for admin/debug endpoints)
  getBucketState(tenantId: string): BucketState | null {
    return this.buckets.get(tenantId) ?? null;
  }

  // Resets daily window — called by scheduler at midnight UTC
  resetDailyCounters(): void {
    const now = Date.now();
    for (const [, bucket] of this.buckets) {
      bucket.dailyUsed = 0;
      bucket.dailyWindowStart = now;
    }
  }
}

// Singleton
let _limiter: RateLimiter | null = null;

export function getRateLimiter(): RateLimiter {
  if (!_limiter) _limiter = new RateLimiter();
  return _limiter;
}

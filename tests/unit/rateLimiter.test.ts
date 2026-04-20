import { RateLimiter } from '../../src/tenant/rateLimiter';
import { RateLimitConfig } from '../../src/types';

// ============================================================
// RateLimiter Unit Tests
//
// Status: FAILING — RateLimiter.check() and .consume() not implemented.
// ============================================================

const BASE_CONFIG: RateLimitConfig = {
  requestsPerMinute: 10,
  requestsPerDay: 100,
  burstAllowance: 2,
};

describe('RateLimiter', () => {
  let limiter: RateLimiter;

  beforeEach(() => {
    limiter = new RateLimiter(); // fresh instance per test
  });

  it('should allow first request for new tenant', () => {
    const result = limiter.check('tenant_1', BASE_CONFIG);
    expect(result.allowed).toBe(true);
    expect(result.remainingRequests).toBe(9); // 10 - 1 (current request)
  });

  it('should deny requests after RPM limit is reached', () => {
    for (let i = 0; i < 10; i++) {
      limiter.consume('tenant_1');
    }

    const result = limiter.check('tenant_1', BASE_CONFIG);
    expect(result.allowed).toBe(false);
    expect(result.limitType).toBe('per_minute');
  });

  it('should deny requests after daily limit is reached', () => {
    // Simulate 100 requests consumed over time
    // This requires the daily counter to be at limit
    for (let i = 0; i < 100; i++) {
      limiter.consume('tenant_1');
    }

    const result = limiter.check('tenant_1', { ...BASE_CONFIG, requestsPerMinute: 9999 });
    expect(result.allowed).toBe(false);
    expect(result.limitType).toBe('per_day');
  });

  it('should isolate buckets between tenants', () => {
    for (let i = 0; i < 10; i++) {
      limiter.consume('tenant_1');
    }

    // tenant_2 should be unaffected
    const result = limiter.check('tenant_2', BASE_CONFIG);
    expect(result.allowed).toBe(true);
  });

  it('resetDailyCounters should clear daily usage', () => {
    for (let i = 0; i < 100; i++) {
      limiter.consume('tenant_1');
    }

    limiter.resetDailyCounters();

    const result = limiter.check('tenant_1', BASE_CONFIG);
    // After reset, daily cap should be 0 again
    expect(result.allowed).toBe(true);
  });

  it('should provide resetInMs indicating when tokens refill', () => {
    for (let i = 0; i < 10; i++) {
      limiter.consume('tenant_1');
    }
    const result = limiter.check('tenant_1', BASE_CONFIG);
    expect(result.resetInMs).toBeGreaterThan(0);
    expect(result.resetInMs).toBeLessThanOrEqual(60 * 1000);
  });
});

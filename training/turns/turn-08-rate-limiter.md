# Turn 8 of 13 — `RateLimiter.check()` and `RateLimiter.consume()`

**Target file**: `src/tenant/rateLimiter.ts`
**Target symbols**: `RateLimiter.check()` and `RateLimiter.consume()`
**Lines to replace**: 46–55

This turn also requires **uncommenting the rate-limit block in `src/index.ts`** and **flipping the integration test from `it.todo` to a real assertion**.

### Current stubs

```typescript
check(_tenantId: string, _config: RateLimitConfig): RateLimitResult {
  throw new Error('Not implemented: RateLimiter.check()');
}

consume(_tenantId: string): void {
  throw new Error('Not implemented: RateLimiter.consume()');
}
```

### What to implement

Token bucket algorithm with lazy refill and daily cap.

**`check(tenantId, config)`**:
1. Look up or initialize bucket in `this.buckets`. On init: `tokens = config.requestsPerMinute`, `lastRefillAt = Date.now()`, `dailyUsed = 0`, `dailyWindowStart = Date.now()`.
2. **Refill** the bucket lazily: compute elapsed ms since `lastRefillAt`; add `(elapsed / 60000) * config.requestsPerMinute` tokens; clamp to `config.requestsPerMinute + config.burstAllowance`; update `lastRefillAt`.
3. Check **daily cap first**: if `dailyUsed >= config.requestsPerDay`, return `{ allowed: false, remainingRequests: 0, resetInMs: msUntilMidnight(), limitType: 'per_day' }`.
4. Check **per-minute bucket**: if `Math.floor(tokens) < 1`, return `{ allowed: false, remainingRequests: 0, resetInMs: Math.ceil(60000 - elapsedSinceLastRefill), limitType: 'per_minute' }`.
5. If allowed: return `{ allowed: true, remainingRequests: Math.floor(tokens) - 1, resetInMs: 0, limitType: 'per_minute' }`.

**`consume(tenantId)`**:
1. Get bucket (create if missing with full tokens).
2. Decrement `tokens` by 1.
3. Increment `dailyUsed` by 1.

### Relevant types

```typescript
export interface RateLimitResult {
  allowed: boolean;
  remainingRequests: number;
  resetInMs: number;
  limitType: 'per_minute' | 'per_day' | 'burst';
}

export interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerDay: number;
  burstAllowance: number;
}
```

### Changes to `src/index.ts`

After this turn, uncomment the rate-limit block at lines 88–95 and rename `_rateLimiter` to `rateLimiter`:

```typescript
// Change:
const _rateLimiter = overrides?.rateLimiter ?? getRateLimiter();

// To:
const rateLimiter = overrides?.rateLimiter ?? getRateLimiter();

// And uncomment:
const rateLimitResult = rateLimiter.check(tenant.id, tenant.rateLimitConfig);
if (!rateLimitResult.allowed) {
  reply.header('X-RateLimit-Reset', rateLimitResult.resetInMs);
  return reply.status(429).send({ error: 'Rate limit exceeded', ...rateLimitResult });
}
rateLimiter.consume(tenant.id);
```

### Changes to `tests/integration/lifecycle.test.ts`

Flip the rate-limit todo to a real assertion:

```typescript
// Replace:
it.todo('should return 429 after exceeding RPM limit');

// With:
it('should return 429 after exceeding RPM limit', async () => {
  // The integration test tenant has requestsPerMinute: 10
  // Send 10 requests to exhaust the bucket, then verify the 11th is rejected
  for (let i = 0; i < 10; i++) {
    await app.inject({
      method: 'POST',
      url: '/v1/chat/completions',
      headers: authHeaders,
      payload: { model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }] },
    });
  }

  const r = await app.inject({
    method: 'POST',
    url: '/v1/chat/completions',
    headers: authHeaders,
    payload: { model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }] },
  });

  expect(r.statusCode).toBe(429);
  expect(r.headers['x-ratelimit-reset']).toBeDefined();
});
```

### Tests that must pass after this turn

Run: `npm run test:unit`

```
RateLimiter › should allow first request for new tenant
RateLimiter › should deny requests after RPM limit is reached
RateLimiter › should deny requests after daily limit is reached
RateLimiter › should isolate buckets between tenants
RateLimiter › resetDailyCounters should clear daily usage
RateLimiter › should provide resetInMs indicating when tokens refill
```

Run: `npm run test:integration`

```
Gateway — Request Lifecycle Integration › Rate Limiting › should return 429 after exceeding RPM limit
```

### Acceptance criteria

```
check() first call → allowed: true, remainingRequests: 9  (10 RPM - 1 in-flight view)
check() after 10 consume() → allowed: false, limitType: 'per_minute'
check() after 100 consume() → allowed: false, limitType: 'per_day'
tenant_1 exhausted → tenant_2 still allowed
after resetDailyCounters() → allowed: true
resetInMs > 0 && <= 60000    when denied per-minute
```

### Gotchas

- The test for "first request" asserts `remainingRequests: 9` — `check()` does NOT consume a token; it peeks. `remainingRequests` is `floor(tokens) - 1` (assuming the request will call `consume()` if allowed).
- Daily check comes **before** per-minute. The daily test overrides `requestsPerMinute: 9999` to isolate the daily path — your daily check must run first regardless of RPM.
- `consume()` must work even if `check()` was not called first (the test calls `consume()` 10/100 times in a loop without calling `check()` in between).
- `resetInMs` for per-minute denial: time remaining in the current 60s window, not next refill time. `Math.ceil(60000 - elapsedSinceLastRefill)`, clamped to `[1, 60000]`.
- The integration test creates a fresh `app` via `buildApp()` in `beforeAll`. The `RateLimiter` singleton persists across inject calls within a test suite — the 10-request loop will actually exhaust the bucket.

---

Output the complete, final content of `src/tenant/rateLimiter.ts`, `src/index.ts`, and `tests/integration/lifecycle.test.ts`. Do not truncate any file.

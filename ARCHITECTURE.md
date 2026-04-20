# LLM Gateway — Architecture

## Overview

A multi-tenant HTTP proxy that sits between clients and LLM provider APIs (OpenAI, Anthropic, etc.). Every request passes through policy evaluation, optional routing, and observability before reaching any upstream model.

```
Client Request
     │
     ▼
┌─────────────┐
│   Ingress   │  Auth: API Key → Tenant resolution
│  (index.ts) │  Validation: body schema, required fields
└──────┬──────┘
       │
       ▼
┌─────────────────┐
│  Rate Limiter   │  Token bucket, per-tenant, in-memory (Redis-ready)
│ (rateLimiter.ts)│  Checks per-minute AND per-day limits
└──────┬──────────┘
       │
       ▼
┌──────────────────┐
│  Policy Engine   │  Rule evaluation: priority-ordered, short-circuit on BLOCK
│  (engine.ts)     │  Rule types: pii_detection, content_filter, cost_cap,
│                  │             rate_limit, model_restriction, prompt_length
└──────┬───────────┘
       │
    ALLOW? ──── BLOCK ──→ 403 response to client
       │
       ▼
┌──────────────┐
│    Router    │  Model alias resolution, health-weighted target selection
│  (router.ts) │  Fallback chain for degraded upstreams
└──────┬───────┘
       │
       ▼
┌────────────────┐
│ Proxy Handler  │  HTTP forward to upstream LLM API
│  (handler.ts)  │  Streaming: SSE passthrough with backpressure
│                │  Non-streaming: buffer + forward
└──────┬─────────┘
       │
       ▼
┌─────────────────────┐
│  Observability      │  RequestSpan → structured log + OTEL trace
│  (collector.ts)     │  Per-tenant aggregates: request count, token usage,
│                     │  avg latency, block rate
└──────┬──────────────┘
       │ (async, off hot path)
       ▼
┌─────────────────────┐
│  Anomaly Detector   │  Sliding window analysis on requestBus events
│  (detector.ts)      │  Detects: cost spikes, rate spikes, repeated blocks
│                     │  Emits: webhook alerts, dead-letter queue on failure
└─────────────────────┘
```

---

## Data Flow — Per Request

1. **Ingress**: Extract `Authorization: Bearer <key>`, validate body against `OpenAIRequestBody` schema
2. **Tenant resolution**: SHA-256 hash of raw key → `TenantStore` lookup → `Tenant` object
3. **Rate limit**: `RateLimiter.check(tenantId, config)` → if denied, return 429 with `X-RateLimit-Reset`
4. **Policy evaluation**: `PolicyEngine.evaluate(request, policySetId, context)` → `PolicyVerdict`
   - If `BLOCK`: return 403 with reason and matched rule ID
   - If `CHALLENGE`: TBD (currently falls through to ALLOW)
5. **Routing**: `Router.selectTarget(request)` → `RoutingDecision` with primary + fallback targets
6. **Proxy**: `proxyRequest(gatewayReq, routing, reply)` → streams or buffers upstream response
7. **Observability** (async): `requestBus.emit('request:completed', span)` → picked up by `AnomalyDetector` and `ObservabilityCollector`

---

## Module Responsibilities

| Module | File | Status |
|--------|------|--------|
| Domain types | `src/types/index.ts` | ✅ Complete |
| Config loader | `src/config/index.ts` | ✅ Complete |
| Tenant store | `src/tenant/store.ts` | ✅ Complete |
| Rate limiter | `src/tenant/rateLimiter.ts` | ❌ Stubbed — `check()` and `consume()` not implemented |
| Policy engine | `src/policy/engine.ts` | ⚠️ Partial — rule loading complete, `evaluate()` not implemented; `cost_cap`, `rate_limit`, `model_restriction`, `prompt_length` evaluators are stubs |
| Proxy handler | `src/proxy/handler.ts` | ⚠️ Partial — SSE pipe works, client disconnect handling missing (issue #8) |
| Router | `src/proxy/router.ts` | ❌ Stubbed — `selectTarget()` and `updateHealth()` not implemented |
| Anomaly detector | `src/anomaly/detector.ts` | ⚠️ Partial — event bus wired, detection algorithms not implemented, dead-letter queue not implemented |
| Observability | `src/observability/collector.ts` | ⚠️ Partial — span recording works, `getP99Latency()` not implemented, OTEL not wired |
| Main server | `src/index.ts` | ⚠️ Partial — rate limiting commented out pending implementation |

---

## Known Issues

### Issue #8 — Streaming: client disconnect does not abort upstream
**File**: `src/proxy/handler.ts`, `handleStreamingResponse()`  
**Impact**: If a client disconnects mid-stream, the upstream request continues until generation completes. Tokens are consumed and billed with no benefit.  
**Fix required**: Register a `close` event listener on `reply.raw`. On close, call `reader.cancel()` to abort the fetch.

### Issue #12 — Rate limiter is not multi-instance safe
**File**: `src/tenant/rateLimiter.ts`  
**Impact**: Token bucket state is in-memory. Running multiple gateway instances behind a load balancer results in each instance having its own bucket — effective rate limit becomes `N × requestsPerMinute`.  
**Fix required**: Move bucket state to Redis using atomic operations (`INCR` + `EXPIRE`, or a Lua script for token bucket).

### Issue #15 — Anomaly webhook has no retry
**File**: `src/anomaly/detector.ts`, `emitAlert()`  
**Impact**: If the alert webhook endpoint is down or returns non-2xx, the anomaly event is silently dropped.  
**Fix required**: Add dead-letter queue with exponential backoff retry (max 3 attempts, delays: 1s, 5s, 30s).

### Issue #19 — Token count not extracted from streaming responses
**File**: `src/proxy/handler.ts`, `handleStreamingResponse()`  
**Impact**: `UpstreamResult.tokenUsage` is always `null` for streaming requests. Cost accounting and anomaly detection are blind to streaming token usage.  
**Fix required**: Parse the final SSE chunk (OpenAI sends usage data in the last `data:` line before `[DONE]`).

### Issue #22 — `buildApp()` not exported, integration tests cannot mount server
**File**: `src/index.ts`  
**Impact**: Integration tests in `tests/integration/lifecycle.test.ts` are skeleton stubs because they cannot import a testable app instance.  
**Fix required**: Refactor `main()` into `buildApp(): Promise<FastifyInstance>` and a separate `start()` entry point.

---

## Configuration

See `.env.example` for all environment variables. Config is validated at startup using Zod — missing or invalid values will throw with a clear error message.

Key config paths:
- `TENANT_CONFIG_PATH` → `config/tenants.json`
- `POLICY_CONFIG_PATH` → `config/policies.json`

### API Keys in tenant config
Keys are stored as SHA-256 hashes. To generate a valid key hash:
```bash
echo -n "your-raw-api-key" | sha256sum
```

---

## Running Locally

```bash
cp .env.example .env
# Edit .env — set ADMIN_API_KEY to any 32+ char string

npm install
npm run dev
```

With Docker:
```bash
docker compose up
```

---

## Test Suite

```bash
npm run test:unit         # Policy engine, rate limiter, router tests (expected: FAILING)
npm run test:integration  # Full lifecycle tests (expected: FAILING — see issue #22)
npm run typecheck         # TypeScript compilation check
```

The unit tests are written spec-first. They define the expected behavior and should all pass once the stubbed methods are implemented.

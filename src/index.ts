import Fastify, { FastifyInstance } from 'fastify';
import { loadConfig } from './config';
import { getTenantStore, TenantStore } from './tenant/store';
import { getPolicyEngine, PolicyEngine } from './policy/engine';
import { getRateLimiter, RateLimiter } from './tenant/rateLimiter';
import { getRouter, Router } from './proxy/router';
import { proxyRequest } from './proxy/handler';
import { getAnomalyDetector, AnomalyDetector, requestBus } from './anomaly/detector';
import { getCostTracker, CostTracker } from './tenant/costTracker';
import { GatewayRequest, OpenAIRequestBody, RequestSpan } from './types';
import { v4 as uuidv4 } from 'uuid';

// ============================================================
// LLM Gateway — Main Entry Point
//
// Request lifecycle:
//   1. Ingest: validate Authorization header, parse request body
//   2. Tenant resolution: API key → Tenant
//   3. Rate limit check
//   4. Policy evaluation: returns ALLOW / BLOCK / CHALLENGE
//   5. Routing: select upstream target
//   6. Proxy: forward to upstream, stream response back
//   7. Observability: emit RequestSpan to anomaly detector
//
// Admin routes (require ADMIN_API_KEY header):
//   GET  /admin/tenants       — list all tenants
//   GET  /admin/health        — system health summary
//   POST /admin/policy/reload — reload policy config from disk
//
// ============================================================

export interface BuildAppOverrides {
  tenantStore?: TenantStore;
  policyEngine?: PolicyEngine;
  rateLimiter?: RateLimiter;
  router?: Router;
  anomalyDetector?: AnomalyDetector;
  costTracker?: CostTracker;
}

export async function buildApp(overrides?: BuildAppOverrides): Promise<FastifyInstance> {
  const config = loadConfig();

  const app = Fastify({
    logger: {
      level: config.NODE_ENV === 'production' ? 'info' : 'debug',
      transport:
        config.NODE_ENV !== 'production'
          ? { target: 'pino-pretty' }
          : undefined,
    },
  });

  // ---- Initialize subsystems ----
  const tenantStore = overrides?.tenantStore ?? await getTenantStore();
  const policyEngine = overrides?.policyEngine ?? await getPolicyEngine();
  const router = overrides?.router ?? getRouter();
  const costTracker = overrides?.costTracker ?? getCostTracker();
  // RateLimiter + AnomalyDetector construction has side effects we need
  // (singleton init, requestBus subscription). Underscore prefix tells
  // the linter we're intentionally keeping the reference without using it.
  const _rateLimiter = overrides?.rateLimiter ?? getRateLimiter();
  const _anomalyDetector = overrides?.anomalyDetector ?? getAnomalyDetector(
    config.ALERT_WEBHOOK_URL,
    config.ALERT_WEBHOOK_SECRET
  );

  app.log.info(`Loaded ${tenantStore.getTenantCount()} tenants`);

  // ---- Health check ----
  app.get('/health', async () => ({ status: 'ok', ts: new Date().toISOString() }));

  // ---- Main proxy route ----
  // Catches all OpenAI-compatible requests
  app.post<{ Body: OpenAIRequestBody }>('/v1/chat/completions', async (request, reply) => {
    const requestId = uuidv4();
    const inboundAt = new Date();

    // 1. Extract and validate API key
    const rawKey = request.headers.authorization?.replace('Bearer ', '');
    if (!rawKey) {
      return reply.status(401).send({ error: 'Missing Authorization header' });
    }

    // 2. Resolve tenant
    const tenant = tenantStore.resolveApiKey(rawKey);
    if (!tenant || !tenant.active) {
      return reply.status(401).send({ error: 'Invalid or inactive API key' });
    }

    // 3. Rate limit check
    // TODO: RateLimiter.check()/consume() are stubbed. Once implemented,
    // rename `_rateLimiter` above (drop the underscore) and uncomment:
    // const rateLimitResult = _rateLimiter.check(tenant.id, tenant.rateLimitConfig);
    // if (!rateLimitResult.allowed) {
    //   reply.header('X-RateLimit-Reset', rateLimitResult.resetInMs);
    //   return reply.status(429).send({ error: 'Rate limit exceeded', ...rateLimitResult });
    // }
    // _rateLimiter.consume(tenant.id);

    const gatewayReq: GatewayRequest = {
      id: requestId,
      tenantId: tenant.id,
      inboundAt,
      originalModel: request.body.model,
      requestBody: request.body,
      headers: request.headers as Record<string, string>,
      streaming: request.body.stream === true,
    };

    // 4. Policy evaluation — context sourced from CostTracker
    const verdict = await policyEngine.evaluate(gatewayReq, tenant.policySetId, {
      tenantDailySpendUsd: costTracker.getDailySpend(tenant.id),
      tenantRequestsThisMinute: costTracker.getRequestsThisMinute(tenant.id),
    });

    if (verdict.action === 'BLOCK') {
      app.log.warn({ requestId, tenantId: tenant.id, reason: verdict.reason }, 'Request blocked');
      return reply.status(403).send({
        error: 'Request blocked by policy',
        reason: verdict.reason,
        rule: verdict.matchedRuleId,
        matchedRuleType: verdict.matchedRuleType,
      });
    }

    if (verdict.action === 'CHALLENGE') {
      // TODO: Implement CHALLENGE flow (e.g., require additional auth token)
      // For now, CHALLENGE falls through to ALLOW
      app.log.warn({ requestId, tenantId: tenant.id }, 'CHALLENGE verdict — treating as ALLOW (not yet implemented)');
    }

    // 5. Route selection
    let routingDecision;
    try {
      routingDecision = router.selectTarget(gatewayReq);
    } catch (err) {
      app.log.error({ requestId, err }, 'No viable upstream target');
      return reply.status(503).send({ error: 'No viable upstream target available' });
    }

    // 6. Proxy to upstream
    const totalStart = Date.now();
    let upstreamResult;
    try {
      upstreamResult = await proxyRequest(gatewayReq, routingDecision, reply);
    } catch (err) {
      app.log.error({ requestId, err }, 'Proxy error');
      return reply.status(502).send({ error: 'Upstream proxy error' });
    }

    const totalLatencyMs = Date.now() - totalStart;

    // Record usage for downstream policy evaluation on the next request
    costTracker.recordRequest(tenant.id);
    if (upstreamResult?.tokenUsage?.estimatedCostUsd) {
      costTracker.recordCost(tenant.id, upstreamResult.tokenUsage.estimatedCostUsd);
    }

    // 7. Emit observability span (async — not on hot path)
    const span: RequestSpan = {
      requestId,
      tenantId: tenant.id,
      modelRequested: gatewayReq.originalModel,
      modelRoutedTo: upstreamResult ? routingDecision.selectedTarget.model : null,
      policyVerdict: verdict.action,
      tokenCount: upstreamResult?.tokenUsage?.totalTokens ?? null,
      latencyMs: totalLatencyMs,
      upstreamLatencyMs: null, // TODO: wire up from upstreamResult
      streaming: gatewayReq.streaming,
      errorCode: upstreamResult?.error ?? null,
      timestamp: inboundAt,
    };

    setImmediate(() => requestBus.emit('request:completed', span));
  });

  // ---- Admin routes ----
  // TODO: Implement admin route handlers
  // GET  /admin/tenants
  // POST /admin/policy/reload
  // GET  /admin/anomalies
  // GET  /admin/metrics/:tenantId

  return app;
}

async function start(): Promise<void> {
  const config = loadConfig();
  const app = await buildApp();
  try {
    await app.listen({ port: config.PORT, host: '0.0.0.0' });
    app.log.info(`LLM Gateway listening on port ${config.PORT}`);
  } catch (err) {
    app.log.error(err);
    process.exit(1);
  }
}

// Only auto-start if this file was run directly, not imported (tests import buildApp)
if (require.main === module) {
  start();
}

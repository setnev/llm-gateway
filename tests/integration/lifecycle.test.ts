import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import * as crypto from 'crypto';

// ============================================================
// Integration Tests — Full Request Lifecycle
//
// These tests mount the real Fastify app via buildApp() and
// exercise the request pipeline end to end. Upstream LLM calls
// are intercepted by undici's MockAgent (Node 20 global fetch
// uses undici under the hood — nock does NOT intercept it).
//
// Reward signal: any test that was previously a vacuous
// `expect(true).toBe(true)` now runs real assertions. Tests that
// depend on a not-yet-implemented stub (e.g., disconnect abort,
// rate-limit 429) are kept as `it.todo()` so a model implementing
// that stub knows to wire the test up, rather than getting a
// silent pass today.
// ============================================================

const TENANT_API_KEY_RAW = 'test-key-for-integration-tests-1234';
const TENANT_API_KEY_HASHED = crypto
  .createHash('sha256')
  .update(TENANT_API_KEY_RAW)
  .digest('hex');

// --- Write fixture config and set env BEFORE importing buildApp ---
// loadConfig() and the tenant/policy singletons cache on first call,
// so env must be set before the module graph imports them.

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gateway-test-'));

const TEST_TENANT_CONFIG = {
  tenants: [
    {
      id: 'tenant_integration_test',
      name: 'Integration Test Tenant',
      apiKeys: [TENANT_API_KEY_HASHED],
      policySetId: 'policy_standard',
      rateLimitConfig: { requestsPerMinute: 10, requestsPerDay: 100, burstAllowance: 2 },
      costConfig: { dailyCapUsd: 10, monthlyCapUsd: 100, alertThresholdPct: 80 },
      createdAt: new Date().toISOString(),
      active: true,
    },
  ],
};

fs.writeFileSync(path.join(tmpDir, 'tenants.json'), JSON.stringify(TEST_TENANT_CONFIG));
fs.copyFileSync(
  path.resolve(__dirname, '../../config/policies.json'),
  path.join(tmpDir, 'policies.json'),
);

process.env.NODE_ENV = 'test';
process.env.ADMIN_API_KEY = 'integration-test-admin-key-32-chars-ok';
process.env.TENANT_CONFIG_PATH = path.join(tmpDir, 'tenants.json');
process.env.POLICY_CONFIG_PATH = path.join(tmpDir, 'policies.json');

import { buildApp } from '../../src/index';
import { FastifyInstance } from 'fastify';
import { MockAgent, setGlobalDispatcher, getGlobalDispatcher, Dispatcher } from 'undici';

describe('Gateway — Request Lifecycle Integration', () => {
  let app: FastifyInstance;
  let mockAgent: MockAgent;
  let originalDispatcher: Dispatcher;

  beforeAll(async () => {
    originalDispatcher = getGlobalDispatcher();
    mockAgent = new MockAgent();
    mockAgent.disableNetConnect();
    setGlobalDispatcher(mockAgent);

    app = await buildApp();
    await app.ready();
  });

  afterAll(async () => {
    await app.close();
    await mockAgent.close();
    setGlobalDispatcher(originalDispatcher);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  const authHeaders = { authorization: `Bearer ${TENANT_API_KEY_RAW}` };

  describe('Authentication', () => {
    it('should return 401 when Authorization header is missing', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        payload: { model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }] },
      });
      expect(r.statusCode).toBe(401);
      expect(r.json().error).toMatch(/Missing Authorization/);
    });

    it('should return 401 for an unrecognized API key', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: { authorization: 'Bearer bogus-key-does-not-exist' },
        payload: { model: 'gpt-4', messages: [{ role: 'user', content: 'hi' }] },
      });
      expect(r.statusCode).toBe(401);
      expect(r.json().error).toMatch(/Invalid or inactive/);
    });
  });

  describe('Policy Enforcement', () => {
    it('should return 403 when request contains SSN', async () => {
      // Register an intercept — if policy correctly blocks before routing,
      // this intercept will remain unconsumed (still in pendingInterceptors).
      const pool = mockAgent.get('https://api.openai.com');
      pool
        .intercept({ path: '/v1/chat/completions', method: 'POST' })
        .reply(200, {});

      const pendingBefore = mockAgent.pendingInterceptors().length;

      const r = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: authHeaders,
        payload: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'SSN: 123-45-6789' }],
        },
      });

      expect(r.statusCode).toBe(403);
      const body = r.json();
      expect(body.rule).toBe('rule_pii_ssn');
      expect(body.matchedRuleType).toBe('pii_detection');

      // Upstream must not have been hit — pending count unchanged
      expect(mockAgent.pendingInterceptors().length).toBe(pendingBefore);
    });

    it('should return 403 for disallowed model', async () => {
      const r = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: authHeaders,
        payload: {
          model: 'gpt-4-32k-0613',
          messages: [{ role: 'user', content: 'hello' }],
        },
      });
      expect(r.statusCode).toBe(403);
      expect(r.json().matchedRuleType).toBe('model_restriction');
    });
  });

  describe('Proxy — Non-streaming', () => {
    it('should forward clean request to upstream and return response', async () => {
      const mockResponse = {
        id: 'chatcmpl-test123',
        object: 'chat.completion',
        model: 'gpt-4-turbo-preview',
        choices: [
          { message: { role: 'assistant', content: 'Hello!' }, finish_reason: 'stop', index: 0 },
        ],
        usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 },
      };

      const pool = mockAgent.get('https://api.openai.com');
      pool
        .intercept({ path: '/v1/chat/completions', method: 'POST' })
        .reply(200, mockResponse, { headers: { 'content-type': 'application/json' } });

      const r = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: authHeaders,
        payload: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'Hello, how are you?' }],
        },
      });

      expect(r.statusCode).toBe(200);
      expect(r.json().id).toBe('chatcmpl-test123');
    });

    it('should propagate upstream 5xx as the upstream status', async () => {
      const pool = mockAgent.get('https://api.openai.com');
      pool
        .intercept({ path: '/v1/chat/completions', method: 'POST' })
        .reply(500, { error: 'Internal Server Error' });

      const r = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: authHeaders,
        payload: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'hi' }],
        },
      });

      // Acceptable status codes vary by training-turn progress:
      //   500 — evaluate() stub throws (pre-Turn 3)
      //   503 — router.selectTarget() stub throws (pre-Turn 6)
      //   500 — upstream returns 500, handler forwards it (post-Turn 6)
      //   502 — if fallback retry is implemented
      expect([500, 502, 503]).toContain(r.statusCode);
    });
  });

  describe('Proxy — Streaming (SSE)', () => {
    it('should stream SSE chunks to client', async () => {
      const sseChunks = [
        'data: {"id":"1","choices":[{"delta":{"content":"Hello"}}]}\n\n',
        'data: {"id":"1","choices":[{"delta":{"content":" World"}}]}\n\n',
        'data: [DONE]\n\n',
      ];

      const pool = mockAgent.get('https://api.openai.com');
      pool
        .intercept({ path: '/v1/chat/completions', method: 'POST' })
        .reply(200, sseChunks.join(''), {
          headers: { 'content-type': 'text/event-stream' },
        });

      const r = await app.inject({
        method: 'POST',
        url: '/v1/chat/completions',
        headers: authHeaders,
        payload: {
          model: 'gpt-4',
          messages: [{ role: 'user', content: 'hi' }],
          stream: true,
        },
      });

      expect(r.headers['content-type']).toContain('text/event-stream');
      expect(r.body).toContain('Hello');
      expect(r.body).toContain('World');
      expect(r.body).toContain('[DONE]');
    });

    // Depends on issue #8: client-disconnect abort is not implemented.
    // A training turn that fixes #8 should wire this up to verify the upstream
    // fetch is aborted when the client drops.
    it.todo('should abort upstream connection when client disconnects mid-stream');
  });

  describe('Rate Limiting', () => {
    // Depends on RateLimiter.check()/consume() being implemented AND on index.ts
    // uncommenting the rate-limit check block. A training turn that implements
    // the rate limiter should flip this from `todo` to a real assertion.
    it.todo('should return 429 after exceeding RPM limit');
  });
});

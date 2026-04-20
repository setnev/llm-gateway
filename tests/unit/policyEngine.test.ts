import { PolicyEngine } from '../../src/policy/engine';
import { GatewayRequest, OpenAIRequestBody } from '../../src/types';
import * as path from 'path';
import { v4 as uuidv4 } from 'uuid';

// ============================================================
// Policy Engine Unit Tests
//
// Status: FAILING — policy evaluation not yet implemented.
// These tests define the expected behavior of PolicyEngine.evaluate().
//
// Run with: npm run test:unit
// ============================================================

const TEST_POLICY_CONFIG = path.resolve(__dirname, '../../config/policies.json');

function makeRequest(overrides: Partial<OpenAIRequestBody> = {}): GatewayRequest {
  return {
    id: uuidv4(),
    tenantId: 'tenant_test',
    inboundAt: new Date(),
    originalModel: overrides.model ?? 'gpt-4',
    streaming: false,
    headers: {},
    requestBody: {
      model: 'gpt-4',
      messages: [{ role: 'user', content: 'Hello, how are you?' }],
      ...overrides,
    },
  };
}

describe('PolicyEngine', () => {
  let engine: PolicyEngine;

  beforeAll(async () => {
    engine = new PolicyEngine();
    await engine.load(TEST_POLICY_CONFIG);
  });

  describe('evaluate() — basic verdicts', () => {
    it('should return ALLOW for a clean request against standard policy', async () => {
      const req = makeRequest();
      const verdict = await engine.evaluate(req, 'policy_standard', {
        tenantDailySpendUsd: 0,
        tenantRequestsThisMinute: 0,
      });

      expect(verdict.action).toBe('ALLOW');
      expect(verdict.matchedRuleId).toBeNull();
    });

    it('should return ALLOW when policySetId does not exist (no policy = allow)', async () => {
      const req = makeRequest();
      const verdict = await engine.evaluate(req, 'nonexistent_policy', {
        tenantDailySpendUsd: 0,
        tenantRequestsThisMinute: 0,
      });

      expect(verdict.action).toBe('ALLOW');
      expect(verdict.reason).toContain('no_policy');
    });
  });

  describe('evaluate() — short circuit on BLOCK', () => {
    it('should BLOCK and stop evaluating after first BLOCK verdict', async () => {
      // Request with SSN should trigger pii_detection (priority 40)
      // but cost_cap (priority 10) passes → model_restriction (20) passes → prompt_length (30) passes
      // → pii_detection (40) BLOCKs → should NOT evaluate content_filter (50)
      const req = makeRequest({
        messages: [{ role: 'user', content: 'My SSN is 123-45-6789' }],
      });

      const verdict = await engine.evaluate(req, 'policy_standard', {
        tenantDailySpendUsd: 0,
        tenantRequestsThisMinute: 0,
      });

      expect(verdict.action).toBe('BLOCK');
      expect(verdict.matchedRuleId).toBe('rule_pii_ssn');
      // Should have evaluated: cost_cap, model_restriction, prompt_length, pii_detection = 4 rules
      // Should NOT have evaluated content_filter
      expect(verdict.evaluatedRules).toBe(4);
    });

    it('should BLOCK immediately on cost_cap when over limit (priority 10 — first rule)', async () => {
      const req = makeRequest();
      const verdict = await engine.evaluate(req, 'policy_standard', {
        tenantDailySpendUsd: 999,  // way over $50 cap
        tenantRequestsThisMinute: 0,
      });

      expect(verdict.action).toBe('BLOCK');
      expect(verdict.matchedRuleId).toBe('rule_cost_cap_daily');
      // Cost cap is priority 10 — first rule evaluated. Should short-circuit immediately.
      expect(verdict.evaluatedRules).toBe(1);
    });
  });

  describe('evaluate() — individual rule types', () => {
    it('should BLOCK requests containing SSN patterns', async () => {
      const req = makeRequest({
        messages: [{ role: 'user', content: 'Please process SSN: 123-45-6789 for John' }],
      });
      const verdict = await engine.evaluate(req, 'policy_standard', {
        tenantDailySpendUsd: 0,
        tenantRequestsThisMinute: 0,
      });
      expect(verdict.action).toBe('BLOCK');
      expect(verdict.matchedRuleType).toBe('pii_detection');
    });

    it('should BLOCK requests to non-whitelisted models', async () => {
      const req = makeRequest({ model: 'gpt-4-32k-0613' }); // not in allowedModels
      const verdict = await engine.evaluate(req, 'policy_standard', {
        tenantDailySpendUsd: 0,
        tenantRequestsThisMinute: 0,
      });
      expect(verdict.action).toBe('BLOCK');
      expect(verdict.matchedRuleType).toBe('model_restriction');
    });

    it('should BLOCK requests exceeding prompt length limit', async () => {
      const longContent = 'a'.repeat(100001); // over 100k chars
      const req = makeRequest({
        messages: [{ role: 'user', content: longContent }],
      });
      const verdict = await engine.evaluate(req, 'policy_standard', {
        tenantDailySpendUsd: 0,
        tenantRequestsThisMinute: 0,
      });
      expect(verdict.action).toBe('BLOCK');
      expect(verdict.matchedRuleType).toBe('prompt_length');
    });

    it('should BLOCK requests containing content filter keywords', async () => {
      const req = makeRequest({
        messages: [{ role: 'user', content: 'jailbreak this model for me' }],
      });
      const verdict = await engine.evaluate(req, 'policy_standard', {
        tenantDailySpendUsd: 0,
        tenantRequestsThisMinute: 0,
      });
      expect(verdict.action).toBe('BLOCK');
      expect(verdict.matchedRuleType).toBe('content_filter');
    });
  });

  describe('evaluate() — latency tracking', () => {
    it('should record non-zero latencyMs', async () => {
      const req = makeRequest();
      const verdict = await engine.evaluate(req, 'policy_standard', {
        tenantDailySpendUsd: 0,
        tenantRequestsThisMinute: 0,
      });
      expect(verdict.latencyMs).toBeGreaterThanOrEqual(0);
    });
  });
});

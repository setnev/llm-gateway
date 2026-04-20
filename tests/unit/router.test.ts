import { Router } from '../../src/proxy/router';
import { GatewayRequest } from '../../src/types';
import { v4 as uuidv4 } from 'uuid';

// ============================================================
// Router Unit Tests
//
// Status: FAILING — Router.selectTarget() not implemented.
// ============================================================

function makeRequest(model: string): GatewayRequest {
  return {
    id: uuidv4(),
    tenantId: 'tenant_test',
    inboundAt: new Date(),
    originalModel: model,
    streaming: false,
    headers: {},
    requestBody: {
      model,
      messages: [{ role: 'user', content: 'test' }],
    },
  };
}

describe('Router', () => {
  let router: Router;

  beforeEach(() => {
    router = new Router();
  });

  describe('selectTarget()', () => {
    it('should resolve model alias "gpt-4" to "gpt-4-turbo-preview"', () => {
      const decision = router.selectTarget(makeRequest('gpt-4'));
      expect(decision.selectedTarget.model).toBe('gpt-4-turbo-preview');
      expect(decision.selectedTarget.provider).toBe('openai');
    });

    it('should resolve model alias "claude-sonnet" to correct Anthropic model', () => {
      const decision = router.selectTarget(makeRequest('claude-sonnet'));
      expect(decision.selectedTarget.provider).toBe('anthropic');
      expect(decision.selectedTarget.model).toContain('claude-3-sonnet');
    });

    it('should select target with lowest priority number when multiple match', () => {
      // Both gpt-4-turbo-preview (priority 1) and gpt-3.5-turbo (priority 2) are openai
      // Requesting gpt-4 should pick priority 1
      const decision = router.selectTarget(makeRequest('gpt-4'));
      expect(decision.selectedTarget.priority).toBe(1);
    });

    it('should populate fallbackTargets with remaining viable targets', () => {
      const decision = router.selectTarget(makeRequest('gpt-4'));
      expect(decision.fallbackTargets.length).toBeGreaterThan(0);
      // Primary target should not be in fallbacks
      expect(
        decision.fallbackTargets.find(t => t.model === decision.selectedTarget.model)
      ).toBeUndefined();
    });

    it('should throw when no viable target exists for an unknown model', () => {
      // No target in registry matches this model
      expect(() => router.selectTarget(makeRequest('llama-99-unknown'))).toThrow();
    });

    it('should exclude targets with healthScore below 0.5', () => {
      // Directly set the health score so this test grades selectTarget()'s
      // filter logic in isolation from updateHealth()'s decay math.
      router.setHealthScoreForTest('openai', 'gpt-4-turbo-preview', 0.2);

      const decision = router.selectTarget(makeRequest('gpt-4'));
      expect(decision.selectedTarget.model).not.toBe('gpt-4-turbo-preview');

      // Restore so other tests aren't polluted (router is module-singleton-ish via MODEL_REGISTRY)
      router.setHealthScoreForTest('openai', 'gpt-4-turbo-preview', 1.0);
    });

    it('updateHealth() should decay healthScore below 0.5 on repeated failures', () => {
      // Grades updateHealth()'s EMA (or equivalent) separately from selectTarget().
      router.setHealthScoreForTest('openai', 'gpt-4-turbo-preview', 1.0);
      router.updateHealth('openai', 'gpt-4-turbo-preview', false);
      router.updateHealth('openai', 'gpt-4-turbo-preview', false);
      router.updateHealth('openai', 'gpt-4-turbo-preview', false);

      const score = router.getHealthScore('openai', 'gpt-4-turbo-preview');
      expect(score).not.toBeNull();
      expect(score!).toBeLessThan(0.5);

      // Restore for cleanliness
      router.setHealthScoreForTest('openai', 'gpt-4-turbo-preview', 1.0);
    });

    it('should include a human-readable reason in the decision', () => {
      const decision = router.selectTarget(makeRequest('gpt-4'));
      expect(typeof decision.reason).toBe('string');
      expect(decision.reason.length).toBeGreaterThan(0);
    });
  });
});

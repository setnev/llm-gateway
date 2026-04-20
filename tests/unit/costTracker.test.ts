import { CostTracker } from '../../src/tenant/costTracker';

// ============================================================
// CostTracker Unit Tests
// These tests verify the scaffold that feeds EvaluationContext
// into PolicyEngine.evaluate().
// ============================================================

describe('CostTracker', () => {
  let tracker: CostTracker;

  beforeEach(() => {
    tracker = new CostTracker();
  });

  it('should record and sum cost for a tenant', () => {
    tracker.recordCost('tenant_1', 0.50);
    tracker.recordCost('tenant_1', 1.25);
    tracker.recordCost('tenant_2', 9.99);

    expect(tracker.getDailySpend('tenant_1')).toBeCloseTo(1.75, 5);
    expect(tracker.getDailySpend('tenant_2')).toBeCloseTo(9.99, 5);
    expect(tracker.getDailySpend('unknown')).toBe(0);
  });

  it('should prune request timestamps older than 60 seconds', () => {
    const now = 1_700_000_000_000;
    // Two stale requests (65s and 120s ago) plus one fresh
    tracker.recordRequest('tenant_1', now - 120_000);
    tracker.recordRequest('tenant_1', now - 65_000);
    tracker.recordRequest('tenant_1', now - 1_000);

    expect(tracker.getRequestsThisMinute('tenant_1', now)).toBe(1);

    // Record one more fresh request; sliding window should now be 2
    tracker.recordRequest('tenant_1', now);
    expect(tracker.getRequestsThisMinute('tenant_1', now)).toBe(2);
  });

  it('resetDaily() should clear daily spend but not request windows', () => {
    tracker.recordCost('tenant_1', 42.0);
    tracker.recordRequest('tenant_1');
    expect(tracker.getDailySpend('tenant_1')).toBe(42.0);

    tracker.resetDaily();

    expect(tracker.getDailySpend('tenant_1')).toBe(0);
    // Request window is independent of daily spend
    expect(tracker.getRequestsThisMinute('tenant_1')).toBe(1);
  });
});

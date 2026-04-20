// ============================================================
// CostTracker — per-tenant rolling cost and request accounting.
//
// Populated by the proxy path after each upstream response.
// Exposes synchronous read helpers that feed PolicyEngine's
// EvaluationContext (tenantDailySpendUsd, tenantRequestsThisMinute).
//
// In-memory today; the interface is intentionally shaped so a
// Redis-backed implementation can be swapped in once issue #12 lands.
// ============================================================

export class CostTracker {
  private dailySpend: Map<string, number> = new Map();
  // tenantId → timestamps (ms) of requests within the last 60s
  private requestsThisMinute: Map<string, number[]> = new Map();

  recordCost(tenantId: string, usd: number): void {
    this.dailySpend.set(tenantId, (this.dailySpend.get(tenantId) ?? 0) + usd);
  }

  recordRequest(tenantId: string, tsMs: number = Date.now()): void {
    const cutoff = tsMs - 60_000;
    const existing = this.requestsThisMinute.get(tenantId) ?? [];
    const pruned = existing.filter(t => t > cutoff);
    pruned.push(tsMs);
    this.requestsThisMinute.set(tenantId, pruned);
  }

  getDailySpend(tenantId: string): number {
    return this.dailySpend.get(tenantId) ?? 0;
  }

  getRequestsThisMinute(tenantId: string, nowMs: number = Date.now()): number {
    const cutoff = nowMs - 60_000;
    const entries = this.requestsThisMinute.get(tenantId) ?? [];
    return entries.filter(t => t > cutoff).length;
  }

  resetDaily(): void {
    this.dailySpend.clear();
  }
}

// Singleton
let _tracker: CostTracker | null = null;

export function getCostTracker(): CostTracker {
  if (!_tracker) _tracker = new CostTracker();
  return _tracker;
}

/** @internal Test-only hook to force a fresh singleton between suites. */
export function resetCostTrackerForTest(): void {
  _tracker = null;
}

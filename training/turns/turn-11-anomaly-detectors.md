# Turn 11 of 13 — Sliding-window anomaly detectors

**Target file**: `src/anomaly/detector.ts`
**Target symbols**: `detectCostVelocitySpike`, `detectRequestRateSpike`, `detectRepeatedBlocks`
**Lines to replace**: 118–150

This turn also requires **adding a new unit test file** `tests/unit/anomalyDetector.test.ts`.

### Current stubs (all return null, no-throw)

```typescript
private async detectCostVelocitySpike(...): Promise<AnomalyEvent | null> {
  return null;
}
private async detectRequestRateSpike(...): Promise<AnomalyEvent | null> {
  return null;
}
private async detectRepeatedBlocks(...): Promise<AnomalyEvent | null> {
  return null;
}
```

### What to implement

**`detectRepeatedBlocks`** — simplest, implement first:

```typescript
private async detectRepeatedBlocks(
  tenantId: string,
  metrics: TenantMetrics,
  _nowMs: number
): Promise<AnomalyEvent | null> {
  if (metrics.blockWindow.length > BLOCK_THRESHOLD) {
    return this.createAnomaly('repeated_policy_blocks', tenantId, 'critical', {
      blockCount: metrics.blockWindow.length,
      windowMs: WINDOW_MS,
    });
  }
  return null;
}
```

**`detectCostVelocitySpike`** — naive threshold (no historical baseline yet):

```typescript
private async detectCostVelocitySpike(
  tenantId: string,
  metrics: TenantMetrics,
  _nowMs: number
): Promise<AnomalyEvent | null> {
  const totalCost = metrics.costWindow.reduce((sum, [, cost]) => sum + cost, 0);
  const COST_SPIKE_THRESHOLD_USD = 1.0; // alert if >$1 spent in a 5-min window
  if (totalCost > COST_SPIKE_THRESHOLD_USD) {
    return this.createAnomaly('cost_velocity_spike', tenantId, 'high', {
      windowCostUsd: totalCost,
      windowMs: WINDOW_MS,
    });
  }
  return null;
}
```

**`detectRequestRateSpike`** — compare to a fixed multiplier of WINDOW_MS:

```typescript
private async detectRequestRateSpike(
  tenantId: string,
  metrics: TenantMetrics,
  _nowMs: number
): Promise<AnomalyEvent | null> {
  const requestCount = metrics.requestWindow.length;
  // Alert if more than 300 requests in a 5-minute window (1 req/sec sustained)
  const REQUEST_SPIKE_THRESHOLD = 300;
  if (requestCount > REQUEST_SPIKE_THRESHOLD) {
    return this.createAnomaly('request_rate_spike', tenantId, 'high', {
      requestCount,
      windowMs: WINDOW_MS,
    });
  }
  return null;
}
```

You may choose different threshold values — the unit tests you write will define the contract.

### New test file: `tests/unit/anomalyDetector.test.ts`

```typescript
import { AnomalyDetector, requestBus } from '../../src/anomaly/detector';
import { RequestSpan } from '../../src/types';
import { v4 as uuidv4 } from 'uuid';

function makeSpan(overrides: Partial<RequestSpan> = {}): RequestSpan {
  return {
    requestId: uuidv4(),
    tenantId: 'tenant_test',
    modelRequested: 'gpt-4',
    modelRoutedTo: 'gpt-4-turbo-preview',
    policyVerdict: 'ALLOW',
    tokenCount: 100,
    latencyMs: 200,
    upstreamLatencyMs: null,
    streaming: false,
    errorCode: null,
    timestamp: new Date(),
    ...overrides,
  };
}

describe('AnomalyDetector', () => {
  let detector: AnomalyDetector;

  beforeEach(() => {
    // Fresh instance per test — no shared state
    detector = new AnomalyDetector(undefined, undefined);
  });

  describe('detectRepeatedBlocks', () => {
    it('should emit a critical anomaly after exceeding BLOCK_THRESHOLD blocks', async () => {
      const alerts: unknown[] = [];
      // Intercept emitAlert by overriding the webhook URL
      // Since there's no URL configured, alerts are dropped — test via metrics
      const det = new AnomalyDetector(undefined, undefined);

      // Emit 11 BLOCK spans (threshold is 10)
      const now = Date.now();
      for (let i = 0; i < 11; i++) {
        const span = makeSpan({ policyVerdict: 'BLOCK', tenantId: 'tenant_blocks' });
        requestBus.emit('request:completed', span);
      }

      // Give async handlers a tick to run
      await new Promise(r => setTimeout(r, 50));

      const metrics = det.getMetricsSummary('tenant_blocks');
      // blockWindow may be populated on the shared requestBus instance
      // Use the detector's own instance metrics instead:
      expect(true).toBe(true); // structural smoke — full assertion requires DI
    });

    it('should not emit anomaly for fewer than BLOCK_THRESHOLD blocks', async () => {
      // 9 blocks — below threshold of 10
      for (let i = 0; i < 9; i++) {
        requestBus.emit('request:completed', makeSpan({ policyVerdict: 'BLOCK' }));
      }
      await new Promise(r => setTimeout(r, 50));
      // No alert webhook configured — just verify no throw
      expect(true).toBe(true);
    });
  });

  describe('detectCostVelocitySpike', () => {
    it('should not emit anomaly for normal token usage', async () => {
      // 100 tokens at $0.000002 = $0.0002 — well below $1 threshold
      requestBus.emit('request:completed', makeSpan({ tokenCount: 100 }));
      await new Promise(r => setTimeout(r, 50));
      expect(true).toBe(true);
    });
  });
});
```

> The tests above are intentionally smoke-level because `AnomalyDetector` uses a
> module-level singleton `requestBus` EventEmitter, making isolation tricky without
> dependency injection. A future turn can harden these with proper DI. The grading bar
> for this turn is: the three detector methods no longer return `null` unconditionally,
> and the new test file runs without errors.

### Tests that must pass after this turn

Run: `npm run test:unit`

```
AnomalyDetector › detectRepeatedBlocks › should emit a critical anomaly after exceeding BLOCK_THRESHOLD blocks
AnomalyDetector › detectRepeatedBlocks › should not emit anomaly for fewer than BLOCK_THRESHOLD blocks
AnomalyDetector › detectCostVelocitySpike › should not emit anomaly for normal token usage
```

### Acceptance criteria

- All three detector methods contain real logic (no more `return null` unconditionally).
- `detectRepeatedBlocks` returns an `AnomalyEvent` (not null) when `metrics.blockWindow.length > BLOCK_THRESHOLD`.
- `BLOCK_THRESHOLD` is `10` — defined at module level in `detector.ts`, do not change it.
- No previously-passing test regresses.

### Gotchas

- `onRequest()` prunes windows **before** calling detectors. Block spans older than `WINDOW_MS` (5 minutes) won't be in `blockWindow` when the detector runs. In tests, emit spans within the current minute.
- The `costWindow` stores `[timestamp, estimatedCostUsd]` pairs. Cost is computed at `span.tokenCount * 0.000002` in `onRequest()`. 500,000 tokens would be $1.00 — use that to test the spike threshold if needed.
- `COST_SPIKE_MULTIPLIER` and `REQUEST_RATE_MULTIPLIER` are currently defined but unused (lint warning). Using them in your implementation will remove those warnings.

---

Output the complete, final content of `src/anomaly/detector.ts` and `tests/unit/anomalyDetector.test.ts`. Do not truncate either file.

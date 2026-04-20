# Turn 13 of 13 — `ObservabilityCollector.getP99Latency()`

> Independent turn — no prerequisites.

**Target file**: `src/observability/collector.ts`
**Target symbol**: `ObservabilityCollector.getP99Latency()`
**Lines to replace**: 126–128

This turn also requires **adding a new unit test file** `tests/unit/observability.test.ts`.

### Current stub

```typescript
getP99Latency(_tenantId: string): number | null {
  throw new Error('Not implemented: getP99Latency()');
}
```

### What to implement

Compute the 99th percentile latency across recent spans for a tenant.

```typescript
getP99Latency(tenantId: string): number | null {
  const tenantSpans = this.spans.filter(s => s.tenantId === tenantId);

  // P99 is not meaningful on small samples
  if (tenantSpans.length < 100) return null;

  const latencies = tenantSpans
    .map(s => s.latencyMs)
    .sort((a, b) => a - b);

  const idx = Math.floor(latencies.length * 0.99);
  return latencies[idx];
}
```

### New test file: `tests/unit/observability.test.ts`

```typescript
import { ObservabilityCollector } from '../../src/observability/collector';
import { RequestSpan } from '../../src/types';
import { v4 as uuidv4 } from 'uuid';

function makeSpan(tenantId: string, latencyMs: number): RequestSpan {
  return {
    requestId: uuidv4(),
    tenantId,
    modelRequested: 'gpt-4',
    modelRoutedTo: 'gpt-4-turbo-preview',
    policyVerdict: 'ALLOW',
    tokenCount: 10,
    latencyMs,
    upstreamLatencyMs: null,
    streaming: false,
    errorCode: null,
    timestamp: new Date(),
  };
}

describe('ObservabilityCollector', () => {
  let collector: ObservabilityCollector;

  beforeEach(() => {
    collector = new ObservabilityCollector();
  });

  describe('getP99Latency()', () => {
    it('should return null when fewer than 100 spans exist', () => {
      for (let i = 0; i < 50; i++) {
        collector.record(makeSpan('tenant_1', i * 10));
      }
      expect(collector.getP99Latency('tenant_1')).toBeNull();
    });

    it('should return null for a tenant with no spans', () => {
      expect(collector.getP99Latency('tenant_unknown')).toBeNull();
    });

    it('should return the 99th percentile latency for 100+ spans', () => {
      // Record 100 spans with latencies 1ms–100ms
      for (let i = 1; i <= 100; i++) {
        collector.record(makeSpan('tenant_2', i));
      }

      const p99 = collector.getP99Latency('tenant_2');
      expect(p99).not.toBeNull();
      // P99 of [1..100] sorted: index floor(100 * 0.99) = 99 → value 100
      expect(p99).toBe(100);
    });

    it('should isolate latency data between tenants', () => {
      // tenant_3: 100 spans all at 1ms
      for (let i = 0; i < 100; i++) {
        collector.record(makeSpan('tenant_3', 1));
      }
      // tenant_4: 100 spans all at 9999ms
      for (let i = 0; i < 100; i++) {
        collector.record(makeSpan('tenant_4', 9999));
      }

      expect(collector.getP99Latency('tenant_3')).toBe(1);
      expect(collector.getP99Latency('tenant_4')).toBe(9999);
    });
  });
});
```

### Tests that must pass after this turn

Run: `npm run test:unit`

```
ObservabilityCollector › getP99Latency() › should return null when fewer than 100 spans exist
ObservabilityCollector › getP99Latency() › should return null for a tenant with no spans
ObservabilityCollector › getP99Latency() › should return the 99th percentile latency for 100+ spans
ObservabilityCollector › getP99Latency() › should isolate latency data between tenants
```

### Acceptance criteria

```
getP99Latency('unknown') === null                  (no spans for tenant)
getP99Latency('tenant_1')  === null                (< 100 spans)
getP99Latency('tenant_2')  === 100                 (100 spans, latencies 1–100ms)
p99 for tenant_3 !== p99 for tenant_4              (tenant isolation)
```

### Gotchas

- The `spans` buffer rolls after `maxSpans = 10_000` entries. Filter by `tenantId` before sorting — don't sort the entire buffer.
- P99 index: `Math.floor(n * 0.99)`. For 100 spans sorted ascending [1..100], `floor(100 * 0.99) = 99`. `latencies[99]` is the 100th element (value `100`). This matches the test expectation.
- `getP99Latency()` is read-only — do not modify `this.spans` or `this.aggregates`.
- The `ObservabilityCollector` is also used by the integration test indirectly (via requestBus → observability span). Using `new ObservabilityCollector()` in the test creates a fresh instance with no cross-test state.

---

Output the complete, final content of `src/observability/collector.ts` and `tests/unit/observability.test.ts`. Do not truncate either file.

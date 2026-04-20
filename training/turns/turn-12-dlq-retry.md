# Turn 12 of 13 — Dead-letter queue retry on webhook failure (Issue #15)

> Prerequisite: Turn 11 (anomaly detectors) should be implemented first so
> anomaly events are actually generated to exercise the webhook path.

**Target file**: `src/anomaly/detector.ts`
**Target symbol**: `AnomalyDetector.emitAlert()` + DLQ drain logic
**Lines to modify**: 169–196

This turn also requires **adding retry tests** to `tests/unit/anomalyDetector.test.ts`.

### Current gap

```typescript
private async emitAlert(anomaly: AnomalyEvent): Promise<void> {
  // ...
  if (!response.ok) {
    // TODO: Instead of logging and dropping, add to deadLetterQueue
    console.error('[AnomalyDetector] Webhook delivery failed:', response.status);
  }
  // ...
  catch (err) {
    // TODO: Add to deadLetterQueue instead of dropping
    console.error('[AnomalyDetector] Webhook error (alert dropped):', err);
  }
}
```

### What to implement

Replace the drop-and-log pattern with a DLQ push and a retry scheduler.

```typescript
private async emitAlert(anomaly: AnomalyEvent, attempt = 1): Promise<void> {
  if (!this.alertWebhookUrl) {
    console.warn('[AnomalyDetector] No webhook URL configured, dropping alert:', anomaly.id);
    return;
  }

  try {
    const response = await fetch(this.alertWebhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(this.alertWebhookSecret
          ? { 'X-Gateway-Signature': this.alertWebhookSecret }
          : {}),
      },
      body: JSON.stringify(anomaly),
    });

    if (response.ok) return;

    console.error(`[AnomalyDetector] Webhook delivery failed (attempt ${attempt}):`, response.status);
  } catch (err) {
    console.error(`[AnomalyDetector] Webhook error (attempt ${attempt}):`, err);
  }

  // Failed — schedule retry or move to DLQ
  const MAX_ATTEMPTS = 3;
  const RETRY_DELAYS_MS = [1_000, 5_000, 30_000];

  if (attempt < MAX_ATTEMPTS) {
    const delay = RETRY_DELAYS_MS[attempt - 1] ?? 1_000;
    setTimeout(() => {
      this.emitAlert(anomaly, attempt + 1).catch(err =>
        console.error('[AnomalyDetector] Retry error:', err)
      );
    }, delay);
  } else {
    // All retries exhausted — add to dead-letter queue
    this.deadLetterQueue.push(anomaly);
    console.error('[AnomalyDetector] Alert moved to DLQ after max retries:', anomaly.id);
  }
}
```

### New tests to add in `tests/unit/anomalyDetector.test.ts`

```typescript
describe('emitAlert — retry and DLQ', () => {
  beforeEach(() => {
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('should retry up to 3 times and land in DLQ on repeated failure', async () => {
    let callCount = 0;
    // Mock fetch to always fail
    global.fetch = jest.fn().mockImplementation(async () => {
      callCount++;
      return { ok: false, status: 500 };
    }) as unknown as typeof fetch;

    const det = new AnomalyDetector('http://webhook.test/alert', undefined);

    // Directly call emitAlert (private — cast to any)
    await (det as unknown as { emitAlert: (e: AnomalyEvent) => Promise<void> })
      .emitAlert({
        id: 'test-anomaly-1',
        type: 'cost_velocity_spike',
        tenantId: 'tenant_test',
        severity: 'high',
        detectedAt: new Date(),
        metadata: {},
        acknowledged: false,
      });

    // First attempt fires immediately
    expect(callCount).toBe(1);

    // Advance timers for retry 1 (1s delay)
    await jest.advanceTimersByTimeAsync(1_100);
    expect(callCount).toBe(2);

    // Advance timers for retry 2 (5s delay)
    await jest.advanceTimersByTimeAsync(5_100);
    expect(callCount).toBe(3);

    // No more retries — should be in DLQ
    expect(det.getDeadLetterQueue()).toHaveLength(1);
    expect(det.getDeadLetterQueue()[0].id).toBe('test-anomaly-1');
  });

  it('should not add to DLQ if webhook succeeds on retry', async () => {
    let callCount = 0;
    global.fetch = jest.fn().mockImplementation(async () => {
      callCount++;
      return callCount >= 2 ? { ok: true } : { ok: false, status: 500 };
    }) as unknown as typeof fetch;

    const det = new AnomalyDetector('http://webhook.test/alert', undefined);

    await (det as unknown as { emitAlert: (e: AnomalyEvent) => Promise<void> })
      .emitAlert({
        id: 'test-anomaly-2',
        type: 'repeated_policy_blocks',
        tenantId: 'tenant_test',
        severity: 'critical',
        detectedAt: new Date(),
        metadata: {},
        acknowledged: false,
      });

    await jest.advanceTimersByTimeAsync(1_100);

    expect(callCount).toBe(2);
    expect(det.getDeadLetterQueue()).toHaveLength(0);
  });
});
```

### Tests that must pass after this turn

Run: `npm run test:unit`

```
AnomalyDetector › emitAlert — retry and DLQ › should retry up to 3 times and land in DLQ on repeated failure
AnomalyDetector › emitAlert — retry and DLQ › should not add to DLQ if webhook succeeds on retry
```

### Acceptance criteria

- First attempt fires immediately (no initial delay).
- Retry 1: 1s delay.
- Retry 2: 5s delay.
- After 3 total attempts with failure: event is in `getDeadLetterQueue()`.
- On success at any attempt: DLQ remains empty.
- `getDeadLetterQueue()` returns a defensive copy (already implemented in the existing code).

### Gotchas

- `jest.useFakeTimers()` must be called in `beforeEach`. `jest.advanceTimersByTimeAsync()` advances both timers and resolves pending promises — use the async variant.
- Cast `det as unknown as { emitAlert: ... }` to call the private method from tests — TypeScript won't allow direct access otherwise.
- The `global.fetch` mock must be typed carefully. After the test, Jest automatically restores mocks if `jest.restoreAllMocks()` is in `afterEach`, or manually reset with `jest.resetAllMocks()`.
- The retry delays array `[1_000, 5_000, 30_000]` — the third entry (30s) is the delay *before* the final retry, but after the third attempt fails, the event goes to DLQ (no fourth retry). Total attempts: 3.

---

Output the complete, final content of `src/anomaly/detector.ts` and `tests/unit/anomalyDetector.test.ts`. Do not truncate either file.

import { EventEmitter } from 'events';
import { AnomalyEvent, AnomalyType, RequestSpan } from '../types';
import { v4 as uuidv4 } from 'uuid';

// ============================================================
// AnomalyDetector
//
// Consumes RequestSpan events (emitted after each proxied request)
// and runs detection algorithms asynchronously — NOT on the hot path.
//
// Current state:
//   - Event bus wiring: COMPLETE
//   - Cost velocity spike detection: STUBBED (see TODO)
//   - Request rate spike detection: STUBBED
//   - Repeated block detection: STUBBED
//   - Webhook emission: COMPLETE (but no retry logic — see issue #15)
//   - Dead-letter queue for failed webhooks: NOT IMPLEMENTED
//
// Detection algorithms use sliding windows. The window implementation
// is intentionally left for the model to complete.
//
// ============================================================

export const requestBus = new EventEmitter();
requestBus.setMaxListeners(50);

// Window tracking state (per tenant)
interface TenantMetrics {
  // Sliding window entries: [timestamp, value]
  costWindow: Array<[number, number]>;        // [ts, costUsd]
  requestWindow: Array<[number, number]>;     // [ts, 1]
  blockWindow: Array<[number, number]>;       // [ts, 1]
}

const WINDOW_MS = 5 * 60 * 1000; // 5-minute sliding window
const COST_SPIKE_MULTIPLIER = 3.0; // alert if current window > 3x rolling avg
const BLOCK_THRESHOLD = 10;        // alert if >10 blocks in window

export class AnomalyDetector {
  private metrics: Map<string, TenantMetrics> = new Map();
  private alertWebhookUrl: string | null;
  private alertWebhookSecret: string | null;

  // Dead-letter queue for failed webhook deliveries
  // TODO: Implement retry with exponential backoff for items in this queue
  private deadLetterQueue: AnomalyEvent[] = [];

  constructor(webhookUrl?: string, webhookSecret?: string) {
    this.alertWebhookUrl = webhookUrl ?? null;
    this.alertWebhookSecret = webhookSecret ?? null;

    // Subscribe to request events
    requestBus.on('request:completed', (span: RequestSpan) => {
      this.onRequest(span).catch(err => {
        console.error('[AnomalyDetector] Error processing span:', err);
      });
    });
  }

  private getOrCreateMetrics(tenantId: string): TenantMetrics {
    if (!this.metrics.has(tenantId)) {
      this.metrics.set(tenantId, {
        costWindow: [],
        requestWindow: [],
        blockWindow: [],
      });
    }
    return this.metrics.get(tenantId)!;
  }

  private pruneWindow<T extends [number, unknown]>(window: T[], nowMs: number): T[] {
    return window.filter(([ts]) => nowMs - ts < WINDOW_MS);
  }

  private async onRequest(span: RequestSpan): Promise<void> {
    const now = Date.now();
    const m = this.getOrCreateMetrics(span.tenantId);

    // Update windows
    m.costWindow.push([now, span.tokenCount ? span.tokenCount * 0.000002 : 0]);
    m.requestWindow.push([now, 1]);
    if (span.policyVerdict === 'BLOCK') {
      m.blockWindow.push([now, 1]);
    }

    // Prune old entries
    m.costWindow = this.pruneWindow(m.costWindow, now);
    m.requestWindow = this.pruneWindow(m.requestWindow, now);
    m.blockWindow = this.pruneWindow(m.blockWindow, now);

    // Run detectors
    const anomalies = await Promise.all([
      this.detectCostVelocitySpike(span.tenantId, m, now),
      this.detectRequestRateSpike(span.tenantId, m, now),
      this.detectRepeatedBlocks(span.tenantId, m, now),
    ]);

    for (const anomaly of anomalies) {
      if (anomaly) {
        await this.emitAlert(anomaly);
      }
    }
  }

  // TODO: Implement cost velocity spike detection.
  //
  // Compare the sum of costWindow in the last WINDOW_MS
  // against a rolling baseline (average of previous N windows).
  //
  // The tricky part: we don't store historical windows yet.
  // For now, compare current window against a naive threshold:
  //   if total cost in window > config threshold → spike.
  //
  // A proper implementation would store per-tenant rolling averages
  // and compare current window sum against COST_SPIKE_MULTIPLIER * avg.
  //
  // Returns AnomalyEvent if spike detected, null otherwise.
  private async detectCostVelocitySpike(
    _tenantId: string,
    _metrics: TenantMetrics,
    _nowMs: number
  ): Promise<AnomalyEvent | null> {
    // TODO: Implement
    return null;
  }

  // TODO: Implement request rate spike detection.
  // Similar structure to cost spike but uses requestWindow.
  // Threshold: if requests in window > 2x the tenant's RPM config * (WINDOW_MS/60000).
  // Note: you'll need to look up the tenant's rate config here.
  private async detectRequestRateSpike(
    _tenantId: string,
    _metrics: TenantMetrics,
    _nowMs: number
  ): Promise<AnomalyEvent | null> {
    // TODO: Implement
    return null;
  }

  // TODO: Implement repeated block detection.
  // If blockWindow.length > BLOCK_THRESHOLD, emit a critical anomaly.
  // This likely indicates either misconfigured policy or active probing.
  private async detectRepeatedBlocks(
    _tenantId: string,
    _metrics: TenantMetrics,
    _nowMs: number
  ): Promise<AnomalyEvent | null> {
    // TODO: Implement
    return null;
  }

  private createAnomaly(
    type: AnomalyType,
    tenantId: string,
    severity: AnomalyEvent['severity'],
    metadata: Record<string, unknown>
  ): AnomalyEvent {
    return {
      id: uuidv4(),
      type,
      tenantId,
      severity,
      detectedAt: new Date(),
      metadata,
      acknowledged: false,
    };
  }

  private async emitAlert(anomaly: AnomalyEvent): Promise<void> {
    if (!this.alertWebhookUrl) {
      console.warn('[AnomalyDetector] No webhook URL configured, dropping alert:', anomaly);
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

      if (!response.ok) {
        // TODO: Instead of logging and dropping, add to deadLetterQueue
        // and schedule retry with exponential backoff.
        console.error('[AnomalyDetector] Webhook delivery failed:', response.status);
      }
    } catch (err) {
      // TODO: Add to deadLetterQueue instead of dropping
      console.error('[AnomalyDetector] Webhook error (alert dropped):', err);
    }
  }

  getDeadLetterQueue(): AnomalyEvent[] {
    return [...this.deadLetterQueue];
  }

  getMetricsSummary(tenantId: string): TenantMetrics | null {
    return this.metrics.get(tenantId) ?? null;
  }
}

let _detector: AnomalyDetector | null = null;

export function getAnomalyDetector(webhookUrl?: string, secret?: string): AnomalyDetector {
  if (!_detector) _detector = new AnomalyDetector(webhookUrl, secret);
  return _detector;
}

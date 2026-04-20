import { RequestSpan, PolicyAction } from '../types';

// ============================================================
// Observability — Structured Request Span Emitter
//
// Emits structured spans for every proxied request.
// Designed to be compatible with OpenTelemetry collectors
// but does NOT require one — falls back to stdout JSON.
//
// Current state:
//   - Stdout JSON logging: COMPLETE
//   - OpenTelemetry SDK integration: STUBBED
//     * Span creation hooks are in place but not wired to an exporter
//     * TODO: Wire OTEL_EXPORTER_OTLP_ENDPOINT from config
//   - Token count extraction from streaming responses: NOT IMPLEMENTED
//     * streamCompleted spans always report tokenCount: null
//   - Upstream latency is not yet separated from total latency
//     * upstreamLatencyMs is always null (see proxy/handler.ts)
//
// ============================================================

export interface SpanSummary {
  requestId: string;
  tenantId: string;
  verdict: PolicyAction;
  model: string | null;
  totalLatencyMs: number;
  upstreamLatencyMs: number | null;
  tokenCount: number | null;
  estimatedCostUsd: number | null;
  errorCode: string | null;
}

// Per-tenant aggregated metrics (rolling, in-memory)
interface TenantAggregates {
  totalRequests: number;
  blockedRequests: number;
  totalTokens: number;
  totalCostUsd: number;
  avgLatencyMs: number;
  lastRequestAt: Date | null;
}

export class ObservabilityCollector {
  private spans: RequestSpan[] = [];
  private aggregates: Map<string, TenantAggregates> = new Map();

  // Maximum spans to retain in memory before rolling
  private readonly maxSpans = 10_000;

  record(span: RequestSpan): void {
    // Rolling buffer
    if (this.spans.length >= this.maxSpans) {
      this.spans.shift();
    }
    this.spans.push(span);

    // Update aggregates
    this.updateAggregates(span);

    // Emit to stdout as structured JSON (production would send to OTEL collector)
    this.emit(span);
  }

  private updateAggregates(span: RequestSpan): void {
    const existing = this.aggregates.get(span.tenantId) ?? {
      totalRequests: 0,
      blockedRequests: 0,
      totalTokens: 0,
      totalCostUsd: 0,
      avgLatencyMs: 0,
      lastRequestAt: null,
    };

    existing.totalRequests += 1;
    if (span.policyVerdict === 'BLOCK') existing.blockedRequests += 1;
    if (span.tokenCount) existing.totalTokens += span.tokenCount;

    // Exponential moving average for latency (alpha = 0.1)
    existing.avgLatencyMs =
      existing.avgLatencyMs === 0
        ? span.latencyMs
        : 0.9 * existing.avgLatencyMs + 0.1 * span.latencyMs;

    existing.lastRequestAt = span.timestamp;

    this.aggregates.set(span.tenantId, existing);
  }

  private emit(span: RequestSpan): void {
    // TODO: Replace with OTEL span when exporter is configured
    const summary: SpanSummary = {
      requestId: span.requestId,
      tenantId: span.tenantId,
      verdict: span.policyVerdict,
      model: span.modelRoutedTo,
      totalLatencyMs: span.latencyMs,
      upstreamLatencyMs: span.upstreamLatencyMs,
      tokenCount: span.tokenCount,
      // TODO: Wire actual cost from token usage + model pricing table
      estimatedCostUsd: null,
      errorCode: span.errorCode,
    };

    // Structured log — picked up by log aggregators (Datadog, Loki, etc.)
    process.stdout.write(JSON.stringify({ level: 'info', event: 'request_span', ...summary }) + '\n');
  }

  getAggregates(tenantId: string): TenantAggregates | null {
    return this.aggregates.get(tenantId) ?? null;
  }

  getAllAggregates(): Record<string, TenantAggregates> {
    return Object.fromEntries(this.aggregates.entries());
  }

  // Returns last N spans for a tenant (for admin debug endpoint)
  getRecentSpans(tenantId: string, limit = 50): RequestSpan[] {
    return this.spans
      .filter(s => s.tenantId === tenantId)
      .slice(-limit);
  }

  // TODO: Implement getP99Latency(tenantId) using spans buffer
  // P99 = the latency value at the 99th percentile of recent requests
  getP99Latency(_tenantId: string): number | null {
    throw new Error('Not implemented: getP99Latency()');
  }
}

let _collector: ObservabilityCollector | null = null;

export function getCollector(): ObservabilityCollector {
  if (!_collector) _collector = new ObservabilityCollector();
  return _collector;
}

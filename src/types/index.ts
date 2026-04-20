// ============================================================
// Core domain types for the LLM Gateway
// These types define the contract between all subsystems.
// ============================================================

// ---- Tenant & Auth ----

export interface Tenant {
  id: string;
  name: string;
  apiKeys: string[];          // hashed API keys that map to this tenant
  policySetId: string;        // which PolicySet applies
  rateLimitConfig: RateLimitConfig;
  costConfig: CostConfig;
  createdAt: Date;
  active: boolean;
}

export interface RateLimitConfig {
  requestsPerMinute: number;
  requestsPerDay: number;
  burstAllowance: number;     // extra requests above RPM before hard block
}

export interface CostConfig {
  dailyCapUsd: number;
  monthlyCapUsd: number;
  alertThresholdPct: number;  // alert at this % of cap (e.g., 80)
}

// ---- Policy Engine ----

export type PolicyAction = 'ALLOW' | 'BLOCK' | 'CHALLENGE';

export type RuleType =
  | 'pii_detection'
  | 'content_filter'
  | 'cost_cap'
  | 'rate_limit'
  | 'model_restriction'
  | 'prompt_length';

export interface PolicyRule {
  id: string;
  type: RuleType;
  priority: number;           // lower = evaluated first
  action: PolicyAction;
  config: Record<string, unknown>;
  description: string;
  enabled: boolean;
}

export interface PolicySet {
  id: string;
  name: string;
  rules: PolicyRule[];        // MUST be sorted by priority before evaluation
  defaultAction: PolicyAction;
}

export interface PolicyVerdict {
  action: PolicyAction;
  reason: string;
  matchedRuleId: string | null;
  matchedRuleType: RuleType | null;
  evaluatedRules: number;     // how many rules ran before verdict
  latencyMs: number;
}

// ---- Routing ----

export type ModelProvider = 'openai' | 'anthropic' | 'google' | 'mistral';

export interface RouteTarget {
  provider: ModelProvider;
  model: string;
  baseUrl: string;
  priority: number;           // for fallback ordering
  healthScore: number;        // 0-1, updated by health checker
}

export interface RoutingDecision {
  selectedTarget: RouteTarget;
  fallbackTargets: RouteTarget[];
  reason: string;             // why this target was chosen
}

// ---- Request Lifecycle ----

export interface GatewayRequest {
  id: string;                 // UUID, generated at ingress
  tenantId: string;
  inboundAt: Date;
  originalModel: string;      // what the client asked for
  requestBody: OpenAIRequestBody;
  headers: Record<string, string>;
  streaming: boolean;
}

export interface GatewayResponse {
  requestId: string;
  verdict: PolicyVerdict;
  routing: RoutingDecision | null;   // null if BLOCK before routing
  upstream: UpstreamResult | null;
  totalLatencyMs: number;
  upstreamLatencyMs: number | null;
}

export interface UpstreamResult {
  statusCode: number;
  model: string;              // model actually used (may differ from requested)
  tokenUsage: TokenUsage | null;
  streamCompleted: boolean;
  error: string | null;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  estimatedCostUsd: number;
}

// ---- OpenAI-compatible request/response shapes ----

export interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface OpenAIRequestBody {
  model: string;
  messages: OpenAIMessage[];
  stream?: boolean;
  temperature?: number;
  max_tokens?: number;
  [key: string]: unknown;    // pass-through for other params
}

// ---- Anomaly Detection ----

export type AnomalyType =
  | 'cost_velocity_spike'
  | 'request_rate_spike'
  | 'repeated_policy_blocks'
  | 'unusual_token_usage'
  | 'auth_probing';

export interface AnomalyEvent {
  id: string;
  type: AnomalyType;
  tenantId: string;
  severity: 'low' | 'medium' | 'high' | 'critical';
  detectedAt: Date;
  metadata: Record<string, unknown>;
  acknowledged: boolean;
}

// ---- Observability ----

export interface RequestSpan {
  requestId: string;
  tenantId: string;
  modelRequested: string;
  modelRoutedTo: string | null;
  policyVerdict: PolicyAction;
  tokenCount: number | null;
  latencyMs: number;
  upstreamLatencyMs: number | null;
  streaming: boolean;
  errorCode: string | null;
  timestamp: Date;
}

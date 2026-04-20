import { GatewayRequest, RouteTarget, RoutingDecision, ModelProvider } from '../types';
import { getConfig } from '../config';

// ============================================================
// Router
//
// Selects an upstream target for a given GatewayRequest.
//
// Routing strategy (in priority order):
//   1. Model alias mapping (e.g., "gpt-4" → specific versioned model)
//   2. Tenant model restrictions (enforced separately by policy engine)
//   3. Provider health score (avoid degraded upstreams)
//   4. Cost optimization (cheapest capable model if tenant has cost routing enabled)
//
// Current state:
//   - Static target registry: COMPLETE
//   - Health score tracking: STUBBED (always returns 1.0)
//   - Alias resolution: COMPLETE
//   - Cost-optimized routing: NOT IMPLEMENTED
//   - Fallback chain selection: NOT IMPLEMENTED
//
// ============================================================

// Static registry of known model targets
// In production this would be loaded from config/database
const MODEL_REGISTRY: RouteTarget[] = [
  {
    provider: 'openai',
    model: 'gpt-4-turbo-preview',
    baseUrl: 'https://api.openai.com',
    priority: 1,
    healthScore: 1.0,
  },
  {
    provider: 'openai',
    model: 'gpt-3.5-turbo',
    baseUrl: 'https://api.openai.com',
    priority: 2,
    healthScore: 1.0,
  },
  {
    provider: 'anthropic',
    model: 'claude-3-sonnet-20240229',
    baseUrl: 'https://api.anthropic.com',
    priority: 3,
    healthScore: 1.0,
  },
];

// Maps common/alias model names to canonical model IDs
const MODEL_ALIASES: Record<string, string> = {
  'gpt-4': 'gpt-4-turbo-preview',
  'gpt-4-turbo': 'gpt-4-turbo-preview',
  'gpt-3.5': 'gpt-3.5-turbo',
  'claude-sonnet': 'claude-3-sonnet-20240229',
};

export class Router {
  // TODO: Implement selectTarget().
  //
  // Given a GatewayRequest:
  //   1. Resolve model alias (if present in MODEL_ALIASES)
  //   2. Find all targets in MODEL_REGISTRY that match the resolved model name
  //   3. If no exact match, fall back to same-provider alternatives sorted by priority
  //   4. Filter out targets with healthScore < 0.5
  //   5. Select primary target (highest priority = lowest priority number)
  //   6. Build fallback list from remaining candidates
  //   7. Return RoutingDecision
  //
  // If no viable target exists, throw an error — the caller handles this
  // and returns a 503 to the client.
  selectTarget(_request: GatewayRequest): RoutingDecision {
    throw new Error('Not implemented: Router.selectTarget()');
  }

  // Updates health score for a target after an upstream response
  // healthScore should decay toward 0 on errors and recover toward 1 on success
  // TODO: Implement exponential moving average update
  updateHealth(_provider: ModelProvider, _model: string, _success: boolean): void {
    // Not implemented
  }

  getRegistry(): RouteTarget[] {
    return [...MODEL_REGISTRY];
  }

  getHealthScore(provider: ModelProvider, model: string): number | null {
    const target = MODEL_REGISTRY.find(t => t.provider === provider && t.model === model);
    return target ? target.healthScore : null;
  }

  /** @internal Test-only hook. Prefer updateHealth() in production. */
  setHealthScoreForTest(provider: ModelProvider, model: string, score: number): void {
    const target = MODEL_REGISTRY.find(t => t.provider === provider && t.model === model);
    if (target) target.healthScore = score;
  }
}

let _router: Router | null = null;

export function getRouter(): Router {
  if (!_router) _router = new Router();
  return _router;
}

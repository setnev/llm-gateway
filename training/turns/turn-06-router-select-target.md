# Turn 6 of 13 — `Router.selectTarget()`

> This is the second critical-path turn. Implementing it unblocks all proxy integration tests.

**Target file**: `src/proxy/router.ts`
**Target symbol**: `Router.selectTarget()`
**Lines to replace**: 72–74

### Current stub

```typescript
selectTarget(_request: GatewayRequest): RoutingDecision {
  throw new Error('Not implemented: Router.selectTarget()');
}
```

### What to implement

Select the best upstream target for the given request.

Algorithm (follow in exact order):

1. **Resolve model alias**: look up `request.requestBody.model` in `MODEL_ALIASES`. If found, use the resolved canonical name; otherwise use the original model string.
2. **Find matching targets**: filter `MODEL_REGISTRY` to entries where `target.model === resolvedModel`.
3. **If no exact match**: fall back to all entries in `MODEL_REGISTRY` sorted by `priority` ascending (ignore provider). This handles requests for a model not in the registry by routing to the best available target.
4. **Filter unhealthy targets**: remove any candidate where `target.healthScore < 0.5`.
5. **If no viable targets remain**: throw an `Error` — the caller in `src/index.ts` catches this and returns 503.
6. **Sort remaining candidates** by `priority` ascending (lowest number = highest priority).
7. **Primary target**: `candidates[0]`.
8. **Fallback targets**: `candidates.slice(1)`.
9. **Return** a `RoutingDecision` with a human-readable `reason` string.

### Relevant types

```typescript
// from src/types/index.ts
export interface RouteTarget {
  provider: ModelProvider;   // 'openai' | 'anthropic' | 'google' | 'mistral'
  model: string;
  baseUrl: string;
  priority: number;          // lower number = higher priority
  healthScore: number;       // 0–1; updated by updateHealth()
}

export interface RoutingDecision {
  selectedTarget: RouteTarget;
  fallbackTargets: RouteTarget[];
  reason: string;
}

// From src/proxy/router.ts (already in scope)
const MODEL_REGISTRY: RouteTarget[] = [
  { provider: 'openai',    model: 'gpt-4-turbo-preview',      baseUrl: 'https://api.openai.com',    priority: 1, healthScore: 1.0 },
  { provider: 'openai',    model: 'gpt-3.5-turbo',            baseUrl: 'https://api.openai.com',    priority: 2, healthScore: 1.0 },
  { provider: 'anthropic', model: 'claude-3-sonnet-20240229', baseUrl: 'https://api.anthropic.com', priority: 3, healthScore: 1.0 },
];

const MODEL_ALIASES: Record<string, string> = {
  'gpt-4':        'gpt-4-turbo-preview',
  'gpt-4-turbo':  'gpt-4-turbo-preview',
  'gpt-3.5':      'gpt-3.5-turbo',
  'claude-sonnet':'claude-3-sonnet-20240229',
};
```

### Tests that must pass after this turn

Run: `npm run test:unit`

```
Router › selectTarget() › should resolve model alias "gpt-4" to "gpt-4-turbo-preview"
Router › selectTarget() › should resolve model alias "claude-sonnet" to correct Anthropic model
Router › selectTarget() › should select target with lowest priority number when multiple match
Router › selectTarget() › should populate fallbackTargets with remaining viable targets
Router › selectTarget() › should throw when no viable target exists for an unknown model
Router › selectTarget() › should exclude targets with healthScore below 0.5
Router › selectTarget() › should include a human-readable reason in the decision
```

### Acceptance criteria

```
decision.selectedTarget.model === 'gpt-4-turbo-preview'     for request.model === 'gpt-4'
decision.selectedTarget.provider === 'anthropic'            for request.model === 'claude-sonnet'
decision.selectedTarget.priority === 1                      lowest priority number wins
decision.fallbackTargets.length > 0                         at least one fallback
decision.fallbackTargets                                     does not include the primary
throws Error                                                for model 'llama-99-unknown'
decision.selectedTarget.model !== 'gpt-4-turbo-preview'     when its healthScore is set to 0.2
typeof decision.reason === 'string' && reason.length > 0
```

### Gotchas

- **Lower `priority` number = higher priority**. `priority: 1` beats `priority: 2`.
- The health-score test calls `router.setHealthScoreForTest('openai', 'gpt-4-turbo-preview', 0.2)` before calling `selectTarget()`. Your implementation must filter `healthScore < 0.5` from candidates.
- `MODEL_REGISTRY` is a `const` array but its elements are mutable objects. `setHealthScoreForTest()` already exists on the class and mutates the registry directly. Your `selectTarget()` reads `target.healthScore` from the same objects — no copying needed.
- When `gpt-4` is requested and `gpt-4-turbo-preview` is the only exact match but is unhealthy, the fallback should pick from remaining registry entries (e.g., `gpt-3.5-turbo`) — don't throw unless ALL candidates (including fallbacks) are below 0.5.
- `fallbackTargets` must not contain the same object reference as `selectedTarget`.

---

Output the complete, final content of `src/proxy/router.ts`. Do not truncate.

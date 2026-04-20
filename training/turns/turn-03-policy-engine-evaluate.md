# Turn 3 of 13 — PolicyEngine.evaluate()

> ⚠️ CRITICAL PATH. This turn unlocks all policy unit tests and all integration tests.
> Implement this before turns 1, 2, 4, 5.

**Target file**: `src/policy/engine.ts`
**Target symbol**: `PolicyEngine.evaluate()`
**Lines to replace**: 158–164

### Current stub

```typescript
async evaluate(
  _request: GatewayRequest,
  _policySetId: string,
  _context: EvaluationContext
): Promise<PolicyVerdict> {
  throw new Error('Not implemented: PolicyEngine.evaluate()');
}
```

### What to implement

Evaluate a `GatewayRequest` against the named `PolicySet` and return a `PolicyVerdict`.

Algorithm (follow in exact order):

1. Record `const start = Date.now()` at the top.
2. Look up the `PolicySet` by `policySetId` using `this.policySets.get(policySetId)`.
   - If not found: return a `PolicyVerdict` with `action: 'ALLOW'`, `reason: 'no_policy'`, `matchedRuleId: null`, `matchedRuleType: null`, `evaluatedRules: 0`, `latencyMs: Date.now() - start`.
3. Iterate `policySet.rules` **in array order** (already sorted by priority ascending at load time — do not re-sort here).
4. For each enabled rule, call `evaluators[rule.type](rule, request, context)`.
   - Increment `evaluatedRules` for every rule called, regardless of result.
   - If the evaluator returns a `PolicyAction` (non-null):
     - If the action is `'BLOCK'`: **immediately stop** — return a `PolicyVerdict` with that action, `reason: rule.description`, `matchedRuleId: rule.id`, `matchedRuleType: rule.type`, the current `evaluatedRules`, and `latencyMs`.
     - If the action is `'CHALLENGE'`: record it but **continue** evaluating — a later BLOCK can override.
   - If the evaluator returns `null`: continue to the next rule.
5. If iteration completes with no BLOCK: return `policySet.defaultAction` with `matchedRuleId: null`, `matchedRuleType: null`, the final `evaluatedRules`, and `latencyMs`.

**Do not catch errors thrown by evaluators.** If an evaluator throws (e.g., `cost_cap` and `rate_limit` are still stubs in early turns), let the error propagate — Fastify will return 500 and that is the correct grading signal until those stubs are implemented.

### Relevant types

```typescript
// from src/types/index.ts
export interface PolicyVerdict {
  action: PolicyAction;          // 'ALLOW' | 'BLOCK' | 'CHALLENGE'
  reason: string;
  matchedRuleId: string | null;
  matchedRuleType: RuleType | null;
  evaluatedRules: number;        // how many evaluators were called
  latencyMs: number;
}

export interface PolicyRule {
  id: string;
  type: RuleType;
  priority: number;
  action: PolicyAction;
  config: Record<string, unknown>;
  description: string;
  enabled: boolean;
}

// from src/policy/engine.ts (already in scope)
type RuleEvaluator = (
  rule: PolicyRule,
  request: GatewayRequest,
  context: EvaluationContext
) => Promise<PolicyAction | null>;

interface EvaluationContext {
  tenantDailySpendUsd: number;
  tenantRequestsThisMinute: number;
}
```

### Tests that must pass after this turn

Run: `npm run test:unit`

```
PolicyEngine › evaluate() — basic verdicts › should return ALLOW for a clean request against standard policy
PolicyEngine › evaluate() — basic verdicts › should return ALLOW when policySetId does not exist (no policy = allow)
PolicyEngine › evaluate() — short circuit on BLOCK › should BLOCK and stop evaluating after first BLOCK verdict
PolicyEngine › evaluate() — short circuit on BLOCK › should BLOCK immediately on cost_cap when over limit (priority 10 — first rule)
PolicyEngine › evaluate() — individual rule types › should BLOCK requests containing SSN patterns
PolicyEngine › evaluate() — individual rule types › should BLOCK requests to non-whitelisted models
PolicyEngine › evaluate() — individual rule types › should BLOCK requests exceeding prompt length limit
PolicyEngine › evaluate() — individual rule types › should BLOCK requests containing content filter keywords
PolicyEngine › evaluate() — latency tracking › should record non-zero latencyMs
```

> Note: the `cost_cap`, `model_restriction`, and `prompt_length` evaluators are still stubs.
> Tests that exercise those rules will remain failing until turns 4, 2, and 1 respectively.
> The two tests that MUST pass immediately are the `no_policy` test and the `pii_detection` / `content_filter` tests (those evaluators are already implemented).

### Acceptance criteria

```
verdict.action === 'ALLOW'          when no rule triggers
verdict.reason === 'no_policy'      when policySetId not found
verdict.matchedRuleId === null      when no rule triggers
verdict.evaluatedRules === 4        for SSN test (cost_cap=1, model_restriction=2, prompt_length=3, pii_detection=4 — then BLOCK, content_filter never runs)
verdict.evaluatedRules === 1        for cost_cap short-circuit test
verdict.latencyMs >= 0              always
```

### Gotchas

- `evaluatedRules` counts calls, not triggers. Every rule that is *called* increments the count, even if it returns `null`. The short-circuit test (`evaluatedRules: 1`) confirms only 1 evaluator ran — the one that immediately blocked.
- The `cost_cap` and `rate_limit` evaluators **throw** right now. If `evaluate()` is called against `policy_standard` with `tenantDailySpendUsd: 0`, the `cost_cap` rule runs first (priority 10) and throws. That means the SSN test and the clean-request ALLOW test will FAIL until turns 4 and 5 are complete. That is expected and correct — do not work around it by skipping rules that throw.
- `'CHALLENGE'` does not short-circuit. Keep a local `challengeVerdict` variable; if no BLOCK is hit but a CHALLENGE was seen, return CHALLENGE at the end.
- Return the `rule.description` string as `reason` when a rule triggers — not a hardcoded string.

---

Output the complete, final content of `src/policy/engine.ts`. Do not truncate.

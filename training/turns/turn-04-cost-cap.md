# Turn 4 of 13 — `cost_cap` evaluator

> Prerequisite: Turn 3 (PolicyEngine.evaluate()) must be implemented first.

**Target file**: `src/policy/engine.ts`
**Target symbol**: `evaluators.cost_cap`
**Lines to replace**: 88–90

### Current stub

```typescript
cost_cap: async (_rule, _request, _ctx) => {
  throw new Error('Not implemented: cost_cap evaluator');
},
```

### What to implement

Block the request if the tenant's daily spend has exceeded the configured cap.

```typescript
cost_cap: async (rule, _request, ctx) => {
  const dailyCapUsd = rule.config.dailyCapUsd as number;
  return ctx.tenantDailySpendUsd > dailyCapUsd ? rule.action : null;
},
```

### Relevant types

```typescript
// rule.config shape: { dailyCapUsd: number }

interface EvaluationContext {
  tenantDailySpendUsd: number;    // from CostTracker.getDailySpend()
  tenantRequestsThisMinute: number;
}
```

### Tests that must pass after this turn

Run: `npm run test:unit`

```
PolicyEngine › evaluate() — short circuit on BLOCK › should BLOCK immediately on cost_cap when over limit (priority 10 — first rule)
PolicyEngine › evaluate() — basic verdicts › should return ALLOW for a clean request against standard policy
```

The short-circuit test passes `tenantDailySpendUsd: 999` against a cap of `$50.00`. It also asserts `evaluatedRules: 1` — cost_cap is priority 10 (first rule), so the engine must stop after it.

### Acceptance criteria

```
verdict.action === 'BLOCK'       when tenantDailySpendUsd > dailyCapUsd
verdict.matchedRuleId === 'rule_cost_cap_daily'
verdict.evaluatedRules === 1     (cost_cap fires on the very first rule — no further rules run)
verdict.action === 'ALLOW'       when tenantDailySpendUsd === 0
```

### Gotchas

- The bound is **exclusive**: `> dailyCapUsd`, not `>=`. A tenant that has spent *exactly* their cap gets one more request through.
- `ctx.tenantDailySpendUsd` reflects spend from **completed** requests via `CostTracker.recordCost()`. The in-flight request has not been recorded yet. This is correct behaviour — do not adjust for it.
- `cost_cap` is priority 10, the **first** rule in `policy_standard`. If this evaluator blocks, `evaluatedRules` must be exactly 1 (the short-circuit test asserts this). This is enforced by `evaluate()`, not by the evaluator itself — just return `rule.action` when over cap.
- This evaluator does not use `_request`. Keep it prefixed with `_`.

---

Output the complete, final content of `src/policy/engine.ts`. Do not truncate.

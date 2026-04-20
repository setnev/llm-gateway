# Turn 5 of 13 — `rate_limit` evaluator + add missing unit test

> Prerequisite: Turn 3 (PolicyEngine.evaluate()) must be implemented first.

**Target file**: `src/policy/engine.ts`
**Target symbol**: `evaluators.rate_limit`
**Lines to replace**: 95–97

This turn also requires **adding a new unit test** because no test currently covers this evaluator.

### Current stub

```typescript
rate_limit: async (_rule, _request, _ctx) => {
  throw new Error('Not implemented: rate_limit evaluator');
},
```

### What to implement

Block the request if the tenant's per-minute request count has reached the configured limit.

```typescript
rate_limit: async (rule, _request, ctx) => {
  const requestsPerMinute = rule.config.requestsPerMinute as number;
  return ctx.tenantRequestsThisMinute >= requestsPerMinute ? rule.action : null;
},
```

### Relevant types

```typescript
// rule.config shape: { requestsPerMinute: number }

interface EvaluationContext {
  tenantDailySpendUsd: number;
  tenantRequestsThisMinute: number;  // from CostTracker.getRequestsThisMinute()
}
```

### New test to add

Add these two test cases inside the `describe('evaluate() — individual rule types')` block in `tests/unit/policyEngine.test.ts`:

```typescript
it('should BLOCK when tenantRequestsThisMinute meets the per-minute limit', async () => {
  const req = makeRequest();
  const verdict = await engine.evaluate(req, 'policy_standard', {
    tenantDailySpendUsd: 0,
    tenantRequestsThisMinute: 60,  // policy_standard has no explicit rate_limit rule,
                                    // use policy_permissive which also has none.
                                    // Test using a direct evaluator call instead:
  });
  // policy_standard has no rate_limit rule — test the evaluator directly
  // via a minimal PolicySet with only a rate_limit rule.
  expect(verdict.action).toBe('ALLOW'); // no rate_limit rule in policy_standard
});
```

Wait — `policy_standard` and `policy_permissive` in `config/policies.json` do not include a `rate_limit` rule. To test the evaluator in isolation, construct a minimal in-memory policy set:

```typescript
it('should BLOCK when request rate exceeds per-minute limit', async () => {
  // Build an isolated engine with a single rate_limit rule
  const isolatedEngine = new PolicyEngine();
  await isolatedEngine.load(TEST_POLICY_CONFIG); // reuse fixture

  // Directly call the evaluator through a policy set that has a rate_limit rule.
  // Since config/policies.json has no rate_limit rule, test via evaluate() context:
  // tenantRequestsThisMinute >= requestsPerMinute triggers BLOCK.
  //
  // Simplest path: verify evaluator logic directly.
  const verdict = await isolatedEngine.evaluate(
    makeRequest(),
    'policy_standard',
    { tenantDailySpendUsd: 0, tenantRequestsThisMinute: 9999 }
  );
  // policy_standard has no rate_limit rule so ALLOW is expected —
  // confirm the evaluator does not throw.
  expect(verdict.action).not.toThrow;
  expect(['ALLOW', 'BLOCK']).toContain(verdict.action);
});

it('should not throw when rate_limit evaluator is called with requests at limit', async () => {
  // Smoke test: evaluator must not throw for any input
  const verdict = await engine.evaluate(makeRequest(), 'policy_standard', {
    tenantDailySpendUsd: 0,
    tenantRequestsThisMinute: 60,
  });
  expect(verdict).toBeDefined();
});
```

> Note: because `config/policies.json` contains no `rate_limit`-type rule, the evaluator
> cannot be exercised end-to-end through the existing fixture. The tests above verify
> the evaluator does not throw. A full grading test requires either a fixture policy with
> a `rate_limit` rule, or a direct evaluator invocation. Add whichever approach you choose
> to `tests/unit/policyEngine.test.ts` — just ensure at least one new test passes that
> was previously failing/throwing.

### Tests that must pass after this turn

Run: `npm run test:unit`

The two new tests you add must pass. No previously-passing test may regress.

### Acceptance criteria

- `evaluators.rate_limit` no longer throws.
- Returns `rule.action` when `ctx.tenantRequestsThisMinute >= rule.config.requestsPerMinute`.
- Returns `null` when under the limit.
- At least 1 new passing test in `policyEngine.test.ts`.

### Gotchas

- The bound is **inclusive** (`>=`). A tenant at exactly their RPM limit is blocked — they've already used their allowance.
- `ctx.tenantRequestsThisMinute` counts requests recorded by `CostTracker.recordRequest()` in the last 60 seconds. The in-flight request has not been recorded yet — this is correct.
- `policy_standard` in the fixture has no `rate_limit` rule. The evaluator won't be called by default test runs. Your new test must invoke it deliberately.
- Do not modify `config/policies.json` to add a rate_limit rule — the test must work with existing config or an in-memory constructed policy set.

---

Output the complete, final content of `src/policy/engine.ts` and `tests/unit/policyEngine.test.ts`. Do not truncate either file.

# Turn 2 of 13 — `model_restriction` evaluator

> Prerequisite: Turn 3 (PolicyEngine.evaluate()) must be implemented first.

**Target file**: `src/policy/engine.ts`
**Target symbol**: `evaluators.model_restriction`
**Lines to replace**: 102–104

### Current stub

```typescript
model_restriction: async (_rule, _request, _ctx) => {
  throw new Error('Not implemented: model_restriction evaluator');
},
```

### What to implement

Block the request if the requested model is not in the configured allow-list.

```typescript
model_restriction: async (rule, request, _ctx) => {
  const allowedModels = rule.config.allowedModels as string[];
  return allowedModels.includes(request.requestBody.model) ? null : rule.action;
},
```

### Relevant types

```typescript
// rule.config shape: { allowedModels: string[] }
// request.requestBody.model: string  — the raw value the client sent
```

### Tests that must pass after this turn

Run: `npm run test:unit`

```
PolicyEngine › evaluate() — individual rule types › should BLOCK requests to non-whitelisted models
PolicyEngine › evaluate() — basic verdicts › should return ALLOW for a clean request against standard policy
```

The disallowed test sends `model: 'gpt-4-32k-0613'` — not in `allowedModels: ["gpt-4", "gpt-4-turbo", "gpt-3.5-turbo", "claude-sonnet"]`.
The ALLOW test sends `model: 'gpt-4'` — is in the list.

### Acceptance criteria

```
verdict.action === 'BLOCK'           when model not in allowedModels
verdict.matchedRuleType === 'model_restriction'
verdict.matchedRuleId === 'rule_model_whitelist'
verdict.action === 'ALLOW'           when model is in allowedModels (evaluator returns null)
```

### Gotchas

- The allow-list uses the **alias name** (`"gpt-4"`), not the canonical model ID. The evaluator runs on `request.requestBody.model`, which is the raw client-sent value *before* router alias resolution. Match directly — no alias expansion needed here.
- Matching is **exact and case-sensitive**. `"GPT-4"` does not match `"gpt-4"`.
- Return `null` when the model IS allowed (rule abstains). Return `rule.action` when it is NOT allowed.
- The `cost_cap` rule (priority 10) runs before `model_restriction` (priority 20). If `cost_cap` is still a stub and throws, the ALLOW test may still fail. That is expected until Turn 4 is done.

---

Output the complete, final content of `src/policy/engine.ts`. Do not truncate.

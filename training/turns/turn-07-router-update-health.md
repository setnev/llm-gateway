# Turn 7 of 13 — `Router.updateHealth()`

> Prerequisite: Turn 6 (Router.selectTarget()) should be implemented first so you can
> verify the health filter works end-to-end after this turn.

**Target file**: `src/proxy/router.ts`
**Target symbol**: `Router.updateHealth()`
**Lines to replace**: 79–81

### Current stub

```typescript
updateHealth(_provider: ModelProvider, _model: string, _success: boolean): void {
  // Not implemented
}
```

### What to implement

Update the `healthScore` of a registry target using exponential decay on failure and recovery on success.

The formula must bring a score of `1.0` below `0.5` after **3 consecutive failures** (the unit test asserts this). Use a decay multiplier on failure and recovery on success:

```typescript
updateHealth(provider: ModelProvider, model: string, success: boolean): void {
  const target = MODEL_REGISTRY.find(
    t => t.provider === provider && t.model === model
  );
  if (!target) return;

  if (success) {
    target.healthScore = Math.min(1.0, target.healthScore + 0.2);
  } else {
    target.healthScore = target.healthScore * 0.4;
  }
}
```

With `multiplier = 0.4`: after 3 failures starting from `1.0`:
- After 1: `1.0 × 0.4 = 0.4` ✓ (already below 0.5)

You may choose any formula that satisfies: **3 consecutive failures from score 1.0 → score < 0.5**.

### Tests that must pass after this turn

Run: `npm run test:unit`

```
Router › selectTarget() › updateHealth() should decay healthScore below 0.5 on repeated failures
```

### Acceptance criteria

```
After router.updateHealth('openai', 'gpt-4-turbo-preview', false) × 3:
  router.getHealthScore('openai', 'gpt-4-turbo-preview') < 0.5
```

Score must be non-null and strictly less than 0.5.

### Gotchas

- The test calls `router.setHealthScoreForTest('openai', 'gpt-4-turbo-preview', 1.0)` before the update calls to reset to a known state. Your `updateHealth()` reads from the same mutable `MODEL_REGISTRY` entries as `setHealthScoreForTest()` — no copying.
- `Math.min(1.0, ...)` on success prevents the score from exceeding 1.0.
- The test **only** asserts the score after 3 failures. It does not test recovery. Implement recovery logic anyway (for production correctness) but it won't be graded in this turn.
- Do not accidentally use `0.8` as the decay factor. `1.0 × 0.8 × 0.8 × 0.8 = 0.512` — still above 0.5. Use `≤ 0.7` or a flat penalty.

---

Output the complete, final content of `src/proxy/router.ts`. Do not truncate.

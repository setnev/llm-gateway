# Turn 1 of 13 — `prompt_length` evaluator

> Prerequisite: Turn 3 (PolicyEngine.evaluate()) must be implemented first.
> Without evaluate(), this evaluator cannot be graded — the unit tests call evaluate() which will throw.

**Target file**: `src/policy/engine.ts`
**Target symbol**: `evaluators.prompt_length`
**Lines to replace**: 109–111

### Current stub

```typescript
prompt_length: async (_rule, _request, _ctx) => {
  throw new Error('Not implemented: prompt_length evaluator');
},
```

### What to implement

Block the request if the total character count of all message content fields exceeds the configured maximum.

```typescript
prompt_length: async (rule, request, _ctx) => {
  const maxChars = rule.config.maxChars as number;
  const total = request.requestBody.messages.reduce(
    (sum, m) => sum + m.content.length, 0
  );
  return total > maxChars ? rule.action : null;
},
```

### Relevant types

```typescript
// rule.config shape: { maxChars: number }

// request.requestBody.messages:
interface OpenAIMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}
```

### Tests that must pass after this turn

Run: `npm run test:unit`

```
PolicyEngine › evaluate() — individual rule types › should BLOCK requests exceeding prompt length limit
```

The test sends `'a'.repeat(100001)` as message content against `policy_standard` which has `maxChars: 100000`.

### Acceptance criteria

```
verdict.action === 'BLOCK'
verdict.matchedRuleType === 'prompt_length'
verdict.matchedRuleId === 'rule_prompt_length'
```

A request with exactly 100,000 chars must ALLOW. A request with 100,001 chars must BLOCK.

### Gotchas

- Sum across **all messages** — system + user + assistant. Don't only check the last message.
- The bound is **exclusive**: `> maxChars`, not `>= maxChars`. `100000 > 100000` is false → ALLOW. `100001 > 100000` is true → BLOCK.
- Return `null` (not `'ALLOW'`) when the length is within limits. `null` means "this rule abstains".
- The evaluator receives `_ctx` — the context is unused for this rule type. Keep it prefixed with `_` to satisfy the linter.

---

Output the complete, final content of `src/policy/engine.ts`. Do not truncate.

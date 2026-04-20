# Turn Test — User Prompt Template

> One instance of this template is sent as the USER message per turn.
> Replace all `{{PLACEHOLDERS}}` before sending.
> The SYSTEM message (TURN_PROMPT_SYSTEM.md) is always prepended.

---

## Turn {{TURN_NUMBER}} of 13 — {{TURN_TITLE}}

**Target file**: `{{FILE_PATH}}`
**Target symbol**: `{{SYMBOL_NAME}}`
**Lines to replace**: {{START_LINE}}–{{END_LINE}}

### Current stub

```typescript
{{STUB_CODE}}
```

### What to implement

{{ALGORITHM_DESCRIPTION}}

### Config / type shapes

```typescript
{{RELEVANT_TYPES}}
```

### Tests that must pass after this turn

Run: `npm run {{TEST_COMMAND}}`

```
{{EXPECTED_TEST_NAMES}}
```

### Acceptance criteria

{{ACCEPTANCE_CRITERIA}}

### Gotchas

{{GOTCHAS}}

---

Implement the stub. Output only the final content of `{{FILE_PATH}}` — the complete file, untruncated. Do not output any other files unless the turn prompt says to add a new test file.

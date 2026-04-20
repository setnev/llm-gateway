# Turn 9 of 13 — Streaming token extraction (Issue #19)

> Prerequisite: Turn 6 (Router.selectTarget()) must be implemented so the proxy path is reachable.

**Target file**: `src/proxy/handler.ts`
**Target symbol**: `handleStreamingResponse()` — the SSE read loop and the returned `UpstreamResult`
**Lines to modify**: 145–176

This turn also requires **adding a new unit test file** `tests/unit/streamingTokens.test.ts`.

### Current gap

```typescript
// TODO: Parse SSE chunks to extract token usage from the final [DONE] chunk.
// Currently, streaming responses always report null tokenUsage.
return {
  statusCode: 200,
  model: req.requestBody.model,
  tokenUsage: null,   // ← always null
  streamCompleted: true,
  error: null,
};
```

### What to implement

While piping SSE chunks, watch for the final data chunk that contains `"usage"` before `[DONE]`. Parse it and populate `tokenUsage` in the returned `UpstreamResult`.

OpenAI sends token usage on the last data chunk before `[DONE]`:
```
data: {"id":"x","choices":[...],"usage":{"prompt_tokens":10,"completion_tokens":5,"total_tokens":15}}\n\n
data: [DONE]\n\n
```

Modified loop:

```typescript
let tokenUsage: TokenUsage | null = null;

// eslint-disable-next-line no-constant-condition
while (true) {
  const { done, value } = await reader.read();
  if (done) break;

  const chunk = decoder.decode(value, { stream: true });
  reply.raw.write(chunk);

  // Parse each SSE line for usage data
  for (const line of chunk.split('\n')) {
    if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
    try {
      const json = JSON.parse(line.slice(6)) as {
        usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
        model?: string;
      };
      if (json.usage) {
        tokenUsage = {
          promptTokens: json.usage.prompt_tokens,
          completionTokens: json.usage.completion_tokens,
          totalTokens: json.usage.total_tokens,
          estimatedCostUsd: estimateCost(json.model ?? req.requestBody.model, json.usage.total_tokens),
        };
      }
    } catch {
      // Non-JSON SSE lines (comments, keep-alives) are ignored
    }
  }
}

reply.raw.end();

return {
  statusCode: 200,
  model: req.requestBody.model,
  tokenUsage,
  streamCompleted: true,
  error: null,
};
```

### New test file to add: `tests/unit/streamingTokens.test.ts`

```typescript
import { Readable } from 'stream';

// Test the token extraction logic in isolation.
// We extract the parsing logic by invoking it through the handler
// or by testing the logic directly.

describe('Streaming token extraction', () => {
  it('should extract token usage from the final SSE chunk', () => {
    const lines = [
      'data: {"id":"1","choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: {"id":"1","choices":[{"delta":{}}],"usage":{"prompt_tokens":5,"completion_tokens":2,"total_tokens":7}}\n\n',
      'data: [DONE]\n\n',
    ];

    let tokenUsage = null;
    for (const line of lines.join('').split('\n')) {
      if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
      try {
        const json = JSON.parse(line.slice(6));
        if (json.usage) {
          tokenUsage = {
            promptTokens: json.usage.prompt_tokens,
            completionTokens: json.usage.completion_tokens,
            totalTokens: json.usage.total_tokens,
          };
        }
      } catch { /* ignore */ }
    }

    expect(tokenUsage).not.toBeNull();
    expect(tokenUsage!.totalTokens).toBe(7);
    expect(tokenUsage!.promptTokens).toBe(5);
    expect(tokenUsage!.completionTokens).toBe(2);
  });

  it('should return null tokenUsage when no usage field is present', () => {
    const lines = [
      'data: {"id":"1","choices":[{"delta":{"content":"Hi"}}]}\n\n',
      'data: [DONE]\n\n',
    ];

    let tokenUsage = null;
    for (const line of lines.join('').split('\n')) {
      if (!line.startsWith('data: ') || line.includes('[DONE]')) continue;
      try {
        const json = JSON.parse(line.slice(6));
        if (json.usage) tokenUsage = json.usage;
      } catch { /* ignore */ }
    }

    expect(tokenUsage).toBeNull();
  });
});
```

### Tests that must pass after this turn

Run: `npm run test:unit`

```
Streaming token extraction › should extract token usage from the final SSE chunk
Streaming token extraction › should return null tokenUsage when no usage field is present
```

### Acceptance criteria

- `upstreamResult.tokenUsage.totalTokens === 7` when usage chunk is present in stream.
- `upstreamResult.tokenUsage === null` when no usage field appears in any chunk.
- All previously-passing tests continue to pass.
- Streaming still works end-to-end (integration test for SSE must still pass).

### Gotchas

- SSE chunks may be split across `reader.read()` calls. The line-by-line split inside the loop handles partial chunks by checking `line.startsWith('data: ')` — lines without the prefix are ignored, so partial lines that don't start with `data: ` are safely skipped.
- Not all providers send `usage` in the stream. The code must not throw when `usage` is absent.
- `try/catch` around `JSON.parse` is mandatory — some SSE lines are not JSON (e.g., `: keep-alive`).
- Keep the `// eslint-disable-next-line no-constant-condition` comment above `while (true)`.

---

Output the complete, final content of `src/proxy/handler.ts` and `tests/unit/streamingTokens.test.ts`. Do not truncate either file.

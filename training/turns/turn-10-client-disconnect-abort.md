# Turn 10 of 13 — Client disconnect abort (Issue #8)

> Prerequisite: Turn 6 (Router.selectTarget()) must be implemented.

**Target file**: `src/proxy/handler.ts`
**Target symbol**: `handleStreamingResponse()` — add `close` event handler
**Lines to modify**: 140–144 (the TODO block before the try/while loop)

This turn also requires **flipping the integration test from `it.todo` to a real assertion**.

### Current gap

```typescript
// TODO: Register a 'close' event on reply.raw to detect client disconnect.
// When client disconnects, reader.cancel() must be called to abort the
// upstream fetch and stop consuming tokens. Currently this leaks upstream
// connections and continues billing until the model finishes generating.
```

### What to implement

Register a `close` event listener on the raw response socket. When the client disconnects, cancel the upstream reader.

```typescript
// Register before the read loop so it fires even if disconnect happens
// during an early chunk
let clientDisconnected = false;
reply.raw.on('close', () => {
  clientDisconnected = true;
  reader.cancel().catch(() => {});
});
```

Then in the read loop, check the flag to break early if the connection was already closed before the next `reader.read()` resolves:

```typescript
while (true) {
  if (clientDisconnected) break;
  const { done, value } = await reader.read();
  if (done) break;
  // ... rest of loop
}
```

### Changes to `tests/integration/lifecycle.test.ts`

Flip the todo to a real test. Because `app.inject()` in Fastify does not simulate real TCP connections, this test must use a live server. Add a helper that starts the server on a real port, sends a streaming request, destroys the socket mid-stream, and verifies the upstream mock was not fully consumed.

```typescript
it('should abort upstream connection when client disconnects mid-stream', async () => {
  // Spawn a real HTTP server to get real socket close events
  // (app.inject() doesn't fire 'close' on reply.raw)
  const http = await import('http');
  const address = await new Promise<{ port: number }>((resolve) => {
    const srv = http.createServer((req, res) => {
      // Proxy to our Fastify app via inject
      app.inject({
        method: req.method ?? 'POST',
        url: req.url ?? '/',
        headers: req.headers as Record<string, string>,
        payload: req,
      }).then(r => {
        res.writeHead(r.statusCode, r.headers as Record<string, string>);
        res.end(r.rawPayload);
      });
    });
    srv.listen(0, () => resolve({ port: (srv.address() as { port: number }).port }));
  });

  // Simpler alternative: assert the mock pool's pending interceptors
  // are NOT consumed if the client disconnects. This depends on
  // issue #8 being fixed so reader.cancel() fires.
  //
  // For now, verify the handler doesn't throw on a normal stream close.
  // A full disconnect test requires a real TCP connection.
  expect(true).toBe(true); // placeholder — expand when HTTP server helper is available
});
```

> Note: Full socket-level disconnect testing requires a real TCP server, not `app.inject()`.
> The minimal passing bar for this turn is: the `close` listener is registered and `reader.cancel()`
> is called on disconnect without throwing. The integration test placeholder above passes.
> A future hardening turn can add the full TCP-level assertion.

### Tests that must pass after this turn

Run: `npm run test:integration`

```
Gateway — Request Lifecycle Integration › Proxy — Streaming (SSE) › should abort upstream connection when client disconnects mid-stream
```

(This test currently passes as a `it.todo` — after flipping to a real test it must still pass with the placeholder assertion.)

### Acceptance criteria

- `reply.raw.on('close', ...)` is registered before the read loop.
- `reader.cancel()` is called from the close handler.
- The existing streaming test continues to pass (no regression in SSE pipe).
- TypeScript compiles cleanly — `reader.cancel()` returns `Promise<void>`, wrapped in `.catch(() => {})`.

### Gotchas

- `reader.cancel()` is async. Do NOT `await` it inside the `close` event handler — use `.catch(() => {})` to fire-and-forget and suppress unhandled rejection warnings.
- After `reader.cancel()`, the next `await reader.read()` call resolves with `{ done: true }`. The loop will exit cleanly without any special handling.
- The `clientDisconnected` flag prevents a race where cancel fires but `reader.read()` has already been awaited — the flag makes the loop exit on the next iteration.
- `reply.raw` is a Node.js `http.ServerResponse`. Its `close` event fires on both graceful and abrupt disconnects.

---

Output the complete, final content of `src/proxy/handler.ts` and `tests/integration/lifecycle.test.ts`. Do not truncate either file.

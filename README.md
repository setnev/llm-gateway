# llm-gateway

A production-grade, multi-tenant LLM API gateway with policy enforcement, intelligent routing, and anomaly detection.

Drop-in compatible with the OpenAI API spec — point any OpenAI SDK at this gateway instead of `api.openai.com`.

## Status

> **Active development.** Core proxy and policy framework are scaffolded. Several subsystems have incomplete implementations — see [ARCHITECTURE.md](./ARCHITECTURE.md) for the full status table and open issues.

## What it does

```
Your App → llm-gateway → OpenAI / Anthropic / Mistral
```

- **Multi-tenant**: Each API key maps to a tenant with isolated policy, rate limits, and cost caps
- **Policy engine**: Rule-based enforcement (PII detection, content filtering, model restrictions, cost caps) with priority-ordered evaluation and short-circuit on block
- **Intelligent routing**: Model alias resolution, health-weighted upstream selection, fallback chains
- **Anomaly detection**: Sliding-window analysis of cost velocity, request rate spikes, and repeated policy violations — async alerts via webhook
- **Observability**: Structured request spans with per-tenant aggregates, OpenTelemetry-compatible

## Quick Start

```bash
git clone https://github.com/your-org/llm-gateway
cd llm-gateway
cp .env.example .env    # set ADMIN_API_KEY

npm install
npm run dev             # starts on :8080
```

Then point your client at `http://localhost:8080` instead of `https://api.openai.com`:

```python
from openai import OpenAI

client = OpenAI(
    api_key="your-tenant-api-key",
    base_url="http://localhost:8080/v1"
)
```

## Architecture

See [ARCHITECTURE.md](./ARCHITECTURE.md) for:
- Full request lifecycle diagram
- Module status table (what's implemented vs. stubbed)
- Open issues with reproduction steps
- Configuration reference

## Development

```bash
npm run dev           # TypeScript watch mode
npm run test:unit     # Unit tests (policy engine, rate limiter, router)
npm run test:integration  # Integration tests (mocked upstream)
npm run typecheck     # Type check without emit
```

## Open Issues

| # | Component | Description |
|---|-----------|-------------|
| #8 | `proxy/handler.ts` | Client disconnect doesn't abort upstream stream |
| #12 | `tenant/rateLimiter.ts` | In-memory bucket breaks under multi-instance deployment |
| #15 | `anomaly/detector.ts` | Webhook alerts dropped on failure, no retry |
| #19 | `proxy/handler.ts` | Token usage not extracted from streaming responses |
| #22 | `src/index.ts` | `buildApp()` not exported, blocks integration tests |

## Contributing

1. Check [ARCHITECTURE.md](./ARCHITECTURE.md) for implementation status
2. Pick an open issue or unimplemented stub (marked with `throw new Error('Not implemented: ...')`)
3. Tests are spec-first — make the failing tests pass
4. Run `npm run typecheck` before opening a PR

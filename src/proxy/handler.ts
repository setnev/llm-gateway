import { FastifyRequest, FastifyReply } from 'fastify';
import { GatewayRequest, GatewayResponse, RoutingDecision, UpstreamResult, TokenUsage } from '../types';
import { getConfig } from '../config';

// ============================================================
// ProxyHandler
//
// Forwards validated, policy-cleared requests to upstream LLM APIs.
//
// Handles both streaming (SSE) and non-streaming responses.
//
// Current state:
//   - Non-streaming proxy: COMPLETE
//   - SSE streaming passthrough: PARTIALLY COMPLETE
//     * Data forwarding works
//     * TODO: Client disconnect handling is NOT implemented.
//       If the client drops, the upstream request continues
//       consuming tokens and costing money. See issue #8.
//     * TODO: Token counting from stream is not implemented —
//       usage stats on streaming responses are always null.
//   - Fallback routing on upstream error: NOT IMPLEMENTED
//
// ============================================================

const OPENAI_CHAT_PATH = '/v1/chat/completions';

export async function proxyRequest(
  gatewayReq: GatewayRequest,
  routing: RoutingDecision,
  reply: FastifyReply
): Promise<UpstreamResult> {
  const target = routing.selectedTarget;
  const upstreamUrl = `${target.baseUrl}${OPENAI_CHAT_PATH}`;
  const upstreamStart = Date.now();

  // Get the original Authorization header to forward to upstream
  const authHeader = gatewayReq.headers['authorization'];
  if (!authHeader) {
    throw new Error('Missing authorization header — cannot proxy to upstream');
  }

  const fetchHeaders: Record<string, string> = {
    'Content-Type': 'application/json',
    'Authorization': authHeader,
    'X-Gateway-Request-Id': gatewayReq.id,
  };

  // Anthropic uses a different auth header
  if (target.provider === 'anthropic') {
    fetchHeaders['x-api-key'] = authHeader.replace('Bearer ', '');
    fetchHeaders['anthropic-version'] = '2023-06-01';
    delete fetchHeaders['Authorization'];
  }

  const upstreamResponse = await fetch(upstreamUrl, {
    method: 'POST',
    headers: fetchHeaders,
    body: JSON.stringify(gatewayReq.requestBody),
  });

  const upstreamLatencyMs = Date.now() - upstreamStart;

  if (!upstreamResponse.ok) {
    const errorBody = await upstreamResponse.text();
    reply.status(upstreamResponse.status).send(errorBody);
    return {
      statusCode: upstreamResponse.status,
      model: gatewayReq.requestBody.model,
      tokenUsage: null,
      streamCompleted: false,
      error: `Upstream error ${upstreamResponse.status}: ${errorBody.slice(0, 200)}`,
    };
  }

  if (gatewayReq.streaming) {
    return handleStreamingResponse(upstreamResponse, reply, gatewayReq, upstreamLatencyMs);
  } else {
    return handleNonStreamingResponse(upstreamResponse, reply, gatewayReq);
  }
}

// ---- Non-streaming response handler ----

async function handleNonStreamingResponse(
  upstream: Response,
  reply: FastifyReply,
  req: GatewayRequest
): Promise<UpstreamResult> {
  const body = await upstream.json() as {
    model?: string;
    usage?: { prompt_tokens: number; completion_tokens: number; total_tokens: number };
  };

  let tokenUsage: TokenUsage | null = null;
  if (body.usage) {
    tokenUsage = {
      promptTokens: body.usage.prompt_tokens,
      completionTokens: body.usage.completion_tokens,
      totalTokens: body.usage.total_tokens,
      estimatedCostUsd: estimateCost(body.model ?? req.requestBody.model, body.usage.total_tokens),
    };
  }

  reply.status(200).send(body);

  return {
    statusCode: 200,
    model: body.model ?? req.requestBody.model,
    tokenUsage,
    streamCompleted: true,
    error: null,
  };
}

// ---- Streaming (SSE) response handler ----
//
// Pipes the upstream SSE stream to the client.
// Known gap: does not handle client disconnection.

async function handleStreamingResponse(
  upstream: Response,
  reply: FastifyReply,
  req: GatewayRequest,
  _upstreamLatencyMs: number
): Promise<UpstreamResult> {
  if (!upstream.body) {
    throw new Error('Upstream returned streaming response with no body');
  }

  reply.raw.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive',
    'X-Gateway-Request-Id': req.id,
  });

  const reader = upstream.body.getReader();
  const decoder = new TextDecoder();

  // TODO: Register a 'close' event on reply.raw to detect client disconnect.
  // When client disconnects, reader.cancel() must be called to abort the
  // upstream fetch and stop consuming tokens. Currently this leaks upstream
  // connections and continues billing until the model finishes generating.

  try {
    // eslint-disable-next-line no-constant-condition
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;

      const chunk = decoder.decode(value, { stream: true });
      reply.raw.write(chunk);
    }

    reply.raw.end();

    // TODO: Parse SSE chunks to extract token usage from the final [DONE] chunk.
    // OpenAI streams token usage in the last data chunk before [DONE].
    // Currently, streaming responses always report null tokenUsage.

    return {
      statusCode: 200,
      model: req.requestBody.model,
      tokenUsage: null, // not yet implemented for streaming
      streamCompleted: true,
      error: null,
    };
  } catch (err) {
    reply.raw.end();
    return {
      statusCode: 200,
      model: req.requestBody.model,
      tokenUsage: null,
      streamCompleted: false,
      error: String(err),
    };
  }
}

// ---- Cost estimation ----
// Very rough — replace with provider pricing tables

function estimateCost(model: string, totalTokens: number): number {
  const rates: Record<string, number> = {
    'gpt-4': 0.00003,
    'gpt-4-turbo': 0.00001,
    'gpt-3.5-turbo': 0.000002,
    'claude-3-opus': 0.000015,
    'claude-3-sonnet': 0.000003,
  };

  const matchedKey = Object.keys(rates).find(k => model.includes(k));
  const rate = matchedKey ? rates[matchedKey] : 0.000002; // default cheap
  return totalTokens * rate;
}

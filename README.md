# weave

**Context that just works. Logs that actually tell the story. Tracing without ceremony.**

`weave` is a tiny, zero-dependency, TypeScript-first async context + structured logging + lightweight tracing library for Node.js, Bun, Deno, browsers, and edge runtimes.

[![npm version](https://img.shields.io/npm/v/@ahsan_raza_syed/weave.svg)](https://www.npmjs.com/package/@ahsan_raza_syed/weave)
[![npm downloads](https://img.shields.io/npm/dm/@ahsan_raza_syed/weave.svg)](https://www.npmjs.com/package/@ahsan_raza_syed/weave)

## Why weave?

Every backend developer hits the same problems:

1. **"Which log belongs to which request?"** — Logs are individual lines. Reconstructing the story of a single request means grepping by some ID you hopefully remembered to pass everywhere.
2. **"Context vanishes in callbacks"** — You set `requestId` at the top, then `setTimeout`, `Promise.then`, or `fetch` loses it.
3. **"The request just hung. No error. No timeout."** — Nothing aborted it because nobody wired up `AbortSignal` or a timeout.

`weave` solves all three with a single `create` → `run` → done workflow, automatic global patching so context survives timers/promises/fetch, and built-in timeouts and cancellation.

## Install

```bash
npm i @ahsan_raza_syed/weave
```

## Quick start

```ts
import { weave } from '@ahsan_raza_syed/weave';

const ctx = weave.create({
  requestId: crypto.randomUUID(),
  userId: 'u_123',
  traceId: weave.autoTraceId()
});

await weave.runScoped(ctx, async () => {
  ctx.log.info('Request started');

  const span = ctx.startSpan('db.query');
  await db.users.findById('u_123');
  span.end({ rows: 1 });

  setTimeout(() => {
    // context is still here — weave patches timers automatically
    ctx.log.success('Async callback', { requestId: weave.current?.values.requestId });
  }, 10);
}, { timeoutMs: 30_000 }); // request aborts after 30s
```

## Core concepts

### Context

A context is a bag of key-value pairs (`requestId`, `traceId`, `userId`, ...) plus a logger, an `AbortSignal`, and lifecycle hooks.

```ts
const ctx = weave.create({ requestId: 'r1', traceId: weave.autoTraceId() });

// Child context — inherits parent values, adds new ones, linked signal
const child = ctx.child({ userId: 'u_42' });
child.values.requestId; // 'r1' — inherited
child.values.userId;    // 'u_42' — added
```

### Running in context

```ts
// Synchronous or async — context is available via weave.current inside fn
weave.run(ctx, () => {
  weave.current?.values.requestId; // 'r1'
});

// Scoped — runs cleanups after fn resolves/rejects + optional timeout
await weave.runScoped(ctx, handler, { timeoutMs: 30_000 });
```

### Spans (lightweight tracing)

```ts
const span = ctx.startSpan('http.fetch', { url: '/api/data' });
await fetch('/api/data');
span.end({ status: 200 }); // logs duration, attributes, spanId, parentId, traceId

// Nested spans get automatic parent linkage
const parent = ctx.startSpan('handler');
const child = parent.context.startSpan('db.query');
child.parentId === parent.id; // true
```

### Structured logging

Every log call includes context values automatically:

```ts
ctx.log.debug('cache miss');
ctx.log.info('user loaded', { userId: 'u_42' });
ctx.log.warn('rate limit near', { remaining: 5 });
ctx.log.error('payment failed', { code: 'CARD_DECLINED' });
ctx.log.success('order placed', { orderId: 'ord_1' });
```

In development, output is colorized. In production (`NODE_ENV=production`), output is one JSON line per call:

```json
{"level":"info","message":"user loaded","timestamp":"2025-03-12T00:00:00.000Z","requestId":"r1","traceId":"t1","userId":"u_42"}
```

### Secret redaction

Keys like `password`, `token`, `authorization`, `apiKey`, `secret` are automatically redacted. Token patterns (`sk_*`, `ghp_*`) and JWTs are detected in values:

```ts
ctx.log.info('auth', { token: 'sk_live_abc123' });
// logs: { token: '[REDACTED]' }

ctx.log.info('jwt', { value: 'eyJhbGci.eyJzdWIi.sig' });
// logs: { value: '[REDACTED_JWT]' }
```

### Timeout and cancellation

```ts
// Timeout a specific task
const data = await weave.withTimeout('api-call', 5000, async (signal) => {
  return fetch('/api/slow', { signal });
});

// Cancel the current context tree
weave.run(ctx, () => {
  weave.cancel('user navigated away');
  ctx.signal.aborted; // true — all child contexts are also aborted
});
```

### Guard (error boundary)

```ts
const safeFn = weave.run(ctx, () =>
  weave.guard('payment', async () => {
    await chargeCard();
  })
);

await safeFn(); // on error: logs with context, then rethrows
```

### Snapshot and restore (cross-boundary)

```ts
// Serialize context for worker/queue/process boundary
const snap = ctx.snapshot(); // { id, values }
const json = JSON.stringify(snap);

// On the other side:
const restored = weave.fromSnapshot(JSON.parse(json));
restored.values.requestId; // preserved
```

### Trace ID on response

So clients or support can reference a specific request:

```ts
weave.run(ctx, () => {
  weave.setTraceIdOnResponse(res); // Node res.setHeader or Web Response.headers
});
```

## Framework adapters

One-line middleware. No peer dependencies — compatible with minimal request/response shapes.

### Express

```ts
import express from 'express';
import { weave } from '@ahsan_raza_syed/weave';
import { weaveExpress } from '@ahsan_raza_syed/weave/adapters';

const app = express();
app.use(weaveExpress({ timeoutMs: 30_000 }));

app.get('/api/data', (req, res) => {
  weave.current?.log.info('handling request');
  res.json({ ok: true });
});
```

### Fastify

```ts
import Fastify from 'fastify';
import { weave } from '@ahsan_raza_syed/weave';
import { weaveFastify } from '@ahsan_raza_syed/weave/adapters';

const fastify = Fastify();
await fastify.register(weaveFastify());

fastify.get('/api/data', async (request, reply) => {
  const ctx = (request as any).weaveContext;
  return weave.run(ctx, () => {
    ctx.log.info('handling request');
    return { ok: true };
  });
});
```

### Hono

```ts
import { Hono } from 'hono';
import { weave } from '@ahsan_raza_syed/weave';
import { weaveHono } from '@ahsan_raza_syed/weave/adapters';

const app = new Hono();
app.use('*', weaveHono({ timeoutMs: 30_000 }));

app.get('/api/data', (c) => {
  weave.current?.log.info('handling request');
  return c.json({ ok: true });
});
```

### Next.js (App Router)

```ts
import { weave } from '@ahsan_raza_syed/weave';
import { withWeaveNext } from '@ahsan_raza_syed/weave/adapters';

export const GET = withWeaveNext(async (request) => {
  weave.current?.log.info('handling request');
  return Response.json({ ok: true });
}, { timeoutMs: 10_000 });
```

All adapters read an incoming `x-weave-trace-id` header (configurable via `headerName`) and set it on the response.

## Trace story script

Filter JSON logs by `traceId` and print in timestamp order:

```bash
cat logs.jsonl | node scripts/trace-story.mjs <traceId>
```

Use the trace ID from the response header to reconstruct "what happened for this request" from your log stream.

## API reference

| Method | Description |
|--------|-------------|
| `weave.create(values, options?)` | Create a new context. Patches globals on first call. |
| `weave.run(ctx, fn)` | Run `fn` with `ctx` as the active context. |
| `weave.runScoped(ctx, fn, { timeoutMs? })` | Run `fn`, then run cleanups. Optional timeout. |
| `weave.bind(fn)` | Bind `fn` to the current context for later invocation. |
| `weave.guard(name, fn)` | Wrap `fn` to log errors with context before rethrowing. |
| `weave.withTimeout(label, ms, task)` | Run `task(signal)` with a timeout. |
| `weave.cancel(reason?)` | Abort the current context's signal (cascades to children). |
| `weave.setTraceIdOnResponse(res, headerName?)` | Set trace ID on a Node or Web response. |
| `weave.fromSnapshot(snapshot, options?)` | Restore a context from a serialized snapshot. |
| `weave.current` | The currently active context, or `undefined`. |
| `weave.autoTraceId()` | Generate a trace ID (`crypto.randomUUID` or fallback). |

**Context methods:** `ctx.child(values)`, `ctx.startSpan(name, attrs?)`, `ctx.onCleanup(fn)`, `ctx.snapshot()`, `ctx.log.*`, `ctx.signal`.

**Options:** `{ redactKeys?: string[], enablePatching?: boolean, headerName?: string }`.

**Exported types:** `WeaveContext`, `WeaveSnapshot`, `WeaveLogger`, `WeaveSpan`, `WeaveLogPayload`, `WeaveOptions`, `ContextRecord`.

## How it works

On the first `weave.create()`, weave patches `setTimeout`, `setInterval`, `queueMicrotask`, `Promise.prototype.then/catch/finally`, `EventTarget.addEventListener`, and `fetch` so that the active context propagates into all async continuations. Disable with `enablePatching: false`.

Context is stored in a module-level variable and swapped in/out by `withContext` (not `AsyncLocalStorage`) so it works in browsers and edge runtimes too.

## Context checklist

Quick checklist for "one story per request":

- [ ] Create a context per request with `weave.create({ requestId, traceId })` or use a framework adapter.
- [ ] Run handlers inside `weave.run(ctx, fn)` or `weave.runScoped(ctx, fn)`.
- [ ] Set a default timeout: `weave.runScoped(ctx, fn, { timeoutMs: 30_000 })`.
- [ ] Put the trace ID on the response: `weave.setTraceIdOnResponse(res)`.
- [ ] In production, pipe JSON logs to your aggregator and filter by `traceId`.

## License

MIT

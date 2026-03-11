# weave

**Context that just works. Logs that actually tell the story. Tracing without ceremony.**

`weave` is a tiny TypeScript-first async context + logging + spans utility for Node, browsers, Bun, Deno, and edge runtimes.

[![npm version](https://img.shields.io/npm/v/weave.svg)](https://www.npmjs.com/package/weave)
[![npm downloads](https://img.shields.io/npm/dm/weave.svg)](https://www.npmjs.com/package/weave)

## Install

```bash
npm i weave
```

## Quick start

```ts
import { weave } from 'weave';

const ctx = weave.create({
  requestId: crypto.randomUUID(),
  userId: 'u_123',
  tenant: 'acme',
  traceId: weave.autoTraceId()
});

await weave.runScoped(ctx, async () => {
  ctx.log.info('User action started');

  const span = ctx.startSpan('api.fetch');
  await fetch('/api/data');
  span.end();

  setTimeout(() => {
    ctx.log.success('still has context', { requestId: weave.current?.values.requestId });
  }, 10);
});
```

## Daily pain points solved (beyond context propagation)

- **Hung requests / promises with no timeout behavior**: `weave.withTimeout()` gives a universal timeout wrapper with `AbortSignal` propagation and contextual error logs.
- **Cleanup leaks across async boundaries**: register disposers with `ctx.onCleanup()` and execute safely with `weave.runScoped()`.
- **Context lost when crossing worker/process boundaries**: `ctx.snapshot()` + `weave.fromSnapshot()` restore portable context payloads.
- **Unhandled async handler crashes**: `weave.guard(name, fn)` logs failures with the active context before rethrowing.
- **Cancel entire request/task trees**: `weave.cancel(reason)` aborts current context signal and downstream operations that consume it.

## Features

- Universal context propagation helpers (`run`, `bind`) and global async patching.
- Structured logger (`debug`, `info`, `warn`, `error`, `success`) with automatic context fields.
- Lightweight spans with parent/child linkage.
- Secret redaction for common keys and token/JWT-like values.
- Fetch header injection (`x-weave-trace-id` by default).
- Scope lifecycle hooks + abort signal propagation for cleanup/cancellation.
- Zero runtime dependencies.

## API

- `weave.create(values, options?)`
- `weave.fromSnapshot(snapshot, options?)`
- `weave.run(ctx, fn)`
- `weave.runScoped(ctx, fn)`
- `weave.bind(fn)`
- `weave.guard(name, fn)`
- `weave.withTimeout(label, ms, task)`
- `weave.cancel(reason?)`
- `weave.current`
- `weave.autoTraceId()`

## Publish on npm

`weave` is configured for a public npm package page and distribution metadata. To publish:

```bash
npm run build
npm publish --access public
```

NPM package page: https://www.npmjs.com/package/weave

## License

MIT

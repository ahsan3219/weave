# @ahsan_raza_syed/weave

> Context that just works. Logs that actually tell the story. Tracing without ceremony.

`weave` is an open-source TypeScript-first async context toolkit for Node.js, browser apps, Bun, Deno, and edge runtimes.

It focuses on daily production debugging pain:
- lost request/user/session data after async boundaries
- inconsistent logs with no correlation IDs
- missing cleanup/cancellation for long-running tasks
- unbounded async operations without timeouts

[![npm version](https://img.shields.io/npm/v/@ahsan_raza_syed/weave.svg)](https://www.npmjs.com/package/@ahsan_raza_syed/weave)
[![npm downloads](https://img.shields.io/npm/dm/@ahsan_raza_syed/weave.svg)](https://www.npmjs.com/package/@ahsan_raza_syed/weave)
[![license: MIT](https://img.shields.io/badge/license-MIT-blue.svg)](./LICENSE)

## Install

```bash
npm i @ahsan_raza_syed/weave
```

## Why this module exists

Modern JS/TS apps jump through async boundaries constantly (`await`, timers, events, fetch calls). Without context propagation, debugging incident timelines is painful.

`weave` gives you:
- context propagation helpers (`create`, `run`, `bind`, `current`)
- structured contextual logs (with redaction)
- lightweight spans (`startSpan`)
- task lifecycle utilities (cleanup handlers, cancellation, timeouts)
- context snapshot/restore for cross-boundary transport

## Quick start

```ts
import { weave } from '@ahsan_raza_syed/weave';

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
  span.end({ service: 'billing-api' });

  setTimeout(() => {
    // context still available here
    ctx.log.success('still has context', {
      requestId: weave.current?.values.requestId
    });
  }, 10);
});
```

## Core API

### Context lifecycle
- `weave.create(values, options?)`
- `weave.fromSnapshot(snapshot, options?)`
- `weave.run(ctx, fn)`
- `weave.runScoped(ctx, fn)`
- `weave.current`
- `weave.cancel(reason?)`

### Async safety helpers
- `weave.bind(fn)`
- `weave.guard(name, fn)`
- `weave.withTimeout(label, ms, task)`

### Tracing and IDs
- `ctx.startSpan(name, attrs?)`
- `weave.autoTraceId()`

### Context instance helpers
- `ctx.child(values)`
- `ctx.snapshot()`
- `ctx.onCleanup(handler)`
- `ctx.signal`
- `ctx.log.{debug,info,warn,error,success}`

## Daily engineering problems solved

1. **Timeouts are bolted on ad-hoc**
   - Use `weave.withTimeout()` with `AbortSignal` and structured timeout logging.
2. **Cleanup is forgotten in asynchronous workflows**
   - Register resources with `ctx.onCleanup()` and execute them reliably via `weave.runScoped()`.
3. **Error handlers lose context**
   - Wrap handlers in `weave.guard()` so errors log with the active context before rethrow.
4. **Cross-worker/task handoff loses identity**
   - Serialize context with `ctx.snapshot()` and recover with `weave.fromSnapshot()`.
5. **Cancel request trees without manual wiring**
   - `weave.cancel()` aborts the active context signal consumed downstream.

## Open-source project details

- License: **MIT**
- Runtime deps: **0**
- Language: **TypeScript**
- Built with: `tsup`
- Tested with: `vitest`

Issues and contributions are welcome.

## Development

```bash
npm install
npm run lint
npm test
npm run build
```

## Publish on npm (scoped account flow)

If you use multiple npm registries/profiles with `npmrc`:

```bash
npmrc <profile-name>
```

Publish flow:

```bash
npm login
npm run build
npm pack --dry-run
npm publish --access public
```

For a fresh scoped package template:

```bash
mkdir my-test-package
cd my-test-package
npm init --scope=@ahsan_raza_syed
```

Package page: https://www.npmjs.com/package/@ahsan_raza_syed/weave

## Security and logging notes

- Redaction is built in for common secret keys (e.g. `token`, `password`, `authorization`, `apikey`, `secret`).
- Token/JWT-like values are auto-scrubbed in metadata payloads.
- Use custom `redactKeys` in `weave.create(values, { redactKeys: [...] })` for your domain.

## License

MIT

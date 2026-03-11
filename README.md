# weave

**Context that just works. Logs that actually tell the story. Tracing without ceremony.**

`weave` is a tiny TypeScript-first async context + logging + spans utility for Node, browsers, Bun, Deno, and edge runtimes.

[![npm version](https://img.shields.io/npm/v/@ahsan_raza_syed/weave.svg)](https://www.npmjs.com/package/@ahsan_raza_syed/weave)
[![npm downloads](https://img.shields.io/npm/dm/@ahsan_raza_syed/weave.svg)](https://www.npmjs.com/package/@ahsan_raza_syed/weave)

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

## Publish on npm (scoped account flow)

If you use multiple npm registries/profiles with `npmrc`:

```bash
npmrc <profile-name>
```

Then publish from this package root:

```bash
npm login
npm run build
npm pack --dry-run
npm publish --access public
```

Create package from scratch flow (npm docs style):

```bash
mkdir my-test-package
cd my-test-package
npm init --scope=@ahsan_raza_syed
```

Package page: https://www.npmjs.com/package/@ahsan_raza_syed/weave

## License

MIT

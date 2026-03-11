# weave

**Context that just works. Logs that actually tell the story. Tracing without ceremony.**

`weave` is a tiny TypeScript-first async context + logging + spans utility for Node, browsers, Bun, Deno, and edge runtimes.

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

await weave.run(ctx, async () => {
  ctx.log.info('User action started');

  const span = ctx.startSpan('api.fetch');
  await fetch('/api/data');
  span.end();

  setTimeout(() => {
    ctx.log.success('still has context', { requestId: weave.current?.values.requestId });
  }, 10);
});
```

## Features

- Universal context propagation helpers (`run`, `bind`) and global async patching.
- Structured logger (`debug`, `info`, `warn`, `error`, `success`) with automatic context fields.
- Lightweight spans with parent/child linkage.
- Secret redaction for common keys and token/JWT-like values.
- Fetch header injection (`x-weave-trace-id` by default).
- Zero runtime dependencies.

## API

- `weave.create(values, options?)`
- `weave.run(ctx, fn)`
- `weave.bind(fn)`
- `weave.current`
- `weave.autoTraceId()`

## Notes

- In modern runtimes, Promise/timer/event/fetch hooks are patched once during first `create()`.
- You can disable patching with: `weave.create(values, { enablePatching: false })`.

## License

MIT

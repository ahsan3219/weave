# Testing Guide & Validation Matrix

This document explains how to validate `@ahsan_raza_syed/weave` thoroughly before publishing.

## 1) Environment sanity

```bash
node -v
npm -v
npm config list
```

Ensure your environment can reach npm and that your selected `npmrc` profile is correct.

## 2) Dependency install

```bash
npm ci
```

Expected: all dependencies install without warnings/errors.

## 3) Static checks

```bash
npm run lint
```

This runs `tsc --noEmit` and verifies:
- exported API type integrity
- strict mode correctness
- test type-checkability

## 4) Unit test suite

```bash
npm test
```

`vitest` validates core module behavior:
- fetch trace header injection
- async context propagation (timers + Promise continuations)
- span parent/child + trace linkage
- log redaction for secret keys and token patterns
- snapshot and restore behavior
- scoped cleanup execution in `runScoped`
- context-safe callback wrapping with `bind`
- guarded handler error behavior via `guard`
- timeout/cancel behavior via `withTimeout` and `cancel`
- trace id generation via `autoTraceId`

## 5) Production build

```bash
npm run build
```

Confirms:
- ESM bundle generation
- CJS bundle generation
- `.d.ts` declaration output

## 6) Package integrity

```bash
npm pack --dry-run
```

Confirms npm tarball contents, package size, and publish readiness.

## 7) Optional smoke script (runtime behavior)

```bash
node -e "import('./dist/index.js').then(async ({weave}) => { const ctx=weave.create({requestId:'r1',traceId:'t1'}); await weave.runScoped(ctx, async () => { ctx.log.info('smoke'); const s=ctx.startSpan('demo'); await new Promise(r=>setTimeout(r,10)); s.end(); }); console.log('smoke-ok'); })"
```

## Release-ready checklist

- [ ] `npm ci` succeeds
- [ ] `npm run lint` succeeds
- [ ] `npm test` succeeds
- [ ] `npm run build` succeeds
- [ ] `npm pack --dry-run` succeeds
- [ ] branch is `main`
- [ ] old feature branches removed locally/remotely
- [ ] `git push -u origin main` succeeds

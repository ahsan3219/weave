import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { weave } from '../src/index';
import type { WeaveContext } from '../src/index';

describe('weave', () => {
  let consoleSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
  });

  afterEach(() => {
    consoleSpy.mockRestore();
  });

  // ─── Context propagation ───────────────────────────────

  describe('context propagation', () => {
    it('keeps context through setTimeout', async () => {
      const ctx = weave.create({ requestId: 'r1', traceId: 't1' });

      const value = await weave.run(ctx, async () => {
        return await new Promise<string>((resolve) => {
          setTimeout(() => {
            resolve(String(weave.current?.values.requestId));
          }, 0);
        });
      });

      expect(value).toBe('r1');
    });

    it('keeps context through queueMicrotask', async () => {
      const ctx = weave.create({ requestId: 'r2', traceId: 't2' });

      const value = await weave.run(ctx, () =>
        new Promise<string>((resolve) => {
          queueMicrotask(() => {
            resolve(String(weave.current?.values.requestId));
          });
        })
      );

      expect(value).toBe('r2');
    });

    it('keeps context through chained promises', async () => {
      const ctx = weave.create({ requestId: 'r3', traceId: 't3' });

      const value = await weave.run(ctx, () =>
        Promise.resolve('a')
          .then(() => Promise.resolve('b'))
          .then(() => String(weave.current?.values.requestId))
      );

      expect(value).toBe('r3');
    });

    it('restores parent context after run completes', () => {
      const outer = weave.create({ requestId: 'outer' });
      const inner = weave.create({ requestId: 'inner' });

      weave.run(outer, () => {
        expect(weave.current?.values.requestId).toBe('outer');
        weave.run(inner, () => {
          expect(weave.current?.values.requestId).toBe('inner');
        });
        expect(weave.current?.values.requestId).toBe('outer');
      });
    });

    it('current is undefined outside any run', () => {
      expect(weave.current).toBeUndefined();
    });
  });

  // ─── Child context ─────────────────────────────────────

  describe('child context', () => {
    it('inherits parent values and adds new ones', () => {
      const parent = weave.create({ requestId: 'r1', traceId: 't1' });
      const child = parent.child({ userId: 'u_1' });

      expect(child.values.requestId).toBe('r1');
      expect(child.values.traceId).toBe('t1');
      expect(child.values.userId).toBe('u_1');
    });

    it('child has its own signal linked to parent', () => {
      const parent = weave.create({ requestId: 'r1', traceId: 't1' });
      const child = parent.child({ userId: 'u_1' });

      expect(child.signal.aborted).toBe(false);
      (parent as unknown as { controller: AbortController }).controller.abort('parent cancelled');
      expect(child.signal.aborted).toBe(true);
      expect(child.signal.reason).toBe('parent cancelled');
    });

    it('child signal does not propagate back to parent', () => {
      const parent = weave.create({ requestId: 'r1', traceId: 't1' });
      const child = parent.child({ userId: 'u_1' });

      (child as unknown as { controller: AbortController }).controller.abort('child cancelled');
      expect(child.signal.aborted).toBe(true);
      expect(parent.signal.aborted).toBe(false);
    });
  });

  // ─── Spans ─────────────────────────────────────────────

  describe('spans', () => {
    it('creates child spans with trace linkage', () => {
      const ctx = weave.create({ requestId: 'r1', traceId: 't1' });
      const span = ctx.startSpan('demo');

      expect(span.traceId).toBe('t1');
      expect(span.context.values.spanId).toBe(span.id);
    });

    it('nested spans have parent-child linkage', () => {
      const ctx = weave.create({ requestId: 'r1', traceId: 't1' });
      const parent = ctx.startSpan('parent-op');
      const child = parent.context.startSpan('child-op');

      expect(child.traceId).toBe('t1');
      expect(child.parentId).toBe(parent.id);
      expect(child.id).not.toBe(parent.id);
    });

    it('span.end() logs duration and metadata', () => {
      const ctx = weave.create({ requestId: 'r1', traceId: 't1' });
      const span = ctx.startSpan('db.query', { table: 'users' });
      span.end({ rows: 42 });

      expect(consoleSpy).toHaveBeenCalled();
      const payload = consoleSpy.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(payload.message).toBe('span:db.query');
      expect(typeof payload.durationMs).toBe('number');
      expect(payload.table).toBe('users');
      expect(payload.rows).toBe(42);
      expect(payload.spanId).toBe(span.id);
      expect(payload.traceId).toBe('t1');
    });

    it('toJSON returns span metadata', () => {
      const ctx = weave.create({ requestId: 'r1', traceId: 't1' });
      const span = ctx.startSpan('op');
      const json = span.toJSON();

      expect(json.spanId).toBe(span.id);
      expect(json.traceId).toBe('t1');
      expect(json.name).toBe('op');
      expect(typeof json.startedAt).toBe('number');
    });
  });

  // ─── Logger + redaction ────────────────────────────────

  describe('logger and redaction', () => {
    it('redacts key-based secrets', () => {
      const ctx = weave.create({ requestId: 'r1' });
      ctx.log.info('test', { token: 'sk_12345678910' });

      const raw = consoleSpy.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(raw.token).toBe('[REDACTED]');
    });

    it('redacts password key', () => {
      const ctx = weave.create({ requestId: 'r1' });
      ctx.log.info('test', { password: 'hunter2' });

      const raw = consoleSpy.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(raw.password).toBe('[REDACTED]');
    });

    it('redacts authorization header (case-insensitive)', () => {
      const ctx = weave.create({ requestId: 'r1' });
      ctx.log.info('test', { Authorization: 'Bearer xyz' });

      const raw = consoleSpy.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(raw.Authorization).toBe('[REDACTED]');
    });

    it('redacts apiKey (case-insensitive match)', () => {
      const ctx = weave.create({ requestId: 'r1' });
      ctx.log.info('test', { apiKey: 'my-key' });

      const raw = consoleSpy.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(raw.apiKey).toBe('[REDACTED]');
    });

    it('redacts token-like string values anywhere', () => {
      const ctx = weave.create({ requestId: 'r1' });
      ctx.log.info('test', { note: 'here is sk_abcdefghij leaked' });

      const raw = consoleSpy.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(raw.note).toBe('[REDACTED_TOKEN]');
    });

    it('redacts JWT-like string values', () => {
      const ctx = weave.create({ requestId: 'r1' });
      ctx.log.info('test', { jwt: 'eyJhbGciOi.eyJzdWIiOi.signature' });

      const raw = consoleSpy.mock.calls[0]?.[1] as Record<string, unknown>;
      expect(raw.jwt).toBe('[REDACTED_JWT]');
    });

    it('redacts nested object keys', () => {
      const ctx = weave.create({ requestId: 'r1' });
      ctx.log.info('test', { config: { secret: 's3cr3t', host: 'localhost' } });

      const raw = consoleSpy.mock.calls[0]?.[1] as Record<string, unknown>;
      const config = raw.config as Record<string, unknown>;
      expect(config.secret).toBe('[REDACTED]');
      expect(config.host).toBe('localhost');
    });

    it('redacts values inside arrays', () => {
      const ctx = weave.create({ requestId: 'r1' });
      ctx.log.info('test', { tokens: ['sk_aaaabbbbcccc', 'normal'] });

      const raw = consoleSpy.mock.calls[0]?.[1] as Record<string, unknown>;
      const tokens = raw.tokens as string[];
      expect(tokens[0]).toBe('[REDACTED_TOKEN]');
      expect(tokens[1]).toBe('normal');
    });

    it('all log levels work (debug, info, warn, error, success)', () => {
      const ctx = weave.create({ requestId: 'r1' });
      ctx.log.debug('d');
      ctx.log.info('i');
      ctx.log.warn('w');
      ctx.log.error('e');
      ctx.log.success('s');

      expect(consoleSpy).toHaveBeenCalledTimes(5);
    });

    it('production log is one JSON line with expected fields', () => {
      const prev = process.env.NODE_ENV;
      process.env.NODE_ENV = 'production';
      consoleSpy.mockRestore();
      consoleSpy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

      const ctx = weave.create({ requestId: 'r1', traceId: 't1' });
      ctx.log.info('hello');

      const out = consoleSpy.mock.calls[0]?.[0] as string;
      const payload = JSON.parse(out) as Record<string, unknown>;
      expect(payload.traceId).toBe('t1');
      expect(payload.requestId).toBe('r1');
      expect(payload.level).toBe('info');
      expect(payload.message).toBe('hello');
      expect(typeof payload.timestamp).toBe('string');

      process.env.NODE_ENV = prev;
    });
  });

  // ─── Snapshot ──────────────────────────────────────────

  describe('snapshot', () => {
    it('snapshot and restore preserves values', () => {
      const ctx = weave.create({ requestId: 'r1', traceId: 't1' });
      const snap = ctx.snapshot();
      const restored = weave.fromSnapshot(snap);

      expect(restored.values.requestId).toBe('r1');
      expect(restored.values.traceId).toBe('t1');
    });

    it('restored context has independent signal', () => {
      const ctx = weave.create({ requestId: 'r1', traceId: 't1' });
      const restored = weave.fromSnapshot(ctx.snapshot());

      (ctx as unknown as { controller: AbortController }).controller.abort('original cancelled');
      expect(restored.signal.aborted).toBe(false);
    });
  });

  // ─── runScoped + cleanup ───────────────────────────────

  describe('runScoped', () => {
    it('runs cleanup handlers after fn completes', async () => {
      const ctx = weave.create({ requestId: 'r1' });
      const cleanup = vi.fn();

      ctx.onCleanup(cleanup);
      await weave.runScoped(ctx, async () => 'ok');

      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('runs multiple cleanups in order', async () => {
      const ctx = weave.create({ requestId: 'r1' });
      const order: number[] = [];

      ctx.onCleanup(() => { order.push(1); });
      ctx.onCleanup(() => { order.push(2); });

      await weave.runScoped(ctx, async () => 'ok');
      expect(order).toEqual([1, 2]);
    });

    it('still runs cleanups after error', async () => {
      const ctx = weave.create({ requestId: 'r1' });
      const cleanup = vi.fn();
      ctx.onCleanup(cleanup);

      await expect(
        weave.runScoped(ctx, async () => { throw new Error('boom'); })
      ).rejects.toThrow('boom');

      expect(cleanup).toHaveBeenCalledTimes(1);
    });

    it('with timeoutMs aborts and still runs cleanups', async () => {
      const ctx = weave.create({ requestId: 'r1', traceId: 't1' });
      const cleanup = vi.fn();
      ctx.onCleanup(cleanup);

      await expect(
        weave.runScoped(
          ctx,
          () => new Promise<string>((resolve) => { setTimeout(() => resolve('late'), 50); }),
          { timeoutMs: 10 }
        )
      ).rejects.toBeInstanceOf(Error);

      expect(cleanup).toHaveBeenCalledTimes(1);
    });
  });

  // ─── bind ──────────────────────────────────────────────

  describe('bind', () => {
    it('captures current context for later invocation', async () => {
      const ctx = weave.create({ requestId: 'r1', traceId: 't1' });
      let captured: string | undefined;

      const fn = weave.run(ctx, () => {
        return weave.bind(() => {
          captured = String(weave.current?.values.requestId);
        });
      });

      fn();
      expect(captured).toBe('r1');
    });

    it('bound function keeps context even called outside run', () => {
      const ctx = weave.create({ requestId: 'r1' });
      let result: string | undefined;

      const bound = weave.run(ctx, () =>
        weave.bind(() => { result = String(weave.current?.values.requestId); })
      );

      expect(weave.current).toBeUndefined();
      bound();
      expect(result).toBe('r1');
    });
  });

  // ─── guard ─────────────────────────────────────────────

  describe('guard', () => {
    it('sync: logs and rethrows errors', () => {
      const ctx = weave.create({ requestId: 'r1' });
      const guarded = weave.run(ctx, () =>
        weave.guard('sync-op', () => { throw new Error('sync-fail'); })
      );

      expect(() => guarded()).toThrow('sync-fail');
      const errorLog = consoleSpy.mock.calls.find(
        (c) => (c[1] as Record<string, unknown>)?.message === 'guard:sync-op'
      );
      expect(errorLog).toBeDefined();
    });

    it('async: logs and rethrows errors', async () => {
      const ctx = weave.create({ requestId: 'r1' });
      const guarded = weave.run(ctx, () =>
        weave.guard('async-op', async () => { throw new Error('async-fail'); })
      );

      await expect(guarded()).rejects.toThrow('async-fail');
      const errorLog = consoleSpy.mock.calls.find(
        (c) => (c[1] as Record<string, unknown>)?.message === 'guard:async-op'
      );
      expect(errorLog).toBeDefined();
    });

    it('returns value on success', () => {
      const ctx = weave.create({ requestId: 'r1' });
      const guarded = weave.run(ctx, () =>
        weave.guard('ok-op', (x: number) => x * 2)
      );
      expect(guarded(5)).toBe(10);
    });
  });

  // ─── withTimeout ───────────────────────────────────────

  describe('withTimeout', () => {
    it('rejects when task exceeds timeout', async () => {
      const ctx = weave.create({ requestId: 'r1' });

      await expect(
        weave.run(ctx, () =>
          weave.withTimeout('slow-task', 5, async (signal) => {
            await new Promise((resolve, reject) => {
              const timer = setTimeout(resolve, 50);
              signal.addEventListener('abort', () => {
                clearTimeout(timer);
                reject(signal.reason);
              });
            });
            return 'never';
          })
        )
      ).rejects.toBeInstanceOf(Error);
    });

    it('resolves when task completes before timeout', async () => {
      const ctx = weave.create({ requestId: 'r1' });

      const result = await weave.run(ctx, () =>
        weave.withTimeout('fast-task', 500, async () => 'done')
      );

      expect(result).toBe('done');
    });
  });

  // ─── cancel ────────────────────────────────────────────

  describe('cancel', () => {
    it('aborts the current context signal', () => {
      const ctx = weave.create({ requestId: 'r1' });

      weave.run(ctx, () => {
        expect(ctx.signal.aborted).toBe(false);
        weave.cancel('user cancelled');
        expect(ctx.signal.aborted).toBe(true);
        expect(ctx.signal.reason).toBe('user cancelled');
      });
    });

    it('propagates to child contexts', () => {
      const ctx = weave.create({ requestId: 'r1' });
      const child = ctx.child({ extra: true });

      weave.run(ctx, () => {
        weave.cancel('from parent');
      });

      expect(child.signal.aborted).toBe(true);
    });
  });

  // ─── setTraceIdOnResponse ──────────────────────────────

  describe('setTraceIdOnResponse', () => {
    it('sets header on Web Headers', () => {
      const ctx = weave.create({ requestId: 'r1', traceId: 'trace-xyz' });
      const headers = new Headers();

      weave.run(ctx, () => {
        weave.setTraceIdOnResponse({ headers });
      });

      expect(headers.get('x-weave-trace-id')).toBe('trace-xyz');
    });

    it('sets header via setHeader', () => {
      const ctx = weave.create({ requestId: 'r1', traceId: 'trace-abc' });
      const setHeader = vi.fn();

      weave.run(ctx, () => {
        weave.setTraceIdOnResponse({ setHeader });
      });

      expect(setHeader).toHaveBeenCalledWith('x-weave-trace-id', 'trace-abc');
    });

    it('uses custom header name', () => {
      const ctx = weave.create({ requestId: 'r1', traceId: 'trace-custom' });
      const setHeader = vi.fn();

      weave.run(ctx, () => {
        weave.setTraceIdOnResponse({ setHeader }, 'x-custom-trace');
      });

      expect(setHeader).toHaveBeenCalledWith('x-custom-trace', 'trace-custom');
    });

    it('uses context id when traceId is absent', () => {
      const ctx = weave.create({ requestId: 'r1' });
      const setHeader = vi.fn();

      weave.run(ctx, () => {
        weave.setTraceIdOnResponse({ setHeader });
      });

      expect(setHeader).toHaveBeenCalledWith('x-weave-trace-id', ctx.id);
    });

    it('does nothing outside context', () => {
      const setHeader = vi.fn();
      weave.setTraceIdOnResponse({ setHeader });
      expect(setHeader).not.toHaveBeenCalled();
    });
  });

  // ─── autoTraceId ───────────────────────────────────────

  describe('autoTraceId', () => {
    it('generates unique string ids', () => {
      const a = weave.autoTraceId();
      const b = weave.autoTraceId();
      expect(typeof a).toBe('string');
      expect(a.length).toBeGreaterThan(5);
      expect(a).not.toBe(b);
    });
  });
});

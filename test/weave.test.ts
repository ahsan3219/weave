import { describe, expect, it, vi } from 'vitest';
import { weave } from '../src/index';

describe('weave', () => {
  it('injects trace header into fetch', async () => {
    const fetchSpy = vi.fn(async (_input: RequestInfo | URL, init?: RequestInit) => {
      return new Response(JSON.stringify({ header: new Headers(init?.headers).get('x-weave-trace-id') }), {
        status: 200,
        headers: { 'content-type': 'application/json' }
      });
    });

    const originalFetch = globalThis.fetch;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = fetchSpy;

    const ctx = weave.create({ requestId: 'fetch', traceId: 'trace-123' }, { headerName: 'x-weave-trace-id' });
    const response = await weave.run(ctx, () => fetch('https://example.com'));
    const payload = (await response.json()) as { header: string | null };

    expect(payload.header).toBe('trace-123');
    expect(fetchSpy).toHaveBeenCalledOnce();

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (globalThis as any).fetch = originalFetch;
  });

  it('keeps context through setTimeout', async () => {
    const ctx = weave.create({ requestId: 'r1', traceId: 't1' });

    const value = await weave.run(ctx, async () => {
      return await new Promise<string>((resolve) => {
        setTimeout(() => resolve(String(weave.current?.values.requestId)), 0);
      });
    });

    expect(value).toBe('r1');
  });

  it('keeps context through Promise.then', async () => {
    const ctx = weave.create({ requestId: 'promise-ctx' });

    const value = await weave.run(ctx, async () => Promise.resolve('ok').then(() => weave.current?.values.requestId));

    expect(value).toBe('promise-ctx');
  });

  it('creates child spans with trace linkage and parent IDs', () => {
    const root = weave.create({ requestId: 'r1', traceId: 't1' });
    const parent = root.startSpan('parent');
    const child = parent.context.startSpan('child');

    expect(parent.traceId).toBe('t1');
    expect(parent.context.values.spanId).toBe(parent.id);
    expect(child.parentId).toBe(parent.id);
  });

  it('redacts configured keys and token-like strings in logs', () => {
    const ctx = weave.create({ requestId: 'r1' });
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    ctx.log.info('test', { token: 'plain-value', nested: { custom: 'sk_12345678910' } });

    const raw = spy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(raw.token).toBe('[REDACTED]');
    expect((raw.nested as Record<string, string>).custom).toBe('[REDACTED_TOKEN]');
    spy.mockRestore();
  });

  it('supports snapshot and restoring context', () => {
    const ctx = weave.create({ requestId: 'r1', traceId: 't1' });
    const restored = weave.fromSnapshot(ctx.snapshot());

    expect(restored.values.requestId).toBe('r1');
    expect(restored.values.traceId).toBe('t1');
  });

  it('runs cleanup handlers in runScoped', async () => {
    const ctx = weave.create({ requestId: 'r1' });
    const cleanup = vi.fn();

    ctx.onCleanup(cleanup);
    await weave.runScoped(ctx, async () => 'ok');

    expect(cleanup).toHaveBeenCalledTimes(1);
  });

  it('bind keeps current context when callback is called later', () => {
    const ctx = weave.create({ requestId: 'bound' });

    const bound = weave.run(ctx, () => weave.bind(() => weave.current?.values.requestId));

    expect(bound()).toBe('bound');
  });

  it('guard logs errors and rethrows', async () => {
    const ctx = weave.create({ requestId: 'guard-ctx' });
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(
      weave.run(ctx, async () => {
        const fn = weave.guard('failing-task', async () => {
          throw new Error('boom');
        });
        return fn();
      })
    ).rejects.toThrow('boom');

    expect(spy).toHaveBeenCalled();
    spy.mockRestore();
  });

  it('aborts timed out tasks', async () => {
    const ctx = weave.create({ requestId: 'r1' });
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    await expect(
      weave.run(ctx, () =>
        weave.withTimeout('slow-task', 10, async (signal) => {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 100);
            signal.addEventListener('abort', () => {
              clearTimeout(timer);
              reject(signal.reason);
            });
          });
          return 'never';
        })
      )
    ).rejects.toBeInstanceOf(Error);

    spy.mockRestore();
  });

  it('cancel aborts the active context signal', async () => {
    const ctx = weave.create({ requestId: 'cancel' });

    const state = await weave.run(ctx, async () => {
      weave.cancel('manual-stop');
      return { aborted: ctx.signal.aborted, reason: String(ctx.signal.reason) };
    });

    expect(state.aborted).toBe(true);
    expect(state.reason).toContain('manual-stop');
  });

  it('autoTraceId returns a non-empty id', () => {
    expect(weave.autoTraceId().length).toBeGreaterThan(5);
  });
});

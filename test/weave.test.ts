import { describe, expect, it, vi } from 'vitest';
import { weave } from '../src/index';

describe('weave', () => {
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

  it('creates child spans with trace linkage', () => {
    const ctx = weave.create({ requestId: 'r1', traceId: 't1' });
    const span = ctx.startSpan('demo');

    expect(span.traceId).toBe('t1');
    expect(span.context.values.spanId).toBe(span.id);
  });

  it('redacts token-like values in logs', () => {
    const ctx = weave.create({ requestId: 'r1' });
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);

    ctx.log.info('test', { token: 'sk_12345678910' });

    const raw = spy.mock.calls[0]?.[1] as Record<string, unknown>;
    expect(raw.token).toBe('[REDACTED]');
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

  it('aborts timed out tasks', async () => {
    const ctx = weave.create({ requestId: 'r1' });

    await expect(
      weave.run(ctx, () =>
        weave.withTimeout('slow-task', 5, async (signal) => {
          await new Promise((resolve, reject) => {
            const timer = setTimeout(resolve, 20);
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
});

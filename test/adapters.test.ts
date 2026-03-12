import { describe, expect, it, vi } from 'vitest';
import { weave } from '../src/index';
import { weaveExpress } from '../src/adapters/express';
import { weaveFastify } from '../src/adapters/fastify';
import { weaveHono } from '../src/adapters/hono';
import { withWeaveNext } from '../src/adapters/next';
import type { WeaveContext } from '../src/index';

describe('adapters', () => {
  // ─── Express ─────────────────────────────────────────

  describe('weaveExpress', () => {
    it('creates context and sets trace ID on response', () => {
      return new Promise<void>((resolve) => {
        const setHeader = vi.fn();
        const req = { headers: {} };
        const res = { setHeader };
        const mw = weaveExpress();

        (mw as (req: unknown, res: { setHeader: ReturnType<typeof vi.fn> }, next: () => void) => void)(
          req, res, () => {
            expect(weave.current?.values.traceId).toBeDefined();
            expect(weave.current?.values.requestId).toBeDefined();
            expect(setHeader).toHaveBeenCalledWith('x-weave-trace-id', expect.any(String));
            resolve();
          }
        );
      });
    });

    it('uses incoming x-weave-trace-id header', () => {
      return new Promise<void>((resolve) => {
        const setHeader = vi.fn();
        const req = { headers: { 'x-weave-trace-id': 'incoming-123' } };
        const res = { setHeader };
        const mw = weaveExpress();

        (mw as (req: unknown, res: { setHeader: ReturnType<typeof vi.fn> }, next: () => void) => void)(
          req, res, () => {
            expect(setHeader).toHaveBeenCalledWith('x-weave-trace-id', 'incoming-123');
            expect(weave.current?.values.traceId).toBe('incoming-123');
            resolve();
          }
        );
      });
    });

    it('supports custom header name', () => {
      return new Promise<void>((resolve) => {
        const setHeader = vi.fn();
        const req = { headers: { 'x-custom': 'custom-id' } };
        const res = { setHeader };
        const mw = weaveExpress({ headerName: 'x-custom' });

        (mw as (req: unknown, res: { setHeader: ReturnType<typeof vi.fn> }, next: () => void) => void)(
          req, res, () => {
            expect(setHeader).toHaveBeenCalledWith('x-custom', 'custom-id');
            resolve();
          }
        );
      });
    });
  });

  // ─── Fastify ─────────────────────────────────────────

  describe('weaveFastify', () => {
    it('attaches context on request and sets response header', () => {
      const hooks: Record<string, (req: any, reply: any) => void> = {};
      const instance = {
        addHook(name: string, fn: (req: any, reply: any) => void) {
          hooks[name] = fn;
        }
      };
      const done = vi.fn();
      const replyHeader = vi.fn();
      const request = { headers: { 'x-weave-trace-id': 'fast-trace-1' } };
      const reply = { header: replyHeader };

      const plugin = weaveFastify();
      plugin(instance as any, {}, done);
      expect(done).toHaveBeenCalled();

      hooks['onRequest']!(request, reply);

      expect((request as any).weaveContext).toBeDefined();
      const ctx = (request as any).weaveContext as WeaveContext;
      expect(ctx.values.traceId).toBe('fast-trace-1');
      expect(replyHeader).toHaveBeenCalledWith('x-weave-trace-id', 'fast-trace-1');
    });

    it('generates trace ID when header missing', () => {
      const hooks: Record<string, (req: any, reply: any) => void> = {};
      const instance = {
        addHook(name: string, fn: (req: any, reply: any) => void) {
          hooks[name] = fn;
        }
      };
      const done = vi.fn();
      const request = { headers: {} };
      const reply = { header: vi.fn() };

      weaveFastify()(instance as any, {}, done);
      hooks['onRequest']!(request, reply);

      const ctx = (request as any).weaveContext as WeaveContext;
      expect(ctx.values.traceId).toBeDefined();
      expect(typeof ctx.values.traceId).toBe('string');
    });
  });

  // ─── Hono ────────────────────────────────────────────

  describe('weaveHono', () => {
    it('creates context, sets response header, and calls next', async () => {
      const headerSpy = vi.fn();
      const setSpy = vi.fn();
      let contextInNext: WeaveContext | undefined;

      const c = {
        req: { header: () => undefined },
        header: headerSpy,
        set: setSpy
      };

      const mw = weaveHono();
      await mw(c, async () => {
        contextInNext = weave.current;
      });

      expect(contextInNext).toBeDefined();
      expect(contextInNext?.values.traceId).toBeDefined();
      expect(headerSpy).toHaveBeenCalledWith('x-weave-trace-id', expect.any(String));
      expect(setSpy).toHaveBeenCalledWith('weaveContext', expect.anything());
    });

    it('uses incoming header', async () => {
      const headerSpy = vi.fn();

      const c = {
        req: { header: (name: string) => name === 'x-weave-trace-id' ? 'hono-trace-1' : undefined },
        header: headerSpy,
        set: vi.fn()
      };

      const mw = weaveHono();
      await mw(c, async () => {
        expect(weave.current?.values.traceId).toBe('hono-trace-1');
      });

      expect(headerSpy).toHaveBeenCalledWith('x-weave-trace-id', 'hono-trace-1');
    });
  });

  // ─── Next.js ─────────────────────────────────────────

  describe('withWeaveNext', () => {
    it('wraps handler with context and sets trace ID on response', async () => {
      const handler = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true })));
      const wrapped = withWeaveNext(handler);
      const request = new Request('http://localhost/', { headers: {} });

      const response = await wrapped(request);

      expect(handler).toHaveBeenCalledWith(request);
      expect(response.headers.get('x-weave-trace-id')).toBeDefined();
    });

    it('uses incoming trace ID from request header', async () => {
      const handler = vi.fn().mockResolvedValue(new Response('ok'));
      const wrapped = withWeaveNext(handler);
      const request = new Request('http://localhost/', {
        headers: { 'x-weave-trace-id': 'next-trace-1' }
      });

      const response = await wrapped(request);

      expect(response.headers.get('x-weave-trace-id')).toBe('next-trace-1');
    });

    it('runs handler inside weave context', async () => {
      let capturedContext: WeaveContext | undefined;
      const handler = vi.fn(async () => {
        capturedContext = weave.current;
        return new Response('ok');
      });
      const wrapped = withWeaveNext(handler);
      const request = new Request('http://localhost/');

      await wrapped(request);

      expect(capturedContext).toBeDefined();
      expect(capturedContext?.values.traceId).toBeDefined();
    });

    it('supports custom header name', async () => {
      const handler = vi.fn().mockResolvedValue(new Response('ok'));
      const wrapped = withWeaveNext(handler, { headerName: 'x-my-trace' });
      const request = new Request('http://localhost/', {
        headers: { 'x-my-trace': 'custom-1' }
      });

      const response = await wrapped(request);

      expect(response.headers.get('x-my-trace')).toBe('custom-1');
    });
  });
});

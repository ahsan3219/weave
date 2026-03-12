/**
 * Hono middleware: request-scoped context and trace ID on response.
 * Use: app.use('*', weaveHono());
 * No peer dependency on Hono—compatible with (c, next) middleware shape.
 */

import { weave } from '../index.js';

const DEFAULT_HEADER = 'x-weave-trace-id';

export interface WeaveHonoOptions {
  headerName?: string;
  timeoutMs?: number;
}

interface HonoContext {
  req: { header: (name: string) => string | undefined };
  header: (name: string, value: string) => void;
  set?: (key: string, value: unknown) => void;
}

export function weaveHono(options: WeaveHonoOptions = {}) {
  const headerName = options.headerName ?? DEFAULT_HEADER;
  const timeoutMs = options.timeoutMs;

  return async function middleware(c: HonoContext, next: () => Promise<void>): Promise<void> {
    const traceId = c.req.header(headerName) ?? weave.autoTraceId();
    const ctx = weave.create({ requestId: traceId, traceId });
    if (c.set) c.set('weaveContext', ctx);
    c.header(headerName, traceId);

    const run = async (): Promise<void> => {
      await next();
    };

    if (timeoutMs != null && timeoutMs > 0) {
      await weave.runScoped(ctx, run, { timeoutMs });
    } else {
      await weave.runScoped(ctx, run);
    }
  };
}

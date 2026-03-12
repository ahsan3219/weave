/**
 * Express-style middleware: one-line request-scoped context and trace ID on response.
 * Use: app.use(weaveExpress());
 * Compatible with Express (req, res, next). No peer dependency on Express.
 */

import { weave } from '../index.js';

const DEFAULT_HEADER = 'x-weave-trace-id';

export interface WeaveExpressOptions {
  headerName?: string;
  timeoutMs?: number;
}

interface ExpressReq {
  headers?: Record<string, string | string[] | undefined>;
  header?(name: string): string | undefined;
}

interface ExpressRes {
  setHeader(name: string, value: string): unknown;
  on?(event: string, fn: () => void): unknown;
}

export function weaveExpress(options: WeaveExpressOptions = {}) {
  const headerName = options.headerName ?? DEFAULT_HEADER;
  const timeoutMs = options.timeoutMs;

  return function middleware(
    req: ExpressReq,
    res: ExpressRes,
    next: (err?: unknown) => void
  ): void {
    const raw = req.headers?.[headerName] ?? (typeof req.header === 'function' ? req.header(headerName) : undefined);
    const traceId = (typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined) ?? weave.autoTraceId();
    const ctx = weave.create({ requestId: traceId, traceId });

    if (timeoutMs != null && timeoutMs > 0) {
      weave
        .runScoped(
          ctx,
          () =>
            new Promise<void>((resolve, reject) => {
              if (res.on) {
                res.on('finish', resolve);
                res.on('close', resolve);
              } else {
                resolve();
              }
              weave.run(ctx, () => {
                weave.setTraceIdOnResponse(res, headerName);
                next();
              });
            }),
          { timeoutMs }
        )
        .catch(next);
    } else {
      weave.run(ctx, () => {
        weave.setTraceIdOnResponse(res, headerName);
        next();
      });
    }
  };
}

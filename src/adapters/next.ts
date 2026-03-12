/**
 * Next.js App Router / Route Handler wrapper: request-scoped context and trace ID on response.
 * Use: export const GET = withWeaveNext(async (request) => { ... return Response.json({}); });
 * No peer dependency on Next.js—works with Web Request/Response.
 */

import { weave } from '../index.js';

const DEFAULT_HEADER = 'x-weave-trace-id';

export interface WeaveNextOptions {
  headerName?: string;
  timeoutMs?: number;
}

type NextRouteHandler = (request: Request) => Promise<Response> | Response;

export function withWeaveNext(handler: NextRouteHandler, options: WeaveNextOptions = {}) {
  const headerName = options.headerName ?? DEFAULT_HEADER;
  const timeoutMs = options.timeoutMs;

  return async function wrapped(request: Request): Promise<Response> {
    const traceId = request.headers.get(headerName) ?? weave.autoTraceId();
    const ctx = weave.create({ requestId: traceId, traceId });

    const run = async (): Promise<Response> => {
      const res = await handler(request);
      const newHeaders = new Headers(res instanceof Response ? res.headers : undefined);
      newHeaders.set(headerName, traceId);
      if (res instanceof Response) {
        return new Response(res.body, { status: res.status, statusText: res.statusText, headers: newHeaders });
      }
      return res;
    };

    if (timeoutMs != null && timeoutMs > 0) {
      return weave.runScoped(ctx, run, { timeoutMs });
    }
    return weave.runScoped(ctx, run);
  };
}

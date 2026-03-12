/**
 * Fastify plugin: request-scoped context and trace ID on response.
 * Use: await fastify.register(weaveFastify());
 * Context is attached as request.weaveContext.
 * Use weave.run(request.weaveContext, fn) in route handlers for propagation.
 */

import type { WeaveContext } from '../index.js';
import { weave } from '../index.js';

const DEFAULT_HEADER = 'x-weave-trace-id';

export interface WeaveFastifyOptions {
  headerName?: string;
}

interface FastifyRequest {
  headers?: Record<string, string | string[] | undefined>;
}

interface FastifyReply {
  header(name: string, value: string): unknown;
}

interface FastifyInstance {
  addHook(name: string, fn: (request: FastifyRequest, reply: FastifyReply) => Promise<void> | void): void;
}

export function weaveFastify(options: WeaveFastifyOptions = {}) {
  const headerName = options.headerName ?? DEFAULT_HEADER;

  return function plugin(instance: FastifyInstance, _opts: unknown, done: (err?: Error) => void): void {
    instance.addHook('onRequest', (request: FastifyRequest, reply: FastifyReply) => {
      const raw = request.headers?.[headerName];
      const traceId = (typeof raw === 'string' ? raw : Array.isArray(raw) ? raw[0] : undefined) ?? weave.autoTraceId();
      const ctx = weave.create({ requestId: traceId, traceId });
      (request as FastifyRequest & { weaveContext: WeaveContext }).weaveContext = ctx;
      reply.header(headerName, traceId);
    });
    done();
  };
}

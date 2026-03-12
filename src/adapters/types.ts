/**
 * Minimal request/response shapes for framework adapters.
 * Compatible with Express, Fastify, Hono, and Node HTTP.
 */

export interface AdapterRequest {
  headers?: Record<string, string | string[] | undefined>;
  header?: (name: string) => string | undefined;
}

export interface AdapterResponse {
  setHeader?(name: string, value: string): unknown;
  headers?: Headers;
}

export interface AdapterNext {
  (): void;
  (err?: unknown): void;
}

export interface WeaveAdapterOptions {
  /** Header to read incoming trace ID from (e.g. from load balancer). */
  headerName?: string;
  /** Default timeout for the request scope (ms). */
  timeoutMs?: number;
}

export type ContextRecord = Record<string, unknown>;

export interface WeaveContext<T extends ContextRecord = ContextRecord> {
  readonly id: string;
  readonly values: Readonly<T>;
  readonly log: WeaveLogger<T>;
  readonly signal: AbortSignal;
  startSpan(name: string, attrs?: ContextRecord): WeaveSpan<T>;
  child<Next extends ContextRecord>(values: Next): WeaveContext<T & Next>;
  onCleanup(cleanup: () => void | Promise<void>): void;
  snapshot(): WeaveSnapshot<T>;
}

export interface WeaveSnapshot<T extends ContextRecord = ContextRecord> {
  id: string;
  values: T;
}

export interface WeaveLogger<T extends ContextRecord = ContextRecord> {
  debug(message: string, meta?: ContextRecord): void;
  info(message: string, meta?: ContextRecord): void;
  warn(message: string, meta?: ContextRecord): void;
  error(message: string, meta?: ContextRecord): void;
  success(message: string, meta?: ContextRecord): void;
}

export interface WeaveSpan<T extends ContextRecord = ContextRecord> {
  readonly id: string;
  readonly traceId: string;
  readonly parentId?: string;
  readonly name: string;
  end(meta?: ContextRecord): void;
  toJSON(): ContextRecord;
  readonly context: WeaveContext<T & { spanId: string; traceId: string }>;
}

export interface WeaveOptions {
  redactKeys?: string[];
  enablePatching?: boolean;
  headerName?: string;
}

interface InternalContext<T extends ContextRecord = ContextRecord> extends WeaveContext<T> {
  controller: AbortController;
  cleanups: Array<() => void | Promise<void>>;
}

const defaults: Required<WeaveOptions> = {
  redactKeys: ['password', 'token', 'authorization', 'apikey', 'secret'],
  enablePatching: true,
  headerName: 'x-weave-trace-id'
};

const color = {
  reset: '\x1b[0m',
  gray: '\x1b[90m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  green: '\x1b[32m'
};

const hasPerformanceNow = typeof performance !== 'undefined' && typeof performance.now === 'function';
const now = () => (hasPerformanceNow ? performance.now() : Date.now());

let currentContext: InternalContext | undefined;
let patched = false;

const original = {
  setTimeout: globalThis.setTimeout,
  setInterval: globalThis.setInterval,
  queueMicrotask: globalThis.queueMicrotask,
  promiseThen: Promise.prototype.then,
  promiseCatch: Promise.prototype.catch,
  promiseFinally: Promise.prototype.finally,
  eventTargetAdd: globalThis.EventTarget?.prototype.addEventListener
};

let originalFetch: typeof globalThis.fetch | undefined;

const listenerMap = new WeakMap<EventListenerOrEventListenerObject, EventListenerOrEventListenerObject>();

function randomId() {
  return Math.random().toString(16).slice(2, 10);
}

function formatMeta(meta: ContextRecord) {
  return Object.keys(meta).length > 0 ? meta : undefined;
}

function redact(value: unknown, redactKeys: string[]): unknown {
  if (typeof value === 'string') {
    if (/\b(?:sk|pk|tok|ghp)_[a-zA-Z0-9]{8,}\b/.test(value)) return '[REDACTED_TOKEN]';
    if (/^[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+$/.test(value)) return '[REDACTED_JWT]';
    return value;
  }
  if (Array.isArray(value)) return value.map((entry) => redact(entry, redactKeys));
  if (value && typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      out[key] = redactKeys.includes(key.toLowerCase()) ? '[REDACTED]' : redact(entry, redactKeys);
    }
    return out;
  }
  return value;
}

function withContext<T>(context: InternalContext | undefined, fn: () => T): T {
  const parent = currentContext;
  currentContext = context;
  try {
    return fn();
  } finally {
    currentContext = parent;
  }
}

type WeaveBoundFn<T extends (...args: any[]) => any> = T & { __weave_bound?: true };

function bindToCurrent<T extends (...args: any[]) => any>(fn: T): T {
  const maybeBound = fn as WeaveBoundFn<T>;
  if (maybeBound.__weave_bound) return fn;

  const boundContext = currentContext;
  const wrapped = ((...args: Parameters<T>) => withContext(boundContext, () => fn(...args))) as WeaveBoundFn<T>;
  wrapped.__weave_bound = true;
  return wrapped;
}

function patchGlobals(options: Required<WeaveOptions>) {
  if (patched || !options.enablePatching) return;
  patched = true;

  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: any[]) => {
    if (typeof handler === 'function') {
      const wrapped = bindToCurrent(handler as (...args: unknown[]) => unknown);
      return original.setTimeout(wrapped, timeout, ...args);
    }
    return original.setTimeout(handler, timeout, ...args);
  }) as typeof setTimeout;

  globalThis.setInterval = ((handler: TimerHandler, timeout?: number, ...args: any[]) => {
    if (typeof handler === 'function') {
      const wrapped = bindToCurrent(handler as (...args: unknown[]) => unknown);
      return original.setInterval(wrapped, timeout, ...args);
    }
    return original.setInterval(handler, timeout, ...args);
  }) as typeof setInterval;

  globalThis.queueMicrotask = ((cb: VoidFunction) => original.queueMicrotask(bindToCurrent(cb))) as typeof queueMicrotask;

  Promise.prototype.then = function <TResult1 = any, TResult2 = never>(
    this: Promise<any>,
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    const wrappedOnFulfilled = onfulfilled ? bindToCurrent(onfulfilled) : onfulfilled;
    const wrappedOnRejected = onrejected ? bindToCurrent(onrejected) : onrejected;
    return original.promiseThen.call(this, wrappedOnFulfilled, wrappedOnRejected) as Promise<TResult1 | TResult2>;
  };

  Promise.prototype.catch = function <TResult = never>(
    this: Promise<any>,
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<any> {
    const wrappedOnRejected = onrejected ? bindToCurrent(onrejected) : onrejected;
    return original.promiseCatch.call(this, wrappedOnRejected);
  };

  Promise.prototype.finally = function (this: Promise<any>, onfinally?: (() => void) | null): Promise<any> {
    const wrappedOnFinally = onfinally ? bindToCurrent(onfinally) : onfinally;
    return original.promiseFinally.call(this, wrappedOnFinally);
  };

  if (original.eventTargetAdd) {
    globalThis.EventTarget.prototype.addEventListener = function (
      type: string,
      listener: EventListenerOrEventListenerObject | null,
      options?: AddEventListenerOptions | boolean
    ) {
      if (!listener) return original.eventTargetAdd.call(this, type, listener, options);
      if (listenerMap.has(listener)) return original.eventTargetAdd.call(this, type, listenerMap.get(listener)!, options);

      const wrapped =
        typeof listener === 'function'
          ? bindToCurrent(listener)
          : { handleEvent: bindToCurrent(listener.handleEvent.bind(listener)) };

      listenerMap.set(listener, wrapped);
      return original.eventTargetAdd.call(this, type, wrapped, options);
    };
  }

  originalFetch = globalThis.fetch;
  if (originalFetch) {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const context = currentContext;
      if (!context) return originalFetch!(input, init);

      const headers = new Headers(init?.headers);
      headers.set(options.headerName, String(context.values.traceId ?? context.id));

      return withContext(context, () =>
        originalFetch!(input, {
          ...init,
          headers,
          signal: init?.signal ?? context.signal
        })
      );
    }) as typeof fetch;
  }
}

function createLogger<T extends ContextRecord>(context: WeaveContext<T>, options: Required<WeaveOptions>): WeaveLogger<T> {
  const isProd = typeof process !== 'undefined' && process.env?.NODE_ENV === 'production';

  const write = (level: keyof WeaveLogger, message: string, meta?: ContextRecord) => {
    const payload = {
      level,
      message,
      timestamp: new Date().toISOString(),
      ...context.values,
      ...formatMeta(redact(meta ?? {}, options.redactKeys) as ContextRecord)
    };

    if (isProd) {
      console.log(JSON.stringify(payload));
      return;
    }

    const levelColor =
      level === 'error' ? color.red : level === 'warn' ? color.yellow : level === 'success' ? color.green : level === 'debug' ? color.gray : color.cyan;

    console.log(`${levelColor}${level.toUpperCase()}${color.reset} ${message}`, payload);
  };

  return {
    debug: (message, meta) => write('debug', message, meta),
    info: (message, meta) => write('info', message, meta),
    warn: (message, meta) => write('warn', message, meta),
    error: (message, meta) => write('error', message, meta),
    success: (message, meta) => write('success', message, meta)
  };
}

function makeContext<T extends ContextRecord>(values: T, options: Required<WeaveOptions>, base?: InternalContext): InternalContext<T> {
  const id = String((values as Partial<{ traceId: string }>).traceId ?? base?.id ?? randomId());
  const controller = new AbortController();

  if (base) {
    if (base.signal.aborted) controller.abort(base.signal.reason);
    else base.signal.addEventListener('abort', () => controller.abort(base.signal.reason), { once: true });
  }

  let context: InternalContext<T>;

  const log = createLogger(
    {
      get id() {
        return context.id;
      },
      get values() {
        return context.values;
      },
      get log() {
        return context.log;
      },
      get signal() {
        return context.signal;
      },
      startSpan(name: string, attrs?: ContextRecord) {
        return context.startSpan(name, attrs);
      },
      child<Next extends ContextRecord>(nextValues: Next) {
        return context.child(nextValues);
      },
      onCleanup(cleanup: () => void | Promise<void>) {
        context.onCleanup(cleanup);
      },
      snapshot() {
        return context.snapshot();
      }
    },
    options
  );

  context = {
    id,
    values: Object.freeze({ ...values }),
    log,
    signal: controller.signal,
    controller,
    cleanups: [],
    startSpan(name: string, attrs?: ContextRecord): WeaveSpan<T> {
      const startedAt = now();
      const spanId = randomId();
      const traceId = String((context.values as Partial<{ traceId: string }>).traceId ?? context.id);
      const parentSpanValue = (context.values as Partial<{ spanId: string }>).spanId;
      const parentId = typeof parentSpanValue === 'string' ? parentSpanValue : undefined;
      const spanContext = context.child({ spanId, traceId } as { spanId: string; traceId: string });

      const span: WeaveSpan<T> = {
        id: spanId,
        traceId,
        ...(parentId ? { parentId } : {}),
        name,
        context: spanContext,
        end(meta?: ContextRecord) {
          const durationMs = Math.round((now() - startedAt) * 100) / 100;
          spanContext.log.info(`span:${name}`, { durationMs, ...attrs, ...meta, spanId, parentId, traceId });
        },
        toJSON() {
          return { spanId, parentId, traceId, name, startedAt };
        }
      };

      return span;
    },
    child<Next extends ContextRecord>(nextValues: Next): InternalContext<T & Next> {
      return makeContext({ ...(context.values as object), ...(nextValues as object) } as T & Next, options, context);
    },
    onCleanup(cleanup: () => void | Promise<void>) {
      context.cleanups.push(cleanup);
    },
    snapshot(): WeaveSnapshot<T> {
      return {
        id: context.id,
        values: { ...(context.values as object) } as T
      };
    }
  };

  return context;
}

async function runCleanups(context: InternalContext) {
  const jobs = context.cleanups.splice(0);
  for (const cleanup of jobs) {
    await cleanup();
  }
}

export const weave = {
  create<T extends ContextRecord>(values: T, options?: WeaveOptions): WeaveContext<T> {
    const resolved = { ...defaults, ...options };
    patchGlobals(resolved);
    return makeContext(values, resolved);
  },

  fromSnapshot<T extends ContextRecord>(snapshot: WeaveSnapshot<T>, options?: WeaveOptions): WeaveContext<T> {
    const resolved = { ...defaults, ...options };
    patchGlobals(resolved);
    return makeContext(snapshot.values, resolved);
  },

  get current(): WeaveContext | undefined {
    return currentContext;
  },

  run<T>(context: WeaveContext, fn: () => T): T {
    return withContext(context as InternalContext, fn);
  },

  async runScoped<T>(context: WeaveContext, fn: () => T | Promise<T>): Promise<T> {
    const internal = context as InternalContext;
    try {
      return await withContext(internal, fn);
    } finally {
      await runCleanups(internal);
    }
  },

  bind<T extends (...args: any[]) => any>(fn: T): T {
    return bindToCurrent(fn);
  },

  guard<T extends (...args: any[]) => any>(name: string, fn: T): T {
    const guarded = ((...args: Parameters<T>) => {
      try {
        const result = fn(...args);
        if (result instanceof Promise) {
          return result.catch((error: unknown) => {
            currentContext?.log.error(`guard:${name}`, { error: error instanceof Error ? error.message : String(error) });
            throw error;
          });
        }
        return result;
      } catch (error) {
        currentContext?.log.error(`guard:${name}`, { error: error instanceof Error ? error.message : String(error) });
        throw error;
      }
    }) as T;

    return bindToCurrent(guarded);
  },

  async withTimeout<T>(label: string, ms: number, task: (signal: AbortSignal) => Promise<T>): Promise<T> {
    const localController = new AbortController();
    const timer = setTimeout(() => localController.abort(new Error(`Timeout in ${label} after ${ms}ms`)), ms);

    const parent = currentContext;
    if (parent) {
      if (parent.signal.aborted) localController.abort(parent.signal.reason);
      else parent.signal.addEventListener('abort', () => localController.abort(parent.signal.reason), { once: true });
    }

    try {
      return await task(localController.signal);
    } catch (error) {
      parent?.log.error(`timeout:${label}`, { ms, error: error instanceof Error ? error.message : String(error) });
      throw error;
    } finally {
      clearTimeout(timer);
    }
  },

  cancel(reason?: unknown): void {
    currentContext?.controller.abort(reason);
  },

  autoTraceId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return `${Date.now().toString(16)}-${randomId()}`;
  }
};

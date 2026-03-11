export type ContextRecord = Record<string, unknown>;

export interface WeaveContext<T extends ContextRecord = ContextRecord> {
  readonly id: string;
  readonly values: Readonly<T>;
  readonly log: WeaveLogger<T>;
  startSpan(name: string, attrs?: ContextRecord): WeaveSpan<T>;
  child<Next extends ContextRecord>(values: Next): WeaveContext<T & Next>;
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
  context: WeaveContext<T & { spanId: string; traceId: string }>;
}

interface InternalContext<T extends ContextRecord = ContextRecord> extends WeaveContext<T> {
  __brand: 'weave_ctx';
}

interface WeaveOptions {
  redactKeys?: string[];
  enablePatching?: boolean;
  headerName?: string;
}

const defaults: Required<WeaveOptions> = {
  redactKeys: ['password', 'token', 'authorization', 'apiKey', 'secret'],
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

let currentContext: InternalContext | undefined;
let patched = false;

const original = {
  setTimeout: globalThis.setTimeout,
  setInterval: globalThis.setInterval,
  queueMicrotask: globalThis.queueMicrotask,
  promiseThen: Promise.prototype.then,
  promiseCatch: Promise.prototype.catch,
  promiseFinally: Promise.prototype.finally,
  eventTargetAdd: globalThis.EventTarget?.prototype.addEventListener,
  fetch: globalThis.fetch
};

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

function bindToCurrent<T extends (...args: any[]) => any>(fn: T): T {
  if ((fn as any).__weave_bound) return fn;
  const boundContext = currentContext;
  const bound = ((...args: Parameters<T>) => withContext(boundContext, () => fn(...args))) as T;
  (bound as any).__weave_bound = true;
  return bound;
}

function patchGlobals(options: Required<WeaveOptions>) {
  if (patched || !options.enablePatching) return;
  patched = true;

  globalThis.setTimeout = ((handler: TimerHandler, timeout?: number, ...args: any[]) => {
    if (typeof handler === 'function') return original.setTimeout(bindToCurrent(handler), timeout, ...args);
    return original.setTimeout(handler, timeout, ...args);
  }) as typeof setTimeout;

  globalThis.setInterval = ((handler: TimerHandler, timeout?: number, ...args: any[]) => {
    if (typeof handler === 'function') return original.setInterval(bindToCurrent(handler), timeout, ...args);
    return original.setInterval(handler, timeout, ...args);
  }) as typeof setInterval;

  globalThis.queueMicrotask = ((cb: VoidFunction) => original.queueMicrotask(bindToCurrent(cb))) as typeof queueMicrotask;

  Promise.prototype.then = function <TResult1 = any, TResult2 = never>(
    this: Promise<any>,
    onfulfilled?: ((value: any) => TResult1 | PromiseLike<TResult1>) | null,
    onrejected?: ((reason: any) => TResult2 | PromiseLike<TResult2>) | null
  ): Promise<TResult1 | TResult2> {
    return original.promiseThen.call(
      this,
      onfulfilled ? bindToCurrent(onfulfilled as any) : onfulfilled,
      onrejected ? bindToCurrent(onrejected as any) : onrejected
    );
  };

  Promise.prototype.catch = function <TResult = never>(
    this: Promise<any>,
    onrejected?: ((reason: any) => TResult | PromiseLike<TResult>) | null
  ): Promise<any> {
    return original.promiseCatch.call(this, onrejected ? bindToCurrent(onrejected as any) : onrejected);
  };

  Promise.prototype.finally = function (this: Promise<any>, onfinally?: (() => void) | null): Promise<any> {
    return original.promiseFinally.call(this, onfinally ? bindToCurrent(onfinally) : onfinally);
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

  if (original.fetch) {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
      const context = currentContext;
      if (!context) return original.fetch!(input as any, init);

      const headers = new Headers(init?.headers);
      const traceId = String(context.values.traceId ?? context.id);
      headers.set(options.headerName, traceId);

      return withContext(context, () => original.fetch!(input as any, { ...init, headers }));
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
      level === 'error'
        ? color.red
        : level === 'warn'
          ? color.yellow
          : level === 'success'
            ? color.green
            : level === 'debug'
              ? color.gray
              : color.cyan;

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

function makeContext<T extends ContextRecord>(values: T, options: Required<WeaveOptions>): InternalContext<T> {
  const id = String(values.traceId ?? randomId());
  const ctx: InternalContext<T> = {
    __brand: 'weave_ctx',
    id,
    values: Object.freeze({ ...values }),
    log: undefined as unknown as WeaveLogger<T>,
    startSpan(name: string, attrs?: ContextRecord): WeaveSpan<T> {
      const startedAt = performance.now();
      const spanId = randomId();
      const traceId = String((ctx.values as any).traceId ?? ctx.id);
      const parentId = typeof (ctx.values as any).spanId === 'string' ? String((ctx.values as any).spanId) : undefined;
      const spanContext = ctx.child({ spanId, traceId } as any);

      return {
        id: spanId,
        traceId,
        parentId,
        name,
        context: spanContext,
        end(meta?: ContextRecord) {
          const durationMs = Math.round((performance.now() - startedAt) * 100) / 100;
          spanContext.log.info(`span:${name}`, { durationMs, ...attrs, ...meta, spanId, parentId, traceId });
        },
        toJSON() {
          return { spanId, parentId, traceId, name, startedAt };
        }
      };
    },
    child<Next extends ContextRecord>(nextValues: Next): InternalContext<T & Next> {
      return makeContext({ ...(ctx.values as object), ...(nextValues as object) } as T & Next, options);
    }
  };

  ctx.log = createLogger(ctx, options);
  return ctx;
}

export const weave = {
  create<T extends ContextRecord>(values: T, options?: WeaveOptions): WeaveContext<T> {
    const resolved = { ...defaults, ...options };
    patchGlobals(resolved);
    return makeContext(values, resolved);
  },

  get current(): WeaveContext | undefined {
    return currentContext;
  },

  run<T>(context: WeaveContext, fn: () => T): T {
    return withContext(context as InternalContext, fn);
  },

  bind<T extends (...args: any[]) => any>(fn: T): T {
    return bindToCurrent(fn);
  },

  autoTraceId(): string {
    if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
    return `${Date.now().toString(16)}-${randomId()}`;
  }
};

export type { WeaveOptions };

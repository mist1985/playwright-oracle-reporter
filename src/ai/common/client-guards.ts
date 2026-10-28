/**
 * Shared request guards for AI providers.
 */

export class RateLimiter {
  private tokens: number;
  private lastRefill: number;
  private readonly maxTokens: number;
  private readonly refillRate: number;

  constructor(maxTokens: number = 50, refillRate: number = 10) {
    this.maxTokens = maxTokens;
    this.refillRate = refillRate;
    this.tokens = maxTokens;
    this.lastRefill = Date.now();
  }

  async acquire(): Promise<void> {
    this.refill();

    while (this.tokens < 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
      this.refill();
    }

    this.tokens--;
  }

  private refill(): void {
    const now = Date.now();
    const elapsed = (now - this.lastRefill) / 1000;
    const tokensToAdd = elapsed * this.refillRate;

    this.tokens = Math.min(this.maxTokens, this.tokens + tokensToAdd);
    this.lastRefill = now;
  }
}

export class CircuitBreaker {
  private failures = 0;
  private lastFailureTime = 0;
  private state: "closed" | "open" | "half-open" = "closed";
  private readonly threshold = 5;
  private readonly resetTimeout = 60000;

  async execute<T>(fn: () => Promise<T>): Promise<T | null> {
    if (this.state === "open") {
      const now = Date.now();
      if (now - this.lastFailureTime > this.resetTimeout) {
        this.state = "half-open";
        this.failures = 0;
      } else {
        throw new Error("Circuit breaker is OPEN - too many failures");
      }
    }

    try {
      const result = await fn();
      // Any success closes the circuit: the threshold counts *consecutive* failures.
      this.state = "closed";
      this.failures = 0;
      return result;
    } catch (error) {
      this.failures++;
      this.lastFailureTime = Date.now();

      // A failed half-open probe re-opens the circuit immediately.
      if (this.state === "half-open" || this.failures >= this.threshold) {
        this.state = "open";
      }

      throw error;
    }
  }

  getState(): string {
    return this.state;
  }

  /** True while the breaker is rejecting calls (open and not yet due for a half-open probe). */
  isOpen(): boolean {
    return this.state === "open" && Date.now() - this.lastFailureTime <= this.resetTimeout;
  }
}

/** Upper bound for any single retry wait, including server-provided Retry-After. */
export const MAX_RETRY_WAIT_MS = 30_000;

/**
 * Exponential backoff for retry `attempt` (1-based), optionally honouring a
 * server-provided Retry-After delay. Always capped at {@link MAX_RETRY_WAIT_MS}.
 */
export function computeBackoffMs(attempt: number, retryAfterMs?: number): number {
  if (retryAfterMs !== undefined && retryAfterMs >= 0) {
    return Math.min(retryAfterMs, MAX_RETRY_WAIT_MS);
  }
  return Math.min(1000 * Math.pow(2, attempt), 10000);
}

/**
 * Parse an HTTP `Retry-After` header (delta-seconds or HTTP-date) into milliseconds.
 */
export function parseRetryAfterMs(value: string | null | undefined): number | undefined {
  if (!value) return undefined;
  const trimmed = value.trim();
  if (/^\d+(\.\d+)?$/.test(trimmed)) {
    return Math.round(parseFloat(trimmed) * 1000);
  }
  const date = Date.parse(trimmed);
  if (Number.isFinite(date)) {
    return Math.max(0, date - Date.now());
  }
  return undefined;
}

/**
 * Read `Retry-After` from a fetch response. Tolerates minimal response
 * objects (e.g. test doubles) that do not expose headers.
 */
export function retryAfterFromResponse(res: {
  headers?: { get?: (name: string) => string | null } | null;
}): number | undefined {
  const get = res.headers?.get;
  if (typeof get !== "function") return undefined;
  return parseRetryAfterMs(get.call(res.headers, "retry-after"));
}

/**
 * Sleep that resolves early when `signal` aborts and never keeps the process alive.
 */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve();
      return;
    }
    const onAbort = () => {
      clearTimeout(timer);
      resolve();
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    timer.unref();
    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

/** Thrown when a request was cancelled by the caller (e.g. the overall AI timeout). */
export class RequestAbortedError extends Error {
  constructor() {
    super("AI request aborted");
    this.name = "RequestAbortedError";
  }
}

/** Thrown when a request kept failing after all retries; counted by the circuit breaker. */
export class RequestFailedError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RequestFailedError";
  }
}

/** Parse a positive integer env value with a safe fallback. */
export function safeInt(raw: string | undefined, fallback: number, min = 0): number {
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = parseInt(raw, 10);
  return Number.isFinite(n) && n >= min ? n : fallback;
}

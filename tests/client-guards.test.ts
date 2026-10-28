import {
  CircuitBreaker,
  abortableSleep,
  computeBackoffMs,
  parseRetryAfterMs,
  retryAfterFromResponse,
  safeInt,
  MAX_RETRY_WAIT_MS,
} from "../src/ai/common/client-guards";

describe("CircuitBreaker", () => {
  const fail = () => Promise.reject(new Error("x"));
  const ok = () => Promise.resolve("ok");

  it("opens after 5 consecutive failures", async () => {
    const breaker = new CircuitBreaker();
    for (let i = 0; i < 5; i++) {
      await expect(breaker.execute(fail)).rejects.toThrow("x");
    }
    expect(breaker.isOpen()).toBe(true);
    await expect(breaker.execute(ok)).rejects.toThrow("Circuit breaker is OPEN");
  });

  it("counts consecutive failures only (a success resets the count)", async () => {
    const breaker = new CircuitBreaker();
    for (let round = 0; round < 3; round++) {
      for (let i = 0; i < 4; i++) {
        await expect(breaker.execute(fail)).rejects.toThrow();
      }
      await expect(breaker.execute(ok)).resolves.toBe("ok");
    }
    expect(breaker.getState()).toBe("closed");
  });

  it("re-opens immediately when the half-open probe fails", async () => {
    const breaker = new CircuitBreaker();
    for (let i = 0; i < 5; i++) {
      await expect(breaker.execute(fail)).rejects.toThrow();
    }
    const now = Date.now();
    const spy = jest.spyOn(Date, "now").mockReturnValue(now + 61_000);
    try {
      await expect(breaker.execute(fail)).rejects.toThrow("x");
      expect(breaker.getState()).toBe("open");
    } finally {
      spy.mockRestore();
    }
  });
});

describe("retry helpers", () => {
  it("parses Retry-After seconds and HTTP dates", () => {
    expect(parseRetryAfterMs("3")).toBe(3000);
    expect(parseRetryAfterMs("1.5")).toBe(1500);
    expect(parseRetryAfterMs(null)).toBeUndefined();
    expect(parseRetryAfterMs("soon")).toBeUndefined();
    const inFuture = new Date(Date.now() + 5000).toUTCString();
    const ms = parseRetryAfterMs(inFuture)!;
    expect(ms).toBeGreaterThan(3000);
    expect(ms).toBeLessThanOrEqual(5000);
  });

  it("caps backoff and Retry-After", () => {
    expect(computeBackoffMs(1)).toBe(2000);
    expect(computeBackoffMs(10)).toBe(10000);
    expect(computeBackoffMs(1, 500)).toBe(500);
    expect(computeBackoffMs(1, 10 * 60_000)).toBe(MAX_RETRY_WAIT_MS);
  });

  it("reads Retry-After from responses and tolerates missing headers", () => {
    expect(retryAfterFromResponse({ headers: { get: () => "2" } })).toBe(2000);
    expect(retryAfterFromResponse({})).toBeUndefined();
    expect(retryAfterFromResponse({ headers: null })).toBeUndefined();
  });

  it("abortableSleep resolves early on abort", async () => {
    const controller = new AbortController();
    const started = Date.now();
    const sleep = abortableSleep(10_000, controller.signal);
    controller.abort();
    await sleep;
    expect(Date.now() - started).toBeLessThan(500);
  });

  it("abortableSleep resolves immediately for an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(abortableSleep(10_000, controller.signal)).resolves.toBeUndefined();
  });
});

describe("safeInt", () => {
  it("falls back for missing, invalid or below-minimum values", () => {
    expect(safeInt(undefined, 7)).toBe(7);
    expect(safeInt("", 7)).toBe(7);
    expect(safeInt("abc", 7)).toBe(7);
    expect(safeInt("0", 7, 1)).toBe(7);
    expect(safeInt("-3", 7)).toBe(7);
    expect(safeInt("42", 7)).toBe(42);
  });
});

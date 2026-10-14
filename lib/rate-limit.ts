export type RateCheck = { ok: true } | { ok: false; retryAfterSec: number };

export type RateLimiter = {
  check: (key: string, now?: number) => RateCheck;
};

export function createRateLimiter(opts: { limit: number; windowMs: number }): RateLimiter {
  const hits = new Map<string, number[]>();
  return {
    check(key: string, now = Date.now()) {
      const start = now - opts.windowMs;
      const prev = (hits.get(key) || []).filter((stamp) => stamp > start);
      if (prev.length >= opts.limit) {
        hits.set(key, prev);
        const retryAfterSec = Math.max(1, Math.ceil((prev[0] + opts.windowMs - now) / 1000));
        return { ok: false, retryAfterSec };
      }
      prev.push(now);
      hits.set(key, prev);
      return { ok: true };
    },
  };
}

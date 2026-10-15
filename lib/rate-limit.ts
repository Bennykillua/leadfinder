import "server-only";

// Small in-memory limiter for sign-in and sign-up attempts. Per server process,
// which is fine for one droplet.
const hits = new Map<string, { count: number; resetAt: number }>();

export function tooManyAttempts(key: string, limit: number, windowMs: number): boolean {
  const now = Date.now();
  const entry = hits.get(key);
  if (!entry || entry.resetAt < now) {
    hits.set(key, { count: 1, resetAt: now + windowMs });
    return false;
  }
  entry.count++;
  return entry.count > limit;
}

export function clearAttempts(key: string) {
  hits.delete(key);
}

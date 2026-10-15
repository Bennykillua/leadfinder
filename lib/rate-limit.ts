import "server-only";

// Small in-memory limiters, per server process (fine for one droplet).

// --- Failed sign-ins: a short backoff, never a permanent lock ---
// Only failures count. Reaching `maxFailures` within `windowMs` starts a wait of
// `windowMs`; it ends on its own, and a successful sign-in clears the count. So
// mistyping someone's email can delay them at most one window, never lock them out.
const failures = new Map<string, { count: number; firstAt: number; blockedUntil: number }>();

// Milliseconds until this key may try again (0 = may try now).
export function backoffRemaining(key: string): number {
  const entry = failures.get(key);
  return entry ? Math.max(0, entry.blockedUntil - Date.now()) : 0;
}

export function recordFailure(key: string, maxFailures: number, windowMs: number) {
  const now = Date.now();
  const entry = failures.get(key);
  // Start counting afresh once the window (or a finished wait) is over.
  if (!entry || now - entry.firstAt > windowMs || (entry.blockedUntil && now >= entry.blockedUntil)) {
    failures.set(key, { count: 1, firstAt: now, blockedUntil: maxFailures <= 1 ? now + windowMs : 0 });
    return;
  }
  entry.count++;
  if (entry.count >= maxFailures) entry.blockedUntil = now + windowMs;
}

export function clearFailures(key: string) {
  failures.delete(key);
}

// --- Plain rate limit (sign-ups per IP) ---
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

import "server-only";
import { randomUUID } from "node:crypto";
import { cookies } from "next/headers";
import { and, eq, gt, lt } from "drizzle-orm";
import { jwtVerify, SignJWT } from "jose";
import { db } from "@/lib/db";
import { sessions } from "@/lib/db/schema";

// Sessions: a signed JWT (HS256, AUTH_SECRET) in an httpOnly cookie, carrying a
// session id (jti) that must still exist in the session table. The signature stops
// forged cookies; the table makes sign-out immediate and revocable.

const COOKIE = "lf_session";
const MAX_AGE_S = 30 * 24 * 60 * 60;
const ISSUER = "leadfinder";

function key() {
  const secret = process.env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET must be set in .env.local and be at least 32 characters (try: openssl rand -base64 33).");
  }
  return new TextEncoder().encode(secret);
}

export async function createSession(userId: string) {
  const id = randomUUID();
  const now = new Date();
  const expiresAt = new Date(now.getTime() + MAX_AGE_S * 1000);
  // Tidy up this user's expired sessions while we're here.
  await db.delete(sessions).where(and(eq(sessions.userId, userId), lt(sessions.expiresAt, now)));
  await db.insert(sessions).values({ id, userId, createdAt: now, expiresAt });

  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setJti(id)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(Math.floor(expiresAt.getTime() / 1000))
    .sign(key());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

async function verify(token: string) {
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: ISSUER, algorithms: ["HS256"] });
    return typeof payload.sub === "string" && typeof payload.jti === "string"
      ? { userId: payload.sub, sessionId: payload.jti }
      : null;
  } catch {
    return null;
  }
}

// The signed-in user's id, or null: needs a valid, unexpired JWT whose session row
// still exists (it's deleted on sign-out).
export async function readSession(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  const claims = await verify(token);
  if (!claims) return null;
  const row = await db.query.sessions.findFirst({
    where: and(
      eq(sessions.id, claims.sessionId),
      eq(sessions.userId, claims.userId),
      gt(sessions.expiresAt, new Date()),
    ),
    columns: { id: true },
  });
  return row ? claims.userId : null;
}

// Sign out: revoke this session server-side, then clear the cookie.
export async function deleteSession() {
  const jar = await cookies();
  const token = jar.get(COOKIE)?.value;
  const claims = token ? await verify(token) : null;
  if (claims) await db.delete(sessions).where(eq(sessions.id, claims.sessionId));
  jar.delete(COOKIE);
}

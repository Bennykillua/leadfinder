import "server-only";
import { cookies } from "next/headers";
import { jwtVerify, SignJWT } from "jose";

// Sessions are a signed JWT (HS256) in an httpOnly cookie. Stateless: signing out
// deletes the cookie. AUTH_SECRET signs it.

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
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(userId)
    .setIssuer(ISSUER)
    .setIssuedAt()
    .setExpirationTime(`${MAX_AGE_S}s`)
    .sign(key());
  (await cookies()).set(COOKIE, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_S,
  });
}

// The signed-in user's id, or null if there's no valid, unexpired token.
export async function readSession(): Promise<string | null> {
  const token = (await cookies()).get(COOKIE)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, key(), { issuer: ISSUER, algorithms: ["HS256"] });
    return typeof payload.sub === "string" ? payload.sub : null;
  } catch {
    return null;
  }
}

export async function deleteSession() {
  (await cookies()).delete(COOKIE);
}

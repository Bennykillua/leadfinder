import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

// Password hashing with Node's built-in scrypt (no native packages to install).
// Format: scrypt$N$r$p$<salt base64>$<hash base64>
// No path aliases here: scripts/set-password.ts imports this file directly.

// OWASP's minimum for scrypt: N=2^17, r=8, p=1 (about 128 MiB per hash).
const N = 2 ** 17;
const R = 8;
const P = 1;
const KEY_LEN = 64;
const MAX_MEM = 256 * 1024 * 1024;

function derive(password: string, salt: Buffer, opts: ScryptOptions & { N: number }): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize("NFKC"), salt, KEY_LEN, { ...opts, maxmem: MAX_MEM }, (err, key) =>
      err ? reject(err) : resolve(key),
    ),
  );
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt, { N, r: R, p: P });
  return ["scrypt", N, R, P, salt.toString("base64"), key.toString("base64")].join("$");
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, hash] = stored.split("$");
  if (scheme !== "scrypt" || !salt || !hash) return false;
  const expected = Buffer.from(hash, "base64");
  const key = await derive(password, Buffer.from(salt, "base64"), { N: Number(n), r: Number(r), p: Number(p) });
  return key.length === expected.length && timingSafeEqual(key, expected);
}

// True for hashes made with weaker settings than today's (e.g. before N was raised),
// so sign-in can quietly re-hash them with the password it just verified.
export function needsRehash(stored: string): boolean {
  const [scheme, n, r, p] = stored.split("$");
  return scheme !== "scrypt" || Number(n) < N || Number(r) < R || Number(p) < P;
}

export const PASSWORD_MIN = 8;
export const PASSWORD_MAX = 200;

/**
 * Agent-token acquisition with on-disk caching. The CLI authenticates the
 * `agents` collection with stored credentials and reuses the resulting token
 * until it nears expiry, re-authenticating transparently.
 */
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { COLLECTIONS } from "@miniboss/shared";
import { configDir, tokenCachePath, type AgentCredentials } from "./config.ts";
import { authWithPassword } from "./pocketbase.ts";

interface TokenCache {
  token: string;
  exp: number; // unix seconds
  server: string;
  email: string;
}

/** Decode a JWT exp claim (unix seconds) without verifying the signature. */
function jwtExp(token: string): number | null {
  const parts = token.split(".");
  if (parts.length !== 3) return null;
  try {
    const payload = JSON.parse(Buffer.from(parts[1]!, "base64url").toString("utf8"));
    return typeof payload.exp === "number" ? payload.exp : null;
  } catch {
    return null;
  }
}

async function readCache(): Promise<TokenCache | null> {
  const path = tokenCachePath();
  if (!existsSync(path)) return null;
  try {
    return JSON.parse(await readFile(path, "utf8")) as TokenCache;
  } catch {
    return null;
  }
}

async function writeCache(cache: TokenCache): Promise<void> {
  await mkdir(configDir(), { recursive: true, mode: 0o700 });
  await writeFile(tokenCachePath(), JSON.stringify(cache), { mode: 0o600 });
  await chmod(tokenCachePath(), 0o600).catch(() => {});
}

const SKEW_SECONDS = 120;

/**
 * Return a valid agent token, using the cache when fresh and re-authenticating
 * when missing/expired/mismatched. `nowSeconds` is injectable for tests.
 */
export async function getAgentToken(
  server: string,
  creds: AgentCredentials,
  nowSeconds: number = Math.floor(Date.now() / 1000)
): Promise<string> {
  const cache = await readCache();
  if (
    cache &&
    cache.server === server &&
    cache.email === creds.email &&
    cache.exp - SKEW_SECONDS > nowSeconds
  ) {
    return cache.token;
  }

  const auth = await authWithPassword(server, COLLECTIONS.agents, creds.email, creds.password);
  const exp = jwtExp(auth.token) ?? nowSeconds + 600;
  await writeCache({ token: auth.token, exp, server, email: creds.email });
  return auth.token;
}

/** Drop the cached token (used when a request unexpectedly 401s). */
export async function clearTokenCache(): Promise<void> {
  const path = tokenCachePath();
  if (existsSync(path)) {
    await writeFile(path, "{}", { mode: 0o600 }).catch(() => {});
  }
}

export { jwtExp as _jwtExp };

/**
 * Configuration resolution. Two layers:
 *   - per-user (~/.config/miniboss/config.json, mode 600): server + agent creds
 *   - per-repo (.miniboss/config.json, committed): team + project + optional server
 * Environment variables override both. All reads are validated at the boundary.
 */
import { existsSync } from "node:fs";
import { chmod, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { z } from "zod";
import { repoConfigSchema, type RepoConfig } from "@miniboss/shared";

export const userConfigSchema = z.object({
  server: z.string().url().nullish(),
  agentEmail: z.string().nullish(),
  agentPassword: z.string().nullish(),
});
export type UserConfig = z.infer<typeof userConfigSchema>;

export function configDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME;
  const base = xdg && xdg.length > 0 ? xdg : join(homedir(), ".config");
  return join(base, "miniboss");
}

export function userConfigPath(): string {
  return join(configDir(), "config.json");
}

export function tokenCachePath(): string {
  return join(configDir(), "token.json");
}

export function logPath(): string {
  return join(configDir(), "miniboss.log");
}

export function outboxDir(): string {
  return join(configDir(), "outbox");
}

/** Load and validate the per-user config; returns empty config if absent. */
export async function loadUserConfig(): Promise<UserConfig> {
  const path = userConfigPath();
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(await readFile(path, "utf8"));
    return userConfigSchema.parse(parsed);
  } catch {
    return {};
  }
}

/** Merge and persist per-user config with secure permissions (dir 700, file 600). */
export async function saveUserConfig(patch: Partial<UserConfig>): Promise<void> {
  const dir = configDir();
  await mkdir(dir, { recursive: true, mode: 0o700 });
  await chmod(dir, 0o700).catch(() => {});
  const current = await loadUserConfig();
  const next = userConfigSchema.parse({ ...current, ...patch });
  await writeFile(userConfigPath(), JSON.stringify(next, null, 2), { mode: 0o600 });
  await chmod(userConfigPath(), 0o600).catch(() => {});
}

/** Load and validate the per-repo committed config, or null if missing/invalid. */
export async function loadRepoConfig(repoRoot: string): Promise<RepoConfig | null> {
  const path = join(repoRoot, ".miniboss", "config.json");
  if (!existsSync(path)) return null;
  try {
    return repoConfigSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return null;
  }
}

/** Resolve the server URL: env > repo config > user config. */
export function resolveServer(
  repoConfig: RepoConfig | null,
  userConfig: UserConfig
): string | null {
  return (
    process.env.MINIBOSS_SERVER ??
    repoConfig?.server ??
    userConfig.server ??
    null
  );
}

export interface AgentCredentials {
  email: string;
  password: string;
}

/** Resolve agent credentials: env > user config. Null if incomplete. */
export function resolveAgentCredentials(userConfig: UserConfig): AgentCredentials | null {
  const email = process.env.MINIBOSS_AGENT_EMAIL ?? userConfig.agentEmail ?? null;
  const password = process.env.MINIBOSS_AGENT_PASSWORD ?? userConfig.agentPassword ?? null;
  if (!email || !password) return null;
  return { email, password };
}

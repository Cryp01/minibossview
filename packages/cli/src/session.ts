/**
 * Opens an authenticated board session from resolved config. Distinguishes
 * "not configured" (returns null — nothing we can do) from "network/auth
 * failure" (throws — caller queues to the outbox).
 */
import type { RepoConfig } from "@miniboss/shared";
import { getAgentToken } from "./auth.ts";
import {
  loadUserConfig,
  resolveAgentCredentials,
  resolveServer,
  type UserConfig,
} from "./config.ts";
import { PbClient } from "./pocketbase.ts";

export interface BoardSession {
  client: PbClient;
  server: string;
}

export interface ResolvedConfig {
  server: string | null;
  hasCredentials: boolean;
}

/** Inspect configuration without opening a connection (used by `doctor`). */
export async function inspectConfig(repoConfig: RepoConfig | null): Promise<ResolvedConfig> {
  const userConfig = await loadUserConfig();
  return {
    server: resolveServer(repoConfig, userConfig),
    hasCredentials: resolveAgentCredentials(userConfig) !== null,
  };
}

/**
 * Open a session, or null if the CLI is not configured (missing server or
 * credentials). Throws on auth/network failure so callers can fall back to the
 * offline outbox.
 */
export async function openSession(
  repoConfig: RepoConfig | null,
  userConfig?: UserConfig
): Promise<BoardSession | null> {
  const cfg = userConfig ?? (await loadUserConfig());
  const server = resolveServer(repoConfig, cfg);
  const creds = resolveAgentCredentials(cfg);
  if (!server || !creds) return null;

  const token = await getAgentToken(server, creds);
  return { client: new PbClient(server, token), server };
}

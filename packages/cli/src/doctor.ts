/**
 * Health check for an installed CLI: configuration, connectivity, git identity.
 * Read-only and side-effect free (beyond a token fetch on success).
 */
import { COLLECTIONS } from "@miniboss/shared";
import { loadRepoConfig, loadUserConfig, resolveAgentCredentials, resolveServer } from "./config.ts";
import { readGitContext } from "./git.ts";
import { openSession } from "./session.ts";

export interface DoctorCheck {
  label: string;
  ok: boolean;
  detail: string;
}

export interface DoctorReport {
  ok: boolean;
  checks: DoctorCheck[];
}

export async function doctor(cwd: string): Promise<DoctorReport> {
  const checks: DoctorCheck[] = [];
  const userConfig = await loadUserConfig();

  const git = await readGitContext(cwd);
  const repoRoot = git?.repoRoot ?? null;
  const repoConfig = repoRoot ? await loadRepoConfig(repoRoot) : null;

  const server = resolveServer(repoConfig, userConfig);
  checks.push({
    label: "server configured",
    ok: Boolean(server),
    detail: server ?? "not set (run: miniboss config set-server <url>)",
  });

  const creds = resolveAgentCredentials(userConfig);
  checks.push({
    label: "agent credentials",
    ok: Boolean(creds),
    detail: creds ? `agent: ${creds.email}` : "not set (run: miniboss config set-agent <email>)",
  });

  // Connectivity + auth (only if configured).
  if (server && creds) {
    try {
      const session = await openSession(repoConfig, userConfig);
      if (session) {
        await session.client.list(COLLECTIONS.teams, { perPage: 1 });
        checks.push({ label: "board reachable + authenticated", ok: true, detail: server });
      } else {
        checks.push({ label: "board reachable + authenticated", ok: false, detail: "could not open session" });
      }
    } catch (error) {
      checks.push({
        label: "board reachable + authenticated",
        ok: false,
        detail: error instanceof Error ? error.message : String(error),
      });
    }
  }

  checks.push({
    label: "git repository",
    ok: Boolean(repoRoot),
    detail: repoRoot ?? "not inside a git repository",
  });

  const identity = git?.identity ?? null;
  checks.push({
    label: "git identity",
    ok: Boolean(identity),
    detail: identity
      ? `${identity.name} <${identity.email}>`
      : "set git user.name and user.email so work is attributed",
  });

  if (repoRoot) {
    checks.push({
      label: "repo .miniboss/config.json",
      ok: Boolean(repoConfig),
      detail: repoConfig
        ? `team=${repoConfig.team} project=${repoConfig.project}`
        : "missing — add .miniboss/config.json with team and project",
    });
  }

  const ok = checks.every((c) => c.ok);
  return { ok, checks };
}

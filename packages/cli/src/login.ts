/**
 * `miniboss login` — guided reconfigure. Prompts for the board URL + agent
 * credentials, VERIFIES they authenticate against the board, and only then
 * saves them. Also used to fix a bad/expired configuration.
 */
import { getAgentToken, clearTokenCache } from "./auth.ts";
import { loadUserConfig, saveUserConfig } from "./config.ts";
import { ask, readSecret } from "./prompts.ts";

export interface VerifyResult {
  ok: boolean;
  message: string;
}

/** Health-check the server, then try to authenticate the agent. */
export async function verifyConnection(
  server: string,
  email: string,
  password: string
): Promise<VerifyResult> {
  try {
    const health = await fetch(new URL("/api/health", server), { signal: AbortSignal.timeout(8000) });
    if (!health.ok) return { ok: false, message: `server not healthy (HTTP ${health.status})` };
  } catch {
    return { ok: false, message: "server unreachable — check the URL / network" };
  }
  try {
    await clearTokenCache();
    await getAgentToken(server, { email, password });
    return { ok: true, message: "authenticated" };
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      message:
        `could not authenticate as "${email}" (${detail}). ` +
        `Use an AGENT account from the board's 'agents' collection — NOT the superuser.`,
    };
  }
}

export async function runLogin(): Promise<number> {
  const cfg = await loadUserConfig();
  process.stdout.write("miniboss login — connect this machine to the board\n\n");

  const server = ask(`  Board URL${cfg.server ? ` [${cfg.server}]` : ""}:`, cfg.server ?? "");
  const email = ask(`  Agent email${cfg.agentEmail ? ` [${cfg.agentEmail}]` : ""}:`, cfg.agentEmail ?? "");
  const password = await readSecret("  Agent password:");

  if (!server || !email || !password) {
    process.stderr.write("miniboss: need a server URL, agent email and password.\n");
    return 1;
  }

  process.stdout.write("  verifying …\n");
  const result = await verifyConnection(server, email, password);
  if (!result.ok) {
    process.stderr.write(`  ✗ ${result.message}\n  Nothing was saved.\n`);
    return 1;
  }

  await saveUserConfig({ server, agentEmail: email, agentPassword: password });
  process.stdout.write("  ✓ connected and saved. Reports will go to this board.\n");
  return 0;
}

/**
 * Argument dispatch. Thin — parses argv and routes to the bounded modules.
 * Reporting/import surface real exit codes; hook subcommands ALWAYS exit 0.
 */
import { parseArgs } from "node:util";
import { readFile } from "node:fs/promises";
import {
  importManifestSchema,
  TICKET_STATUSES,
  type ImportManifest,
  type TicketStatus,
} from "@miniboss/shared";
import { saveUserConfig, loadUserConfig } from "./config.ts";
import { doctor } from "./doctor.ts";
import { hookSessionEnd, hookSessionStart, hookStop } from "./hooks.ts";
import { runImport, type GroupStrategy } from "./import.ts";
import { runInit } from "./init.ts";
import { runLogin, verifyConnection } from "./login.ts";
import { reportDone, reportStart, reportStatus, reportUpdate } from "./report.ts";
import { runUpdate } from "./update.ts";

const USAGE = `miniboss — report development work to the team board

  login                                               # connect/reconfigure (verifies auth)
  update                                              # update the client to the latest
  init [--team <slug>] [--project <slug>] [--force]   # write .miniboss/config.json from the repo
  report start  --title <t> [--stdin | --summary <s>]
  report update [--stdin | --summary <s>]
  report done   [--stdin | --summary <s>]
  report status
  import [--manifest <file> | --stdin] [--group branch|time|scope|commit]
         [--since <date>] [--all-branches | --current-branch]
         [--status done|in_progress] [--dry-run] [--replace] [--repo <path>]
  hook session-start | stop | session-end
  config set-server <url> | set-agent <email> | show
  doctor`;

async function readStdin(): Promise<string> {
  return await Bun.stdin.text();
}

async function resolveSummary(values: Record<string, unknown>): Promise<string> {
  if (values["stdin"]) return await readStdin();
  return typeof values["summary"] === "string" ? (values["summary"] as string) : "";
}

function printOutcomeLine(message: string): void {
  process.stderr.write(`miniboss: ${message}\n`);
}

export async function main(argv: string[]): Promise<number> {
  const { values, positionals } = parseArgs({
    args: argv,
    allowPositionals: true,
    options: {
      title: { type: "string" },
      summary: { type: "string" },
      stdin: { type: "boolean", default: false },
      repo: { type: "string" },
      team: { type: "string" },
      project: { type: "string" },
      force: { type: "boolean", default: false },
      manifest: { type: "string" },
      group: { type: "string" },
      since: { type: "string" },
      "all-branches": { type: "boolean", default: false },
      "current-branch": { type: "boolean", default: false },
      status: { type: "string" },
      "dry-run": { type: "boolean", default: false },
      replace: { type: "boolean", default: false },
      email: { type: "string" },
      help: { type: "boolean", default: false },
    },
  });

  const cwd = typeof values.repo === "string" ? values.repo : process.cwd();
  const command = positionals[0];
  const sub = positionals[1];

  if (values.help) {
    process.stdout.write(`${USAGE}\n`);
    return 0;
  }
  if (!command) {
    process.stdout.write(`${USAGE}\n`);
    return 1;
  }

  switch (command) {
    case "login":
      return await runLogin();
    case "update": {
      const result = await runUpdate();
      printOutcomeLine(result.message);
      return result.ok ? 0 : 1;
    }
    case "init":
      return await runInitCommand(cwd, values);
    case "report":
      return await runReport(sub, cwd, values);
    case "import":
      return await runImportCommand(cwd, values);
    case "hook":
      return await runHook(sub);
    case "config":
      return await runConfig(sub, positionals[2], values);
    case "doctor":
      return await runDoctor(cwd);
    default:
      printOutcomeLine(`unknown command "${command}"`);
      process.stdout.write(`${USAGE}\n`);
      return 1;
  }
}

async function runInitCommand(cwd: string, values: Record<string, unknown>): Promise<number> {
  const result = await runInit({
    cwd,
    team: typeof values.team === "string" ? values.team : undefined,
    project: typeof values.project === "string" ? values.project : undefined,
    force: Boolean(values.force),
  });
  printOutcomeLine(result.message);
  if (result.created && result.path) process.stdout.write(`wrote ${result.path}\n`);
  return result.ok ? 0 : 1;
}

async function runReport(
  sub: string | undefined,
  cwd: string,
  values: Record<string, unknown>
): Promise<number> {
  switch (sub) {
    case "start": {
      const title = typeof values.title === "string" ? values.title : "";
      if (!title.trim()) {
        printOutcomeLine("report start requires --title");
        return 1;
      }
      const outcome = await reportStart(cwd, title, await resolveSummary(values));
      printOutcomeLine(outcome.message);
      return outcome.ok ? 0 : 1;
    }
    case "update": {
      const outcome = await reportUpdate(cwd, await resolveSummary(values));
      printOutcomeLine(outcome.message);
      return outcome.ok ? 0 : 1;
    }
    case "done": {
      const outcome = await reportDone(cwd, await resolveSummary(values));
      printOutcomeLine(outcome.message);
      return outcome.ok ? 0 : 1;
    }
    case "status": {
      const info = await reportStatus(cwd);
      if (info.error) {
        printOutcomeLine(info.error);
        return 1;
      }
      process.stdout.write(
        info.title
          ? `current task: "${info.title}" (status ${info.status}) ticket=${info.ticketId ?? "pending"}\n`
          : "no active task in this repo\n"
      );
      return 0;
    }
    default:
      printOutcomeLine("report expects: start | update | done | status");
      return 1;
  }
}

async function loadManifest(values: Record<string, unknown>): Promise<ImportManifest | null> {
  let raw: string | null = null;
  if (typeof values.manifest === "string") raw = await readFile(values.manifest, "utf8");
  else if (values.stdin) raw = await readStdin();
  if (!raw) return null;
  return importManifestSchema.parse(JSON.parse(raw));
}

function resolveGroup(values: Record<string, unknown>, hasManifest: boolean): GroupStrategy {
  const g = values.group;
  if (g === "branch" || g === "scope" || g === "time" || g === "commit" || g === "manifest") return g;
  return hasManifest ? "manifest" : "time";
}

function resolveStatus(values: Record<string, unknown>): TicketStatus | null {
  const s = values.status;
  return typeof s === "string" && (TICKET_STATUSES as readonly string[]).includes(s)
    ? (s as TicketStatus)
    : null;
}

async function runImportCommand(cwd: string, values: Record<string, unknown>): Promise<number> {
  let manifest: ImportManifest | null = null;
  try {
    manifest = await loadManifest(values);
  } catch (error) {
    printOutcomeLine(`invalid manifest: ${error instanceof Error ? error.message : String(error)}`);
    return 1;
  }

  const allBranches = values["current-branch"] ? false : true;
  const result = await runImport({
    cwd,
    manifest,
    group: resolveGroup(values, manifest !== null),
    since: typeof values.since === "string" ? values.since : undefined,
    allBranches,
    status: resolveStatus(values),
    dryRun: Boolean(values["dry-run"]),
    replace: Boolean(values.replace),
  });

  printOutcomeLine(result.message);
  if (result.clusters.length > 0) {
    for (const c of result.clusters) {
      process.stdout.write(`  • ${c.title} — ${c.commits} commit(s) [${c.status}]\n`);
    }
  }
  return result.ok ? 0 : 1;
}

/** Hook subcommands always exit 0 and never throw. */
async function runHook(sub: string | undefined): Promise<number> {
  try {
    const raw = await readStdin();
    const output =
      sub === "session-start"
        ? await hookSessionStart(raw)
        : sub === "stop"
          ? await hookStop(raw)
          : sub === "session-end"
            ? await hookSessionEnd(raw)
            : { stdout: "" };
    if (output.stdout) process.stdout.write(output.stdout);
  } catch {
    // Swallow everything — a hook must never disrupt the session.
  }
  return 0;
}

async function runConfig(
  sub: string | undefined,
  arg: string | undefined,
  values: Record<string, unknown>
): Promise<number> {
  switch (sub) {
    case "set-server": {
      if (!arg) {
        printOutcomeLine("usage: miniboss config set-server <url>");
        return 1;
      }
      await saveUserConfig({ server: arg });
      printOutcomeLine(`server set to ${arg}`);
      try {
        const res = await fetch(new URL("/api/health", arg), { signal: AbortSignal.timeout(6000) });
        printOutcomeLine(res.ok ? "✓ server reachable" : `✗ server returned HTTP ${res.status}`);
      } catch {
        printOutcomeLine("✗ could not reach the server (check the URL / network)");
      }
      return 0;
    }
    case "set-agent": {
      const email = arg ?? (typeof values.email === "string" ? values.email : "");
      if (!email) {
        printOutcomeLine("usage: miniboss config set-agent <email>  (password read from stdin)");
        return 1;
      }
      const password = (await readStdin()).trim();
      if (!password) {
        printOutcomeLine("no password provided on stdin");
        return 1;
      }
      await saveUserConfig({ agentEmail: email, agentPassword: password });
      printOutcomeLine(`agent credentials stored for ${email}`);
      // Verify the agent actually authenticates against the configured server.
      const cfg = await loadUserConfig();
      if (cfg.server) {
        const verify = await verifyConnection(cfg.server, email, password);
        printOutcomeLine(verify.ok ? "✓ authenticated" : `✗ ${verify.message}`);
      }
      return 0;
    }
    case "show": {
      const cfg = await loadUserConfig();
      const masked = cfg.agentPassword ? "•".repeat(8) : "(unset)";
      process.stdout.write(
        `server: ${cfg.server ?? "(unset)"}\nagent:  ${cfg.agentEmail ?? "(unset)"}\nsecret: ${masked}\n`
      );
      return 0;
    }
    default:
      printOutcomeLine("config expects: set-server <url> | set-agent <email> | show");
      return 1;
  }
}

async function runDoctor(cwd: string): Promise<number> {
  const report = await doctor(cwd);
  for (const check of report.checks) {
    process.stdout.write(`${check.ok ? "✓" : "✗"} ${check.label}: ${check.detail}\n`);
  }
  process.stdout.write(report.ok ? "\nAll checks passed.\n" : "\nSome checks failed.\n");
  return report.ok ? 0 : 1;
}

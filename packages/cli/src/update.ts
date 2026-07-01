/**
 * `miniboss update` — pull the latest client from the git checkout the launcher
 * runs from, reinstall deps, and refresh the installed skill. Also exposes a
 * throttled "is an update available?" check used to notify the developer.
 */
import { existsSync } from "node:fs";
import { copyFile, mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";
import { configDir } from "./config.ts";
import { git } from "./git.ts";

/** The repo root the CLI is running from (…/packages/cli/src → repo root). */
export function repoRoot(): string {
  return resolve(import.meta.dir, "..", "..", "..");
}

function isGitCheckout(root: string): boolean {
  return existsSync(join(root, ".git"));
}

function checkStatePath(): string {
  return join(configDir(), "update-check.json");
}

async function stampChecked(): Promise<void> {
  try {
    await mkdir(configDir(), { recursive: true, mode: 0o700 });
    await writeFile(checkStatePath(), JSON.stringify({ at: new Date().toISOString() }));
  } catch {
    // best effort
  }
}

async function dueForCheck(hours: number, nowMs: number): Promise<boolean> {
  try {
    const parsed = JSON.parse(await readFile(checkStatePath(), "utf8"));
    const last = Date.parse(parsed.at);
    return Number.isNaN(last) || nowMs - last > hours * 3_600_000;
  } catch {
    return true;
  }
}

/** `git fetch origin main` with a hard timeout so it never stalls a hook. */
async function fetchWithTimeout(root: string, ms: number): Promise<void> {
  try {
    const proc = Bun.spawn(["git", "fetch", "--quiet", "origin", "main"], {
      cwd: root,
      stdout: "ignore",
      stderr: "ignore",
    });
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<void>((r) => {
      timer = setTimeout(() => {
        try {
          proc.kill();
        } catch {
          /* ignore */
        }
        r();
      }, ms);
    });
    await Promise.race([proc.exited.then(() => {}), timeout]);
    if (timer) clearTimeout(timer);
  } catch {
    // ignore
  }
}

export interface UpdateStatus {
  available: boolean;
  current: string;
  latest: string;
}

/**
 * Throttled check (default once/24h). Returns null when not a git checkout,
 * throttled, or the check failed. Never throws.
 */
export async function checkForUpdate(
  nowMs: number = Date.now(),
  throttleHours = 24
): Promise<UpdateStatus | null> {
  const root = repoRoot();
  if (!isGitCheckout(root)) return null;
  if (!(await dueForCheck(throttleHours, nowMs))) return null;
  await stampChecked();

  await fetchWithTimeout(root, 4000);
  const local = await git(["rev-parse", "HEAD"], root);
  const remote = await git(["rev-parse", "origin/main"], root);
  if (!local || !remote) return null;
  return { available: local !== remote, current: local.slice(0, 7), latest: remote.slice(0, 7) };
}

export interface UpdateResult {
  ok: boolean;
  message: string;
}

async function bunInstall(root: string): Promise<void> {
  try {
    const proc = Bun.spawn(["bun", "install"], { cwd: root, stdout: "ignore", stderr: "ignore" });
    await proc.exited;
  } catch {
    // ignore
  }
}

/** Re-copy the skill so an updated SKILL.md reaches ~/.claude/skills/miniboss. */
async function refreshSkill(root: string): Promise<void> {
  const src = join(root, "skills", "miniboss", "SKILL.md");
  if (!existsSync(src)) return;
  const dest = join(homedir(), ".claude", "skills", "miniboss");
  try {
    await mkdir(dest, { recursive: true });
    await copyFile(src, join(dest, "SKILL.md"));
  } catch {
    // ignore
  }
}

export async function runUpdate(): Promise<UpdateResult> {
  const root = repoRoot();
  if (!isGitCheckout(root)) {
    return { ok: false, message: `not a git checkout at ${root} — reinstall via the bootstrap` };
  }

  const before = await git(["rev-parse", "--short", "HEAD"], root);
  const pulled = await git(["pull", "--ff-only"], root);
  if (pulled === null) {
    return {
      ok: false,
      message: "git pull failed (local changes or network) — resolve manually and retry",
    };
  }
  const after = await git(["rev-parse", "--short", "HEAD"], root);
  await bunInstall(root);
  await refreshSkill(root);
  await stampChecked();

  if (before === after) return { ok: true, message: `already up to date (${after})` };
  return { ok: true, message: `updated ${before} → ${after}. Restart Claude Code to reload the skill.` };
}

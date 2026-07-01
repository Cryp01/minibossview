/**
 * Per-repo developer state: .miniboss/state.json (gitignored).
 * Tracks the current task ticket so updates append to the same ticket until it
 * is marked done or a new task supersedes it. Writes are atomic (tmp + rename).
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { repoStateSchema, type RepoState } from "@miniboss/shared";

function miniboss(repoRoot: string): string {
  return join(repoRoot, ".miniboss");
}

function statePath(repoRoot: string): string {
  return join(miniboss(repoRoot), "state.json");
}

export function defaultState(): RepoState {
  return repoStateSchema.parse({ schemaVersion: 1 });
}

/** Load the per-repo state, returning a fresh default if absent or invalid. */
export async function loadState(repoRoot: string): Promise<RepoState> {
  const path = statePath(repoRoot);
  if (!existsSync(path)) return defaultState();
  try {
    return repoStateSchema.parse(JSON.parse(await readFile(path, "utf8")));
  } catch {
    return defaultState();
  }
}

/** Persist state atomically and keep it out of version control. */
export async function saveState(repoRoot: string, state: RepoState): Promise<void> {
  const dir = miniboss(repoRoot);
  await mkdir(dir, { recursive: true });
  await ensureGitignore(repoRoot);

  const validated = repoStateSchema.parse(state);
  const tmp = join(dir, `state.${process.pid}.${Date.now()}.tmp`);
  await writeFile(tmp, JSON.stringify(validated, null, 2));
  await rename(tmp, statePath(repoRoot));
}

/** Ensure `.miniboss/.gitignore` excludes the local state file. */
async function ensureGitignore(repoRoot: string): Promise<void> {
  const path = join(miniboss(repoRoot), ".gitignore");
  const desired = "state.json\n";
  try {
    if (existsSync(path)) {
      const current = await readFile(path, "utf8");
      if (current.includes("state.json")) return;
      await writeFile(path, current.endsWith("\n") ? current + desired : `${current}\n${desired}`);
    } else {
      await writeFile(path, desired);
    }
  } catch {
    // Non-fatal: a missing gitignore should not block reporting.
  }
}

/** Immutable transition: clear the current-task pointer (after done/new task). */
export function withClearedTicket(state: RepoState): RepoState {
  return { ...state, currentTicketId: null, currentTitle: null, status: null, pending: null };
}

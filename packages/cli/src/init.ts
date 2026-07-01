/**
 * `miniboss init` — derive a repo's board config from git so the developer
 * never hand-writes .miniboss/config.json. Project comes from the repo name,
 * team from the git remote owner (falling back sensibly when there's no remote).
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";
import { repoConfigSchema, slugify, type GitContext, type RepoConfig } from "@miniboss/shared";
import { loadRepoConfig } from "./config.ts";
import { readGitContext } from "./git.ts";

const DEFAULT_TEAM = "default";

interface OwnerRepo {
  owner: string;
  repo: string;
}

/** Parse owner/repo from a git remote URL (scp-like, https, or ssh). */
export function parseRemote(remote: string): OwnerRepo | null {
  if (!remote) return null;
  let path = remote.trim().replace(/\.git$/i, "");

  const scp = path.match(/^[^@]+@[^:]+:(.+)$/); // git@host:owner/repo
  if (scp) {
    path = scp[1]!;
  } else {
    const url = path.match(/^[a-z][a-z0-9+.-]*:\/\/[^/]+\/(.+)$/i); // proto://host/owner/repo
    if (url) path = url[1]!;
  }

  const parts = path.split("/").filter(Boolean);
  if (parts.length >= 2) return { owner: parts[parts.length - 2]!, repo: parts[parts.length - 1]! };
  if (parts.length === 1) return { owner: "", repo: parts[0]! };
  return null;
}

/** Derive team + project slugs from git context (remote owner/repo, else folder). */
export function deriveRepoConfig(git: GitContext): RepoConfig {
  const parsed = git.repoRemote ? parseRemote(git.repoRemote) : null;
  const project =
    slugify(parsed?.repo ?? basename(git.repoRoot)) || slugify(basename(git.repoRoot)) || "project";
  const team = (parsed?.owner ? slugify(parsed.owner) : "") || DEFAULT_TEAM;
  return repoConfigSchema.parse({ schemaVersion: 1, team, project });
}

/**
 * Resolve the effective repo config: the committed `.miniboss/config.json` if
 * present, otherwise an ephemeral one derived from git. Lets report/import work
 * with zero setup while `miniboss init` persists an explicit choice.
 */
export async function resolveRepoConfig(git: GitContext): Promise<RepoConfig> {
  return (await loadRepoConfig(git.repoRoot)) ?? deriveRepoConfig(git);
}

export interface InitOptions {
  cwd: string;
  team?: string;
  project?: string;
  force: boolean;
}

export interface InitResult {
  ok: boolean;
  created: boolean;
  message: string;
  team?: string;
  project?: string;
  path?: string;
}

/** Write `.miniboss/config.json` from derived + overridden values. */
export async function runInit(options: InitOptions): Promise<InitResult> {
  const git = await readGitContext(options.cwd);
  if (!git) return { ok: false, created: false, message: "not a git repository" };

  const derived = deriveRepoConfig(git);
  const team = (options.team ? slugify(options.team) : "") || derived.team;
  const project = (options.project ? slugify(options.project) : "") || derived.project;
  const config = repoConfigSchema.parse({ schemaVersion: 1, team, project });

  const dir = join(git.repoRoot, ".miniboss");
  const path = join(dir, "config.json");

  if (existsSync(path) && !options.force) {
    const existing = await readFile(path, "utf8").catch(() => "");
    return {
      ok: true,
      created: false,
      team,
      project,
      path,
      message: `.miniboss/config.json already exists (use --force to overwrite):\n${existing.trim()}`,
    };
  }

  await mkdir(dir, { recursive: true });
  await writeFile(path, `${JSON.stringify(config, null, 2)}\n`);
  await ensureGitignore(dir);

  return { ok: true, created: true, team, project, path, message: `initialized team=${team} project=${project}` };
}

/** Keep the local state file out of version control. */
async function ensureGitignore(minibossDir: string): Promise<void> {
  const path = join(minibossDir, ".gitignore");
  try {
    if (existsSync(path)) {
      const current = await readFile(path, "utf8");
      if (current.includes("state.json")) return;
      await writeFile(path, current.endsWith("\n") ? `${current}state.json\n` : `${current}\nstate.json\n`);
    } else {
      await writeFile(path, "state.json\n");
    }
  } catch {
    // non-fatal
  }
}

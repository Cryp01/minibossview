/**
 * Read-only git helpers. Every call is best-effort and never throws — a repo
 * without git, without an origin, or without a configured identity must degrade
 * gracefully rather than block the developer.
 */
import type { GitContext, GitIdentity } from "@miniboss/shared";

/** Run a git command in `cwd`; returns trimmed stdout or null on any failure. */
export async function git(args: readonly string[], cwd: string): Promise<string | null> {
  try {
    const proc = Bun.spawn(["git", ...args], { cwd, stdout: "pipe", stderr: "ignore" });
    const out = await new Response(proc.stdout).text();
    const code = await proc.exited;
    if (code !== 0) return null;
    const trimmed = out.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/** Absolute path to the repo root containing `cwd`, or null if not a repo. */
export async function repoRootOf(cwd: string): Promise<string | null> {
  return await git(["rev-parse", "--show-toplevel"], cwd);
}

/** Read the full git context used to enrich and attribute reports. */
export async function readGitContext(cwd: string): Promise<GitContext | null> {
  const repoRoot = await repoRootOf(cwd);
  if (!repoRoot) return null;

  const [name, email, branch, remote, head] = await Promise.all([
    git(["config", "user.name"], repoRoot),
    git(["config", "user.email"], repoRoot),
    git(["rev-parse", "--abbrev-ref", "HEAD"], repoRoot),
    git(["remote", "get-url", "origin"], repoRoot),
    git(["rev-parse", "--short", "HEAD"], repoRoot),
  ]);

  const identity: GitIdentity | null = name && email ? { name, email } : null;
  return {
    repoRoot,
    repoRemote: remote ?? "",
    branch: branch ?? "",
    head: head ?? "",
    identity,
  };
}

export interface CommitRecord {
  sha: string;
  shortSha: string;
  authorName: string;
  authorEmail: string;
  date: string; // ISO 8601
  subject: string;
  branch?: string;
}

// Unit-separator delimited format to survive arbitrary subject text.
const LOG_FORMAT = "%H%x1f%h%x1f%an%x1f%ae%x1f%aI%x1f%s";

/**
 * Read commits as structured records. `range` controls scope, e.g.
 * ["--all"] for every branch or [] for the current branch's history.
 */
export async function readCommits(
  repoRoot: string,
  range: readonly string[],
  since?: string
): Promise<CommitRecord[]> {
  const args = ["log", `--pretty=format:${LOG_FORMAT}`, ...range];
  if (since) args.push(`--since=${since}`);
  const out = await git(args, repoRoot);
  if (!out) return [];

  return out
    .split("\n")
    .map((line) => line.split(""))
    .filter((parts) => parts.length === 6)
    .map(([sha, shortSha, authorName, authorEmail, date, subject]) => ({
      sha: sha!,
      shortSha: shortSha!,
      authorName: authorName!,
      authorEmail: authorEmail!,
      date: date!,
      subject: subject!,
    }));
}

/** Look up structured records for an explicit list of commit shas. */
export async function readCommitsByShas(
  repoRoot: string,
  shas: readonly string[]
): Promise<Map<string, CommitRecord>> {
  const all = await readCommits(repoRoot, ["--all"]);
  const byFull = new Map<string, CommitRecord>();
  const byShort = new Map<string, CommitRecord>();
  for (const c of all) {
    byFull.set(c.sha, c);
    byShort.set(c.shortSha, c);
  }
  const result = new Map<string, CommitRecord>();
  for (const sha of shas) {
    const match = byFull.get(sha) ?? byShort.get(sha) ?? findByPrefix(all, sha);
    if (match) result.set(sha, match);
  }
  return result;
}

function findByPrefix(commits: readonly CommitRecord[], sha: string): CommitRecord | undefined {
  return commits.find((c) => c.sha.startsWith(sha) || sha.startsWith(c.shortSha));
}

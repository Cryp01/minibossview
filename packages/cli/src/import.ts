/**
 * Import an already-started project's git history into backdated tickets.
 *
 * Recommended path: Claude authors an import manifest (clusters of commits with
 * readable titles/summaries) and pipes it in. Deterministic fallbacks group
 * straight from `git log` without a model. Either way, tickets are upserted by a
 * stable external_key and worklog is deduped by (ticket, commit) — re-import is
 * idempotent.
 */
import {
  COLLECTIONS,
  importExternalKey,
  type ImportManifest,
  type TicketStatus,
} from "@miniboss/shared";
import { appendWorklog, ensureMember, ensureProject, ensureTeam } from "./board.ts";
import { identityForAuthor } from "./developer.ts";
import { resolveRepoConfig } from "./init.ts";
import { git, readCommits, readGitContext, type CommitRecord } from "./git.ts";
import { describeError, logLine } from "./log.ts";
import { PbClient, PbError } from "./pocketbase.ts";
import { redactSummary } from "./redact.ts";
import { openSession } from "./session.ts";

export type GroupStrategy = "manifest" | "branch" | "scope" | "time" | "commit";

export interface ImportOptions {
  cwd: string;
  manifest: ImportManifest | null;
  group: GroupStrategy;
  since?: string;
  allBranches: boolean;
  status: TicketStatus | null;
  dryRun: boolean;
  replace: boolean;
}

interface PlannedCluster {
  title: string;
  summary: string;
  status: TicketStatus;
  commits: CommitRecord[];
  externalKey: string;
}

export interface ImportResult {
  ok: boolean;
  message: string;
  planned: number;
  ticketsCreated: number;
  ticketsUpdated: number;
  worklogsAdded: number;
  dryRun: boolean;
  clusters: Array<{ title: string; commits: number; status: TicketStatus }>;
}

const TIME_GAP_MS = 4 * 60 * 60 * 1000; // 4h session boundary

function fail(message: string): ImportResult {
  return {
    ok: false,
    message,
    planned: 0,
    ticketsCreated: 0,
    ticketsUpdated: 0,
    worklogsAdded: 0,
    dryRun: false,
    clusters: [],
  };
}

function titleize(text: string): string {
  const cleaned = text.replace(/[-_/]+/g, " ").trim();
  return cleaned ? cleaned.replace(/\b\w/g, (c) => c.toUpperCase()) : text;
}

function safeText(input: string): string {
  const r = redactSummary(input);
  return r.ok ? r.clean : "(redacted)";
}

function oldestFirst(commits: readonly CommitRecord[]): CommitRecord[] {
  return [...commits].sort((a, b) => a.date.localeCompare(b.date));
}

/** Most frequent author email among a cluster's commits (for assignee). */
export function dominantAuthor(commits: readonly CommitRecord[]): { name: string; email: string } | null {
  const counts = new Map<string, { name: string; email: string; n: number }>();
  for (const c of commits) {
    const key = c.authorEmail.toLowerCase();
    const entry = counts.get(key) ?? { name: c.authorName, email: c.authorEmail, n: 0 };
    entry.n += 1;
    counts.set(key, entry);
  }
  let best: { name: string; email: string; n: number } | null = null;
  for (const entry of counts.values()) if (!best || entry.n > best.n) best = entry;
  return best ? { name: best.name, email: best.email } : null;
}

// ---- grouping strategies ---------------------------------------------------

export function groupByCommit(commits: CommitRecord[]): Array<{ title: string; commits: CommitRecord[] }> {
  return commits.map((c) => ({ title: c.subject, commits: [c] }));
}

export function groupByScope(commits: CommitRecord[]): Array<{ title: string; commits: CommitRecord[] }> {
  const re = /^(\w+)(?:\(([^)]+)\))?!?:/;
  const buckets = new Map<string, CommitRecord[]>();
  for (const c of commits) {
    const match = c.subject.match(re);
    const key = match ? `${match[1]}${match[2] ? `(${match[2]})` : ""}` : "misc";
    const list = buckets.get(key) ?? [];
    list.push(c);
    buckets.set(key, list);
  }
  return [...buckets.entries()].map(([key, list]) => ({ title: titleize(key), commits: list }));
}

export function groupByTime(commits: CommitRecord[]): Array<{ title: string; commits: CommitRecord[] }> {
  const sorted = oldestFirst(commits);
  const clusters: Array<{ title: string; commits: CommitRecord[] }> = [];
  let current: CommitRecord[] = [];
  let prev: CommitRecord | null = null;
  for (const c of sorted) {
    const breakHere =
      prev !== null &&
      (prev.authorEmail !== c.authorEmail ||
        new Date(c.date).getTime() - new Date(prev.date).getTime() > TIME_GAP_MS);
    if (breakHere && current.length > 0) {
      clusters.push({ title: current[0]!.subject, commits: current });
      current = [];
    }
    current.push(c);
    prev = c;
  }
  if (current.length > 0) clusters.push({ title: current[0]!.subject, commits: current });
  return clusters;
}

/** Map each commit to the ref (branch) it was reached by, via `git log --source`. */
async function branchByCommit(repoRoot: string, allBranches: boolean): Promise<Map<string, string>> {
  const range = allBranches ? ["--all"] : [];
  const out = await git(["log", "--source", "--pretty=format:%H%x1f%S", ...range], repoRoot);
  const map = new Map<string, string>();
  if (!out) return map;
  for (const line of out.split("\n")) {
    const [sha, ref] = line.split("\x1f");
    if (sha && ref) map.set(sha, ref.replace(/^refs\/(heads|remotes)\//, ""));
  }
  return map;
}

async function groupByBranch(
  repoRoot: string,
  commits: CommitRecord[],
  allBranches: boolean
): Promise<Array<{ title: string; commits: CommitRecord[] }>> {
  const refs = await branchByCommit(repoRoot, allBranches);
  if (refs.size === 0) {
    await logLine("warn", "branch grouping unavailable (no source refs); falling back to time grouping");
    return groupByTime(commits);
  }
  const buckets = new Map<string, CommitRecord[]>();
  for (const c of commits) {
    const ref = refs.get(c.sha) ?? "unknown";
    const list = buckets.get(ref) ?? [];
    list.push(c);
    buckets.set(ref, list);
  }
  return [...buckets.entries()].map(([ref, list]) => ({ title: titleize(ref), commits: list }));
}

// ---- plan ------------------------------------------------------------------

async function plan(
  repoRoot: string,
  repoKey: string,
  options: ImportOptions
): Promise<PlannedCluster[]> {
  const range = options.allBranches ? ["--all"] : [];
  const allCommits = await readCommits(repoRoot, range, options.since);
  const byFull = new Map(allCommits.map((c) => [c.sha, c]));
  const byShort = new Map(allCommits.map((c) => [c.shortSha, c]));

  const defaultStatus: TicketStatus = options.status ?? "done";

  if (options.group === "manifest") {
    if (!options.manifest) return [];
    return options.manifest.clusters
      .map((cluster) => {
        const commits = cluster.commits
          .map((sha) => byFull.get(sha) ?? byShort.get(sha) ?? prefixMatch(allCommits, sha))
          .filter((c): c is CommitRecord => Boolean(c));
        return {
          title: cluster.title,
          summary: cluster.summary,
          status: options.status ?? cluster.status,
          commits: oldestFirst(commits),
          externalKey: importExternalKey(repoKey, commits.map((c) => c.sha)),
        };
      })
      .filter((c) => c.commits.length > 0);
  }

  const raw =
    options.group === "commit"
      ? groupByCommit(allCommits)
      : options.group === "scope"
        ? groupByScope(allCommits)
        : options.group === "branch"
          ? await groupByBranch(repoRoot, allCommits, options.allBranches)
          : groupByTime(allCommits);

  return raw
    .filter((g) => g.commits.length > 0)
    .map((g) => ({
      title: g.title,
      summary: "",
      status: defaultStatus,
      commits: oldestFirst(g.commits),
      externalKey: importExternalKey(repoKey, g.commits.map((c) => c.sha)),
    }));
}

function prefixMatch(commits: readonly CommitRecord[], sha: string): CommitRecord | undefined {
  return commits.find((c) => c.sha.startsWith(sha) || sha.startsWith(c.shortSha));
}

// ---- apply -----------------------------------------------------------------

export async function runImport(options: ImportOptions): Promise<ImportResult> {
  const ctx = await readGitContext(options.cwd);
  if (!ctx) return fail("not a git repository");
  // Uses .miniboss/config.json if present, else derives team/project from git.
  const config = await resolveRepoConfig(ctx);

  const repoKey = ctx.repoRemote || ctx.repoRoot;
  const clusters = await plan(ctx.repoRoot, repoKey, options);
  if (clusters.length === 0) {
    return { ...fail("no commits to import (check --since / --group / manifest)"), ok: true };
  }

  const clusterSummary = clusters.map((c) => ({
    title: c.title,
    commits: c.commits.length,
    status: c.status,
  }));

  if (options.dryRun) {
    return {
      ok: true,
      message: `dry run: ${clusters.length} clusters, ${clusters.reduce((n, c) => n + c.commits.length, 0)} commits`,
      planned: clusters.length,
      ticketsCreated: 0,
      ticketsUpdated: 0,
      worklogsAdded: 0,
      dryRun: true,
      clusters: clusterSummary,
    };
  }

  const session = await openSession(config);
  if (!session) return fail("not configured (run: miniboss config set-server / set-token)");

  try {
    if (options.replace) await deleteExistingImports(session.client, repoKey);

    const teamId = await ensureTeam(session.client, config.team, titleize(config.team));
    const projectId = await ensureProject(
      session.client,
      config.project,
      titleize(config.project),
      teamId,
      ctx.repoRemote,
      ctx.branch
    );

    let created = 0;
    let updated = 0;
    let worklogs = 0;
    for (const cluster of clusters) {
      const res = await applyCluster(session.client, cluster, {
        teamId,
        projectId,
        repoRemote: ctx.repoRemote,
      });
      if (res.created) created++;
      else updated++;
      worklogs += res.worklogsAdded;
    }

    return {
      ok: true,
      message: `imported ${clusters.length} clusters (${created} new, ${updated} updated), ${worklogs} commits logged`,
      planned: clusters.length,
      ticketsCreated: created,
      ticketsUpdated: updated,
      worklogsAdded: worklogs,
      dryRun: false,
      clusters: clusterSummary,
    };
  } catch (error) {
    await logLine("error", `import failed: ${describeError(error)}`);
    return fail(`import failed: ${describeError(error)}`);
  }
}

interface ApplyCtx {
  teamId: string;
  projectId: string;
  repoRemote: string;
}

async function applyCluster(
  client: PbClient,
  cluster: PlannedCluster,
  ctx: ApplyCtx
): Promise<{ created: boolean; worklogsAdded: number }> {
  const oldest = cluster.commits[0]!;
  const newest = cluster.commits[cluster.commits.length - 1]!;
  const dominant = dominantAuthor(cluster.commits);
  const assigneeId = await ensureMember(client, dominant ? identityForAuthor(dominant) : null);

  const existing = await client.getFirst(
    COLLECTIONS.tickets,
    `external_key = "${cluster.externalKey.replace(/"/g, '\\"')}"`
  );

  let ticketId: string;
  let created = false;
  const ticketData: Record<string, unknown> = {
    title: cluster.title,
    description: cluster.summary ? safeText(cluster.summary) : "",
    status: cluster.status,
    team: ctx.teamId,
    project: ctx.projectId,
    assignee: assigneeId ?? "",
    origin: "import",
    repo_remote: ctx.repoRemote,
    last_commit: newest.shortSha,
    work_date: oldest.date,
    external_key: cluster.externalKey,
  };

  if (existing) {
    ticketId = existing.id;
    await client.update(COLLECTIONS.tickets, ticketId, ticketData);
  } else {
    const ticket = await client.create(COLLECTIONS.tickets, ticketData);
    ticketId = ticket.id;
    created = true;
  }

  let worklogsAdded = 0;
  for (const commit of cluster.commits) {
    const authorId = await ensureMember(
      client,
      identityForAuthor({ name: commit.authorName, email: commit.authorEmail })
    );
    try {
      await appendWorklog(client, {
        ticket: ticketId,
        authorMember: authorId,
        kind: "commit",
        message: safeText(commit.subject),
        workDate: commit.date,
        commit: commit.sha,
        meta: { shortSha: commit.shortSha, author: commit.authorEmail },
      });
      worklogsAdded++;
    } catch (error) {
      // Unique (ticket, commit) index → already logged on a prior import. Skip.
      if (!(error instanceof PbError && error.status === 400)) throw error;
    }
  }

  return { created, worklogsAdded };
}

async function deleteExistingImports(client: PbClient, repoKey: string): Promise<void> {
  const prefix = `import:${repoKey}:`.replace(/"/g, '\\"');
  // Page through and delete all import tickets for this repo.
  for (let guard = 0; guard < 50; guard++) {
    const page = await client.list(COLLECTIONS.tickets, {
      filter: `origin = "import" && external_key ~ "${prefix}"`,
      perPage: 100,
    });
    if (page.items.length === 0) break;
    for (const ticket of page.items) {
      await client.delete(COLLECTIONS.tickets, ticket.id).catch(() => {});
    }
    if (page.totalPages <= 1) break;
  }
}

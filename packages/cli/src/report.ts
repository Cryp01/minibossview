/**
 * Live reporting: start / update / done. Authors a BoardReport from git context
 * + repo config + local state, applies it to the board, and updates state. On
 * network failure the report is queued to the outbox; nothing ever blocks.
 */
import {
  reportExternalKey,
  normalizeTitle,
  type GitContext,
  type RepoConfig,
  type RepoState,
  type TicketStatus,
} from "@miniboss/shared";
import { applyReport, type BoardReport } from "./board.ts";
import { resolveCurrentIdentity, type MemberIdentity } from "./developer.ts";
import { redactSummary } from "./redact.ts";
import { resolveRepoConfig } from "./init.ts";
import { readGitContext } from "./git.ts";
import { describeError, logLine } from "./log.ts";
import { enqueueReport } from "./queue.ts";
import { openSession } from "./session.ts";
import { loadState, saveState, withClearedTicket } from "./state.ts";
import { drainOutboxFor } from "./drain.ts";

export type ReportVerb = "start" | "update" | "done";

export interface ReportOutcome {
  ok: boolean;
  delivered: boolean; // true if sent now, false if queued offline
  ticketId: string | null;
  message: string;
}

function titleize(slug: string): string {
  const cleaned = slug.replace(/[-_/]+/g, " ").trim();
  if (!cleaned) return slug;
  return cleaned.replace(/\b\w/g, (c) => c.toUpperCase());
}

function repoKey(git: GitContext): string {
  return git.repoRemote || git.repoRoot;
}

function nowIso(): string {
  return new Date().toISOString();
}

/** Resolve the task title for update/done: current task, else branch-derived. */
function resolveTitle(state: RepoState, git: GitContext): string {
  if (state.currentTitle) return state.currentTitle;
  if (git.branch && git.branch !== "HEAD") return titleize(git.branch);
  return "Untitled task";
}

function buildReport(params: {
  verb: ReportVerb;
  title: string;
  summary: string;
  status: TicketStatus | null;
  config: RepoConfig;
  git: GitContext;
  identity: MemberIdentity | null;
}): BoardReport {
  const { verb, title, summary, status, config, git, identity } = params;
  return {
    verb,
    externalKey: reportExternalKey(repoKey(git), git.branch, title),
    title,
    summary,
    status,
    team: { slug: config.team, name: titleize(config.team) },
    project: {
      slug: config.project,
      name: titleize(config.project),
      repoRemote: git.repoRemote,
      defaultBranch: git.branch,
    },
    identity,
    git: { repoRemote: git.repoRemote, branch: git.branch, head: git.head },
    workDate: nowIso(),
  };
}

interface ReportContext {
  repoRoot: string;
  config: RepoConfig;
  git: GitContext;
  state: RepoState;
  identity: MemberIdentity | null;
}

/** Load everything needed to report from a working directory. */
async function loadContext(cwd: string): Promise<ReportContext | { error: string }> {
  const git = await readGitContext(cwd);
  if (!git) return { error: "not a git repository" };
  // Uses .miniboss/config.json if present, else derives team/project from git.
  const config = await resolveRepoConfig(git);
  const identity = await resolveCurrentIdentity(git); // dedup key = GitHub username
  const state = await loadState(git.repoRoot);
  return { repoRoot: git.repoRoot, config, git, state, identity };
}

/** Deliver a report now, or queue it offline. Updates state on the result. */
async function deliver(
  ctx: ReportContext,
  report: BoardReport,
  nextState: (ticketId: string | null) => RepoState
): Promise<ReportOutcome> {
  try {
    const session = await openSession(ctx.config);
    if (!session) {
      await enqueueReport(report, nowIso());
      await saveState(ctx.repoRoot, nextState(null));
      return {
        ok: true,
        delivered: false,
        ticketId: null,
        message: "not configured yet — queued locally (run: miniboss config set-server / set-token)",
      };
    }
    // Opportunistically flush anything queued earlier.
    await drainOutboxFor(ctx.config).catch(() => {});
    const result = await applyReport(session.client, report, "agent");
    await saveState(ctx.repoRoot, nextState(result.ticketId));
    return { ok: true, delivered: true, ticketId: result.ticketId, message: "reported" };
  } catch (error) {
    await logLine("warn", `report ${report.verb} failed, queued: ${describeError(error)}`);
    await enqueueReport(report, nowIso());
    await saveState(ctx.repoRoot, nextState(null));
    return { ok: true, delivered: false, ticketId: null, message: "board unreachable — queued locally" };
  }
}

export async function reportStart(cwd: string, title: string, rawSummary: string): Promise<ReportOutcome> {
  const ctx = await loadContext(cwd);
  if ("error" in ctx) return { ok: false, delivered: false, ticketId: null, message: ctx.error };

  // Same title as the current open task → idempotent no-op pointer refresh.
  const sameTask =
    ctx.state.currentTitle && normalizeTitle(ctx.state.currentTitle) === normalizeTitle(title);

  const summary = sanitizeOrEmpty(rawSummary, "summary");
  const report = buildReport({
    verb: "start",
    title,
    summary,
    status: "in_progress",
    config: ctx.config,
    git: ctx.git,
    identity: ctx.identity,
  });

  return deliver(ctx, report, (ticketId) => ({
    ...ctx.state,
    currentTicketId: ticketId ?? (sameTask ? ctx.state.currentTicketId : null),
    currentTitle: title,
    status: "in_progress",
    openedAt: ctx.state.openedAt ?? nowIso(),
    lastWorklogAt: nowIso(),
    lastGit: { branch: ctx.git.branch, remote: ctx.git.repoRemote, head: ctx.git.head },
  }));
}

export async function reportUpdate(cwd: string, rawSummary: string): Promise<ReportOutcome> {
  const ctx = await loadContext(cwd);
  if ("error" in ctx) return { ok: false, delivered: false, ticketId: null, message: ctx.error };

  const title = resolveTitle(ctx.state, ctx.git);
  const summary = sanitizeOrEmpty(rawSummary, "summary");
  const report = buildReport({
    verb: "update",
    title,
    summary,
    status: null,
    config: ctx.config,
    git: ctx.git,
    identity: ctx.identity,
  });

  return deliver(ctx, report, (ticketId) => ({
    ...ctx.state,
    currentTicketId: ticketId ?? ctx.state.currentTicketId,
    currentTitle: title,
    status: ctx.state.status ?? "in_progress",
    lastWorklogAt: nowIso(),
    lastGit: { branch: ctx.git.branch, remote: ctx.git.repoRemote, head: ctx.git.head },
  }));
}

export async function reportDone(cwd: string, rawSummary: string): Promise<ReportOutcome> {
  const ctx = await loadContext(cwd);
  if ("error" in ctx) return { ok: false, delivered: false, ticketId: null, message: ctx.error };

  const title = resolveTitle(ctx.state, ctx.git);
  const summary = sanitizeOrEmpty(rawSummary, "summary");
  const report = buildReport({
    verb: "done",
    title,
    summary,
    status: "done",
    config: ctx.config,
    git: ctx.git,
    identity: ctx.identity,
  });

  return deliver(ctx, report, () => withClearedTicket(ctx.state));
}

export interface StatusInfo {
  configured: boolean;
  title: string | null;
  status: string | null;
  ticketId: string | null;
  error?: string;
}

export async function reportStatus(cwd: string): Promise<StatusInfo> {
  const ctx = await loadContext(cwd);
  if ("error" in ctx) return { configured: false, title: null, status: null, ticketId: null, error: ctx.error };
  return {
    configured: true,
    title: ctx.state.currentTitle,
    status: ctx.state.status,
    ticketId: ctx.state.currentTicketId,
  };
}

/** Apply the scrubber; on refusal, log and drop the summary (still report). */
function sanitizeOrEmpty(rawSummary: string, label: string): string {
  if (!rawSummary || rawSummary.trim().length === 0) return "";
  const result = redactSummary(rawSummary);
  if (result.ok) return result.clean;
  void logLine("warn", `${label} dropped by scrubber: ${result.reason}`);
  return "";
}

/**
 * Claude Code hook handlers. Three hard rules, no exceptions:
 *   1. Always succeed (exit 0). A reporting hook must never block the developer.
 *   2. Never emit {"continue": false} or exit 2.
 *   3. Transport only — hooks flush the outbox; they never author reports.
 * The Skill is the reporting gate; these guarantee eventual delivery.
 */
import { z } from "zod";
import { loadRepoConfig } from "./config.ts";
import { drainOutboxFor } from "./drain.ts";
import { repoRootOf } from "./git.ts";
import { describeError, logLine } from "./log.ts";
import { loadState } from "./state.ts";

const hookInputSchema = z
  .object({
    cwd: z.string().optional(),
    source: z.string().optional(),
    reason: z.string().optional(),
    hook_event_name: z.string().optional(),
  })
  .passthrough();

export interface HookOutput {
  stdout: string; // printed verbatim; "" means print nothing
}

function noOutput(): HookOutput {
  return { stdout: "" };
}

function parseInput(raw: string): { cwd: string } {
  try {
    const parsed = hookInputSchema.parse(JSON.parse(raw));
    return { cwd: parsed.cwd ?? process.cwd() };
  } catch {
    return { cwd: process.cwd() };
  }
}

async function safeDrain(cwd: string): Promise<void> {
  try {
    const repoRoot = await repoRootOf(cwd);
    const repoConfig = repoRoot ? await loadRepoConfig(repoRoot) : null;
    const result = await drainOutboxFor(repoConfig);
    if (result.sent > 0) await logLine("info", `flushed ${result.sent} queued report(s)`);
  } catch (error) {
    await logLine("warn", `outbox drain failed: ${describeError(error)}`);
  }
}

/** SessionStart: flush the outbox and surface the current task to Claude. */
export async function hookSessionStart(raw: string): Promise<HookOutput> {
  const { cwd } = parseInput(raw);
  await safeDrain(cwd);
  try {
    const repoRoot = await repoRootOf(cwd);
    if (!repoRoot) return noOutput();
    const state = await loadState(repoRoot);
    if (!state.currentTitle) return noOutput();
    const context = `miniboss: this repo has an active board task "${state.currentTitle}" (status ${state.status ?? "in_progress"}). Continue updating it with /miniboss as work progresses.`;
    return {
      stdout: JSON.stringify({
        hookSpecificOutput: { hookEventName: "SessionStart", additionalContext: context },
      }),
    };
  } catch (error) {
    await logLine("warn", `session-start context failed: ${describeError(error)}`);
    return noOutput();
  }
}

/** Stop: cheap outbox flush after a turn. Usually a no-op. */
export async function hookStop(raw: string): Promise<HookOutput> {
  await safeDrain(parseInput(raw).cwd);
  return noOutput();
}

/** SessionEnd: final outbox flush. Cannot block. */
export async function hookSessionEnd(raw: string): Promise<HookOutput> {
  await safeDrain(parseInput(raw).cwd);
  return noOutput();
}

/**
 * Offline outbox. When the board is unreachable, reports are appended here as
 * NDJSON and drained on the next successful connection (hooks call the drain).
 * A failure to reach the server must never lose a report or block the developer.
 */
import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { z } from "zod";
import { boardReportSchema, type BoardReport } from "./board.ts";
import { outboxDir } from "./config.ts";

const MAX_ENTRIES = 500;

const outboxEntrySchema = z.object({
  id: z.string(),
  queuedAt: z.string(),
  report: boardReportSchema,
});
export type OutboxEntry = z.infer<typeof outboxEntrySchema>;

function outboxFile(): string {
  return join(outboxDir(), "reports.ndjson");
}

function entryId(report: BoardReport, queuedAt: string): string {
  return `${report.verb}:${report.externalKey}:${queuedAt}`;
}

/** Append a report to the outbox, capping total size. */
export async function enqueueReport(report: BoardReport, queuedAt: string): Promise<void> {
  await mkdir(outboxDir(), { recursive: true, mode: 0o700 });
  const entries = await readOutbox();
  entries.push({ id: entryId(report, queuedAt), queuedAt, report });
  const capped = entries.slice(-MAX_ENTRIES);
  await writeOutbox(capped);
}

export async function readOutbox(): Promise<OutboxEntry[]> {
  const path = outboxFile();
  if (!existsSync(path)) return [];
  const text = await readFile(path, "utf8").catch(() => "");
  const result: OutboxEntry[] = [];
  for (const line of text.split("\n")) {
    if (!line.trim()) continue;
    try {
      result.push(outboxEntrySchema.parse(JSON.parse(line)));
    } catch {
      // Skip corrupt lines rather than failing the whole drain.
    }
  }
  return result;
}

async function writeOutbox(entries: readonly OutboxEntry[]): Promise<void> {
  await mkdir(outboxDir(), { recursive: true, mode: 0o700 });
  const body = entries.map((e) => JSON.stringify(e)).join("\n");
  await writeFile(outboxFile(), body.length > 0 ? body + "\n" : "");
}

/**
 * Drain the outbox through `send`. Entries that send successfully are removed;
 * entries that fail are kept for the next attempt. Returns counts.
 */
export async function drainOutbox(
  send: (report: BoardReport) => Promise<void>
): Promise<{ sent: number; remaining: number }> {
  const entries = await readOutbox();
  if (entries.length === 0) return { sent: 0, remaining: 0 };

  const kept: OutboxEntry[] = [];
  let sent = 0;
  for (const entry of entries) {
    try {
      await send(entry.report);
      sent++;
    } catch {
      kept.push(entry);
    }
  }
  await writeOutbox(kept);
  return { sent, remaining: kept.length };
}

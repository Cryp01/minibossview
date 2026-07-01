/**
 * Flush the offline outbox against the board. Shared by live reporting (best-
 * effort flush before a send) and by the hooks (delivery guarantee).
 */
import type { RepoConfig } from "@miniboss/shared";
import { applyReport } from "./board.ts";
import { drainOutbox } from "./queue.ts";
import { openSession } from "./session.ts";

export async function drainOutboxFor(
  repoConfig: RepoConfig | null
): Promise<{ sent: number; remaining: number }> {
  const session = await openSession(repoConfig);
  if (!session) return { sent: 0, remaining: 0 };
  return drainOutbox(async (report) => {
    await applyReport(session.client, report, "agent");
  });
}

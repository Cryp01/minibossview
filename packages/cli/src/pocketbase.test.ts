import { describe, expect, test } from "bun:test";
import { authWithPassword, buildHeaders, PbClient, recordsPath } from "./pocketbase.ts";

const SERVER = process.env.MINIBOSS_TEST_SERVER ?? "http://127.0.0.1:8090";
const AGENT_EMAIL = process.env.MINIBOSS_TEST_AGENT_EMAIL ?? "agent@miniboss.local";
const AGENT_PASSWORD = process.env.MINIBOSS_TEST_AGENT_PASSWORD ?? "changeme-agent-123";
const SU_EMAIL = process.env.PB_SUPERUSER_EMAIL ?? "admin@miniboss.local";
const SU_PASSWORD = process.env.PB_SUPERUSER_PASSWORD ?? "changeme-admin-123";

async function serverUp(): Promise<boolean> {
  try {
    const res = await fetch(new URL("/api/health", SERVER), { signal: AbortSignal.timeout(800) });
    return res.ok;
  } catch {
    return false;
  }
}
const LIVE = await serverUp();

describe("pure helpers", () => {
  test("recordsPath builds collection and record URLs", () => {
    expect(recordsPath("tickets")).toBe("/api/collections/tickets/records");
    expect(recordsPath("tickets", "abc123")).toBe("/api/collections/tickets/records/abc123");
  });

  test("buildHeaders uses RAW token (no Bearer prefix)", () => {
    const headers = buildHeaders("TKN");
    expect(headers["Authorization"]).toBe("TKN");
    expect(headers["Authorization"]).not.toContain("Bearer");
    expect(headers["Content-Type"]).toBe("application/json");
  });

  test("buildHeaders omits Authorization when no token", () => {
    expect(buildHeaders()["Authorization"]).toBeUndefined();
  });
});

describe.skipIf(!LIVE)("live integration (requires seeded PocketBase)", () => {
  test("agent can auth, create, read and update a ticket (raw token)", async () => {
    const auth = await authWithPassword(SERVER, "agents", AGENT_EMAIL, AGENT_PASSWORD);
    expect(auth.token.length).toBeGreaterThan(10);

    const client = new PbClient(SERVER, auth.token);
    const team = await client.getFirst("teams", 'slug = "platform"');
    expect(team).not.toBeNull();

    const externalKey = `pbtest:${Date.now()}`;
    const created = await client.create("tickets", {
      title: "PB CONTRACT TEST",
      status: "todo",
      team: team!.id,
      origin: "agent",
      external_key: externalKey,
    });
    expect(created.id).toBeTruthy();

    const found = await client.getFirst("tickets", `external_key = "${externalKey}"`);
    expect(found?.id).toBe(created.id);

    // Agents may update (WRITE rule) but not delete (manager-only).
    const updated = await client.update("tickets", created.id, { status: "in_progress" });
    expect(updated.status).toBe("in_progress");

    // Cleanup via superuser (bypasses rules).
    const su = await authWithPassword(SERVER, "_superusers", SU_EMAIL, SU_PASSWORD);
    await new PbClient(SERVER, su.token).delete("tickets", created.id);
  });
});

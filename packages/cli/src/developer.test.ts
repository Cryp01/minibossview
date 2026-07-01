import { describe, expect, test } from "bun:test";
import { identityForAuthor } from "./developer.ts";
import { ensureMember } from "./board.ts";
import { authWithPassword, PbClient } from "./pocketbase.ts";

describe("identityForAuthor (pure)", () => {
  test("GitHub noreply email → github username, verified", () => {
    const id = identityForAuthor({ name: "Octo Cat", email: "12345+octocat@users.noreply.github.com" });
    expect(id.username).toBe("octocat");
    expect(id.verified).toBe(true);
  });
  test("normal email → email fallback, unverified", () => {
    const id = identityForAuthor({ name: "Dev", email: "dev@company.com" });
    expect(id.username).toBe("email:dev@company.com");
    expect(id.verified).toBe(false);
  });
});

// ---- live: one member across multiple emails ------------------------------

const SERVER = process.env.MINIBOSS_TEST_SERVER ?? "http://127.0.0.1:8090";
const SU_EMAIL = "admin@miniboss.local";
const SU_PASSWORD = "changeme-admin-123";

async function serverUp(): Promise<boolean> {
  try {
    return (await fetch(new URL("/api/health", SERVER), { signal: AbortSignal.timeout(800) })).ok;
  } catch {
    return false;
  }
}
const LIVE = await serverUp();

describe.skipIf(!LIVE)("dedup by GitHub username (live)", () => {
  test("same username, two emails → one member accumulating both emails", async () => {
    const auth = await authWithPassword(SERVER, "agents", "agent@miniboss.local", "changeme-agent-123");
    const client = new PbClient(SERVER, auth.token);
    const username = `dedup-test-${Date.now()}`;

    // Same GitHub user, committing under two different emails.
    const id1 = await ensureMember(client, {
      username,
      displayName: "Dedup Tester",
      email: "work@example.com",
      verified: true,
    });
    const id2 = await ensureMember(client, {
      username,
      displayName: "Dedup Tester",
      email: "personal@example.com",
      verified: true,
    });

    expect(id1).toBe(id2); // one person, not two members

    const su = await authWithPassword(SERVER, "_superusers", SU_EMAIL, SU_PASSWORD);
    const suClient = new PbClient(SERVER, su.token);
    const member = await suClient.getFirst("members", `username = "${username}"`);
    expect(member).not.toBeNull();
    const emails = (member!.emails as string[]) ?? [];
    expect(emails).toContain("work@example.com");
    expect(emails).toContain("personal@example.com");

    await suClient.delete("members", member!.id);
  });
});

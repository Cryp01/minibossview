/**
 * Create the accounts a DEPLOYED board needs — WITHOUT demo data:
 *   - one `agents` record (the token the CLI uses to report)
 *   - one `app_users` manager + viewer (to log into the board UI)
 *
 * Run it against your instance with the superuser you set at deploy time:
 *
 *   PB_URL=https://board.yourcompany.com \
 *   PB_SUPERUSER_EMAIL=admin@... PB_SUPERUSER_PASSWORD='...' \
 *   bun scripts/provision-accounts.ts
 *
 * Passwords are generated unless you pass them via env (AGENT_PASSWORD,
 * MANAGER_PASSWORD, VIEWER_PASSWORD). Emails default to <role>@<board-host>.
 * Idempotent: re-running updates the same records.
 */
import { randomBytes } from "node:crypto";
import PocketBase from "pocketbase";

const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";
const SU_EMAIL = process.env.PB_SUPERUSER_EMAIL;
const SU_PASSWORD = process.env.PB_SUPERUSER_PASSWORD;

if (!SU_EMAIL || !SU_PASSWORD) {
  console.error("Set PB_SUPERUSER_EMAIL and PB_SUPERUSER_PASSWORD (your deploy superuser).");
  process.exit(1);
}

const host = new URL(PB_URL).hostname;
const gen = () => randomBytes(15).toString("base64url");

const accounts = {
  agent: {
    email: process.env.AGENT_EMAIL ?? `agent@${host}`,
    password: process.env.AGENT_PASSWORD ?? gen(),
  },
  manager: {
    email: process.env.MANAGER_EMAIL ?? `manager@${host}`,
    password: process.env.MANAGER_PASSWORD ?? gen(),
  },
  viewer: {
    email: process.env.VIEWER_EMAIL ?? `viewer@${host}`,
    password: process.env.VIEWER_PASSWORD ?? gen(),
  },
};

const pb = new PocketBase(PB_URL);
pb.autoCancellation(false);

async function upsert(collection: string, filter: string, data: Record<string, unknown>): Promise<void> {
  try {
    const existing = await pb.collection(collection).getFirstListItem(filter);
    await pb.collection(collection).update(existing.id, data);
  } catch {
    await pb.collection(collection).create(data);
  }
}

async function main(): Promise<void> {
  await pb.collection("_superusers").authWithPassword(SU_EMAIL!, SU_PASSWORD!);

  await upsert("agents", `email = "${accounts.agent.email}"`, {
    email: accounts.agent.email,
    password: accounts.agent.password,
    passwordConfirm: accounts.agent.password,
    label: "default-agent",
    active: true,
    verified: true,
  });
  await upsert("app_users", `email = "${accounts.manager.email}"`, {
    email: accounts.manager.email,
    password: accounts.manager.password,
    passwordConfirm: accounts.manager.password,
    name: "Manager",
    role: "manager",
    verified: true,
  });
  await upsert("app_users", `email = "${accounts.viewer.email}"`, {
    email: accounts.viewer.email,
    password: accounts.viewer.password,
    passwordConfirm: accounts.viewer.password,
    name: "Viewer",
    role: "viewer",
    verified: true,
  });

  console.log("\n✓ accounts ready on", PB_URL);
  console.log("\n  Board login (manager) →", accounts.manager.email, "/", accounts.manager.password);
  console.log("  Board login (viewer)  →", accounts.viewer.email, "/", accounts.viewer.password);
  console.log("\n  CLI agent (for the installer):");
  console.log("    email    :", accounts.agent.email);
  console.log("    password :", accounts.agent.password);
  console.log("\n  Connect the CLI:  miniboss login   (or ./install.sh <url>", accounts.agent.email, "<password>)");
}

main().catch((err) => {
  console.error("provisioning failed:", err?.message ?? err);
  process.exit(1);
});

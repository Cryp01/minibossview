/**
 * Seeds a local PocketBase with demo data and the accounts the system needs.
 * Idempotent: safe to run repeatedly. DEV CREDENTIALS ONLY — override via env.
 *
 *   bun run scripts/seed.ts
 */
import PocketBase from "pocketbase";
import { normalizeEmail } from "../packages/shared/src/identity.ts";

const PB_URL = process.env.PB_URL ?? "http://127.0.0.1:8090";
const SU_EMAIL = process.env.PB_SUPERUSER_EMAIL ?? "admin@miniboss.local";
const SU_PASSWORD = process.env.PB_SUPERUSER_PASSWORD ?? "changeme-admin-123";

const ACCOUNTS = {
  agent: { email: "agent@miniboss.local", password: "changeme-agent-123" },
  manager: { email: "manager@miniboss.local", password: "changeme-mgr-123" },
  viewer: { email: "viewer@miniboss.local", password: "changeme-view-123" },
};

interface Identity {
  name: string;
  email: string;
  username: string; // GitHub username — the members dedup key
}

const MEMBERS: Identity[] = [
  { name: "Ada Lovelace", email: "ada@example.com", username: "adalovelace" },
  { name: "Grace Hopper", email: "grace@example.com", username: "ghopper" },
  { name: "Alan Turing", email: "alan@example.com", username: "aturing" },
  { name: "Katherine Johnson", email: "katherine@example.com", username: "kjohnson" },
  { name: "Margaret Hamilton", email: "margaret@example.com", username: "mhamilton" },
];

const pb = new PocketBase(PB_URL);
pb.autoCancellation(false);

async function findFirst(collection: string, filter: string): Promise<{ id: string } | null> {
  try {
    return await pb.collection(collection).getFirstListItem(filter);
  } catch {
    return null;
  }
}

async function upsert<T extends Record<string, unknown>>(
  collection: string,
  filter: string,
  data: T
): Promise<{ id: string }> {
  const existing = await findFirst(collection, filter);
  if (existing) return await pb.collection(collection).update(existing.id, data);
  return await pb.collection(collection).create(data);
}

async function main(): Promise<void> {
  await pb.collection("_superusers").authWithPassword(SU_EMAIL, SU_PASSWORD);
  console.log("✓ authenticated as superuser");

  // Automation agent (the CLI's identity).
  await upsert("agents", `email = "${ACCOUNTS.agent.email}"`, {
    email: ACCOUNTS.agent.email,
    password: ACCOUNTS.agent.password,
    passwordConfirm: ACCOUNTS.agent.password,
    label: "default-agent",
    active: true,
    verified: true,
  });
  console.log("✓ agent account");

  // Human accounts.
  await upsert("app_users", `email = "${ACCOUNTS.manager.email}"`, {
    email: ACCOUNTS.manager.email,
    password: ACCOUNTS.manager.password,
    passwordConfirm: ACCOUNTS.manager.password,
    name: "Manager Demo",
    role: "manager",
    verified: true,
  });
  await upsert("app_users", `email = "${ACCOUNTS.viewer.email}"`, {
    email: ACCOUNTS.viewer.email,
    password: ACCOUNTS.viewer.password,
    passwordConfirm: ACCOUNTS.viewer.password,
    name: "Viewer Demo",
    role: "viewer",
    verified: true,
  });
  console.log("✓ human accounts (manager, viewer)");

  // Teams.
  const payments = await upsert("teams", 'slug = "payments"', {
    name: "Payments",
    slug: "payments",
    description: "Billing, checkout and payment rails",
  });
  const platform = await upsert("teams", 'slug = "platform"', {
    name: "Platform",
    slug: "platform",
    description: "Internal tooling and developer platform",
  });

  // Projects.
  const checkout = await upsert("projects", 'slug = "checkout-api"', {
    name: "Checkout API",
    slug: "checkout-api",
    team: payments.id,
    repo_remote: "git@github.com:demo/checkout-api.git",
    default_branch: "main",
  });
  const board = await upsert("projects", 'slug = "mini-boss-view"', {
    name: "Mini Boss View",
    slug: "mini-boss-view",
    team: platform.id,
    repo_remote: "git@github.com:demo/mini-boss-view.git",
    default_branch: "main",
  });

  // Members (developers), keyed by GitHub username.
  const memberIds: string[] = [];
  for (const m of MEMBERS) {
    const rec = await upsert("members", `username = "${m.username}"`, {
      username: m.username,
      email_normalized: normalizeEmail(m.email),
      emails: [normalizeEmail(m.email)],
      display_name: m.name,
      aliases: [{ name: m.name, email: m.email }],
      active: true,
    });
    memberIds.push(rec.id);
  }
  console.log(`✓ teams, projects, ${memberIds.length} members`);

  // Tickets across the board, with a small worklog trail each.
  const statuses = ["backlog", "todo", "in_progress", "review", "done"] as const;
  const sample = [
    { title: "Add idempotency keys to payment intents", team: payments.id, project: checkout.id },
    { title: "Retry failed webhooks with backoff", team: payments.id, project: checkout.id },
    { title: "Refactor settlement reconciliation", team: payments.id, project: checkout.id },
    { title: "Realtime board updates via SSE", team: platform.id, project: board.id },
    { title: "Drag-and-drop status changes", team: platform.id, project: board.id },
    { title: "Import git history into tickets", team: platform.id, project: board.id },
    { title: "Members admin and identity merge", team: platform.id, project: board.id },
    { title: "Installer hardening for macOS", team: platform.id, project: board.id },
    { title: "Worklog timeline ordering", team: platform.id, project: board.id },
    { title: "Secret scrubber test corpus", team: platform.id, project: board.id },
  ];

  let created = 0;
  for (let i = 0; i < sample.length; i++) {
    const s = sample[i]!;
    const status = statuses[i % statuses.length]!;
    const assignee = memberIds[i % memberIds.length]!;
    const externalKey = `seed:${s.project}:${i}`;
    const ticket = await upsert("tickets", `external_key = "${externalKey}"`, {
      title: s.title,
      description: `Demo ticket seeded for the board. Status: ${status}.`,
      status,
      team: s.team,
      project: s.project,
      assignee,
      priority: (["low", "med", "high", "urgent"] as const)[i % 4],
      tags: ["demo"],
      origin: "agent",
      external_key: externalKey,
      work_date: new Date(Date.UTC(2026, 5, 10 + i)).toISOString(),
    });

    const existingLogs = await pb
      .collection("worklog")
      .getList(1, 1, { filter: `ticket = "${ticket.id}"` });
    if (existingLogs.totalItems === 0) {
      await pb.collection("worklog").create({
        ticket: ticket.id,
        author_member: assignee,
        kind: "progress",
        message: "Started the task and outlined the approach.",
        work_date: new Date(Date.UTC(2026, 5, 10 + i)).toISOString(),
      });
      if (status === "done") {
        await pb.collection("worklog").create({
          ticket: ticket.id,
          author_member: assignee,
          kind: "status_change",
          message: "Completed and merged.",
          meta: { from: "in_progress", to: "done" },
          work_date: new Date(Date.UTC(2026, 5, 12 + i)).toISOString(),
        });
      }
    }
    created++;
  }
  console.log(`✓ ${created} tickets with worklog`);
  console.log("\nSeed complete. Accounts:");
  console.log(`  superuser : ${SU_EMAIL} / ${SU_PASSWORD}`);
  console.log(`  manager   : ${ACCOUNTS.manager.email} / ${ACCOUNTS.manager.password}`);
  console.log(`  viewer    : ${ACCOUNTS.viewer.email} / ${ACCOUNTS.viewer.password}`);
  console.log(`  agent     : ${ACCOUNTS.agent.email} / ${ACCOUNTS.agent.password}`);
}

main().catch((err) => {
  console.error("Seed failed:", err);
  process.exit(1);
});

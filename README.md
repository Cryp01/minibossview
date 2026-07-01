# Mini Boss View

A central Scrum/Kanban board that **Claude Code feeds automatically** — so
developers never write a daily standup or file tickets by hand, and managers can
see what every team is working on across every project.

- **Developers are identified by their GitHub username** (resolved from git),
  not by a Claude account — so one person with several commit emails stays a
  single member on the board.
- A Claude Code **hook + skill** report work to the board as it happens (one
  ticket per task/feature, with a worklog trail). Managers can also create and
  assign tickets from the board.
- Already-started projects can be **imported** from their git history (backdated,
  attributed to each commit's author).

**Stack:** Vite · PocketBase v0.39.5 · TanStack (Router + Query) · `@dnd-kit` ·
Bun (runtime + package manager). Developer machines: macOS.

```
apps/board/          Vite + TanStack SPA (the board UI)
pb/                  PocketBase binary + migrations (schema as code)
packages/shared/     zod contract + types shared by board and CLI
packages/cli/        the `miniboss` CLI (what the hook and skill call)
packages/installer/  per-developer installer
skills/miniboss/     the Claude Code /miniboss skill
Dockerfile           builds one image: PocketBase serving API + built SPA
docker-compose.coolify.yml   production deploy (Coolify)
install.sh           one-command per-developer client install
```

There are **two things to install**:

1. **The board** — deployed **once** to a server (below: Coolify). One container
   runs PocketBase, which serves the REST API *and* the built board UI.
2. **The client** — installed by **each developer** on their Mac (the `miniboss`
   CLI + the Claude Code skill/hooks that report to the board).

---

## Part 1 — Deploy the board (production, Coolify)

The board is a single container. Migrations apply automatically on boot; the
first admin is created from env vars; data lives in a persistent volume.

1. **Point Coolify at this repo.** In Coolify: *New Resource → Docker Compose*,
   choose this repository and set the compose file to
   [`docker-compose.coolify.yml`](docker-compose.coolify.yml).

2. **Set the environment variables** (resource → *Environment Variables*). See
   [`.env.production.example`](.env.production.example):

   | Variable | What | Secret? |
   |---|---|---|
   | `PB_SUPERUSER_EMAIL` | first admin login for `/_/` | no |
   | `PB_SUPERUSER_PASSWORD` | first admin password (long & random) | **yes** |
   | `PB_ENCRYPTION_KEY` | optional 32-char key to encrypt settings (`openssl rand -hex 16`) | **yes** |

3. **Assign a domain** to the service. Coolify fills `SERVICE_FQDN_MINIBOSS_8090`,
   wires Traefik to port 8090, and provisions HTTPS (Let's Encrypt) automatically.

4. **Deploy.** When it's healthy (`/api/health`), open your domain — the board UI
   is served at `/`, the PocketBase admin dashboard at `/_/`.

5. **Create the accounts** in the dashboard (`https://<domain>/_/`):
   - one **agent** record in the `agents` collection → this is the token the CLI
     uses to report (give the email/password to your team, step 2 of Part 2);
   - **manager**/**viewer** records in `app_users` (role `manager` / `viewer`)
     so people can log into the board.

   > Prefer scripting it? Run [`scripts/seed.ts`](scripts/seed.ts) against the
   > deployed instance with `PB_URL`, `PB_SUPERUSER_EMAIL`, `PB_SUPERUSER_PASSWORD`
   > set — it creates the agent + manager + viewer + demo data.

Coolify notes: the compose already uses the external `coolify` network, no
published `ports:`, a `driver: local` volume, and a healthcheck — the conventions
Coolify needs for HTTPS + zero-config routing.

---

## Part 2 — Install for your team (each developer, macOS)

Each developer runs this **once**. It installs the `miniboss` CLI, stores the
board URL + agent credentials, and registers the Claude Code skill + hooks
(merging into `~/.claude/settings.json` — existing hooks are preserved, with a
backup).

```bash
git clone <this-repo-url> mini-boss-view
cd mini-boss-view
./install.sh https://board.yourcompany.com agent@yourcompany.com <agent-password>
```

(Run `./install.sh` with no arguments for interactive prompts.)

Then **restart Claude Code once** so it discovers the `/miniboss` skill, and
verify:

```bash
miniboss doctor
```

Prerequisite: [Bun](https://bun.sh) (`curl -fsSL https://bun.sh/install | bash`).

---

## Part 3 — Use it

Nothing to configure per project — team and project are derived from git
(project = repo name, team = git remote owner).

**Automatic reporting.** Just work with Claude Code in any git repo. It reports
to the board at natural points (start / progress / done), tagged with your git
identity, branch, and commit. Summaries are plain-English only — a three-layer
scrubber refuses code and secrets, and hooks never block you (offline reports are
queued and flushed later).

**Index an already-started project** (from a Claude Code session in that repo):

```
/miniboss import
```

Claude reads the git log, groups commits into readable tasks, and imports them
backdated and attributed to each commit's author.

**Handy CLI commands:**

```bash
miniboss init                 # write .miniboss/config.json from the repo (optional)
miniboss init --team payments --project checkout-api   # or pin it explicitly
miniboss import --group time --dry-run   # preview a deterministic import
miniboss report status        # current task for this repo
miniboss doctor               # server / credentials / git identity check
```

---

## Run locally (development)

Run the whole board on your machine with Docker:

```bash
docker compose up --build            # board at http://localhost:8090
docker compose --profile seed up     # + demo teams/projects/tickets
```

Or run the pieces directly for UI work (hot reload):

```bash
bun install
bun run pb:fetch                                  # download PocketBase
cd pb && ./pocketbase migrate up
./pocketbase superuser create admin@miniboss.local changeme-admin-123
./pocketbase serve --http 127.0.0.1:8090 &
cd .. && bun run seed                             # demo data + dev accounts
bun run dev:board                                 # Vite on http://localhost:5173
```

Dev accounts (local only): `manager@miniboss.local` / `changeme-mgr-123`,
`viewer@miniboss.local`, agent `agent@miniboss.local` / `changeme-agent-123`.

Point the CLI at your local board without installing anything:

```bash
export MINIBOSS_SERVER=http://127.0.0.1:8090
export MINIBOSS_AGENT_EMAIL=agent@miniboss.local
export MINIBOSS_AGENT_PASSWORD=changeme-agent-123
cd /path/to/any/repo
bun /path/to/mini-boss-view/packages/cli/bin/miniboss.ts import --group time
```

---

## Development

```bash
bun test            # unit + live-integration tests (integration needs PocketBase on :8090)
bun run typecheck   # all packages
bun run build:board # production build of the SPA
```

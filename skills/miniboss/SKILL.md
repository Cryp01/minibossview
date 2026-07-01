---
name: miniboss
description: >
  Report development work to the team's Scrum board so the programmer never has
  to write a daily standup or file tickets by hand. Use this PROACTIVELY: when
  you BEGIN a distinct task or feature, when you complete a meaningful chunk of
  it, and when it is DONE. Also use it to import an already-started project's git
  history into the board. Authors a short plain-English summary only — never
  code, diffs, secrets, or file contents. The developer is identified by their
  git user, not by Claude.
argument-hint: "[start|update|done|import] <short task title>"
allowed-tools: Bash(miniboss *), Bash(git log:*), Bash(git rev-parse:*)
---

# miniboss — report work to the team board

You report what is being worked on to a central Scrum board through the
`miniboss` CLI. A Claude Code hook ships each report automatically, tagged with
the developer's **git identity** and the **current folder** — the programmer
does nothing manual. Corporate/managers watch the board to understand progress
without standups, and can assign tickets back.

The board groups work into **one ticket per task/feature**. Keep updating the
same ticket until the task is done; starting a new task opens a new ticket.

## When to report (do this on your own initiative)

- **start** — the moment you begin a distinct task or feature (a new request, a
  new feature branch, a clearly new goal).
- **update** — after you finish a meaningful chunk: a subsystem wired up, tests
  passing, a blocker resolved. NOT after trivial Q&A or tiny edits — only when a
  human reading the board would care.
- **done** — when the task is complete (shipped/merged/verified).

Do not report on every turn. You are the gate that decides what is worth a board
entry; reporting noise makes the board useless.

## How to report

Pass the summary on **stdin** (never as a shell argument — it avoids quoting
bugs and keeps multi-line prose intact):

```bash
# Begin a task
printf %s "Add idempotency keys to the payment intents endpoint." \
  | miniboss report start --title "Idempotency keys for payments" --stdin

# Progress update on the same task
printf %s "Wired the middleware and covered retries with tests; all green." \
  | miniboss report update --stdin

# Finish the task
printf %s "Shipped behind a flag and merged to main." \
  | miniboss report done --stdin
```

`miniboss report status` prints the current task for this repo if you need to
check what is open.

## Importing an already-started project

When asked to load an existing project's history onto the board, read the git
log yourself, group the commits into readable tasks/features, and hand the CLI a
manifest. You produce the human-readable titles and summaries; the CLI backdates
each ticket and attributes every commit to its real author.

1. Read the history (read-only):

   ```bash
   git log --all --date=iso --pretty=format:'%H | %an <%ae> | %ad | %s'
   ```

2. Cluster the commits into coherent tasks/features. Write a short, plain-English
   title and 1–3 sentence summary per cluster. List each cluster's commit SHAs.

3. Build a manifest and pipe it in:

   ```bash
   cat <<'JSON' | miniboss import --stdin
   {
     "schemaVersion": 1,
     "clusters": [
       {
         "title": "Idempotency keys for payments",
         "summary": "Added idempotency-key handling end-to-end with retries.",
         "status": "done",
         "commits": ["<sha1>", "<sha2>"]
       }
     ]
   }
   JSON
   ```

Preview first with `miniboss import --group time --dry-run` if you want a quick
deterministic plan without authoring a manifest. Re-running import is safe
(idempotent); use `--replace` for a clean re-import.

## Safety — summaries only (non-negotiable)

Summaries leave the developer's machine. Write **intent and outcome in prose**.
Keep each summary under ~600 characters. NEVER include:

- source code, diffs, or file contents (no code fences)
- secrets, tokens, API keys, passwords, connection strings, or env values
- raw command output or stack traces

The CLI runs a deterministic scrubber and will drop anything that looks like a
secret or code, but do not rely on it — keep summaries clean by construction. If
in doubt, describe *what changed and why*, not *how* in code.

## Reliability

`miniboss` never blocks you: if the board is unreachable, the report is queued
locally and delivered automatically later. You can keep working regardless of
its output. If `miniboss doctor` reports a problem (no server/credentials, no git
identity), tell the developer to run the installer or set git `user.email`.

## Repo config (optional)

You do NOT need to create anything by hand: team and project are derived from git
automatically (project = repo name, team = git remote owner). To pin an explicit
mapping into a committed `.miniboss/config.json`, run once:

```bash
miniboss init                       # derive from the repo
miniboss init --team payments --project checkout-api   # or override
```

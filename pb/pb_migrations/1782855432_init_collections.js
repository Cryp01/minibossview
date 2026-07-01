/// <reference path="../pb_data/types.d.ts" />

// mini-boss-view schema as code.
// Collections: app_users (auth), agents (auth), members, teams, projects, tickets, worklog.
// Rule vocabulary:
//   AUTHED      any authenticated record (a human app_user OR an automation agent)
//   IS_AGENT    the automation client (CLI) — created from the `agents` auth collection
//   IS_MANAGER  an app_user whose role is manager or admin
//   IS_ADMIN    an app_user whose role is admin
//   WRITE       IS_AGENT or IS_MANAGER — may create/append board data
migrate(
  (app) => {
    const AUTHED = '@request.auth.id != ""';
    const IS_AGENT = '@request.auth.collectionName = "agents"';
    const IS_MANAGER =
      '(@request.auth.collectionName = "app_users" && (@request.auth.role = "manager" || @request.auth.role = "admin"))';
    const IS_ADMIN =
      '(@request.auth.collectionName = "app_users" && @request.auth.role = "admin")';
    const WRITE = `(${IS_AGENT} || ${IS_MANAGER})`;

    const autodateCreated = { name: "created", type: "autodate", onCreate: true, onUpdate: false };
    const autodateUpdated = { name: "updated", type: "autodate", onCreate: true, onUpdate: true };

    // ---- app_users (auth): managers + viewers ------------------------------
    const appUsers = new Collection({
      type: "auth",
      name: "app_users",
      passwordAuth: { enabled: true, identityFields: ["email"] },
      listRule: IS_ADMIN,
      viewRule: `id = @request.auth.id || ${IS_ADMIN}`,
      createRule: IS_ADMIN,
      updateRule: `(id = @request.auth.id && @request.body.role:isset = false) || ${IS_ADMIN}`,
      deleteRule: IS_ADMIN,
      fields: [
        { name: "name", type: "text", required: true, max: 120 },
        {
          name: "role",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["viewer", "manager", "admin"],
        },
        autodateCreated,
        autodateUpdated,
      ],
    });
    app.save(appUsers);

    // ---- agents (auth): automation identity for the CLI --------------------
    // CRUD locked to superuser; the collection still authenticates via password
    // so the CLI can exchange agent credentials for a token.
    const agents = new Collection({
      type: "auth",
      name: "agents",
      passwordAuth: { enabled: true, identityFields: ["email"] },
      listRule: null,
      viewRule: null,
      createRule: null,
      updateRule: null,
      deleteRule: null,
      fields: [
        { name: "label", type: "text", required: false, max: 120 },
        { name: "active", type: "bool" },
        autodateCreated,
        autodateUpdated,
      ],
    });
    app.save(agents);

    // ---- teams -------------------------------------------------------------
    const teams = new Collection({
      type: "base",
      name: "teams",
      listRule: AUTHED,
      viewRule: AUTHED,
      createRule: WRITE,
      updateRule: IS_MANAGER,
      deleteRule: IS_ADMIN,
      fields: [
        { name: "name", type: "text", required: true, max: 120 },
        { name: "slug", type: "text", required: true, max: 80, pattern: "^[a-z0-9-]+$" },
        { name: "description", type: "text", required: false, max: 500 },
        autodateCreated,
        autodateUpdated,
      ],
      indexes: ["CREATE UNIQUE INDEX `idx_teams_slug` ON `teams` (`slug`)"],
    });
    app.save(teams);

    // ---- members: git-identity registry (NOT auth) -------------------------
    const members = new Collection({
      type: "base",
      name: "members",
      listRule: AUTHED,
      viewRule: AUTHED,
      createRule: WRITE,
      updateRule: WRITE,
      deleteRule: null,
      fields: [
        // A developer is identified by their GitHub username (stable across the
        // multiple git emails they may commit with). `email_normalized` holds the
        // first/primary email; `emails` accumulates every email seen for them.
        { name: "username", type: "text", required: false, max: 80 },
        { name: "email_normalized", type: "text", required: false, max: 254 },
        { name: "emails", type: "json", required: false, maxSize: 20000 },
        { name: "display_name", type: "text", required: false, max: 120 },
        { name: "aliases", type: "json", required: false, maxSize: 20000 },
        {
          name: "linked_user",
          type: "relation",
          required: false,
          maxSelect: 1,
          collectionId: appUsers.id,
          cascadeDelete: false,
        },
        { name: "active", type: "bool" },
        autodateCreated,
        autodateUpdated,
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_members_username` ON `members` (`username`) WHERE `username` != ''",
        "CREATE INDEX `idx_members_email` ON `members` (`email_normalized`)",
      ],
    });
    app.save(members);

    // ---- projects ----------------------------------------------------------
    const projects = new Collection({
      type: "base",
      name: "projects",
      listRule: AUTHED,
      viewRule: AUTHED,
      createRule: WRITE,
      updateRule: WRITE,
      deleteRule: IS_MANAGER,
      fields: [
        { name: "name", type: "text", required: true, max: 120 },
        { name: "slug", type: "text", required: true, max: 80, pattern: "^[a-z0-9-]+$" },
        {
          name: "team",
          type: "relation",
          required: true,
          maxSelect: 1,
          collectionId: teams.id,
          cascadeDelete: false,
        },
        { name: "repo_remote", type: "text", required: false, max: 400 },
        { name: "default_branch", type: "text", required: false, max: 120 },
        autodateCreated,
        autodateUpdated,
      ],
      indexes: [
        "CREATE UNIQUE INDEX `idx_projects_team_slug` ON `projects` (`team`, `slug`)",
      ],
    });
    app.save(projects);

    // ---- tickets: one per task/feature -------------------------------------
    const tickets = new Collection({
      type: "base",
      name: "tickets",
      listRule: AUTHED,
      viewRule: AUTHED,
      createRule: WRITE,
      updateRule: WRITE,
      deleteRule: IS_MANAGER,
      fields: [
        { name: "title", type: "text", required: true, max: 200 },
        { name: "description", type: "editor", required: false },
        {
          name: "status",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["backlog", "todo", "in_progress", "review", "done"],
        },
        {
          name: "team",
          type: "relation",
          required: false,
          maxSelect: 1,
          collectionId: teams.id,
          cascadeDelete: false,
        },
        {
          name: "project",
          type: "relation",
          required: false,
          maxSelect: 1,
          collectionId: projects.id,
          cascadeDelete: false,
        },
        {
          name: "assignee",
          type: "relation",
          required: false,
          maxSelect: 1,
          collectionId: members.id,
          cascadeDelete: false,
        },
        {
          name: "priority",
          type: "select",
          required: false,
          maxSelect: 1,
          values: ["low", "med", "high", "urgent"],
        },
        { name: "tags", type: "json", required: false, maxSize: 5000 },
        { name: "repo_remote", type: "text", required: false, max: 400 },
        { name: "branch", type: "text", required: false, max: 200 },
        { name: "last_commit", type: "text", required: false, max: 80 },
        {
          name: "origin",
          type: "select",
          required: false,
          maxSelect: 1,
          values: ["agent", "manager", "import"],
        },
        { name: "work_date", type: "date", required: false },
        { name: "external_key", type: "text", required: false, max: 200 },
        autodateCreated,
        autodateUpdated,
      ],
      indexes: [
        "CREATE INDEX `idx_tickets_status` ON `tickets` (`status`)",
        "CREATE INDEX `idx_tickets_team` ON `tickets` (`team`)",
        "CREATE INDEX `idx_tickets_project` ON `tickets` (`project`)",
        "CREATE INDEX `idx_tickets_assignee` ON `tickets` (`assignee`)",
        "CREATE INDEX `idx_tickets_work_date` ON `tickets` (`work_date`)",
        "CREATE UNIQUE INDEX `idx_tickets_external_key` ON `tickets` (`external_key`) WHERE `external_key` != ''",
      ],
    });
    app.save(tickets);

    // ---- worklog: append-only activity stream ------------------------------
    const worklog = new Collection({
      type: "base",
      name: "worklog",
      listRule: AUTHED,
      viewRule: AUTHED,
      createRule: WRITE,
      updateRule: null,
      deleteRule: null,
      fields: [
        {
          name: "ticket",
          type: "relation",
          required: true,
          maxSelect: 1,
          collectionId: tickets.id,
          cascadeDelete: true,
        },
        {
          name: "author_member",
          type: "relation",
          required: false,
          maxSelect: 1,
          collectionId: members.id,
          cascadeDelete: false,
        },
        {
          name: "author_user",
          type: "relation",
          required: false,
          maxSelect: 1,
          collectionId: appUsers.id,
          cascadeDelete: false,
        },
        {
          name: "kind",
          type: "select",
          required: true,
          maxSelect: 1,
          values: ["status_change", "progress", "commit", "note", "assignment"],
        },
        { name: "message", type: "text", required: false, max: 5000 },
        { name: "meta", type: "json", required: false, maxSize: 20000 },
        { name: "commit", type: "text", required: false, max: 80 },
        { name: "work_date", type: "date", required: false },
        autodateCreated,
      ],
      indexes: [
        "CREATE INDEX `idx_worklog_ticket` ON `worklog` (`ticket`)",
        "CREATE INDEX `idx_worklog_created` ON `worklog` (`created`)",
        "CREATE UNIQUE INDEX `idx_worklog_ticket_commit` ON `worklog` (`ticket`, `commit`) WHERE `commit` != ''",
      ],
    });
    app.save(worklog);

    // app_users gains an optional multi-relation to teams now that teams exists.
    const appUsers2 = app.findCollectionByNameOrId("app_users");
    appUsers2.fields.add(
      new RelationField({
        name: "teams",
        required: false,
        maxSelect: 0,
        collectionId: teams.id,
        cascadeDelete: false,
      })
    );
    app.save(appUsers2);
  },
  (app) => {
    for (const name of [
      "worklog",
      "tickets",
      "projects",
      "members",
      "teams",
      "agents",
      "app_users",
    ]) {
      try {
        app.delete(app.findCollectionByNameOrId(name));
      } catch (_) {
        // ignore missing on rollback
      }
    }
  }
);

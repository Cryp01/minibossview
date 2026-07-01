/// <reference path="../pb_data/types.d.ts" />

// Allow the automation agent to delete ONLY its own import-origin tickets
// (so `miniboss import --replace` can clean up superseded clusters). Manual and
// manager tickets remain manager-deletable only.
migrate(
  (app) => {
    const IS_AGENT = '@request.auth.collectionName = "agents"';
    const IS_MANAGER =
      '(@request.auth.collectionName = "app_users" && (@request.auth.role = "manager" || @request.auth.role = "admin"))';
    const tickets = app.findCollectionByNameOrId("tickets");
    tickets.deleteRule = `(${IS_MANAGER} || (${IS_AGENT} && origin = "import"))`;
    app.save(tickets);
  },
  (app) => {
    const IS_MANAGER =
      '(@request.auth.collectionName = "app_users" && (@request.auth.role = "manager" || @request.auth.role = "admin"))';
    const tickets = app.findCollectionByNameOrId("tickets");
    tickets.deleteRule = IS_MANAGER;
    app.save(tickets);
  }
);

import {
  createRootRoute,
  createRoute,
  createRouter,
  redirect,
} from "@tanstack/react-router";
import { isAuthenticated, isManager } from "./lib/pb.ts";
import { AdminMembers } from "./routes/AdminMembers.tsx";
import { BoardsList } from "./routes/BoardsList.tsx";
import { Developers } from "./routes/Developers.tsx";
import { Login } from "./routes/Login.tsx";
import { ProjectBoard } from "./routes/ProjectBoard.tsx";
import { RootLayout } from "./routes/RootLayout.tsx";
import { TicketModal } from "./components/TicketModal.tsx";

const rootRoute = createRootRoute({ component: RootLayout });

const loginRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/login",
  component: Login,
});

function requireAuth() {
  if (!isAuthenticated()) throw redirect({ to: "/login" });
}

interface BoardSearch {
  assignee?: string;
}

const boardsListRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/",
  beforeLoad: requireAuth,
  component: BoardsList,
});

const projectBoardRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/project/$projectId",
  beforeLoad: requireAuth,
  component: ProjectBoard,
  validateSearch: (search: Record<string, unknown>): BoardSearch => ({
    assignee: typeof search.assignee === "string" ? search.assignee : undefined,
  }),
});

// Ticket detail renders as a modal overlay on top of the board (nested route).
const ticketModalRoute = createRoute({
  getParentRoute: () => projectBoardRoute,
  path: "ticket/$ticketId",
  component: TicketModal,
});

const developersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/developers",
  beforeLoad: requireAuth,
  component: Developers,
});

const adminMembersRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/admin/members",
  beforeLoad: () => {
    requireAuth();
    if (!isManager()) throw redirect({ to: "/" });
  },
  component: AdminMembers,
});

const routeTree = rootRoute.addChildren([
  loginRoute,
  boardsListRoute,
  projectBoardRoute.addChildren([ticketModalRoute]),
  developersRoute,
  adminMembersRoute,
]);

export const router = createRouter({ routeTree });

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}

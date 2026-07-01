import { Outlet } from "@tanstack/react-router";
import { AppShell } from "../components/AppShell.tsx";
import { isAuthenticated } from "../lib/pb.ts";

export function RootLayout() {
  // Unauthenticated (login) renders bare; everything else lives in the shell.
  if (!isAuthenticated()) {
    return <Outlet />;
  }
  return (
    <AppShell>
      <Outlet />
    </AppShell>
  );
}

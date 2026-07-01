import { useState, type ReactNode } from "react";
import { useNavigate } from "@tanstack/react-router";
import { Hexagon, Menu } from "lucide-react";
import { logout } from "../lib/pb.ts";
import { Sidebar } from "./Sidebar.tsx";

interface AppShellProps {
  children: ReactNode;
}

/** Floating-panel shell (Skrubba-style): sidebar card + main column of panels. */
export function AppShell({ children }: AppShellProps) {
  const navigate = useNavigate();
  const [drawerOpen, setDrawerOpen] = useState(false);

  function signOut() {
    logout();
    setDrawerOpen(false);
    navigate({ to: "/login" });
  }

  return (
    <div className={`app-shell${drawerOpen ? " drawer-open" : ""}`}>
      <Sidebar onNavigate={() => setDrawerOpen(false)} onSignOut={signOut} />
      <div className="drawer-scrim" onClick={() => setDrawerOpen(false)} />

      <div className="main">
        <div className="mobile-topbar">
          <button
            className="icon-btn"
            onClick={() => setDrawerOpen(true)}
            aria-label="Open navigation"
          >
            <Menu size={20} />
          </button>
          <span className="logo">
            <Hexagon size={18} strokeWidth={2.4} />
          </span>
          <strong>Mini Boss View</strong>
        </div>
        {children}
      </div>
    </div>
  );
}

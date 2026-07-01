import { Link } from "@tanstack/react-router";
import { Hexagon, LayoutGrid, LogOut, Moon, Sun, UserCog, Users } from "lucide-react";
import { currentUser, isManager } from "../lib/pb.ts";
import { initials } from "../lib/format.ts";
import { useTheme } from "../lib/theme.ts";

interface NavDef {
  to: string;
  label: string;
  icon: typeof LayoutGrid;
  exact?: boolean;
  managerOnly?: boolean;
}

const NAV: NavDef[] = [
  { to: "/", label: "Boards", icon: LayoutGrid, exact: true },
  { to: "/developers", label: "Developers", icon: Users },
  { to: "/admin/members", label: "Members", icon: UserCog, managerOnly: true },
];

interface SidebarProps {
  onNavigate?: () => void;
  onSignOut: () => void;
}

export function Sidebar({ onNavigate, onSignOut }: SidebarProps) {
  const user = currentUser();
  const manager = isManager();
  const { theme, toggle } = useTheme();

  return (
    <nav className="sidebar" aria-label="Main navigation">
      <div className="sidebar-brand">
        <span className="logo">
          <Hexagon size={22} strokeWidth={2.4} />
        </span>
        <span>Mini Boss View</span>
      </div>

      <div className="sidebar-nav">
        {NAV.filter((n) => !n.managerOnly || manager).map((n) => {
          const Icon = n.icon;
          return (
            <Link
              key={n.to}
              to={n.to}
              className="nav-item"
              activeProps={{ className: "nav-item active" }}
              activeOptions={{ exact: n.exact ?? false }}
              onClick={onNavigate}
            >
              <span className="nav-icon">
                <Icon size={18} />
              </span>
              <span>{n.label}</span>
            </Link>
          );
        })}
      </div>

      <div className="sidebar-footer">
        {user ? (
          <div className="sidebar-user">
            <span className="avatar" aria-hidden="true">
              {initials(user.name)}
            </span>
            <span className="who">
              <div className="name">{user.name}</div>
              <div className="role">{user.role}</div>
            </span>
          </div>
        ) : null}
        <div className="sidebar-actions">
          <button
            className="icon-btn"
            onClick={toggle}
            aria-label={theme === "dark" ? "Switch to light theme" : "Switch to dark theme"}
            title="Toggle theme"
          >
            {theme === "dark" ? <Sun size={18} /> : <Moon size={18} />}
          </button>
          <button className="icon-btn" onClick={onSignOut} aria-label="Sign out" title="Sign out">
            <LogOut size={18} />
          </button>
        </div>
      </div>
    </nav>
  );
}

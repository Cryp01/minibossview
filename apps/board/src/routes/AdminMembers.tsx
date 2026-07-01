import { PageHeader } from "../components/PageHeader.tsx";
import { useMembers, useUsers } from "../queries/meta.ts";

export function AdminMembers() {
  const members = useMembers();
  const users = useUsers();

  return (
    <>
      <PageHeader
        title="Members"
        subtitle="Developers reporting to the board, deduplicated by GitHub username — they appear automatically, no login required"
      />
      <div className="page-body">
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>GitHub</th>
            <th>Git emails</th>
            <th>Status</th>
          </tr>
        </thead>
        <tbody>
          {(members.data ?? []).map((m) => {
            const hasGithub = m.username && !m.username.startsWith("email:");
            const emails = m.emails && m.emails.length > 0 ? m.emails : [m.email_normalized].filter(Boolean);
            return (
              <tr key={m.id}>
                <td>{m.display_name || <span className="muted">(no name)</span>}</td>
                <td className="mono">
                  {hasGithub ? `@${m.username}` : <span className="muted">(no GitHub)</span>}
                </td>
                <td className="muted mono">{emails.join(", ")}</td>
                <td>{m.active ? "active" : "inactive"}</td>
              </tr>
            );
          })}
          {members.data && members.data.length === 0 ? (
            <tr>
              <td colSpan={4} className="empty">
                No members yet — they appear as developers report work.
              </td>
            </tr>
          ) : null}
        </tbody>
      </table>

      <h2 style={{ marginTop: 28 }}>Accounts</h2>
      <p className="muted">Managers and viewers with board logins.</p>
      <table>
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Role</th>
          </tr>
        </thead>
        <tbody>
          {(users.data ?? []).map((u) => (
            <tr key={u.id}>
              <td>{u.name}</td>
              <td className="muted">{u.email}</td>
              <td>{u.role}</td>
            </tr>
          ))}
        </tbody>
      </table>
      </div>
    </>
  );
}

/**
 * Pure, immutable merge of miniboss hook handlers into a Claude Code
 * settings.json object. NEVER clobbers existing hooks (the developer almost
 * certainly already has some). Idempotent: merging twice == merging once.
 */

export interface HookHandler {
  event: string; // e.g. "SessionStart"
  command: string; // e.g. "miniboss hook session-start"
  timeout: number;
}

interface CommandHook {
  type: "command";
  command: string;
  timeout?: number;
}

interface MatcherGroup {
  matcher?: string;
  hooks: CommandHook[];
}

type Settings = Record<string, unknown>;

export const MINIBOSS_HANDLERS: readonly HookHandler[] = [
  { event: "SessionStart", command: "miniboss hook session-start", timeout: 5 },
  { event: "Stop", command: "miniboss hook stop", timeout: 5 },
  { event: "SessionEnd", command: "miniboss hook session-end", timeout: 5 },
];

function asGroups(value: unknown): MatcherGroup[] {
  if (!Array.isArray(value)) return [];
  return value as MatcherGroup[];
}

function groupHasCommand(groups: readonly MatcherGroup[], command: string): boolean {
  return groups.some(
    (group) =>
      Array.isArray(group?.hooks) && group.hooks.some((h) => h?.command === command)
  );
}

/**
 * Return a new settings object with the handlers ensured present. Existing
 * hooks for the same events are preserved; a handler is appended only if no
 * identical command already exists for that event.
 */
export function mergeHooks(
  existing: Settings,
  handlers: readonly HookHandler[] = MINIBOSS_HANDLERS
): { settings: Settings; added: number } {
  const hooks: Record<string, unknown> = {
    ...((existing.hooks as Record<string, unknown> | undefined) ?? {}),
  };
  let added = 0;

  for (const handler of handlers) {
    const groups = asGroups(hooks[handler.event]);
    if (groupHasCommand(groups, handler.command)) continue;
    const newGroup: MatcherGroup = {
      hooks: [{ type: "command", command: handler.command, timeout: handler.timeout }],
    };
    hooks[handler.event] = [...groups, newGroup];
    added += 1;
  }

  return { settings: { ...existing, hooks }, added };
}

/** Remove miniboss handlers (used by an uninstall path); pure and immutable. */
export function unmergeHooks(
  existing: Settings,
  handlers: readonly HookHandler[] = MINIBOSS_HANDLERS
): Settings {
  const existingHooks = (existing.hooks as Record<string, unknown> | undefined) ?? {};
  const commands = new Set(handlers.map((h) => h.command));
  const hooks: Record<string, unknown> = {};

  for (const [event, value] of Object.entries(existingHooks)) {
    const groups = asGroups(value)
      .map((group) => ({
        ...group,
        hooks: (group.hooks ?? []).filter((h) => !commands.has(h?.command)),
      }))
      .filter((group) => group.hooks.length > 0);
    if (groups.length > 0) hooks[event] = groups;
  }

  return { ...existing, hooks };
}

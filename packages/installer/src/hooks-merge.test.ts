import { describe, expect, test } from "bun:test";
import { mergeHooks, unmergeHooks } from "./hooks-merge.ts";

// A settings.json shaped like the user's real one: pre-existing GSD hooks.
function gsdSettings() {
  return {
    model: "claude-opus-4-8",
    hooks: {
      SessionStart: [
        { hooks: [{ type: "command", command: "gsd session-start", timeout: 10 }] },
      ],
      PostToolUse: [
        { matcher: "Edit", hooks: [{ type: "command", command: "gsd format" }] },
      ],
    },
  };
}

describe("mergeHooks", () => {
  test("preserves existing GSD hooks and appends miniboss handlers", () => {
    const { settings, added } = mergeHooks(gsdSettings());
    expect(added).toBe(3);

    // GSD SessionStart hook still present.
    const sessionStart = (settings.hooks as any).SessionStart;
    const commands = sessionStart.flatMap((g: any) => g.hooks.map((h: any) => h.command));
    expect(commands).toContain("gsd session-start");
    expect(commands).toContain("miniboss hook session-start");

    // PostToolUse untouched.
    expect((settings.hooks as any).PostToolUse[0].hooks[0].command).toBe("gsd format");

    // New events created.
    expect((settings.hooks as any).Stop[0].hooks[0].command).toBe("miniboss hook stop");
    expect((settings.hooks as any).SessionEnd[0].hooks[0].command).toBe("miniboss hook session-end");

    // Other top-level keys untouched.
    expect(settings.model).toBe("claude-opus-4-8");
  });

  test("is idempotent — merging twice adds nothing the second time", () => {
    const once = mergeHooks(gsdSettings());
    const twice = mergeHooks(once.settings);
    expect(twice.added).toBe(0);
    expect(JSON.stringify(twice.settings)).toBe(JSON.stringify(once.settings));
  });

  test("does not mutate the input object", () => {
    const input = gsdSettings();
    const snapshot = JSON.stringify(input);
    mergeHooks(input);
    expect(JSON.stringify(input)).toBe(snapshot);
  });

  test("handles empty settings", () => {
    const { settings, added } = mergeHooks({});
    expect(added).toBe(3);
    expect((settings.hooks as any).Stop[0].hooks[0].command).toBe("miniboss hook stop");
  });
});

describe("unmergeHooks", () => {
  test("removes only miniboss handlers, keeping GSD intact", () => {
    const merged = mergeHooks(gsdSettings()).settings;
    const cleaned = unmergeHooks(merged);

    const sessionStart = (cleaned.hooks as any).SessionStart;
    const commands = sessionStart.flatMap((g: any) => g.hooks.map((h: any) => h.command));
    expect(commands).toContain("gsd session-start");
    expect(commands).not.toContain("miniboss hook session-start");

    // Empty miniboss-only events are dropped.
    expect((cleaned.hooks as any).Stop).toBeUndefined();
  });
});

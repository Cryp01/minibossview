import { describe, expect, test } from "bun:test";
import {
  emailFallbackUsername,
  githubUsernameFromEmail,
  importExternalKey,
  normalizeEmail,
  normalizeTitle,
  normalizeUsername,
  reportExternalKey,
  slugify,
  stableHash,
} from "./identity.ts";

describe("githubUsernameFromEmail", () => {
  test("extracts username from GitHub noreply with numeric id", () => {
    expect(githubUsernameFromEmail("12345+Octocat@users.noreply.github.com")).toBe("octocat");
  });
  test("extracts username from GitHub noreply without id", () => {
    expect(githubUsernameFromEmail("octocat@users.noreply.github.com")).toBe("octocat");
  });
  test("returns null for a normal email", () => {
    expect(githubUsernameFromEmail("dev@company.com")).toBeNull();
  });
});

describe("normalizeUsername / emailFallbackUsername", () => {
  test("normalizeUsername lowercases and trims", () => {
    expect(normalizeUsername("  OctoCat ")).toBe("octocat");
  });
  test("emailFallbackUsername is email-scoped and stable", () => {
    expect(emailFallbackUsername("Dev@Company.com")).toBe("email:dev@company.com");
  });
});

describe("slugify", () => {
  test("lowercases, dashes non-alphanumerics, trims", () => {
    expect(slugify("  My Cool Project! ")).toBe("my-cool-project");
    expect(slugify("Acme_Org")).toBe("acme-org");
    expect(slugify("checkout-api")).toBe("checkout-api");
  });
});

describe("normalizeEmail", () => {
  test("lowercases and trims", () => {
    expect(normalizeEmail("  Ada.Lovelace@Example.COM ")).toBe("ada.lovelace@example.com");
  });
});

describe("normalizeTitle", () => {
  test("collapses whitespace and lowercases", () => {
    expect(normalizeTitle("  Add   Idempotency\tKeys ")).toBe("add idempotency keys");
  });
});

describe("stableHash", () => {
  test("is deterministic", () => {
    expect(stableHash("hello")).toBe(stableHash("hello"));
  });
  test("differs for different input", () => {
    expect(stableHash("a")).not.toBe(stableHash("b"));
  });
});

describe("importExternalKey", () => {
  test("is order-independent over commits", () => {
    const a = importExternalKey("org/repo", ["c1", "c2", "c3"]);
    const b = importExternalKey("org/repo", ["c3", "c1", "c2"]);
    expect(a).toBe(b);
  });
  test("changes with repo", () => {
    expect(importExternalKey("org/a", ["c1"])).not.toBe(importExternalKey("org/b", ["c1"]));
  });
});

describe("reportExternalKey", () => {
  test("is stable across title casing/whitespace", () => {
    const a = reportExternalKey("org/repo", "main", "Add Keys");
    const b = reportExternalKey("org/repo", "main", "  add   keys ");
    expect(a).toBe(b);
  });
});

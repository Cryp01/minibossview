import { describe, expect, test } from "bun:test";
import { _jwtExp } from "./auth.ts";

function makeJwt(payload: Record<string, unknown>): string {
  const b64 = (obj: unknown) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  return `${b64({ alg: "HS256", typ: "JWT" })}.${b64(payload)}.signature`;
}

describe("jwtExp", () => {
  test("decodes the exp claim", () => {
    expect(_jwtExp(makeJwt({ exp: 1893456000, id: "x" }))).toBe(1893456000);
  });

  test("returns null when exp missing", () => {
    expect(_jwtExp(makeJwt({ id: "x" }))).toBeNull();
  });

  test("returns null for malformed token", () => {
    expect(_jwtExp("not-a-jwt")).toBeNull();
    expect(_jwtExp("only.two")).toBeNull();
  });
});

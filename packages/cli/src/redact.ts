/**
 * Deterministic privacy guardrail. Every summary that may leave the developer
 * machine passes through here. Prose about intent/outcome is allowed; code,
 * blobs, and credential-shaped strings are refused outright.
 *
 * This is layer 2 of the three-layer defense (skill instructions, this scrubber,
 * structural send-only-known-fields). It must never throw.
 */
import { MAX_SUMMARY_LENGTH } from "@miniboss/shared";

export type RedactResult =
  | { ok: true; clean: string; truncated: boolean }
  | { ok: false; reason: string };

interface SecretPattern {
  name: string;
  re: RegExp;
}

// Ordered most-specific to most-general. A single match refuses the summary.
const SECRET_PATTERNS: readonly SecretPattern[] = [
  { name: "code fence", re: /```/ },
  { name: "PEM private key", re: /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----/ },
  { name: "PEM block", re: /-----BEGIN [A-Z0-9 ]+-----/ },
  { name: "AWS access key id", re: /\bAKIA[0-9A-Z]{16}\b/ },
  { name: "GitHub token", re: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b/ },
  { name: "GitHub fine-grained PAT", re: /\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { name: "OpenAI/Anthropic-style key", re: /\bsk-[A-Za-z0-9-]{20,}\b/ },
  { name: "Slack token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: "Google API key", re: /\bAIza[0-9A-Za-z_-]{30,}\b/ },
  { name: "JWT", re: /\beyJ[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}\.[A-Za-z0-9_-]{5,}/ },
  { name: "URL with embedded credentials", re: /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:@]+:[^\s/@]+@/i },
  {
    name: "inline credential assignment",
    re: /\b(pass(word|wd)?|pwd|secret|token|api[_-]?key|client[_-]?secret|access[_-]?token)\b\s*[:=]\s*\S{4,}/i,
  },
  { name: "long hex blob", re: /\b[A-Fa-f0-9]{40,}\b/ },
  { name: "long base64 blob", re: /\b[A-Za-z0-9+/]{60,}={0,2}\b/ },
];

/** Remove control characters (except newline/tab) without throwing. */
function stripControl(input: string): string {
  let out = "";
  for (const ch of input) {
    const code = ch.codePointAt(0) ?? 0;
    if (code === 0x09 || code === 0x0a || code >= 0x20) out += ch;
  }
  return out;
}

/**
 * Validate and clean a summary. Returns the cleaned text (trimmed, control
 * chars removed, truncated to the cap) or refuses if a secret pattern matches.
 */
export function redactSummary(input: string): RedactResult {
  const normalized = stripControl(input).trim();
  if (normalized.length === 0) return { ok: false, reason: "summary is empty" };

  for (const pattern of SECRET_PATTERNS) {
    if (pattern.re.test(normalized)) {
      return { ok: false, reason: `summary rejected: looks like a ${pattern.name}` };
    }
  }

  const truncated = normalized.length > MAX_SUMMARY_LENGTH;
  const clean = truncated ? `${normalized.slice(0, MAX_SUMMARY_LENGTH - 1)}…` : normalized;
  return { ok: true, clean, truncated };
}

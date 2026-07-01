#!/usr/bin/env bash
# =====================================================================
# mini-boss-view — per-developer client install (macOS).
# Installs the `miniboss` CLI, registers the Claude Code hooks (merged,
# never clobbered) and the /miniboss skill, and stores the board server +
# agent credentials.
#
# Usage:
#   ./install.sh                                   # interactive prompts
#   ./install.sh <server-url> <agent-email> <agent-password>   # non-interactive
# =====================================================================
set -euo pipefail

DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"

if ! command -v bun >/dev/null 2>&1; then
  echo "Bun is required. Install it first:  curl -fsSL https://bun.sh/install | bash"
  exit 1
fi

echo "Installing dependencies…"
bun install >/dev/null

if [ "$#" -ge 3 ]; then
  bun packages/installer/bin/install.ts \
    --server "$1" --agent-email "$2" --agent-password "$3" --non-interactive
else
  bun packages/installer/bin/install.ts
fi

echo
echo "Done. Restart Claude Code once so it discovers the /miniboss skill."
echo "Then run  miniboss doctor  to verify."

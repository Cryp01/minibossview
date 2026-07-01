#!/usr/bin/env sh
# =====================================================================
# mini-boss-view — one-command client install for macOS / Linux.
#
#   curl -fsSL https://raw.githubusercontent.com/Cryp01/minibossview/main/bootstrap.sh | sh
#
# Installs Bun if missing, clones/updates the repo to ~/.mini-boss-view,
# and launches the guided installer (asks for the board URL + agent creds).
# =====================================================================
set -eu

REPO_URL="https://github.com/Cryp01/minibossview.git"
DIR="$HOME/.mini-boss-view"

echo "Mini Boss View — client setup"

# --- Bun -------------------------------------------------------------
if ! command -v bun >/dev/null 2>&1; then
  echo "• Installing Bun…"
  curl -fsSL https://bun.sh/install | bash >/dev/null
  export BUN_INSTALL="${BUN_INSTALL:-$HOME/.bun}"
  export PATH="$BUN_INSTALL/bin:$PATH"
fi

# --- git -------------------------------------------------------------
if ! command -v git >/dev/null 2>&1; then
  echo "git is required. On Debian/Ubuntu: sudo apt-get install -y git" >&2
  exit 1
fi

# --- clone or update -------------------------------------------------
if [ -d "$DIR/.git" ]; then
  echo "• Updating $DIR"
  git -C "$DIR" pull --ff-only --quiet || true
else
  echo "• Cloning to $DIR"
  git clone --depth=1 --quiet "$REPO_URL" "$DIR"
fi

cd "$DIR"
echo "• Installing dependencies…"
bun install >/dev/null

# --- guided installer (needs a real terminal, even when piped) -------
echo
if [ -t 0 ]; then
  bun packages/installer/bin/install.ts "$@"
elif [ -e /dev/tty ]; then
  bun packages/installer/bin/install.ts "$@" </dev/tty
else
  echo "No terminal available for prompts. Re-run with arguments:" >&2
  echo "  bun $DIR/packages/installer/bin/install.ts --server <url> --agent-email <email> --agent-password <pw> --non-interactive" >&2
  exit 1
fi

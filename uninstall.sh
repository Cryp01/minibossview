#!/usr/bin/env bash
# =====================================================================
# mini-boss-view — remove the client from this machine (macOS / Linux).
# Removes the CLI launcher, the /miniboss skill, and the miniboss hooks
# (other Claude Code hooks are preserved). Keeps your config unless --purge.
#
#   ./uninstall.sh            # keep config
#   ./uninstall.sh --purge    # also delete server URL + credentials
# =====================================================================
set -euo pipefail
DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$DIR"
exec bun packages/installer/bin/uninstall.ts "$@"

#!/usr/bin/env bash
# One-click: resolve the newest DeepSeek Harness for the channel, fetch it,
# build the engine, and pack clients for this OS. All logic lives in
# scripts/build-clients.mjs so every platform wrapper stays identical.
#
# Usage:
#   ./tools/build-clients.sh
#   ./tools/build-clients.sh stable|latest|lock|<ref>
#
# Env knobs (see scripts/build-clients.mjs):
#   DSH_CLIENTS=vscode,nsis,zip
#   DSH_SKIP_ENGINE_BUILD=1  DSH_SKIP_FETCH=1  DSH_SKIP_PNPM_INSTALL=1
#   DSH_AUTO_UPDATE_LOCK=1   DSH_INSTALL=1
set -euo pipefail
cd "$(dirname "$0")/.."
export CI=1

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: $1 is required. $2" >&2
    exit 1
  fi
}
need node 'Install Node.js 22+ from https://nodejs.org/'
need pnpm 'Run: npm install -g pnpm@10'
need git 'Install git from https://git-scm.com/'

CHANNEL="${1:-stable}"
node scripts/build-clients.mjs "$CHANNEL"

echo
echo "Artifacts for this OS:"
echo "  apps/vscode/*.vsix"
echo "  apps/desktop/dist-release/"
echo "Next: ./tools/install-clients.sh"

#!/usr/bin/env bash
# One-click: fetch DeepSeek Harness from GitHub and pack clients for this OS.
# Usage:
#   ./build-clients.sh
#   ./build-clients.sh stable|latest|lock|master
set -euo pipefail
cd "$(dirname "$0")"
export CI=1
CHANNEL="${1:-stable}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: $1 is required. $2" >&2
    exit 1
  fi
}

need node 'Install Node.js 22+ from https://nodejs.org/'
need pnpm 'Run: npm install -g pnpm@10'

echo "== pnpm install =="
pnpm install

if [[ "${CHANNEL}" == "stable" || "${CHANNEL}" == "latest" || "${CHANNEL}" == "lock" ]]; then
  echo "== build clients channel=${CHANNEL} =="
  pnpm run "build:clients:${CHANNEL}"
else
  echo "== build clients with DSH_ENGINE_REF=${CHANNEL} =="
  DSH_ENGINE_REF="${CHANNEL}" pnpm run build:clients:stable
fi

if [[ "${DSH_INSTALL:-}" == "1" ]]; then
  echo "== install packed clients =="
  node scripts/install-clients.mjs
fi

echo
echo "Artifacts for this OS:"
echo "  apps/vscode/*.vsix"
echo "  apps/desktop/dist-release/"
if [[ "${DSH_INSTALL:-}" != "1" ]]; then
  echo "Next: ./install-clients.sh"
fi

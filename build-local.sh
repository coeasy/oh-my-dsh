#!/usr/bin/env bash
# One-click LOCAL client build with network optimizations baked in.
#
# Wraps build-clients.sh but pre-configures mirrors/registry so it works on
# networks where GitHub / npmjs are slow. All optimizations can be turned off.
#
# Usage:
#   ./build-local.sh                 # build lock channel (pinned engine.lock.json)
#   ./build-local.sh stable|latest   # build a GitHub stable/latest release
#   ./build-local.sh master          # build a specific branch/tag
#
# Optional env overrides (set to "0" to disable, or to a value to override):
#   DSH_GH_PROXY=1            route git clone of the engine through ghfast.top
#   DSH_REGISTRY=https://registry.npmmirror.com
#   DSH_ELECTRON_MIRROR=https://npmmirror.com/mirrors/electron/
#   DSH_INSTALL=1             also install the packed VSIX after building
set -euo pipefail
cd "$(dirname "$0")"
export CI=1
CHANNEL="${1:-lock}"

need() {
  if ! command -v "$1" >/dev/null 2>&1; then
    echo "ERROR: $1 is required. $2" >&2
    exit 1
  fi
}
need node 'Install Node.js 22+ from https://nodejs.org/'
need pnpm 'Run: npm install -g pnpm@10'

# --- GitHub clone proxy (speeds up fetching the DeepSeek Harness engine) ---
if [[ "${DSH_GH_PROXY:-1}" == "1" ]]; then
  GIT_CONFIG_COUNT=1
  GIT_CONFIG_KEY_0="url.https://ghfast.top/https://github.com/.insteadOf"
  GIT_CONFIG_VALUE_0="https://github.com/"
  export GIT_CONFIG_COUNT GIT_CONFIG_KEY_0 GIT_CONFIG_VALUE_0
  echo "== GitHub clone proxy: ghfast.top (DSH_GH_PROXY=0 to disable) =="
fi

# --- npm registry mirror ---
REGISTRY="${DSH_REGISTRY:-https://registry.npmmirror.com}"
export NPM_CONFIG_REGISTRY="$REGISTRY"
export npm_config_registry="$REGISTRY"
echo "== npm registry: $REGISTRY (DSH_REGISTRY to override) =="

# --- Electron binary mirror ---
ELECTRON_MIRROR="${DSH_ELECTRON_MIRROR:-https://npmmirror.com/mirrors/electron/}"
export ELECTRON_MIRROR
echo "== electron mirror: $ELECTRON_MIRROR (DSH_ELECTRON_MIRROR to override) =="

echo "== pnpm install =="
pnpm install

echo "== build clients channel=${CHANNEL} =="
case "$CHANNEL" in
  stable|latest|lock)
    pnpm run "build:clients:${CHANNEL}"
    ;;
  *)
    DSH_ENGINE_REF="${CHANNEL}" pnpm run build:clients:stable
    ;;
esac

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

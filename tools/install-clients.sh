#!/usr/bin/env bash
# Install packed clients on this machine after a successful build.
set -euo pipefail
cd "$(dirname "$0")/.."
exec node scripts/install-clients.mjs

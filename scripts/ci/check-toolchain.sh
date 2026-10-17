#!/usr/bin/env bash
# Fail unless the active Node/npm are the canonical pair: Node from .nvmrc and npm 11.21.0.
# CI installs that npm explicitly (Node 22.23.3 bundles npm 10.9.9, a separate historical
# parity row). npm 11's default lifecycle-script policy is kept: no allowScripts/ignore-scripts
# override; `npm ci` lists the install scripts it skips (esbuild, fsevents) in its own output.
#
#   scripts/ci/check-toolchain.sh
set -euo pipefail
cd "$(dirname "$0")/../.."

CANONICAL_NPM=11.21.0
want_node="v$(tr -d '[:space:]' < .nvmrc)"
have_node=$(node --version)
have_npm=$(npm --version)
echo "toolchain node=$have_node npm=$have_npm (canonical node=$want_node npm=$CANONICAL_NPM)"
status=0
if [ "$have_node" != "$want_node" ]; then
  echo "FAIL: node $have_node != $want_node (.nvmrc)" >&2
  status=1
fi
if [ "$have_npm" != "$CANONICAL_NPM" ]; then
  echo "FAIL: npm $have_npm != $CANONICAL_NPM" >&2
  status=1
fi
exit $status

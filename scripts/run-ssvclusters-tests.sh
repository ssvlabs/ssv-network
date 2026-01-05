#!/usr/bin/env bash
set -euo pipefail

cd "$(dirname "${BASH_SOURCE[0]}")/.."

pattern="test/unit/SSVClusters/*.test.ts"

npx hardhat test $pattern "$@"

#!/usr/bin/env bash
set -euo pipefail

# Move to repo root
cd "$(dirname "${BASH_SOURCE[0]}")/../../.."

pattern="test/unit/SSVOperators/*.test.ts"

npx hardhat test $pattern "$@"

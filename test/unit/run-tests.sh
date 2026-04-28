#!/usr/bin/env bash
set -euo pipefail

# Move to repo root
cd "$(dirname "${BASH_SOURCE[0]}")/../.."

echo "Running SSVClusters tests..."
npx hardhat test test/unit/SSVClusters/*.test.ts

echo ""
echo "Running SSVOperators tests..."
npx hardhat test test/unit/SSVOperators/*.test.ts

echo ""
echo "Running SSVDAO tests..."
npx hardhat test test/unit/SSVDAO/*.test.ts

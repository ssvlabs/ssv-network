#!/bin/bash

# Script to set up mainnet-fork contracts for fork tests
# This copies test/setup/mainnet to contracts/mainnet-fork so Hardhat can compile them

set -e

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_ROOT="$(cd "$SCRIPT_DIR/../.." && pwd)"
MAINNET_SOURCE="$REPO_ROOT/test/setup/mainnet"
MAINNET_FORK_TARGET="$REPO_ROOT/contracts/mainnet-fork"

echo "Setting up mainnet-fork contracts for fork tests..."
echo "Source: $MAINNET_SOURCE"
echo "Target: $MAINNET_FORK_TARGET"

# Remove existing mainnet-fork directory if it exists
if [ -d "$MAINNET_FORK_TARGET" ]; then
  echo "Removing existing $MAINNET_FORK_TARGET..."
  rm -rf "$MAINNET_FORK_TARGET"
fi

# Copy mainnet contracts to contracts/mainnet-fork
echo "Copying mainnet contracts to contracts/mainnet-fork..."
cp -r "$MAINNET_SOURCE" "$MAINNET_FORK_TARGET"

echo "✓ Successfully set up mainnet-fork contracts"
echo ""
echo "Next steps:"
echo "1. Run: npx hardhat compile"
echo "2. Run your fork tests with: RUN_FORK=true npx hardhat test test/test-forked/v2.0.0/upgrade.test.ts"

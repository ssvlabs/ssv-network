# Fork Test Setup

This directory contains setup files for running fork tests against mainnet contracts.

## Overview

Fork tests (like `test/test-forked/v2.0.0/upgrade.test.ts`) need access to mainnet contract sources for compilation. Since Hardhat compiles from a single source directory (`contracts/`), we need to copy the mainnet contracts from `test/setup/mainnet` to `contracts/mainnet-fork` before running fork tests.

**Important**: The `contracts/mainnet-fork` directory is not committed to git and should be generated locally before running fork tests.

## Running Fork Tests

Follow these steps to run fork tests:

### Step 1: Set up mainnet-fork contracts

Run the setup script to copy mainnet contracts to the contracts directory:

```bash
bash test/setup/setup-fork.sh
```

This will:
- Remove any existing `contracts/mainnet-fork` directory
- Copy `test/setup/mainnet` to `contracts/mainnet-fork`

### Step 2: Compile contracts

Compile the contracts so Hardhat can use them:

```bash
npx hardhat compile
```

### Step 3: Run fork tests

Run the fork tests with the `RUN_FORK=true` environment variable:

```bash
RUN_FORK=true npx hardhat test test/test-forked/v2.0.0/upgrade.test.ts
```

Or run all fork tests:

```bash
RUN_FORK=true npx hardhat test test/test-forked/
```

## Environment Variables

Fork tests require certain environment variables to be set:

- `RUN_FORK=true` - Enables fork tests (they are skipped by default)
- `MAINNET_RPC_URL` - RPC URL for mainnet (required for forking)
- `FORK_BLOCK_NUMBER` - (Optional) Specific block number to fork from

Make sure these are set in your `.env` file or exported in your shell.

## Troubleshooting

### "Contract not found" errors

If you see errors about contracts not being found:
1. Make sure you ran `test/setup/setup-fork.sh` first
2. Make sure you ran `npx hardhat compile` after setting up
3. Check that `contracts/mainnet-fork` exists and contains the expected files

### Tests are skipped

If tests are being skipped, make sure `RUN_FORK=true` is set in your environment.

### RPC errors

If you see RPC-related errors, check that:
- `MAINNET_RPC_URL` is set correctly
- Your RPC provider is accessible
- You have sufficient rate limits/quota

## Files in this directory

- `setup-fork.sh` - Script to set up mainnet-fork contracts
- `mainnet/` - Source mainnet contracts (committed to git)
- `fixtures.ts` - Test fixtures for fork tests
- `fork.ts` - Fork connection utilities

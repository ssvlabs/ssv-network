## SSVClusters Unit Tests

This directory contains unit tests for the SSVClusters module, which handles validator registration and cluster management in the SSV Network.

### Structure

- **`register.test.ts`** - Tests for validator registration functionality
- **`helpers/`** - Helper utilities and test fixtures
- **`types/`** - Type definitions and constants used in tests

### Running Tests

- Run all unit tests under this suite: `npx hardhat test test/unit/SSVClusters`
- Run a single file: `npx hardhat test test/unit/SSVClusters/register.test.ts`
- Run a single test (pattern match): `npx hardhat test test/unit/SSVClusters/register.test.ts --grep "valid registration"`

### Test Coverage

The tests cover:
- Valid validator registration
- Validation error cases (empty public keys, length mismatches, invalid operator IDs, etc.)
- Duplicate registration prevention
- Multiple validator registration in existing clusters

Hardhat will build artifacts on demand; make sure dependencies are installed before running (`npm install`).

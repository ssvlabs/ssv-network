## SSVClusters Unit Tests

This directory contains unit tests for the SSVClusters module, which handles validator registration and cluster management in the SSV Network.

### Running Tests

- Run all unit tests under this suite: `npx hardhat test test/unit/SSVClusters/*.test.ts`
- Or use the helper script from repo root: `./test/unit/SSVClusters/run-tests.sh`

### Test Coverage

The tests cover:
- Valid validator registration
- Validation error cases (empty public keys, length mismatches, invalid operator IDs, etc.)
- Duplicate registration prevention
- Multiple validator registration in existing clusters
- Validator removal (single/bulk)
- Cluster liquidation, reactivation, deposits, withdrawals
- Exit flows (single/bulk)
- Cluster balance updates (error path)
- ETH migration (error paths)

Hardhat will build artifacts on demand; make sure dependencies are installed before running (`npm install`).

# SSVDAO Unit Tests

This directory contains unit tests for the SSVDAO module of the SSV Network contracts.

## Test Files

- `updateNetworkFee.test.ts` - Tests for updating the ETH network fee
- `updateNetworkFeeSSV.test.ts` - Tests for updating the SSV network fee  
- `withdrawNetworkSSVEarnings.test.ts` - Tests for withdrawing network SSV earnings
- `updateOperatorFeeIncreaseLimit.test.ts` - Tests for updating operator fee increase limit
- `updateDeclareOperatorFeePeriod.test.ts` - Tests for updating declare operator fee period
- `updateExecuteOperatorFeePeriod.test.ts` - Tests for updating execute operator fee period
- `updateLiquidationThresholdPeriod.test.ts` - Tests for updating liquidation threshold period (ETH & SSV)
- `updateMinimumLiquidationCollateral.test.ts` - Tests for updating minimum liquidation collateral (ETH & SSV)
- `updateMaximumOperatorFee.test.ts` - Tests for updating maximum operator fee (ETH & SSV)
- `commitRoot.test.ts` - Tests for committing EB Merkle roots
- `replaceOracle.test.ts` - Tests for replacing oracle addresses
- `setQuorumBps.test.ts` - Tests for setting quorum basis points
- `setUnstakeCooldownDuration.test.ts` - Tests for setting unstake cooldown duration

## Running Tests

Run all SSVDAO tests:

```bash
npx hardhat test test/unit/SSVDAO/*.test.ts
```

Run a specific test file:

```bash
npx hardhat test test/unit/SSVDAO/updateNetworkFee.test.ts
```

Or use the run script:

```bash
./test/unit/SSVDAO/run-tests.sh
```

## Harness Contract

The tests use `SSVDAOHarness` contract (`contracts/test/harness/SSVDAOHarness.sol`) which extends the `SSVDAO` module and provides mock functions to set up storage state for testing.


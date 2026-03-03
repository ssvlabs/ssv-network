# E2E Test Coverage Report

**Generated:** 2026-02-18
**Branch:** `implement--e2e-integration-pass`
**Test command:** `npx hardhat test test/e2e/**/*.test.ts`

## Summary

| Metric | Count |
|---|---|
| Total scenarios (from SCENARIO-TESTS.md) | 107 |
| Tests implemented | 209 |
| Tests passing | 209 |
| Tests failing | 0 |
| Tests skipped | 0 |
| Missing scenarios | 0 |

## Scenario Coverage by Module

### Operators & Validators (OV-1 to OV-35) — 35 scenarios, 100% covered

| File | Scenarios | Tests |
|---|---|---|
| `operators/operator-lifecycle.test.ts` | OV-1, OV-2, OV-3, OV-11, OV-12, OV-13, OV-14 | 23 |
| `operators/operator-economics.test.ts` | OV-13, OV-15, OV-16, OV-17, OV-18 | 8 |
| `operators/operator-edge-cases.test.ts` | OV-21, OV-23, OV-24, OV-28, OV-29 | 9 |
| `operators/operator-reverts.test.ts` | OV-19 (partial), OV-21 | 6 |
| `validators/validator-lifecycle.test.ts` | OV-4, OV-5, OV-6, OV-7, OV-8, OV-9, OV-10 | 17 |
| `validators/validator-edge-cases.test.ts` | OV-19, OV-20, OV-22, OV-25, OV-26, OV-27, OV-30–OV-35 | 20 |

### Cluster Mechanics (CM-1 to CM-30) — 30 scenarios, 100% covered

| File | Scenarios | Tests |
|---|---|---|
| `clusters-eth/cluster-eth-lifecycle.test.ts` | CM-1, CM-2, CM-3, CM-9, CM-10 | 9 |
| `clusters-eth/cluster-eth-liquidation.test.ts` | CM-3 ext, CM-14, CM-15 | 3 |
| `clusters-eth/cluster-eth-eb.test.ts` | CM-12, CM-13 | 2 |
| `clusters-eth/cluster-eth-edge.test.ts` | CM-19, CM-20, CM-23, CM-24, CM-26 | 6 |
| `clusters-eth/cluster-reverts.test.ts` | CM-21 | 3 |
| `clusters-eth/cluster-conservation.test.ts` | CM-16 | 1 |
| `clusters-ssv/cluster-ssv-legacy.test.ts` | CM-4, CM-11 | 6 |
| `clusters-ssv/cluster-ssv-fees.test.ts` | CM-17, CM-25 | 2 |
| `migration/migration-basic.test.ts` | CM-5, CM-6, CM-7, CM-8 | 6 |
| `migration/migration-edge.test.ts` | CM-18, CM-22, CM-27, CM-28, CM-29 | 7 |
| `migration/migration-full-lifecycle.test.ts` | CM-30 | 1 |

### Effective Balance & Staking (ES-1 to ES-32) — 32 scenarios, 100% covered

| File | Scenarios | Tests |
|---|---|---|
| `effective-balance/oracle-commits.test.ts` | ES-1, ES-2, ES-3, ES-4, ES-5 | 14 |
| `effective-balance/eb-updates.test.ts` | ES-6, ES-7, ES-8, ES-9, ES-10 | 5 |
| `effective-balance/eb-operator-vunits.test.ts` | ES-11 | 1 |
| `effective-balance/eb-edge-cases.test.ts` | ES-12, ES-13, ES-14 | 15 |
| `staking/staking-lifecycle.test.ts` | ES-15, ES-16, ES-17, ES-18 | 7 |
| `staking/staking-edge-cases.test.ts` | ES-20, ES-21, ES-22, ES-23, ES-26, ES-29 | 11 |
| `staking/staking-rewards.test.ts` | ES-24, ES-25, ES-27, ES-28, ES-31, ES-32 | 8 |
| `staking/staking-transfers.test.ts` | ES-19, ES-30 | 7 |

### Cross-Cutting (CC-1 to CC-10) — 10 scenarios, 100% covered

| File | Scenarios | Tests |
|---|---|---|
| `cross-cutting/economics.test.ts` | CC-1, CC-2, CC-5 | 3 |
| `cross-cutting/multi-step-flows.test.ts` | CC-3, CC-7, CC-9 | 4 |
| `cross-cutting/staking-integration.test.ts` | CC-4, CC-6, CC-8 | 3 |
| `cross-cutting/full-lifecycle.test.ts` | CC-10 | 1 |
| `smoke.test.ts` | (smoke) | 1 |

## Discrepancy Annotations

14 formal `// TODO(DISC-XX):` annotations added across 7 files, covering 8 discrepancies between code behavior and FLOWS.md specification:

| ID | Description | Files |
|---|---|---|
| DISC-OV-1 | `registerOperator` always emits `OperatorPrivacyStatusUpdated` even for public operators | `operator-lifecycle.test.ts` |
| DISC-OV-3 | `removeOperator` does NOT check `validatorCount == 0` | `operator-edge-cases.test.ts` |
| DISC-OV-8 | `deposit` does NOT settle fees or update operator snapshots | `cluster-eth-lifecycle.test.ts` (3), `validator-edge-cases.test.ts` |
| DISC-OV-9 | `deposit` does NOT check `cluster.active` | `cluster-eth-lifecycle.test.ts` |
| DISC-CM-3 | `withdraw` does NOT update operator snapshots | `cluster-eth-lifecycle.test.ts`, `cluster-eth-edge.test.ts`, `migration-full-lifecycle.test.ts` |
| DISC-CM-5 | `reactivate` uses additive `balance += msg.value` | `cluster-eth-lifecycle.test.ts` (2) |
| DISC-ES-6 | `_updateOperatorVUnits` applies FULL delta per operator | `eb-operator-vunits.test.ts` |
| DISC-CC-1 | `removeOperator` does NOT delete `operatorFeeChangeRequests` | `operator-edge-cases.test.ts` |

## Weak Assertion Audit

The following assertions were strengthened from weak (`closeTo`, `greaterThan(0n)`, `greaterThanOrEqual`) to exact (`equal`) with computed expected values:

1. `operator-economics.test.ts` — `closeTo` -> `equal` for identical operator earnings comparison
2. `migration-basic.test.ts` — `greaterThanOrEqual(1)` -> `equal(1)` for `ethValidatorCount`
3. `staking-integration.test.ts` — Removed redundant `greaterThanOrEqual(0n)` DAO earnings check (already verified implicitly)

Remaining weak assertions are intentional (conservation law lower bounds, monotonicity checks, snapshot-dependent computations where exact values depend on operator registration timing).

## Helpers

All shared helpers are centralized in `test/e2e/helpers/`:

| File | Exports |
|---|---|
| `fee-calculator.ts` | `calcOperatorFeeAccrual`, `calcClusterBurn`, `calcNetworkFeeAccrual`, `calcVUnits`, `defaultVUnits`, `calcSSVClusterFees`, `calcLiquidationThreshold`, `calcAccEthPerShareDelta`, `calcStakingReward` |
| `block-helpers.ts` | `mineBlocks`, `getBlockNumber`, `getTxBlock`, `snapshotContractBalance` |
| `balance-tracker.ts` | `BalanceTracker` class for multi-step balance tracking |
| `invariant-checker.ts` | `checkETHConservation` |
| `index.ts` | Re-exports all helpers |

No duplicate helper code found in test files.

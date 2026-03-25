# E2E Test Coverage Report

**Updated:** 2026-03-25
**Branch:** `feat/exhaustive-scenario-coverage`
**Test command:** `find test/e2e -name "*.test.ts" | sort | xargs npx hardhat test`

## Summary

| Metric | Count |
|---|---|
| Documented scenarios (27 scenario files) | 1,777 |
| Tracked scenarios (CSV) | 1,026 |
| Hardhat e2e tests passing | 1,020 |
| Tests failing | 0 |
| Tests using mockRemoveOperator | 0 (quarantined) |

## Test Files by Category

| Category | Files | Tests | Description |
|---|---|---|---|
| removed-operator | 11 | ~211 | RM1-RM6, RMA, RMC — all use real `removeOperator()` |
| cross-cutting | 5 | ~266 | XO, XV, XL, XG, XF — multi-module chain tests |
| invariants | 2 | ~15 | G1-G12 invariant verification |
| clusters-eth | 4 | ~66 | CL deposit/withdraw, liquidation, edge cases |
| effective-balance | 3 | ~64 | EB oracle, updates, deviation |
| operators | 4 | ~96 | OP lifecycle, OF fees, OE earnings, WL whitelist |
| validators | 3 | ~90 | VR registration, VX remove/exit |
| migration | 2 | ~33 | MG SSV→ETH migration |
| staking | 2 | ~60 | ST staking lifecycle, rewards |
| dao | 1 | ~35 | DA governance parameters |
| clusters-ssv | 1 | ~7 | SSV legacy cluster operations |
| mock-migration | 1 | ~32 | W5.5 mock-to-real migration |
| smoke | 1 | 1 | Basic smoke test |

## Wave History

| Wave | Commits | Focus | Lines Added |
|---|---|---|---|
| W5 | 9 | RM-* removed-operator tests (real removeOperator) | ~3,200 |
| W5.5 | 1 | Mock-to-real migration (32 scenarios) | ~800 |
| W6 | 5 | Cross-module tests (XO/XV/XL/XG/XF) | ~4,500 |
| W7 | 11 | Module gap tests (all modules) | ~3,800 |
| W8 | 4 | Assertion strengthening (119 scenarios) | ~1,400 |
| W9 | 4 | Fix 88 tests for BUG-21 correct behavior | ~765 |
| W10 | 8+1 | Assertion hardening + coverage gaps + ask-codex fixes | ~2,700 |

## BUG-21 Coverage

The removed-operator bug (operatorEthVUnits not deleted on removal) is covered by:

- **RM1**: `_updateOperatorVUnits` guard — 24 tests verifying guard skips removed ops
- **RM2**: `_executeLiquidation` deviation cleanup — 30 tests
- **RM3**: `_bulkRemoveValidator` guard — 27 tests
- **RM4**: `migrateClusterToETH` guard — 27 tests
- **RM5**: Reactivation with removed ops — 21 tests
- **RM6**: Migration init guard — 21 tests
- **RMA**: Auto-liquidation compound path — 33 tests
- **RMC**: Multi-step chains — 28 tests
- **INV**: G11 invariant (removed operator zero state) — 15 tests

All tests verify `isActive == false`, `fee == 0`, `operatorEthVUnits == 0` after every `removeOperator()` call.

## Assertion Quality

After W10 hardening:
- Zero `greaterThan(0n)` weak assertions in new tests
- All balance assertions use exact computed values via `calcClusterBurn`
- Block numbers captured at each transaction for precise fee calculations
- ask-codex reviewed all waves with findings addressed

## Helpers

All shared helpers in `test/helpers/`:

| File | Key Exports |
|---|---|
| `fee-calculator.ts` | `calcOperatorFeeAccrual`, `calcClusterBurn`, `calcVUnits`, `defaultVUnits`, `calcLiquidationThreshold`, `calcAccEthPerShareDelta` |
| `block-helpers.ts` | `mineBlocks`, `getBlockNumber`, `setAccountBalance` |
| `cluster-helpers.ts` | `parseClusterFromEvent`, `getCurrentClusterState`, `computeClusterId` |
| `eb-helpers.ts` | `setupOracles`, `commitEBRoot`, `computeEBRoot`, `generateMerkleForClusterEB` |
| `index.ts` | Re-exports all helpers |

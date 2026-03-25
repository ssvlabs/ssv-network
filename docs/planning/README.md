# SSV Network — Exhaustive Scenario Coverage

## Status

| Wave | Phase | Workers | Status |
|------|-------|---------|--------|
| Pre-work | Setup | 1 | ✅ Done |
| W1 | Phase 1: Individual Module Scenarios (983 scenarios) | 13 | ✅ Done |
| W2 | Phase 1b: Cross-Module Scenarios (410 scenarios) | 5 | ✅ Done |
| W3 | Phase 1c: Removed Operator + Invariants (365 scenarios) | 9 | ✅ Done |
| W4 | Phase 2: Coverage Verification | 10 | ✅ Done |
| — | Phase 3: Gap Analysis | 1 | ✅ Done |
| W5 | Phase 4: RM-* Tests (9 files, real removeOperator) | 9 | ✅ Done |
| W5.5 | Mock-to-Real Migration (32 scenarios) | 1 | ✅ Done |
| W6 | Phase 4: Cross-Module Tests (XO/XV/XL/XG/XF) | 5 | ✅ Done |
| W7 | Phase 4: Module Gap Tests (11 modules) | 11 | ✅ Done |
| W8 | Assertion Strengthening (119 scenarios) | 4 | ✅ Done |
| W9 | Fix 88 Tests for BUG-21 Correct Behavior | 4 | ✅ Done |
| W10 | Assertion Hardening + Coverage Gaps (8 workers) | 8+1 | ✅ Done |
| — | Phase 5: Final Review | 1 | ✅ Done |

## Scenario Files

| File | Prefix | Worker | Est. Scenarios | Status |
|------|--------|--------|----------------|--------|
| scenarios-op-lifecycle.md | OP | W1-A | 57 | ✅ |
| scenarios-op-fees.md | OF | W1-B | 60 | ✅ |
| scenarios-op-earnings.md | OE | W1-C | 48 | ✅ |
| scenarios-whitelist.md | WL | W1-D | 67 | ✅ |
| scenarios-vl-register.md | VR | W1-E | 76 | ✅ |
| scenarios-vl-remove-exit.md | VX | W1-F | 72 | ✅ |
| scenarios-cl-deposit-withdraw.md | CL | W1-G | 60 | ✅ |
| scenarios-eb-oracle.md | EB (oracle) | W1-H | 42 | ✅ |
| scenarios-eb-updates.md | EB (updates) | W1-H2 | 102 | ✅ |
| scenarios-lq-reactivation.md | LQ | W1-I | 110 | ✅ |
| scenarios-migration.md | MG | W1-J | 70 | ✅ |
| scenarios-staking.md | ST | W1-K | 104 | ✅ |
| scenarios-dao-governance.md | DA | W1-L | 115 | ✅ |
| scenarios-xm-op-cluster.md | XO | W2-A | 68 | ✅ |
| scenarios-xm-vl-eb.md | XV | W2-B | 90 | ✅ |
| scenarios-xm-lq-react-chains.md | XL | W2-C | 102 | ✅ |
| scenarios-xm-migration-staking.md | XG | W2-D | 53 | ✅ |
| scenarios-xm-full-lifecycle.md | XF | W2-E | 97 | ✅ |
| scenarios-rm-updateOperatorVUnits.md | RM1 | W3-A | 28 | ✅ |
| scenarios-rm-executeLiquidation.md | RM2 | W3-B | 32 | ✅ |
| scenarios-rm-bulkRemoveValidator.md | RM3 | W3-C | 27 | ✅ |
| scenarios-rm-migrateClusterToETH.md | RM4 | W3-D | 27 | ✅ |
| scenarios-rm-reactivation.md | RM5 | W3-E | 35 | ✅ |
| scenarios-rm-migration-init.md | RM6 | W3-F | 21 | ✅ |
| scenarios-rm-auto-liquidation.md | RMA | W3-G | 53 | ✅ |
| scenarios-rm-chains.md | RMC | W3-H | 56 | ✅ |
| scenarios-invariants.md | INV | W3-I | 86 | ✅ |
| GAP-ANALYSIS.md | — | Phase 3 | — | ✅ |

## Final Stats

- **1,777 scenarios** documented across 27 scenario files
- **1,020 hardhat e2e tests** passing (0 failures)
- **1,026 tracked scenarios** in CSV (all passing)
- **765+ new test lines** in W9 alone, **2,700+ lines** added in W10
- **0 mockRemoveOperator** usage in new tests — all use real `removeOperator()`
- **ask-codex reviewed** every wave with findings addressed
- **BUG-21 fix** independently verified from first principles

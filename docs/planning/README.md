# SSV Network — Exhaustive Scenario Coverage

## Status

| Wave | Phase | Workers | Status |
|------|-------|---------|--------|
| Pre-work | Setup | 1 | ✅ Done |
| W1 | Phase 1: Individual Module Scenarios (983 scenarios) | 13 | ✅ Done |
| W2 | Phase 1b: Cross-Module Scenarios (410 scenarios) | 5 | ✅ Done |
| W3 | Phase 1c: Removed Operator + Invariants | 9 | ⏳ Pending |
| W4 | Phase 2: Coverage Verification | 10 | ⏳ Pending |
| — | Phase 3: Gap Analysis | 1 | ⏳ Pending |
| W5 | Phase 4: RM-* Tests | 9 | ⏳ Pending |
| W6 | Phase 4: Cross-Module Tests | 5 | ⏳ Pending |
| W7 | Phase 4: Module Gap Tests | 11 | ⏳ Pending |
| — | Phase 5: Final Review | 1 | ⏳ Pending |

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
| scenarios-rm-updateOperatorVUnits.md | RM1 | W3-A | 20-30 | ⏳ |
| scenarios-rm-executeLiquidation.md | RM2 | W3-B | 20-30 | ⏳ |
| scenarios-rm-bulkRemoveValidator.md | RM3 | W3-C | 20-30 | ⏳ |
| scenarios-rm-migrateClusterToETH.md | RM4 | W3-D | 20-30 | ⏳ |
| scenarios-rm-reactivation.md | RM5 | W3-E | 15-20 | ⏳ |
| scenarios-rm-migration-init.md | RM6 | W3-F | 15-20 | ⏳ |
| scenarios-rm-auto-liquidation.md | RMA | W3-G | 20-30 | ⏳ |
| scenarios-rm-chains.md | RMC | W3-H | 30-50 | ⏳ |
| scenarios-invariants.md | INV | W3-I | 30-50 | ⏳ |
| GAP-ANALYSIS.md | — | Phase 3 | — | ⏳ |

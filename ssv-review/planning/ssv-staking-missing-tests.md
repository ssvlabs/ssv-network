# SSV Staking — Missing Test Coverage

**Date:** 2026-02-11
**Commit:** `38791fa` (ssv-staking branch)
**Current suite:** 726 passing, 0 failing, 145 pending (forked)

---

## Summary

| Priority | Count | Description |
|----------|-------|-------------|
| **P0** | 22 | Security-critical — value extraction, accounting corruption, liveness failures |
| **P1** | 46 | Correctness — wrong balances, broken lifecycles, untested state transitions |
| **P2** | 19 | Edge cases — boundaries, dust, defensive checks |
| **Total** | **87** | |

### Key Systemic Gaps

1. **Every SSVValidators test uses operators with fee=0** — the entire fee settlement mechanism during register/remove has zero real coverage
2. **EB-weighted operator earnings have zero unit test coverage** — the economic core of the EB feature is untested
3. **No balance delta assertions anywhere in liquidation paths** — events are checked but actual ETH transfers are not
4. **EB decrease scenarios are completely untested** — only increases are covered
5. **Cross-module interactions with EB are mostly untested** — fee changes, parameter changes, migration + EB, staking rewards from EB-weighted fees

---

Full details for each finding are in separate files:

- **[P0 — Security Critical (21)](ssv-staking-missing-tests-p0.md)** — value extraction, accounting corruption, liveness failures
- **[P1 — Correctness (46)](ssv-staking-missing-tests-p1.md)** — wrong balances, broken lifecycles, untested state transitions
- **[P2 — Edge Cases (19)](ssv-staking-missing-tests-p2.md)** — boundaries, dust, defensive checks

---

## Prioritized Action Plan

### Immediate (P0)

1. **Add balance assertions to liquidation paths** (C-3, C-4)
2. **Test fee settlement with non-zero operator fees** in validators (V-1, V-2, V-4)
3. **Test EB-weighted operator earnings** (O-1, O-2)
4. **Test deviation cleanup on last-validator removal** (V-3, E-2)
5. **Test `UpdateTooFrequent` rate limiting** (C-1)
6. **Test oracle quorum edge cases** (D-1, D-2, D-3, E-6)
7. **Test `updateClusterBalance` on liquidated clusters** (C-2)
8. **Test cross-module EB interactions** (E-1, E-3, E-4, E-5, E-7)
9. **Verify `rescueERC20` access control** (D-4)

### High Priority (P1)

1. **EB decrease scenarios** — all modules
2. **Reactivation with stored EB deviation** — solvency check
3. **Multi-cycle liquidation/reactivation** — accounting drift
4. **Operator fee changes + EB burn rate**
5. **Staker reward distribution accuracy**
6. **Network fee change + EB-weighted clusters**
7. **Full lifecycle E2E test**

### Later (P2)

1. Boundary value tests (exact thresholds, min/max EB)
2. Idempotency checks (double-exit, double-sync)
3. Input validation negative tests

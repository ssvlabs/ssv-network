# SSV Network v2.0.0 — Audit Issues Tracking

**Generated:** 2026-02-27
**Updated:** 2026-03-02
**Source:** `ssv-review/audit-report-source.md`
**Branch:** `ssv-staking`

This document tracks issues from the audit report source in a management-friendly format. It mirrors the style of `ssv-review/planning/MAINNET-READINESS.md` but is focused exclusively on audit findings and auditor suggestions.

---

## Priority Summary

| ID | Task | Type | Priority | Effort |
|----|------|------|----------|--------|
| SSV-1 | ~~Stale memory write-back locks operators at zero ETH fee & reactivates removed operators~~ | Audit Finding | P0 | ✅ Fixed |
| SSV-2 | Live cSSV supply used per vote allows quorum manipulation | Audit Finding | P0 | M |
| SSV-3 | Validator registration can leave cluster immediately liquidatable | Audit Finding | P0 | M |
| SSV-4 | Remove-and-reregister resets explicit EB to baseline, creating fee undercharge window | Audit Finding | P2 | TBD |
| SSV-5 | Operator removal can compromise clusters' fault tolerance | Audit Finding | P2 | ✅ By Design |
| SSV-6 | ETH rewards accrued during zero cSSV supply become unclaimable | Audit Finding | P1 | ✅ Mitigated |
| SSV-7 | EB auto-liquidation can leave ethValidatorCount inflated | Audit Finding | P2 | ✅ Fixed |
| SSV-8 | Double-accounting EB deviation blocks validator removal from liquidated clusters | Audit Finding | P2 | ✅ Fixed |
| SSV-9 | Incorrect oracle weight may reach premature quorum | Audit Finding | P2 | M |
| SSV-10 | Cluster owners can avoid liquidation by removing all validators before withdrawal | Audit Finding | P3 | ⚠️ Pending — choose mitigation option |
| SSV-11 | Legacy fee requests may execute after upgrade with incompatible fee scale | Audit Finding | P3 | ✅ Fixed (uses UPGRADE_TIMESTAMP) |
| SSV-12 | Liquidation fallback adds operatorEthVUnits in sub-baseline case | Audit Finding | P3 | ✅ Acknowledged (unreachable under current invariants) |
| SSV-13 | Operator registration can be DoSed | Audit Finding | P3 | ✅ Acknowledged |
| SSV-14 | Phantom operators can extract fees and degrade fault tolerance | Audit Finding | P3 | ✅ Acknowledged (no bonding by design) |
| SSV-15 | Deferred reward accounting exposes stakers to ETH price volatility | Audit Finding | P3 | ❌ Invalid (execution order misunderstood) |
| SSV-16 | Non-standard ERC20 tokens trapped in SSVStaking | Audit Finding | P3 | L |
| SSV-17 | Stale cluster effective balance updates | Audit Finding | P3 | M |
| SSV-18 | Direct liquidations do not consider effective balance updates | Audit Finding | P3 | TBD |
| SSV-19 | replaceOracle allows out-of-set oracle IDs to vote | Audit Finding | P3 | TBD |
| SSV-20 | Duplicate BLS key registration across owners risks slashing | Audit Finding | P3 | TBD |
| SSV-21 | Operator onboarding may lead to increasing centralization | Audit Finding | P3 | TBD |
| S-1 | Improve error handling | Auditor Suggestion | P3 | TBD |
| S-2 | Misleading event emission in replaceOracle | Auditor Suggestion | P3 | TBD |
| S-3 | Incorrect code comment in reentrancy storage/guard | Auditor Suggestion | P3 | TBD |
| S-4 | Gas savings opportunities | Auditor Suggestion | P3 | TBD |
| S-5 | Missing input validation in governance/admin paths | Auditor Suggestion | P3 | TBD |
| S-6 | Unstake cooldown unit mismatch (docs vs code) | Auditor Suggestion | P3 | TBD |
| S-7 | Code quality improvements (cluster invariants, reentrancy, docs) | Auditor Suggestion | P3 | TBD |
| S-8 | Remove unchecked arithmetic in loops | Auditor Suggestion | P3 | TBD |
| S-9 | replaceOracle no-op emits misleading event | Auditor Suggestion | P3 | TBD |

---

## High Priority Audit Findings

### [SSV-1] Stale Memory Write-Back Locks Operators at Zero ETH Fee & Silently Reactivates Removed Operators
- **Type:** Critical Bug Fix
- **Severity:** High
- **Priority:** P0
- **Status:** ✅ Fixed
- **Owner:** N/A
- **Timeline:** Fixed 2026-02-15
- **Github Link:** Fixed in commit `bd973d4`
- **Files Affected:** [contracts/libraries/OperatorLib.sol](contracts/libraries/OperatorLib.sol), [contracts/modules/SSVOperators.sol](contracts/modules/SSVOperators.sol), [contracts/modules/SSVValidators.sol](contracts/modules/SSVValidators.sol)

**Requirement:**
Fix `OperatorLib.updateClusterOperatorsOnRegistration` so that the memory copy of an operator is taken AFTER `ensureETHDefaults` writes to storage, not before. The stale memory copy was overwriting the ETH defaults that were just set.

**Original Issue:**
`updateClusterOperatorsOnRegistration` took a storage-to-memory copy of each operator, called `ensureETHDefaults` on the **storage** reference, then wrote the **memory** copy back to storage. Because the memory copy was taken before the storage mutation and written back after it, the two diverged, causing two critical bugs:

**Bug 1: ethFee permanently clobbered for SSV-only operators**
- When an SSV-only operator (one with `ethFee = 0`, `ethSnapshot.block = 0`, `fee != 0`) was first included in an ETH cluster, `ensureETHDefaults` correctly wrote `ethFee = defaultOperatorEthFee()` to storage.
- However, the memory copy still held `ethFee = 0`.
- The write-back at the end of the loop overwrote storage with the stale zero value.
- **Consequences:**
  - The operator was left permanently with `ethFee = 0`, accruing no ETH fees for any cluster
  - `cumulativeFee` returned to the caller was understated, corrupting burn-rate and liquidation threshold calculations
  - `declareOperatorFee` could no longer re-apply defaults once `ethSnapshot.block != 0`
  - Fee increase checks based on `ethFee = 0` caused non-zero fee declarations to revert with `FeeExceedsIncreaseLimit`

**Bug 2: Removed operators reactivated on validator registration**
- When `isExistingCluster = true`, the existence check only required `operator.owner != address(0)`, which passed for removed operators (since `_resetOperatorState` preserves owner).
- The function then:
  1. Called `ensureETHDefaults` on storage — saw `ethSnapshot.block == 0`, set it to `block.number`
  2. Called `updateSnapshot` on the memory copy — unconditionally set `operator.ethSnapshot.block = currentBlock`
  3. Incremented `operator.ethValidatorCount += deltaValidatorCount` on the memory copy
  4. Wrote back the memory copy — persisted `ethSnapshot.block = currentBlock` (non-zero) and the incremented `ethValidatorCount`
- After the write-back, the removed operator had `ethSnapshot.block != 0`, which is the signal downstream code uses to identify active operators.
- The operator was effectively **reactivated**: it appeared active to all snapshot logic and carried an incorrectly inflated `ethValidatorCount`.

**Resolution:**
Code refactored in commit `bd973d4` (Feb 15, 2026):
- The function now uses a storage reference (`operatorSt`)
- Calls `ensureOperatorExist` and `ensureETHDefaults` on the storage reference first
- Only then copies to memory after defaults are persisted
- See [OperatorLib.sol:197-201](contracts/libraries/OperatorLib.sol#L197-L201):
  ```solidity
  ISSVNetworkCore.Operator storage operatorSt = s.operators[operatorId];
  ensureOperatorExist(operatorSt);

  ensureETHDefaults(operatorSt);
  ISSVNetworkCore.Operator memory operator = operatorSt;
  ```

**Auditor Recommendation (Original):**
- Use storage-only mutation (or reload from storage after `ensureETHDefaults`), so initialized ETH defaults cannot be overwritten
- Add regression tests for legacy operator state transitions
- Guard `ensureETHDefaults` so it is skipped for removed operators in the `isExistingCluster` branch

**Current Status:**
✅ **FIXED** - The core memory write-back issue is fully resolved. The fix ensures:
- Pre-v2 operators get correct `ethFee` (default ETH fee) after first validator registration
- Pre-v2 operators get correct `ethSnapshot.block` (current block) after first registration
- `cumulativeFee` accumulates correctly for clusters with pre-v2 operators
- Removed operators cannot be reactivated through registration paths

**Related Issues:**
- This is the same issue as **BUG-1** in [MAINNET-READINESS.md](ssv-review/planning/MAINNET-READINESS.md#bug-1)
- Also relates to **BUG-3** (`ensureETHDefaults` resurrects removed operators) which was mitigated by upstream guards

**Acceptance Criteria:**
- [x] Operator loaded into memory AFTER `ensureETHDefaults` is called
- [x] Pre-v2 operators get correct `ethFee` after first validator registration
- [x] Pre-v2 operators get correct `ethSnapshot.block` after first registration
- [x] `cumulativeFee` accumulates correctly for clusters with pre-v2 operators
- [x] Removed operators cannot be reactivated through registration
- [x] Code verified on current `ssv-staking` branch

**Test Coverage:**
- Existing unit tests pass with the fix
- Additional regression tests recommended in `test/unit/SSVValidator/` for:
  - Registering a validator with pre-v2 operators (zero ETH fields)
  - Verifying `ethFee != 0` after registration
  - Verifying removed operators remain removed (cannot be resurrected)

---

### [SSV-2] Live cSSV Supply Used Per Vote in commitRoot Allows Supply Manipulation to Block or Bypass Oracle Quorum
- **Type:** Security Hardening / Audit Finding (High Severity)
- **Priority:** P0
- **Status:** Open - Acknowledged, Fix Required
- **Owner:** (unassigned)
- **Timeline:** Must be fixed before mainnet v2.0.0 deployment
- **Github Link:** (empty)
- **Related:** Supersedes [SEC-5] with concrete exploit scenarios from audit

**Requirement:**
Fix `commitRoot` so that cSSV total supply is frozen at the start of each voting round (on the first vote) and used consistently for all subsequent votes in that round, preventing supply manipulation attacks.

**Audit Finding (SSV-2 from external audit report):**
`commitRoot` uses live `cSSV.totalSupply()` on every individual oracle vote, but vote weight is accumulated across multiple transactions. This creates a "moving denominator" problem where:

**Attack Vector 1: Liveness DoS (Supply Increase)**
```
Initial supply: 100M cSSV
Oracle 1 votes → adds 25M weight (100M/4)
[Attacker stakes 100M cSSV → supply becomes 200M]
Oracle 2 votes → adds 50M weight (200M/4)
Oracle 3 votes → adds 50M weight (200M/4)
Total accumulated: 125M
Threshold: 150M (75% of 200M)
Result: 125M < 150M → FAILS despite 3/4 oracles voting!
```

**Impact:** Blocks all EB updates → validators pay fees based on stale EB → incorrect liquidation thresholds → system liveness degraded.

**Attack Vector 2: Safety Bypass (Supply Decrease)**
```
Initial supply: 200M cSSV
Oracle 1 votes → adds 50M weight (200M/4)
Oracle 2 votes → adds 50M weight (200M/4)
[Large staker requests unstake of 100M → supply becomes 100M]
Total accumulated: 100M
Threshold: 75M (75% of 100M)
Result: 100M ≥ 75M → PASSES with only 2/4 oracles!
```

**Impact:** Bypasses 3-of-4 quorum requirement → malicious oracle pair can commit incorrect EB data → fee theft → security degradation.

**Rationale for v2.0.0 Solution:**
- ✅ **Valid for current design:** Oracles are permissioned (4 oracles with equal weight) and vote nearly simultaneously
- ✅ **No UX impact:** Oracles vote exactly as before
- ✅ **Complete security fix:** Eliminates both attack vectors
- ✅ **Trains ecosystem:** Users and oracles adapt to freeze-on-first-vote behavior

**Future Consideration (Phase 2 with Permissionless Oracles):**
When oracles become permissionless with delegated stake-based weights, the freeze-on-first-vote approach will need to be replaced with **OpenZeppelin Checkpoints**:
- Each oracle will have different weight based on delegated cSSV stakes
- Users will delegate stakes to specific oracles
- Checkpoints will allow querying oracle weights at a specific block number
- Oracle votes will reference a checkpoint block to ensure consistent weight calculation

**Why Checkpoints for Future:**
- Prevents "first voter advantage" issue when oracle weights differ significantly
- Allows fair weight calculation based on historical stake distribution
- Enables future governance features

**Implementation Plan:**
1. **v2.0.0 (Current):** Implement freeze-on-first-vote solution
2. **v2.0.0:** Add comprehensive tests for supply manipulation scenarios
3. **Phase 2 (Future):** When implementing permissionless oracles, migrate to checkpoint-based system

**Acceptance Criteria:**
- [ ] `RoundState` struct added to track frozen supply per commitment round
- [ ] First vote for a commitment key freezes `totalStaked` at current `cSSV.totalSupply()`
- [ ] Subsequent votes for same key use frozen supply
- [ ] Frozen supply cleaned up when round succeeds (root committed)
- [ ] Optional: Add round timeout (e.g., 7200 blocks / ~24 hours) for stale round cleanup
- [ ] Test: Oracle A votes, large stake occurs, Oracle B votes → quorum uses consistent supply
- [ ] Test: Oracle A votes, Oracle B votes, large unstake occurs, Oracle C votes → quorum still requires 3/4
- [ ] Test: Auditor's concrete example (supply doubles mid-round) → 3/4 still reaches quorum
- [ ] All existing oracle tests still pass

**Agent Instructions:**
1. Read `contracts/modules/SSVDAO.sol`, focus on `commitRoot` function (lines 155-200)
2. Read `contracts/libraries/storage/SSVStorageEB.sol` to understand oracle vote storage
3. Add `RoundState` struct to `SSVStorageEB.sol`:
   ```solidity
   struct RoundState {
       uint192 frozenSupply;
       uint64 firstVoteBlock;
   }
   ```
4. Add mapping in `StorageEB`: `mapping(bytes32 => RoundState) roundStates;`
5. Modify `commitRoot` to:
   - Check if `roundStates[commitmentKey].frozenSupply == 0` (first vote)
   - If first vote: read and freeze current `totalSupply()`
   - If subsequent vote: use frozen supply
   - Calculate weight and threshold using frozen supply
   - On successful commit: delete `roundStates[commitmentKey]`
6. (Optional) Add round timeout check:
   ```solidity
   if (round.frozenSupply != 0 && block.number > round.firstVoteBlock + MAX_ROUND_DURATION) {
       // Reset stale round
       delete roundStates[commitmentKey];
       // Start fresh
   }
   ```
7. Add comprehensive tests in `test/unit/SSVDAO/` covering:
   - Supply increase between votes (liveness attack)
   - Supply decrease between votes (safety attack)
   - Normal voting with stable supply
   - Round cleanup on success
   - (Optional) Stale round timeout
8. Update SPEC.md and FLOWS.md to document frozen supply behavior
9. Run `npm run test:unit` and `npm run test:integration`

#### Sub-items:
- [ ] Sub-task 1: Add `RoundState` struct and storage mapping
- [ ] Sub-task 2: Implement freeze-on-first-vote logic in `commitRoot`
- [ ] Sub-task 3: Add round cleanup on successful commit
- [ ] Sub-task 4: (Optional) Add round timeout for stale round cleanup
- [ ] Sub-task 5: Write comprehensive tests for supply manipulation scenarios
- [ ] Sub-task 6: Update SPEC.md §4 Oracle section with frozen supply behavior
- [ ] Sub-task 7: Update FLOWS.md §3.1 commitRoot flow
- [ ] Sub-task 8: Run full test suite

---

### [SSV-3] Validator Registration Can Leave Cluster Immediately Liquidatable Due to Stale vUnits in Liquidation Check
- **Type:** Security Bug / Audit Finding (High Severity)
- **Priority:** P0
- **Status:** Open - Acknowledged, Fix Required
- **Owner:** (unassigned)
- **Timeline:** Must be fixed before mainnet v2.0.0 deployment
- **Github Link:** (empty)
- **Files Affected:** [contracts/modules/SSVValidators.sol](contracts/modules/SSVValidators.sol), [contracts/libraries/ClusterLib.sol](contracts/libraries/ClusterLib.sol)

**Requirement:**
Fix validator registration flow so that the liquidation check uses the **post-registration vUnits** (including the baseline for newly added validators), not the pre-registration vUnits stored in `ebSnapshot.vUnits`.

**Issue Summary:**
During `registerValidator` and `bulkRegisterValidator`, the liquidation safety check is executed **before** the cluster's explicit EB units (`ebSnapshot.vUnits`) are updated for the newly added validators. This creates a temporal inconsistency where:

1. The liquidation check reads **old vUnits** from storage (via `getVUnits`)
2. The check passes because the threshold calculation uses lower vUnits
3. **After** the check passes, `ebSnapshot.vUnits` is incremented by `validatorCountDelta * VUNITS_PRECISION`
4. The cluster is now immediately liquidatable with the higher vUnits

**Execution Flow ([SSVValidators.sol:136-160](contracts/modules/SSVValidators.sol#L136-L160)):**
```solidity
// Line 136: Validate cluster state
bytes32 hashedCluster = cluster.validateClusterOnRegistration(owner, operatorIds, s);

// Line 138: Add deposited ETH
cluster.balance += value;

// Line 140: Update cluster state AND perform liquidation check
cluster.updateClusterOnRegistration(operatorIds, hashedCluster, uint32(validatorsLength), s, sp);
  // Inside this function (ClusterLib.sol:255-266):
  // - Line 253: cluster.validatorCount += validatorCountDelta (in memory)
  // - Line 255-266: Liquidation check calls isLiquidatableWithEB
  //   - isLiquidatableWithEB calls getVUnits(clusterId, cluster.validatorCount)
  //   - getVUnits reads ebSnapshot.vUnits from STORAGE (still old value!)
  //   - Check uses OLD vUnits → lower threshold → easier to pass

// Lines 148-150: NOW the vUnits get updated in storage
if (ebSnapshot.vUnits > 0) {
    ebSnapshot.vUnits += uint64(validatorsLength) * VUNITS_PRECISION;
}
```

**Concrete Exploit Scenario:**

**Initial State:**
- Cluster has 10 validators with explicit EB = 3200 ETH (320 ETH each, post-Pectra maxed out)
- `ebSnapshot.vUnits = 1,000,000` (3200 ETH / 32 * 10,000)
- Cluster is active and solvent

**Attack Steps:**
1. Owner calls `bulkRegisterValidator` to add 500 new validators (implicit 32 ETH each)
2. Owner deposits only enough ETH to cover fees for the **existing 3200 ETH** effective balance

**What Happens:**
```
Liquidation check calculation (ClusterLib.sol:78-83):
  vUnits = getVUnits(clusterId, 510)  // reads storage → returns 1,000,000 (OLD!)
  thresholdUnits = (50190 * burnRate * 1,000,000) / 10,000
  liquidationThreshold = thresholdUnits * 100,000

  Passes check because msg.value covers fees for 1M vUnits

Post-registration state (SSVValidators.sol:150):
  ebSnapshot.vUnits = 1,000,000 + (500 * 10,000) = 6,000,000

  New threshold calculation:
  thresholdUnits = (50190 * burnRate * 6,000,000) / 10,000  // 6x higher!

  Result: cluster.balance < new threshold → IMMEDIATELY LIQUIDATABLE
```

**Impact Calculation (with governance parameters from SPEC.md):**
- `minimumBlocksBeforeLiquidation = 50,190` blocks (~7 days)
- `ethNetworkFee ≈ 3,550,929,823` wei/block (packed)
- Assume 4 operators @ `1,770,000,000` wei/block each

```
Required collateral for 6M vUnits (final state):
  burnRate = 4 * 1,770,000,000 + 3,550,929,823 = 10,630,929,823 wei/block
  threshold = (50,190 * 10,630,929,823 * 6,000,000) / 10,000 * 100,000
           ≈ 320.28 ETH

Required collateral for 1M vUnits (what was checked):
  threshold ≈ 53.38 ETH

Result: Attacker deposits only ~53 ETH instead of ~320 ETH
```

**Severity Justification:**
- **High** - Breaks critical post-condition invariant from [FLOWS.md §1.1](docs/FLOWS.md#11-register-validator-eth): "Cluster is not liquidatable"
- **Loss of funds** - Deposited ETH becomes liquidation bounty for any MEV bot watching the mempool
- **DoS vector** - Honest users adding many validators might not realize they need to account for baseline EB increase
- **Affects all clusters with explicit EB** - Any cluster that has received an oracle EB update is vulnerable

**Proposed Solution:**

Reorder the operations in `_bulkRegisterValidator` so that the EB snapshot is updated **before** the liquidation check:

```solidity
// Current order (SSVValidators.sol:136-153):
bytes32 hashedCluster = cluster.validateClusterOnRegistration(owner, operatorIds, s);
cluster.balance += value;
cluster.updateClusterOnRegistration(...);  // ← liquidation check here with OLD vUnits
{
    StorageEB storage seb = SSVStorageEB.load();
    ClusterEBSnapshot storage ebSnapshot = seb.clusterEB[hashedCluster];
    if (ebSnapshot.vUnits > 0) {
        ebSnapshot.vUnits += uint64(validatorsLength) * VUNITS_PRECISION;  // ← update AFTER check
    }
}

// Proposed fix - swap order:
bytes32 hashedCluster = cluster.validateClusterOnRegistration(owner, operatorIds, s);
cluster.balance += value;

// Update EB snapshot FIRST
{
    StorageEB storage seb = SSVStorageEB.load();
    ClusterEBSnapshot storage ebSnapshot = seb.clusterEB[hashedCluster];
    if (ebSnapshot.vUnits > 0) {
        ebSnapshot.vUnits += uint64(validatorsLength) * VUNITS_PRECISION;  // ← update BEFORE check
    }
}

// THEN perform liquidation check with correct vUnits
cluster.updateClusterOnRegistration(...);  // ← liquidation check now uses NEW vUnits
```

**Alternative Solution (if reordering is complex):**

Modify `ClusterLib.isLiquidatableWithEB` to accept a `projectedVUnits` parameter:

```solidity
// In updateClusterOnRegistration (ClusterLib.sol:255-266):
uint64 currentVUnits = getVUnits(hashedCluster, cluster.validatorCount - validatorCountDelta);
uint64 projectedVUnits = currentVUnits + (validatorCountDelta * VUNITS_PRECISION);

if (isLiquidatableWithVUnits(
    cluster,
    projectedVUnits,  // ← use projected vUnits, not current
    burnRate,
    PackedETH.unwrap(sp.ethNetworkFee),
    sp.minimumBlocksBeforeLiquidation,
    sp.minimumLiquidationCollateral
)) {
    revert ISSVNetworkCore.InsufficientBalance();
}
```

**Acceptance Criteria:**
- [ ] Liquidation check uses post-registration vUnits (baseline for new validators included)
- [ ] Post-condition invariant from FLOWS.md §1.1 is enforced: cluster cannot be immediately liquidatable after registration
- [ ] Test: Register 500 validators to cluster with explicit EB, deposit only enough for old EB → reverts with `InsufficientBalance`
- [ ] Test: Register validators with sufficient ETH for projected vUnits → succeeds and cluster remains solvent
- [ ] Test: Implicit EB clusters (vUnits == 0) are unaffected by the fix
- [ ] All existing validator registration tests still pass
- [ ] No regression in gas costs for common registration scenarios

**Agent Instructions:**
1. Read [contracts/modules/SSVValidators.sol](contracts/modules/SSVValidators.sol) lines 115-161
2. Read [contracts/libraries/ClusterLib.sol](contracts/libraries/ClusterLib.sol) lines 234-289
3. Implement **Solution 1 (reordering)**:
   - Move the EB snapshot update block (lines 143-153) to **before** line 140
   - Ensure `hashedCluster` is available at the new location (already computed at line 136)
   - Verify no other dependencies are broken
4. Add regression tests in `test/unit/SSVValidators/`:
   - Test name: `bulkRegisterValidator should revert if deposit insufficient for projected vUnits`
   - Setup: Create cluster with 10 validators, oracle sets EB to 3200 ETH (explicit vUnits)
   - Action: Add 500 validators with ETH deposit calculated for old vUnits only
   - Expected: Revert with `InsufficientBalance`
5. Add positive test:
   - Test name: `bulkRegisterValidator should succeed with sufficient ETH for projected vUnits`
   - Setup: Same as above
   - Action: Add 500 validators with ETH deposit calculated for new vUnits (6M)
   - Expected: Success, cluster remains solvent
6. Update FLOWS.md §1.1 and §1.2 to clarify that EB snapshot is updated before liquidation check
7. Run `npm run test:unit` and `npm run test:integration`
8. Verify no gas regression with `npm run test:gas`

#### Sub-items:
- [ ] Sub-task 1: Reorder EB snapshot update to occur before `updateClusterOnRegistration`
- [ ] Sub-task 2: Write regression test for insufficient deposit with projected vUnits
- [ ] Sub-task 3: Write positive test for sufficient deposit with projected vUnits
- [ ] Sub-task 4: Update FLOWS.md §1.1 and §1.2 documentation
- [ ] Sub-task 5: Run full unit test suite
- [ ] Sub-task 6: Run integration test suite
- [ ] Sub-task 7: Verify no gas regression
- [ ] Sub-task 8: Code review and PR submission

---

### [SSV-5] Operator Removal Can Compromise Clusters' Fault Tolerance
- **Type:** Design Decision / Acknowledged Risk
- **Priority:** P2 (Documentation/Monitoring)
- **Status:** Won't Fix - By Design
- **Owner:** N/A
- **Timeline:** N/A (protocol design decision)
- **Github Link:** N/A
- **Files Affected:** [contracts/modules/SSVOperators.sol](contracts/modules/SSVOperators.sol), [contracts/libraries/OperatorLib.sol](contracts/libraries/OperatorLib.sol)

**Audit Finding:**
The protocol allows operators to remove themselves at any time via `removeOperator`, even when they are actively managing validators in existing clusters. When an operator is removed:
- The operator's state is reset (fees zeroed, validator counts cleared)
- All accrued earnings are withdrawn to the operator owner
- The operator is effectively "deleted" from the protocol perspective

However, **clusters that included this operator continue to exist** with a reduced operator set. For example, a 4-of-4 cluster becomes a 3-of-4 cluster if one operator is removed. This degrades the cluster's fault tolerance and may compromise validator security.

**Protocol Response: By Design**

**This is an intentional design decision, not a bug.** The SSV Network protocol operates on the principle of **delegated responsibility** where:

1. **Operators have autonomy** - Operators are independent service providers and must be free to exit the network (similar to how Ethereum validators can voluntarily exit)
2. **Cluster owners bear monitoring responsibility** - It is the cluster owner's responsibility to:
   - Monitor the health and status of operators in their clusters
   - React to operator removal events by migrating validators to new operators
   - Maintain sufficient fault tolerance for their validator operations

**Rationale:**
- **No on-chain enforcement** - The protocol cannot force operators to continue providing services against their will
- **Economic incentives** - Operators have economic incentives (ongoing fees) to remain active, but these incentives cannot be guaranteed indefinitely
- **Off-chain monitoring** - The SSV ecosystem provides off-chain monitoring tools and operator reputation systems to help cluster owners track operator status
- **Graceful degradation** - Reduced operator sets (e.g., 3-of-4) can still operate validators, though with reduced fault tolerance. This gives cluster owners time to respond.

**Existing Mitigations:**

1. **Event emission** - `OperatorRemoved` event is emitted when an operator exits, allowing off-chain monitoring systems to alert cluster owners
2. **Operator earnings withdrawal** - Final earnings are paid out, ensuring no locked funds
3. **Cluster continues operating** - Validators don't immediately fail; they continue with reduced operator coverage
4. **Reactivation support** - Clusters can be reactivated after operator changes (see `reactivate` flow in FLOWS.md §1.11)

**Documentation in SPEC.md:**
Per [SPEC.md §1 "Minimum ETH Calculation"](docs/SPEC.md#1-eth-payments):
> **Removed operators** are skipped during migration (detected by `operator.snapshot.block == 0 && operator.ethSnapshot.block == 0`; their fees do not contribute to `operatorFeeSum`)

Per [FLOWS.md §1.11 "Reactivate"](docs/FLOWS.md#111-reactivate):
> **Note — operator removal and reactivation:** If one or more operators in a cluster's operator set have been removed (via `removeOperator`), the cluster can still be reactivated, but removed operators are silently skipped during `updateClusterOperatorsOnReactivation` (see `OperatorLib.sol:311`). The cluster will operate with reduced operator coverage (e.g., 3/4 instead of 4/4), which may compromise the cluster's fault tolerance. The reactivation fee calculation excludes removed operators' fees. No on-chain event signals which operators were skipped, but this is detectable off-chain by checking operator states before reactivation.

**Recommendations for Cluster Owners:**

1. **Active monitoring** - Subscribe to `OperatorRemoved` events for operators in your clusters
2. **Operator diversification** - Choose operators from different entities/geographic regions to reduce correlated exit risk
3. **Reputation research** - Use SSV explorer and community resources to assess operator reliability before cluster creation
4. **Contingency planning** - Have a plan to migrate validators if an operator exits
5. **Over-provision fault tolerance** - Consider using more operators than the minimum required (e.g., 5 or 7 operators instead of 4)

**Acceptance Criteria:**
- [x] Behavior is documented in SPEC.md and FLOWS.md
- [x] `OperatorRemoved` event is emitted for off-chain tracking
- [x] Clusters with removed operators can still function (graceful degradation)
- [x] Protocol team acknowledges this as intended behavior
- [ ] (Optional) Add warning in webapp UI when creating clusters: "Monitor operator status - operators may exit at any time"
- [ ] (Optional) Enhance SSV explorer to highlight clusters with removed operators

**Status: ACKNOWLEDGED - No protocol changes required. This is by design and documented.**

---

### [SSV-6] ETH Rewards Accrued During Zero cSSV Supply Become Unclaimable
- **Type:** Critical Bug Fix
- **Priority:** P1
- **Status:** ✅ Mitigated (deployment procedure)
- **Owner:** Deployment team
- **Timeline:** At upgrade (atomic batch transaction)
- **Github Link:** Mitigated via [PR #431](https://github.com/ssvlabs/ssv-network/pull/431)
- **Related:** [MAINNET-READINESS.md BUG-6](ssv-review/planning/MAINNET-READINESS.md#bug-6)
- **Files Affected:** [contracts/modules/SSVStaking.sol](contracts/modules/SSVStaking.sol)

**Requirement:**
When `totalStaked == 0` (i.e., `cSSV.totalSupply() == 0`) in the `_syncFees` function, ETH rewards must not be silently lost. Either accumulate them for the next sync when stakers exist, or redirect them to the DAO.

**Issue Summary:**
In [SSVStaking.sol:179-203](contracts/modules/SSVStaking.sol#L179-L203), when `totalStaked == 0`:
- Line 196: Skips the `accEthPerShare` increment (division by zero would revert)
- Line 201: Still advances `stakingEthPoolBalance` to the new DAO earnings value

**The Problem:**
Fees earned during the zero-staked period are permanently locked in the contract — they update `stakingEthPoolBalance` but never increment `accEthPerShare`, so they can never be distributed to future stakers.

**Code Flow:**
```solidity
function _syncFees() internal {
    StorageProtocol storage sp = SSVStorageProtocol.load();
    PackedETH current = sp.networkTotalEarnings();
    PackedETH previous = s.stakingEthPoolBalance;

    if (current.lte(previous)) {
        // Safety valve: DAO earnings decreased (can happen after claims)
        s.stakingEthPoolBalance = current;
        return;
    }

    PackedETH newFees = PackedETH.wrap(PackedETH.unwrap(current) - PackedETH.unwrap(previous));
    uint256 totalStaked = IERC20(CSSV_ADDRESS).totalSupply();

    if (totalStaked > 0) {
        s.accEthPerShare += (PackedETHLib.unpack(newFees) * 1e18) / totalStaked;  // ← rewards distributed
    }
    // else: newFees are LOST — no accumulator update, but stakingEthPoolBalance still advances below

    s.stakingEthPoolBalance = current;  // ← always updated, even when totalStaked == 0
    emit FeesSynced(PackedETHLib.unpack(newFees), s.accEthPerShare);
}
```

**When This Happens:**
- Between contract deployment and first stake
- If all stakers unstake and withdraw (extremely unlikely in practice, but possible)
- During the upgrade window before the first stake transaction

**Additional Edge Case (from MAINNET-READINESS.md BUG-6):**
The `_syncFees` function also has a related edge case when `current <= previous` (DAO earnings decrease). At lines 187-190, if `current.lte(previous)`, the function silently updates `stakingEthPoolBalance` to the lower value and returns without distributing. This can happen after reward claims reduce `sp.ethDaoBalance`. While `claimEthRewards` reduces both `stakingEthPoolBalance` and `sp.ethDaoBalance` by the same packed amount (so `current == previous` after normal claims), this edge case acts as a safety valve.

**Mitigation Strategy: Deployment Procedure (Not Code Fix)**

This issue is **mitigated by deployment procedure** rather than a code change. The DAO multisig (Safe) upgrade batch transaction includes an SSV `approve` + `stake(1 SSV)` call **immediately after** `upgradeToAndCall`. This ensures:
- `cSSV.totalSupply() > 0` before any network fees can accrue
- The zero-staked window is impossible in practice
- The 1 SSV stake goes to the DAO address (tokens not lost)

**Upgrade Batch Transaction Sequence:**
All executed **atomically** in a single Safe multisig batch:
1. `upgradeToAndCall` (proxy upgrade + `initializeSSVStaking` with `quorumBps=7500`)
2. `updateModule` × 7 (all module addresses)
3. **SSV token `approve`** (SSVNetwork contract as spender, amount ≥ 1 SSV)
4. **`stake(1_000_000_000)`** (1 SSV minimum stake from DAO) ← **Key mitigation step**
5. Governance parameter updates (`updateNetworkFee`, `updateLiquidationThresholdPeriod`, etc.)

Because all operations are atomic in a single batch, there is **no block gap** where the contract is live but `totalStaked == 0`.

**Why This Approach:**
- ✅ **Zero code risk** - No changes to tested staking logic
- ✅ **Guaranteed effective** - Atomic execution ensures no gap
- ✅ **Simple verification** - Easy to verify in batch transaction encoding
- ✅ **Reversible** - If needed, DAO can unstake later (unlikely)
- ✅ **Cost effective** - 1 SSV is minimal and stays in DAO control

**Alternative Approaches Considered (Not Implemented):**
1. **Accumulate rewards during zero-staked period** - Complex state tracking, edge cases
2. **Redirect to DAO when totalStaked == 0** - Requires additional logic and events
3. **Revert on sync when totalStaked == 0** - Blocks all staking operations unnecessarily

**Acceptance Criteria:**
- [x] Deployment runbook includes DAO stake as part of upgrade batch
- [x] `initializeSSVStaking` validates `quorumBps != 0` (PR #431)
- [x] Safe batch transaction encoding includes `approve` + `stake` steps
- [ ] Verify Safe batch transaction encoding before mainnet execution
- [ ] Post-upgrade: Confirm `cSSV.totalSupply() > 0` on-chain
- [ ] Post-upgrade: Verify DAO address holds ≥ 1 cSSV

**Documentation References:**
- Full analysis: [MAINNET-READINESS.md BUG-6](ssv-review/planning/MAINNET-READINESS.md#bug-6)
- Related PR: [#431 - Add quorumBps validation to initializer](https://github.com/ssvlabs/ssv-network/pull/431)

**Status: MITIGATED - No code changes required. Deployment procedure ensures totalStaked > 0 from block 1.**

---

### [SSV-7] EB Auto-Liquidation Can Leave ethValidatorCount Inflated and Inflate Future ETH Accrual
- **Type:** Bug Fix
- **Priority:** P2
- **Status:** ✅ Fixed
- **Owner:** N/A
- **Timeline:** Fixed in current codebase
- **Github Link:** (commit hash TBD)
- **Files Affected:** [contracts/modules/SSVClusters.sol](contracts/modules/SSVClusters.sol)

**Audit Finding (from external audit report):**
In `_liquidateAfterEBUpdateIfNeeded`, the audit report described ETH validator cleanup being gated by **both ETH and SSV snapshot state**:

```solidity
// Audit report claimed this buggy code existed:
if (op.ethSnapshot.block != 0 && op.snapshot.block != 0) {
    op.ethValidatorCount -= cluster.validatorCount;
}
```

The issue was that for operators with mixed snapshot states (`ethSnapshot.block != 0` but `snapshot.block == 0`), the liquidation would execute but the `ethValidatorCount` decrement would be skipped. This could leave `ethValidatorCount` overstated after liquidation and distort later ETH accounting.

**Current Implementation:**
The code at [SSVClusters.sol:543-548](contracts/modules/SSVClusters.sol#L543-L548) shows the fix has already been applied:

```solidity
for (uint256 i; i < operatorIds.length; ++i) {
    ISSVOperators.Operator storage op = s.operators[operatorIds[i]];
    if (op.ethSnapshot.block != 0) {  // ← Only checks ETH snapshot (CORRECT)
        op.ethValidatorCount -= cluster.validatorCount;
    }
}
```

**The Fix:**
The conditional now correctly checks **only `ethSnapshot.block != 0`**, not both snapshots. This ensures that:
- ETH validator count is decremented based on ETH snapshot state only
- No dependency on SSV snapshot state (which is legacy/separate accounting)
- Operators with ETH-only activity are handled correctly
- The issue mentioned in the audit (related to SSV-1's removed operator reactivation bug) cannot cause inflated `ethValidatorCount`

**Status: FIXED - The audit-reported bug does not exist in the current codebase. The conditional correctly checks only ETH snapshot state.**

---

### [SSV-8] Double-Accounting of EB Deviation Blocks Validator Removal From Liquidated Clusters
- **Type:** Bug Fix
- **Priority:** P2
- **Status:** ✅ Fixed
- **Owner:** N/A
- **Timeline:** Fixed in current codebase
- **Github Link:** (commit hash TBD)
- **Files Affected:** [contracts/modules/SSVClusters.sol](contracts/modules/SSVClusters.sol), [contracts/modules/SSVValidators.sol](contracts/modules/SSVValidators.sol)

**Audit Finding (from external audit report):**
The protocol preserves `clusterEB.vUnits` across liquidation → reactivation to restore prior EB weighting. However, liquidation already settles cluster deviation from global accounting (`operatorEthVUnits` and `daoTotalEthVUnits`).

The audit claimed that if the owner removes validators from an **already-liquidated cluster** until `validatorCount == 0`, the final cleanup path would treat the remaining `clusterEB.vUnits` as fresh deviation and subtract it **again** from global/operator deviation accounting, causing underflow reverts or understated accounting.

**Example from audit:**
```
Cluster with 1 validator, EB = 48 ETH → vUnits = 15000, deviation = 5000

During liquidation (_executeLiquidation):
  - sp.updateDAO(false, 1) → daoTotalEthVUnits -= 10000 (baseline)
  - Deviation removal → daoTotalEthVUnits -= 5000, operatorEthVUnits -= 5000
  - ebSnapshot.vUnits still reads 15000 (preserved for reactivation)

During validator removal (_bulkRemoveValidator):
  - cluster.active == false → operator/DAO updates skipped (correct)
  - ebSnapshot.vUnits == 15000 > 0 → enters EB cleanup block
  - ebSnapshot.vUnits -= 10000 → 5000 remains
  - cluster.validatorCount == 0 → triggers final cleanup:
    - operatorEthVUnits -= 5000 → underflow! (already 0 from liquidation)
    - daoTotalEthVUnits -= 5000 → underflow!
```

**Current Implementation - The Fix:**

The code at [SSVValidators.sol:224-236](contracts/modules/SSVValidators.sol#L224-L236) shows the fix has been applied:

```solidity
// When cluster becomes empty, clean up any remaining deviation
if (cluster.validatorCount == 0) {
    uint64 remainingVUnits = ebSnapshot.vUnits;
    if (remainingVUnits > 0 && cluster.active) {  // ← KEY FIX: checks cluster.active!
        // remainingVUnits is pure deviation (no baseline left since validatorCount=0)
        // Skip for liquidated clusters: deviation already cleaned up in _executeLiquidation
        uint256 operatorsLength = operatorIds.length;
        for (uint256 i; i < operatorsLength; ++i) {
            seb.operatorEthVUnits[operatorIds[i]] -= remainingVUnits;
        }
        StorageProtocol storage sp = SSVStorageProtocol.load();
        sp.updateDAOEthVUnits(remainingVUnits, 0);
    }
    ebSnapshot.vUnits = 0;
}
```

**Why This Fix Is Correct:**

1. **Conditional guard** - Line 226 checks `&& cluster.active` before attempting deviation cleanup
2. **Skips liquidated clusters** - Since `cluster.active == false` after liquidation, the deviation subtraction is completely bypassed
3. **Explicit documentation** - Line 228 comment clearly states: "Skip for liquidated clusters: deviation already cleaned up in _executeLiquidation"
4. **No double-accounting** - Deviation is removed exactly once:
   - During liquidation: `_executeLiquidation` removes it from global/operator accounting
   - During validator removal from liquidated cluster: cleanup is **skipped** due to `cluster.active == false`
5. **Preserves EB for reactivation** - `ebSnapshot.vUnits` is still preserved and only zeroed at line 236, so reactivation can still restore the prior EB state

**Flow with the fix:**

```
Cluster with 1 validator, EB = 48 ETH → vUnits = 15000, deviation = 5000

During liquidation (_executeLiquidation):
  ✅ daoTotalEthVUnits -= 10000 (baseline via updateDAO)
  ✅ daoTotalEthVUnits -= 5000 (deviation)
  ✅ operatorEthVUnits -= 5000 (deviation)
  ✅ cluster.active = false
  ✅ ebSnapshot.vUnits still = 15000 (preserved)

During validator removal (_bulkRemoveValidator) on liquidated cluster:
  ✅ cluster.active == false → operator/DAO baseline updates skipped (correct)
  ✅ ebSnapshot.vUnits == 15000 > 0 → enters EB cleanup block
  ✅ ebSnapshot.vUnits -= 10000 → 5000 remains
  ✅ cluster.validatorCount == 0 → final cleanup check:
     ✅ remainingVUnits = 5000 > 0 → true
     ✅ cluster.active → FALSE! ← Cleanup SKIPPED
  ✅ ebSnapshot.vUnits = 0 (zeroed, but no global accounting change)

Result: No underflow, no double-accounting ✅
```

**Verification:**
- [x] Code at line 226 checks `cluster.active` before deviation cleanup
- [x] Liquidated clusters (`active == false`) skip the subtraction
- [x] Comment explicitly documents this behavior
- [x] `ebSnapshot.vUnits` still preserved and only zeroed after the conditional
- [x] No double-accounting possible

**Status: FIXED - The guard `&& cluster.active` at line 226 prevents double-accounting of deviation. Liquidated clusters skip the global deviation cleanup.**

---

### [SSV-9] Liquidation Fallback Branch Incorrectly Adds operatorEthVUnits in Sub-Baseline Case
- Don't allow to register more than 4 oracles using `replaceOracle`

---

### [SSV-10] Cluster Owners Can Avoid Liquidation By Removing All Validators Before Withdrawal
1. Disallow validator removal while liquidatable.
2. Document as accepted behavior.

---

### [SSV-12] Liquidation Fallback Branch Incorrectly Adds operatorEthVUnits in Sub-Baseline Case
- **Type:** Unreachable Code Path / Defensive Programming
- **Severity:** Low (unreachable under current protocol invariants)
- **Priority:** P3
- **Status:** ✅ Acknowledged - Unreachable under current design
- **Owner:** N/A
- **Timeline:** Monitor for future protocol changes
- **Github Link:** N/A
- **Files Affected:** [contracts/modules/SSVClusters.sol](contracts/modules/SSVClusters.sol#L577-L596)

**Requirement:**
Document that the sub-baseline fallback branch in `_executeLiquidation` (lines 577-596) violates the deviation-only accounting model but is unreachable under current protocol invariants that enforce minimum 32 ETH per validator.

**Audit Finding (from external audit report):**
The `_executeLiquidation` function contains a fallback branch for the case where `vUnitsCluster < baselineVUnits`:

```solidity
// SSVClusters.sol:577-596
if (vUnitsCluster != baselineVUnits) {
    bool moreThanBaseline = vUnitsCluster > baselineVUnits;
    uint64 deviation = moreThanBaseline ? vUnitsCluster - baselineVUnits : baselineVUnits - vUnitsCluster;

    if (deviation != 0) {
        if (moreThanBaseline) sp.daoTotalEthVUnits -= deviation;
        else sp.daoTotalEthVUnits += deviation;  // ← Line 583: adds deviation when sub-baseline
    }

    uint256 n = operatorIds.length;
    for (uint256 i; i < n; ++i) {
        if (moreThanBaseline) {
            seb.operatorEthVUnits[operatorIds[i]] -= deviation;
        } else {
            seb.operatorEthVUnits[operatorIds[i]] += deviation;  // ← Line 594: adds to operatorEthVUnits
        }
    }
}
```

**The Issue:**
If the `else` branch at lines 583 and 594 were executed (when `vUnitsCluster < baselineVUnits`), it would **incorrectly add** positive deviation to both `daoTotalEthVUnits` and `operatorEthVUnits`. This violates the deviation-only accounting model, where these storage variables track **only positive deviation above the baseline** (baseline is already accounted for via `ethValidatorCount`).

**Why This Is Currently Unreachable:**

Per [SPEC.md §2 "EB Update Constraints"](../docs/SPEC.md#2-effective-balance-accounting):
> - `effectiveBalance >= validatorCount * 32` (minimum 32 ETH per validator)
> - `effectiveBalance <= validatorCount * 2048` (maximum 2048 ETH per validator)

The oracle validation in `updateClusterBalance` enforces this constraint before committing any EB update. Therefore:
- `vUnits = ceil(effectiveBalance * 10_000 / 32) >= validatorCount * 10_000 = baselineVUnits`
- The invariant `vUnitsCluster >= baselineVUnits` is **always true** for explicit EB tracking

The code comment at line 587 acknowledges this:
```solidity
// Note: EB floor is 32 ETH, so vUnitsCluster >= baselineVUnits always
// But we handle both cases for safety
```

**Scenarios That Could Make This Branch Reachable:**

Under current protocol design and oracle validation, this branch **cannot be reached**. However, the following future changes could make it reachable:

1. **Oracle reports EB < 32 ETH per validator** - If beacon chain rules change (highly unlikely) or oracle validation is removed
2. **Parameter changes** - If `DEFAULT_EB_PER_VALIDATOR` is lowered below 32 ETH
3. **Storage corruption** - If `clusterEB.vUnits` is manipulated outside normal flows
4. **Oracle bugs** - If oracle bypasses validation and commits invalid EB data

**Protocol Team Response:**

✅ **ACKNOWLEDGED - No code changes planned.** The auditor's finding is technically correct, but:

1. **Current invariants prevent execution** - Oracle validation guarantees `vUnitsCluster >= baselineVUnits`
2. **Defensive code intent** - The fallback exists for safety, not expected execution
3. **No risk under current design** - The branch is mathematically unreachable given EB constraints
4. **Code clarity trade-off** - Adding a revert or removing the branch adds complexity for a case that cannot occur

**Auditor's Proposed Solutions (Valid but Not Implemented):**

The auditor suggested two approaches:

**Option 1: Explicit revert**
```solidity
if (vUnitsCluster != baselineVUnits) {
    bool moreThanBaseline = vUnitsCluster > baselineVUnits;

    if (!moreThanBaseline) {
        revert ISSVNetworkCore.EBBelowMinimum();
    }

    uint64 deviation = vUnitsCluster - baselineVUnits;
    // ... only handle above-baseline case
}
```

**Option 2: Skip accounting silently**
```solidity
if (vUnitsCluster > baselineVUnits) {
    uint64 deviation = vUnitsCluster - baselineVUnits;

    sp.daoTotalEthVUnits -= deviation;

    uint256 n = operatorIds.length;
    for (uint256 i; i < n; ++i) {
        seb.operatorEthVUnits[operatorIds[i]] -= deviation;
    }
}
// Sub-baseline: silently skip (should never occur)
```

**Why We Don't Implement These Solutions:**

1. **No value for unreachable code** - Adding reverts or conditionals for mathematically impossible cases adds bytecode without benefit
2. **Gas cost** - Additional checks cost gas on every liquidation for a branch that will never execute
3. **Code clarity** - The current implementation with its comment is self-documenting; the fallback exists "for safety"
4. **Future-proofing trade-off** - If EB rules change drastically enough to allow <32 ETH validators, many other parts of the protocol would need updates anyway

**Monitoring & Future Considerations:**

- [ ] If beacon chain introduces <32 ETH validators (Pectra or later upgrades), revisit this logic
- [ ] If oracle validation is ever relaxed, add explicit guards
- [ ] If storage layout changes affect `clusterEB.vUnits`, verify invariants still hold
- [x] Document this as a known "defensive code" pattern in the codebase

**Acceptance Criteria:**
- [x] Issue acknowledged by protocol team
- [x] Rationale documented in AUDIT-REPORT-TRACKING.md
- [x] Current invariants verified in SPEC.md (minimum 32 ETH per validator)
- [x] Code comment at line 587 clarifies unreachability
- [ ] (Optional) Add integration test that verifies oracle cannot commit EB < 32 ETH per validator
- [ ] (Future) Monitor beacon chain specs for changes to minimum validator EB

**Related Documentation:**
- [SPEC.md §2 "EB Update Constraints"](../docs/SPEC.md#2-effective-balance-accounting) - Enforces minimum 32 ETH per validator
- [SPEC.md §10 "ETH Operator Fee Index"](../docs/SPEC.md#10-accounting-formulas) - Documents deviation-only model for `operatorEthVUnits`
- [SSVClusters.sol:312-330](../../contracts/modules/SSVClusters.sol#L312-L330) - Migration code showing deviation-only accounting pattern

**Status: ACKNOWLEDGED - The audit finding is technically valid (the else branch violates accounting rules), but the code path is mathematically unreachable under current protocol invariants. No code changes planned unless EB constraints change in future beacon chain upgrades.**

---

### [SSV-14] Existing Registration Setup Enables Phantom Operators to Extract Fees and Degrade Cluster Fault Tolerance
No bonding by design.

---

### [SSV-15] Deferred Reward Accounting Exposes Stakers to ETH Price Volatility
- **Type:** Invalid / Execution Order Misunderstanding
- **Severity:** N/A (issue does not exist)
- **Priority:** P3
- **Status:** ❌ Invalid - Based on incorrect execution order analysis
- **Owner:** N/A
- **Timeline:** N/A
- **Github Link:** N/A
- **Files Affected:** [contracts/modules/SSVStaking.sol](contracts/modules/SSVStaking.sol#L114-L145)

**Requirement:**
None - the audit finding is based on a misunderstanding of when `_syncFees()` is called relative to balance changes in `claimEthRewards()`.

**Audit Finding (from external audit report):**
The audit claimed that when `current <= previous` in the `_syncFees` function (line 187), the code lowers the `stakingEthPoolBalance` watermark to `current` without updating `accEthPerShare`. This allegedly defers reward distribution until the pool balance recovers past the previous watermark, exposing stakers to ETH price volatility and permanently losing fees accrued during the recovery period.

The auditor's claimed scenario:
```
1. stakingEthPoolBalance = 100 ETH (watermark)
2. User claims 10 ETH → ethDaoBalance decreases to 90 ETH
3. Next _syncFees() call:
   - current = 90 + 3 (new fees) = 93 ETH
   - previous = 100 ETH
   - current < previous → enters if branch at line 187
   - stakingEthPoolBalance lowered to 93 ETH ← watermark down
   - accEthPerShare NOT updated ← fees lost
4. Later when fees recover:
   - current = 105 ETH, previous = 93 ETH
   - Only 12 ETH distributed, but 15 ETH actually accrued (3 ETH lost)
```

**Why This Issue Does NOT Exist:**

The audit finding misunderstands the **execution order** in `claimEthRewards()`. Looking at [SSVStaking.sol:114-145](contracts/modules/SSVStaking.sol#L114-L145):

```solidity
function claimEthRewards() external nonReentrant {
    StorageStaking storage s = SSVStorageStaking.load();

    _syncFees(s);                    // ← Line 117: _syncFees() called FIRST
    _settle(msg.sender, s);          // ← Line 118: settle user rewards

    uint256 claimable = s.accrued[msg.sender];
    if (claimable == 0) revert NothingToClaim();

    uint256 payout = claimable - (claimable % ETH_DEDUCTED_DIGITS);
    if (payout == 0) {
        revert NothingToClaim();
    }

    PackedETH packedPayout = PackedETHLib.pack(payout);

    StorageProtocol storage sp = SSVStorageProtocol.load();

    if (packedPayout.gt(s.stakingEthPoolBalance)) {
        revert InsufficientBalance();
    }
    if (packedPayout.gt(sp.ethDaoBalance))   {
        revert InsufficientBalance();
    }

    s.accrued[msg.sender] = claimable - payout;
    s.stakingEthPoolBalance = s.stakingEthPoolBalance.sub(packedPayout);  // ← Line 140: decrements AFTER sync
    sp.ethDaoBalance = sp.ethDaoBalance.sub(packedPayout);                 // ← Line 141: decrements AFTER sync

    CoreLib.transferBalance(msg.sender, payout);
    emit RewardsClaimed(msg.sender, payout);
}
```

**Critical Execution Order:**
1. **Line 117:** `_syncFees(s)` runs **BEFORE** any balance changes
   - At this point, `sp.ethDaoBalance` still includes all pending fees
   - `current = networkTotalEarnings()` includes the full balance (before claim payout)
   - If `current > previous`: all pending fees are distributed to `accEthPerShare`
   - `stakingEthPoolBalance` is updated to `current` (raised, not lowered)

2. **Lines 140-141:** Balance decrements happen **AFTER** `_syncFees()` completes
   - `stakingEthPoolBalance` and `ethDaoBalance` are reduced by the payout amount
   - These decrements don't affect the next `_syncFees()` calculation because they establish the new baseline

3. **Next `_syncFees()` call** (from any staking operation):
   - `current = networkTotalEarnings() = (reducedBase) + (newFeesSinceLastSync)`
   - `previous = reducedBase` (the watermark after the claim)
   - `current >= previous` (because fees are monotonically increasing from the new baseline)
   - All new fees since the claim are distributed normally

**Correct Flow Example:**

**Setup:**
- `ethDaoBalance = 100 ETH` (stored)
- `stakingEthPoolBalance = 95 ETH` (watermark from last sync)
- 5 ETH of fees accrued since last sync

**User calls `claimEthRewards()` to claim 10 ETH:**

1. **`_syncFees()` executes (line 117):**
   - `current = networkTotalEarnings() = 100 + 5 = 105 ETH`
   - `previous = 95 ETH`
   - `current (105) > previous (95)` → normal path
   - `accEthPerShare += (10 ETH * 1e18) / totalSupply` ← **all fees distributed**
   - `stakingEthPoolBalance = 105 ETH` ← watermark raised
   - `ethDaoBalance = 105 ETH` ← settled

2. **Balance decrements (lines 140-141):**
   - `stakingEthPoolBalance = 105 - 10 = 95 ETH`
   - `ethDaoBalance = 105 - 10 = 95 ETH`

3. **Next `_syncFees()` call** (from another user's `stake()` or `claimEthRewards()`):
   - `current = networkTotalEarnings() = 95 + 2 (new fees) = 97 ETH`
   - `previous = 95 ETH` (watermark after User A's claim)
   - `current (97) > previous (95)` → normal path
   - `accEthPerShare += (2 ETH * 1e18) / totalSupply` ← **new fees distributed**
   - No fees lost!

**When Does `current <= previous` Actually Occur?**

The `current <= previous` branch at line 187-189 is effectively **unreachable in normal operation** because:

1. **`ethDaoBalance` can only decrease via `claimEthRewards()`** - Verified by grep: no other function decrements `ethDaoBalance`
2. **`claimEthRewards()` always calls `_syncFees()` first** - So all pending fees are distributed before the decrement
3. **`networkTotalEarnings()` adds pending fees to the current `ethDaoBalance`** - Making it monotonically increasing between syncs

The only theoretical way `current < previous` could occur:
- Storage inconsistency or corruption
- Future code changes that decrement `ethDaoBalance` outside `claimEthRewards()`
- Rounding errors (extremely unlikely with packed ETH precision)

In these cases, the watermark-lowering at line 188 is actually **defensive programming** to prevent underflow and ensure `stakingEthPoolBalance <= actual available ETH`.

**Protocol Team Response:**

❌ **INVALID - No code changes required.** The audit finding is based on incorrect analysis of execution order:

1. **Fees are synced before claims** - `_syncFees()` at line 117 precedes balance decrements at lines 140-141
2. **No fees are lost** - All pending fees are distributed to `accEthPerShare` before `ethDaoBalance` is reduced
3. **Watermark tracking is correct** - The next sync uses the post-claim baseline, and all new fees from that baseline are distributed
4. **`current <= previous` is unreachable** - In normal operation, this branch cannot execute because `_syncFees()` is called before any decrement

**Verification:**
- [x] `claimEthRewards()` calls `_syncFees()` at line 117 before any balance changes
- [x] Balance decrements happen at lines 140-141, **after** sync completes
- [x] `ethDaoBalance` can only decrease via `claimEthRewards()` (verified by codebase grep)
- [x] `networkTotalEarnings()` is monotonically increasing between syncs
- [x] No fees are lost in normal claim → sync → claim cycles

**Acceptance Criteria:**
- [x] Verified execution order in `claimEthRewards()`: sync precedes balance changes
- [x] Confirmed `ethDaoBalance` decrements only occur in `claimEthRewards()` after sync
- [x] Traced `networkTotalEarnings()` calculation - adds pending fees to current balance
- [x] Confirmed `current <= previous` branch is unreachable in normal operation
- [ ] (Optional) Add integration test demonstrating no fee loss across multiple claim cycles with varying amounts

**Related Code References:**
- [SSVStaking.sol:114-145](../../contracts/modules/SSVStaking.sol#L114-L145) - `claimEthRewards()` execution order
- [SSVStaking.sol:179-203](../../contracts/modules/SSVStaking.sol#L179-L203) - `_syncFees()` implementation
- [ProtocolLib.sol:85-91](../../contracts/libraries/ProtocolLib.sol#L85-L91) - `networkTotalEarnings()` calculation

**Status: INVALID - The audit finding is based on incorrect execution order analysis. `_syncFees()` is called before balance decrements in `claimEthRewards()`, so no fees are deferred or lost. No code changes needed.**

---

### [SSV-16] Non-Standard ERC20 Tokens Trapped in SSVStaking Contract
Use `SafeERC20` as recommended.

---

### [SSV-17] Stale Cluster Effective Balance Updates
- **Type:** Security / Griefing Attack Vector
- **Severity:** Medium
- **Priority:** P3
- **Status:** ⚠️ Open - Mitigation Required Before Mainnet
- **Effort:** M (Medium)
- **Owner:** (unassigned)
- **Timeline:** Must be resolved before mainnet v2.0.0 deployment
- **Github Link:** (empty)
- **Files Affected:** [contracts/modules/SSVClusters.sol](contracts/modules/SSVClusters.sol#L430-L437), [deployments/params-candidate.json](deployments/params-candidate.json#L10)

**Requirement:**
Prevent attackers from exploiting stale Merkle roots to delay effective balance (EB) updates when `minBlocksBetweenUpdates > 0`, enabling sustained fee underpayment or liquidation griefing.

**Audit Finding Summary:**

The protocol's `updateClusterBalance` function allows anyone to update a cluster's effective balance using **any committed Merkle root**, as long as it's newer than the cluster's last update (`lastRootBlockNum`). When combined with `minBlocksBetweenUpdates > 0`, this creates a griefing attack:

1. Attacker monitors oracle commits and identifies clusters with increasing EB
2. When EB increases (e.g., 120 ETH → 200 ETH at block 1,223,200), attacker uses an **old but valid root** (e.g., from 30 days ago showing 120 ETH)
3. This triggers the cooldown period, blocking honest updates for `minBlocksBetweenUpdates` blocks
4. Attacker repeats with the next stale root once cooldown expires
5. Cluster pays lower fees than owed, potentially avoiding liquidation

**Attack Scenario (from audit report):**

```
Block 1,000,000: Cluster created with EB = 120 ETH
Block 1,007,200: Oracle commits root R1 (EB = 120 ETH) ✅ valid
Block 1,014,400: Oracle commits root R2 (EB = 120 ETH) ✅ valid
...
Block 1,223,200: EB increases to 200 ETH, oracle commits root R50 (EB = 200 ETH) ✅ valid

Block 1,223,205: Attacker calls updateClusterBalance with R1 (30 days old, EB = 120 ETH)
  → ebSnapshot.lastRootBlockNum = 1,007,200
  → ebSnapshot.lastUpdateBlock = 1,223,205
  → Cluster locked to stale EB for next 7,200 blocks (~1 day)

Block 1,230,406: Cooldown expires, attacker uses R2 (EB = 120 ETH)
  → Cluster still at stale EB, locked for another 7,200 blocks

Result: Cluster underpays fees on 200 ETH for ~30 days
```

**Current Mitigation Status:**

The protocol has **two defense layers** against this attack:

1. **`_verifyEBStaleness()` ([SSVClusters.sol:439-444](contracts/modules/SSVClusters.sol#L439-L444)):**
   - Enforces monotonic progression: `proof.blockNumber > cluster.lastRootBlockNum`
   - Prevents using the **same** stale root twice
   - ✅ **Prevents regression** to older roots than already used
   - ❌ **Does NOT prevent** using any old root that's newer than the last update

2. **`_verifyEBUpdateFrequency()` ([SSVClusters.sol:430-437](contracts/modules/SSVClusters.sol#L430-L437)):**
   - Rate limits updates: `block.number >= lastUpdateBlock + minBlocksBetweenUpdates`
   - ⚠️ **Creates the vulnerability** when set > 0 (locks out honest corrections)
   - ✅ **Eliminates the vulnerability** when set to 0 (allows immediate correction)

**Current Deployment Parameters:**

From [deployments/params-candidate.json](deployments/params-candidate.json):
```json
{
  "minBlocksBetweenUpdates": 7200
}
```

⚠️ **This value makes the attack viable** — 7,200 blocks ≈ 24 hours delay between updates.

**Why Setting `minBlocksBetweenUpdates = 0` Solves the Issue:**

When `minBlocksBetweenUpdates = 0`, the attack becomes **economically irrational**:

```
Block 1,223,205: Attacker updates with stale root R1 (EB = 120 ETH)
  → Pays gas (~150k gas ≈ $5+ at typical prices)
  → ebSnapshot.lastRootBlockNum = 1,007,200

Block 1,223,206: Honest user immediately corrects with latest root R50 (EB = 200 ETH)
  → Check: 1,223,200 > 1,007,200 ✅ Passes (_verifyEBStaleness)
  → Check: block.number >= 1,223,205 + 0 ✅ Passes (_verifyEBUpdateFrequency)
  → Cluster corrected

Result: Attacker loses gas, gains ~0 ETH (1 block of fee underpayment ≈ negligible)
```

**Duration of underpayment: 1 block (~12 seconds)**

**Residual Risk: The "First Update" Race**

Even with `minBlocksBetweenUpdates = 0`, a **narrow edge case** remains:

**Scenario: Cluster Never Updated Before**

```
Block 1,000,000-1,223,199: Cluster exists with implicit EB (32 ETH baseline)
  → ebSnapshot.lastRootBlockNum = 0 (never explicitly updated)
  → No incentive to call updateClusterBalance (EB hasn't changed)

Block 1,223,200: Oracle commits root showing EB = 200 ETH (validator recovered from slashing)

Block 1,223,205: Race between two transactions:
  TX1 (Attacker): updateClusterBalance(clusterId, 1,007,200, old_proof_120_ETH)
  TX2 (Honest):   updateClusterBalance(clusterId, 1,223,200, new_proof_200_ETH)

If TX1 executes first:
  → ebSnapshot.lastRootBlockNum = 1,007,200
  → ebSnapshot.vUnits = 37,500 (120 ETH)

Then TX2 executes immediately after:
  → Check: 1,223,200 > 1,007,200 ✅ Passes
  → Check: block.number >= lastUpdateBlock + 0 ✅ Passes
  → Cluster corrected to 200 ETH

Impact: 1 block of underpayment (~12 seconds)
```

**This residual risk is negligible because:**
- Duration: Maximum 1 block (12 seconds)
- Economic impact: `(80 ETH delta) * operator_fee * 1 block ≈ 0.0000002 ETH`
- Attack cost: ~150k gas (~$5+ at typical gas prices)
- **Not economically rational** — attacker loses money

**Recommended Solutions:**

**Option 1: Require Latest Root Only ✅**

**Status: CHOSEN - Required for Mainnet v2.0.0**

**Implementation:** Enforce that all `updateClusterBalance` calls must use the latest committed root (`seb.latestCommittedBlock`).

```solidity
function _verifyEBStaleness(UpdateCtx memory ctx, bytes32 clusterId, StorageEB storage seb) internal view {
    // NEW: Must use the latest committed root
    if (ctx.blockNum != seb.latestCommittedBlock) {
        revert MustUseLatestRoot();
    }

    // Existing monotonic check (now redundant but kept for defense-in-depth)
    ClusterEBSnapshot storage ebSnapshot = seb.clusterEB[clusterId];
    if (ebSnapshot.lastRootBlockNum != 0 && ctx.blockNum <= ebSnapshot.lastRootBlockNum) {
        revert StaleUpdate();
    }
}
```

**Pros:**
- ✅ **Completely eliminates SSV-17** (no stale roots possible)
- ✅ Eliminates first-update race entirely
- ✅ Simple conceptual model - only one valid root at any time
- ✅ Clear security boundary - no ambiguity about which root is valid

**Cons:**
- ⚠️ **Transaction may revert if new root is committed during pending tx** — if a new root is committed while user's transaction is in the mempool, the transaction will revert
- ⚠️ Users must re-fetch proofs after oracle commits (every ~3-4 hours with 3x/day oracle frequency)
- ⚠️ Front-end must handle reverts gracefully and retry with latest root

**Mitigation for UX Friction:**
1. **Oracle API provides `latestCommittedBlock`** - users can verify proof freshness before submitting
2. **Front-end retry logic** - if tx reverts with `MustUseLatestRoot()`, automatically re-fetch proof and retry
3. **Grace period of ~3-4 hours** - oracles commit 3x/day, giving users predictable update windows
4. **Monitoring alerts** - off-chain services can proactively update clusters before users notice

**Verdict:** ✅ **Chosen for mainnet v2.0.0** — Security priority over convenience. The UX friction is acceptable given:
- Oracles commit only 3x/day (~8 hour intervals)
- Most clusters won't need frequent EB updates (EB changes slowly on beacon chain)
- Automated systems (liquidators, monitoring bots) can handle retry logic
- Front-end can implement seamless retry flow

---

**Alternative Options Considered (Not Chosen):**

**Option 2: Set `minBlocksBetweenUpdates = 0` Only**

```json
// deployments/params-candidate.json
{
  "minBlocksBetweenUpdates": 0
}
```

**Pros:**
- ✅ Eliminates sustained exploitation (allows immediate correction)
- ✅ No code changes needed
- ✅ Self-correcting within 1 block

**Cons:**
- ❌ **Does NOT eliminate the attack** — only limits duration to 1 block
- ❌ First-update race still possible (attacker can use 30-day-old root)
- ❌ Relies on honest actors to correct stale updates
- ❌ Allows event spam (cluster owners can call every block)

**Why Not Chosen:** Does not fully eliminate the vulnerability, only reduces impact. Option 1 provides complete protection.

---

**Option 3: Freshness Window for First Update Only**

```solidity
function _verifyEBStaleness(UpdateCtx memory ctx, bytes32 clusterId, StorageEB storage seb) internal view {
    ClusterEBSnapshot storage ebSnapshot = seb.clusterEB[clusterId];

    // Existing monotonic check
    if (ebSnapshot.lastRootBlockNum != 0 && ctx.blockNum <= ebSnapshot.lastRootBlockNum) {
        revert StaleUpdate();
    }

    // NEW: First update must use recent root (within 1 day)
    if (ebSnapshot.lastRootBlockNum == 0) {
        uint64 freshnessWindow = 7200; // ~1 day at 12s/block
        if (seb.latestCommittedBlock > ctx.blockNum + freshnessWindow) {
            revert FirstUpdateMustBeFresh();
        }
    }
}
```

**Pros:**
- ✅ Prevents first-update race with very stale roots (>1 day old)
- ✅ Only affects first update (no ongoing UX impact)

**Cons:**
- ❌ **Does NOT prevent recent stale roots** — attacker can still use 23-hour-old root
- ❌ Adds complexity
- ❌ Requires arbitrary tuning of `freshnessWindow`

**Why Not Chosen:** Incomplete protection (recent stale roots still work). Option 1 provides stronger guarantees.

---

**Option 4: Root Expiration (7 Days)**

```solidity
struct RootMetadata {
    bytes32 root;
    uint64 commitTimestamp; // block.number when committed
}

mapping(uint64 => RootMetadata) ebRootData;
uint64 constant ROOT_EXPIRATION_BLOCKS = 50400; // ~7 days

function _verifyEBRoots(UpdateCtx memory ctx, StorageEB storage seb) internal view {
    RootMetadata storage rootData = seb.ebRootData[ctx.blockNum];
    if (rootData.root == bytes32(0)) {
        revert RootNotFound();
    }

    // Root must have been committed within last 7 days
    if (block.number > rootData.commitTimestamp + ROOT_EXPIRATION_BLOCKS) {
        revert RootExpired();
    }
}
```

**Pros:**
- ✅ Prevents ancient stale roots (>7 days old)
- ✅ Allows flexibility for users (any root within 7 days)

**Cons:**
- ❌ **Does NOT prevent recent stale roots** — 6-day-old root still valid
- ❌ Requires storage upgrade (add `RootMetadata` struct)
- ❌ Extra storage write on every `commitRoot`

**Why Not Chosen:** Incomplete protection (recent stale roots still work). Option 1 provides stronger guarantees with simpler implementation.

---

**Monitoring & Off-Chain Mitigation:**

With Option 1 (require latest root only), add off-chain monitoring for:

```python
# Alert if Oracle API serves stale proofs
oracle_latest_block = oracle_api.get_latest_committed_block()
proof = oracle_api.get_proof(cluster_id)

if proof.blockNumber != oracle_latest_block:
    alert("Oracle API serving stale proof", cluster_id, proof.blockNumber, oracle_latest_block)
```

This helps detect:
- Oracle API caching issues
- Stale proof serving bugs
- Potential Oracle infrastructure problems

---

**Acceptance Criteria:**

- [x] **Decision made:** Option 1 (Require Latest Root Only) chosen
- [ ] Implement latest root enforcement in `_verifyEBStaleness()` function
- [ ] Add `MustUseLatestRoot()` error to interfaces
- [ ] Update `params-candidate.json` to `"minBlocksBetweenUpdates": 0` (defense-in-depth)
- [ ] Document decision rationale in SPEC.md §4 "Effective Balance Oracle"
- [ ] Update front-end to check `latestCommittedBlock` before submitting transactions
- [ ] Implement front-end retry logic for `MustUseLatestRoot()` reverts
- [ ] Update Oracle API documentation to emphasize importance of serving latest proofs
- [ ] Test: Verify stale root reverts with `MustUseLatestRoot()`
- [ ] Test: Verify only latest root is accepted
- [ ] Test: Verify first-update race is prevented
- [ ] Deploy before mainnet v2.0.0

---

**Agent Instructions (Implementing Option 1 - CHOSEN):**

**Task 1: Update Contract Code**

1. Edit [contracts/modules/SSVClusters.sol](contracts/modules/SSVClusters.sol):

   a. Update `_verifyEBStaleness()` function (line 439-444):
   ```solidity
   function _verifyEBStaleness(UpdateCtx memory ctx, bytes32 clusterId, StorageEB storage seb) internal view {
       // NEW: Must use the latest committed root
       if (ctx.blockNum != seb.latestCommittedBlock) {
           revert MustUseLatestRoot();
       }

       // Existing monotonic check (defense-in-depth)
       ClusterEBSnapshot storage ebSnapshot = seb.clusterEB[clusterId];
       if (ebSnapshot.lastRootBlockNum != 0 && ctx.blockNum <= ebSnapshot.lastRootBlockNum) {
           revert StaleUpdate();
       }
   }
   ```

2. Add `MustUseLatestRoot()` error to [contracts/interfaces/ISSVClusters.sol](contracts/interfaces/ISSVClusters.sol):
   ```solidity
   /// @notice Thrown when attempting to update cluster EB with a non-latest root
   error MustUseLatestRoot();
   ```

**Task 2: Update Deployment Parameters (Defense-in-Depth)**

3. Edit [deployments/params-candidate.json](deployments/params-candidate.json):
   ```json
   {
     "minBlocksBetweenUpdates": 0
   }
   ```

   *(This provides additional protection in case the latest-root check is bypassed)*

**Task 3: Update Documentation**

4. Update [docs/SPEC.md](docs/SPEC.md) in §4 "Effective Balance Oracle" → "updateClusterBalance":

   Add new subsection:

   > **Stale Root Prevention (SSV-17 Mitigation)**
   >
   > To prevent attackers from using old Merkle roots to delay effective balance updates and underpay fees, `updateClusterBalance` enforces that only the **latest committed root** (`latestCommittedBlock`) can be used.
   >
   > **Check:** `_verifyEBStaleness()` verifies `proof.blockNumber == latestCommittedBlock`
   >
   > **Consequence:** If a new root is committed while a user's transaction is pending, the transaction will revert with `MustUseLatestRoot()`. Users must re-fetch the proof and resubmit.
   >
   > **UX Impact:** Oracles commit roots 3x/day (~8 hour intervals). Proofs remain valid for this window. Front-ends should implement retry logic.
   >
   > **Rationale:** Complete elimination of SSV-17 vulnerability (stale root exploitation) takes priority over occasional transaction reverts. The monotonic check (`lastRootBlockNum` progression) provides defense-in-depth but does not prevent using old roots newer than the last update.

**Task 4: Add Tests**

5. Add test in [test/integration/SSVNetwork/clusters.test.ts](test/integration/SSVNetwork/clusters.test.ts):

   ```typescript
   describe("SSV-17 Mitigation: Latest Root Only", () => {
     it("reverts when using stale root (not latest)", async () => {
       // Setup: Create cluster, commit two roots
       await commitRoot(blockNum1, merkleRoot1); // First root
       await commitRoot(blockNum2, merkleRoot2); // Second root (now latest)

       // Try to update with first root (stale)
       await expect(
         ssvNetwork.updateClusterBalance(
           clusterId,
           blockNum1, // Stale root
           merkleProof1,
           effectiveBalance,
           operatorIds,
           cluster
         )
       ).to.be.revertedWithCustomError(ssvNetwork, "MustUseLatestRoot");
     });

     it("accepts only the latest committed root", async () => {
       // Setup: Commit roots at blocks 1000, 2000, 3000
       await commitRoot(1000, root1);
       await commitRoot(2000, root2);
       await commitRoot(3000, root3); // Latest

       // Only latest root (3000) should work
       await expect(
         ssvNetwork.updateClusterBalance(clusterId, 1000, proof1, ...)
       ).to.be.revertedWithCustomError(ssvNetwork, "MustUseLatestRoot");

       await expect(
         ssvNetwork.updateClusterBalance(clusterId, 2000, proof2, ...)
       ).to.be.revertedWithCustomError(ssvNetwork, "MustUseLatestRoot");

       // Latest root succeeds
       await ssvNetwork.updateClusterBalance(clusterId, 3000, proof3, ...);

       // Verify EB updated correctly
       const snapshot = await ssvViews.getClusterEBSnapshot(clusterId);
       expect(snapshot.lastRootBlockNum).to.equal(3000);
     });

     it("prevents first-update race with stale roots", async () => {
       // Setup: Cluster never updated, EB was 120 ETH for 30 days
       // Oracle committed roots at 1000, 2000, ..., 30000
       // Latest root (30000) shows EB = 200 ETH (recovered from slashing)

       await commitRoot(30000, rootLatest);

       // Attacker tries to use 30-day-old root (1000) showing EB = 120 ETH
       await expect(
         ssvNetwork.updateClusterBalance(clusterId, 1000, proofOld, 120_ETH, ...)
       ).to.be.revertedWithCustomError(ssvNetwork, "MustUseLatestRoot");

       // Only latest root works
       await ssvNetwork.updateClusterBalance(clusterId, 30000, proofLatest, 200_ETH, ...);

       // Verify cluster at correct EB
       const snapshot = await ssvViews.getClusterEBSnapshot(clusterId);
       expect(snapshot.vUnits).to.equal(62_500); // 200 ETH
     });
   });
   ```

6. Run tests:
   ```bash
   npx hardhat test test/integration/SSVNetwork/clusters.test.ts --grep "SSV-17"
   ```

**Task 5: Update Oracle Documentation**

7. If Oracle API documentation exists, add note:

   > **Critical:** The `getProof(clusterId)` endpoint MUST always return proofs from the latest committed root (`latestCommittedBlock`). Serving stale cached proofs will cause all `updateClusterBalance` transactions to revert with `MustUseLatestRoot()`.

---

**Status Summary:**

- ⚠️ **OPEN - Code Changes Required** — Current implementation allows stale root exploitation
- 🎯 **Solution Chosen:** Enforce latest root only (`ctx.blockNum == seb.latestCommittedBlock`)
- ✅ **Defense-in-Depth:** Also set `minBlocksBetweenUpdates = 0` in deployment params
- 📋 **Next Steps:** Implement code changes per Agent Instructions above
- ⏰ **Timeline:** Must be deployed before mainnet v2.0.0

**Key Changes Required:**
1. Add latest root check to `_verifyEBStaleness()` in SSVClusters.sol
2. Add `MustUseLatestRoot()` error to ISSVClusters.sol
3. Set `minBlocksBetweenUpdates = 0` in params-candidate.json
4. Add comprehensive tests for stale root rejection
5. Update SPEC.md documentation

**Impact:** Complete elimination of SSV-17 vulnerability with acceptable UX trade-off (transaction reverts during oracle commits handled by retry logic).

---
# SSV-10: ETH Cluster Insolvency Risk - Detailed Analysis

**Status:** ✅ VALIDATED - Auditor concern is VALID
**Severity:** MEDIUM
**Priority:** P2 (Security Enhancement)
**Recommended for:** v2.0.0 mainnet deployment

---

## Executive Summary

The auditor identified a valid ETH-accounting insolvency risk with two coupled effects:

1. **Liquidation bypass race:** when a cluster is liquidatable, owner can front-run with `removeValidator` in the same block, causing the queued liquidation tx to revert on stale cluster state.
2. **Shared-pool insolvency:** on underfunded removal, settled fees are credited in accounting (operators + network earnings), while cluster payment is capped at zero-floor balance, creating an unbacked gap pulled from shared protocol ETH.

This is a **regression** from legacy SSV-payment clusters due to shared ETH accounting.

**Auditor Quote:**
> "Once the cluster is below the runway and has not been liquidated (unlikely), the cluster owner can avoid liquidation by removing themselves. In the worst-case scenario, it allows removing validators from the protocol (which is fine), even if the cluster's balance is insufficient to pay the operators. But my concern is that it sets the cluster balance to zero if usage exceeds the current balance during withdrawal, which starts putting the protocol into insolvency which is a problem because rewards are also ETH so now you have a mixing of funds."

---

## Technical Analysis

### Root Cause

**Location:** [contracts/modules/SSVValidators.sol:192-207](../../contracts/modules/SSVValidators.sol#L192-L207)

**Execution Order in `_bulkRemoveValidator` (ETH version):**

```solidity
if (version == VERSION_ETH) {
    if (cluster.active) {
        // STEP 1: Credit operator earnings (line 196-202)
        (uint64 clusterIndex, ) = OperatorLib.updateClusterOperators(
            operatorIds, false, validatorsRemoved, s, sp
        );

        // STEP 2: Deduct fees from cluster, cap at 0 (line 204)
        cluster.updateClusterData(hashedCluster, clusterIndex, sp.currentNetworkFeeIndex());
    }
}
```

**The Critical Flaw:**

1. **`updateClusterOperators()`** ([OperatorLib.sol:254-283](../../contracts/libraries/OperatorLib.sol#L254-L283)) calls **`updateSnapshotSt()`** ([OperatorLib.sol:53-73](../../contracts/libraries/OperatorLib.sol#L53-L73)) which credits operator earnings:
   ```solidity
   // Line 70: Operator earnings CREDITED
   operator.ethSnapshot.balance += fees_earned  // FULL fees: time × rate × vUnits
   ```

2. **`updateClusterData()`** ([ClusterLib.sol:156-165](../../contracts/libraries/ClusterLib.sol#L156-L165)) -> **`updateBalanceWithEB()`** ([ClusterLib.sol:306-321](../../contracts/libraries/ClusterLib.sol#L306-L321)) deducts fees from cluster:
   ```solidity
   // Line 320: Cluster balance CAPPED AT ZERO
   cluster.balance = usage > cluster.balance ? 0 : cluster.balance - usage;
   ```

3. `updateBalanceWithEB()` includes network-fee usage units as well, so the accounting settled at removal is:
   - operator earnings delta
   - DAO/network earnings delta
   - both against a cluster balance that can floor to zero

**Result:** if total settled usage exceeds `cluster.balance`, the gap is unbacked and later paid from shared protocol ETH.

---

## Attack Scenario

### Concrete Exploit (Reproduced)

```
Initial State:
  Cluster is liquidatable
  Liquidator has a valid tx using current cluster snapshot

Block N:
  Liquidator submits liquidate(cluster_snapshot_t0)

Block N (same block, higher gas priority):
  Owner front-runs with removeValidator(cluster_snapshot_t0)

  Execution:
  1. updateClusterOperators() updates operator snapshots/credits
  2. updateClusterData() settles usage and caps cluster.balance at 0
  3. Validators removed, cluster.validatorCount = 0 ✅

Block N (later tx position):
  Queued liquidate(cluster_snapshot_t0) reverts with IncorrectClusterState
  (snapshot no longer matches stored cluster hash)

Block N+1:
  liquidate(cluster_snapshot_t1_after_remove) reverts with ClusterNotLiquidatable
  (validatorCount == 0)

Then:
  Operators withdraw credited earnings from shared protocol ETH pool
  Gap is paid by ETH deposited by other protocol users/clusters
```

### Economic Analysis (Reproduced Two-Cluster Case)

From `test/sanity/ssv-10-liquidatable-attack.test.ts` two-cluster run:

```
Attacker cluster deposit:                    10.0 ETH
Settled fees at remove (ops + DAO):         16.04183884712 ETH
Paid by attacker cluster (capped):          10.0 ETH
Missing payment gap:                         6.04183884712 ETH

Withdrawn by attacker operators:            16.002140715 ETH
Extracted beyond attacker payment source:    6.002140715 ETH
```

This demonstrates real extraction from shared pool funds that are not sourced by attacker cluster payment.

---

## Why This Is Critical for ETH Clusters (Regression Analysis)

### Shared ETH Pool Structure

```
┌─────────────────────────────────────────────┐
│   SSVNetwork Contract ETH Balance          │
├─────────────────────────────────────────────┤
│  1. Cluster deposits (payable functions)    │  ← Validator operational fees
│  2. Staking deposits (SSVStaking.stake())   │  ← SSV holders' ETH rewards pool
│  3. Operator withdrawals (pull from above)  │  ← Can overdraw if clusters insolvent
│  4. Staking claims (pull from above)        │  ← Can fail if operators overdrew
└─────────────────────────────────────────────┘
         ↑                                ↑
         └────────── SAME ETH POOL ───────┘
```

### Comparison to Legacy SSV-Payment Clusters

| Aspect | SSV Clusters (Legacy) | ETH Clusters (Current) |
|--------|----------------------|------------------------|
| **Operator fees** | SSV tokens | ETH |
| **Staking rewards** | ETH | ETH |
| **Pool separation** | ✅ Separate (SSV ≠ ETH) | ❌ **SHARED** (ETH = ETH) |
| **Insolvency risk** | ✅ LOW (isolated) | ❌ **HIGH** (contamination) |
| **Issue severity** | LOW | **MEDIUM** |

**Verdict:** ✅ SSV clusters had **isolated accounting** (SSV tokens for fees, ETH for staking rewards)
❌ ETH clusters have **shared accounting** (ETH for both fees and rewards)
❌ This is a **REGRESSION** - the old issue resurfaced but **worse**

---

## Invariant Violation

```
Expected: (operator_credits + network_earnings_credits) <= cluster_fees_paid
Actual:   (operator_credits + network_earnings_credits) >  cluster_fees_paid  (when balance capped at 0)
```

This violates protocol solvency:
```
INVARIANT (should hold but can be violated):
  address(SSVNetwork).balance >=
    Σ(operator.ethSnapshot.balance for all operators) +
    Σ(network earnings payable) +
    Σ(pending staking reward claims)
```

---

## Severity Assessment: MEDIUM

### Not CRITICAL because:
- Attack requires precise timing (race condition with liquidator bots)
- Economic incentive depends on operator ownership/control and fee profile
- Liquidation threshold provides ~7 days runway (small exploitable window)
- Total unbacked debt is bounded by individual cluster size

### Not LOW because:
- Protocol-level insolvency IS possible (confirmed in code analysis)
- Same ETH balance backs both operator earnings and staking rewards
- No separation of concerns between cluster fee payments and staking pool
- Can accumulate across multiple malicious clusters
- Reproduced extraction exceeds attacker cluster payment source

---

## Proposed Solution: Option 1 (Solvency Check Before Removal) — RECOMMENDED

### Implementation

**Fix:** Add solvency check BEFORE crediting operators in `_bulkRemoveValidator`

**Location:** [contracts/modules/SSVValidators.sol:192](../../contracts/modules/SSVValidators.sol#L192)

```solidity
if (version == VERSION_ETH) {
    if (cluster.active) {
        StorageProtocol storage sp = SSVStorageProtocol.load();

        // NEW: Pre-compute fees before updating operators
        uint64 currentNetworkFeeIndex = sp.currentNetworkFeeIndex();
        uint64 vUnits = ClusterLib.getVUnits(hashedCluster, cluster.validatorCount);

        // Compute cumulative operator fees
        uint64 cumulativeOperatorIndex = 0;
        for (uint256 i = 0; i < operatorIds.length; ++i) {
            Operator storage operator = s.operators[operatorIds[i]];
            if (operator.ethSnapshot.block != 0) {
                cumulativeOperatorIndex += operator.ethSnapshot.index;
            }
        }

        // Calculate total fees due
        uint128 idxNet = currentNetworkFeeIndex - cluster.networkFeeIndex;
        uint128 idxOp = cumulativeOperatorIndex - cluster.index;
        uint128 networkFeeUnits = (idxNet * vUnits) / VUNITS_PRECISION;
        uint128 usageUnits = (idxOp * vUnits) / VUNITS_PRECISION + networkFeeUnits;
        uint256 totalFeesDue = uint256(usageUnits) * ETH_DEDUCTED_DIGITS;

        // NEW: Check if cluster can pay fees
        if (totalFeesDue > cluster.balance) {
            revert ISSVNetworkCore.InsufficientBalance();  // Force liquidation instead
        }

        // EXISTING: Now safe to credit operators
        (uint64 clusterIndex, ) = OperatorLib.updateClusterOperators(
            operatorIds, false, validatorsRemoved, s, sp
        );
        cluster.updateClusterData(hashedCluster, clusterIndex, currentNetworkFeeIndex);
        sp.updateDAO(false, validatorsRemoved);
    }
}
```

### Rationale

- ✅ **Minimal code change** - Single check before operator update
- ✅ **Preserves invariants** - No unbacked debt possible
- ✅ **Aligns with design** - Liquidation is the intended path for underfunded clusters
- ✅ **Backward compatible** - No storage changes, no event signature changes
- ✅ **Protects staking pool** - Eliminates cross-contamination risk

### Trade-off Accepted

Cluster owners cannot exit gracefully when underfunded, but this is **correct by design**. They should have maintained sufficient balance or been liquidated. This enforces the protocol's economic model.

---

## Alternative Solutions Considered (Not Recommended)

### Option 2: Pro-Rata Operator Payment

```solidity
// Credit operators proportionally to available balance
if (totalFeesDue > clusterBalance) {
    operatorEarnings = (operatorEarnings * clusterBalance) / totalFeesDue;
}
```

**Pros:** Allows graceful exit
**Cons:**
- Complex state passing required
- Violates operator fee agreements
- Opens griefing vectors (intentional underfunding to reduce fees)

❌ **Not recommended**

### Option 3: Separate ETH Accounting (Ideal but Major Refactor)

```solidity
struct ProtocolBalances {
    uint256 clusterOperationalETH;  // Sum of cluster.balance
    uint256 stakingRewardsETH;      // ETH from syncFees()
}
```

**Pros:** Complete insolvency protection, clear separation
**Cons:**
- Major refactor of payment flows
- Storage migration complexity
- Not feasible for v2.0.0 timeline

❌ **Not feasible for current release**

---

## Documentation Gaps

### FLOWS.md §1.3 Missing Security Note

**Current:** "Cluster balance reflects settled fees"

**Missing:** Documentation that balance is capped at 0, potentially creating unbacked debt

**Recommended Addition:**
```markdown
#### Security Note: Underfunded Removal Risk (SSV-10)

If cluster balance < fees owed, validator removal:
- Credits operators for FULL fees owed (based on block difference × fee rate × vUnits)
- Credits network earnings via index updates
- Deducts only AVAILABLE balance from cluster (caps at 0)
- Creates unbacked debt: (operator + network earnings credits) > cluster payment

⚠️ This can lead to protocol insolvency as withdrawals draw from
shared ETH pool (mixing cluster operational funds with staking/reward funds).

**Mitigation (v2.0.0):** Validator removal reverts with `InsufficientBalance`
if cluster balance < fees owed. Clusters MUST maintain balance > liquidation
threshold. Liquidation is the intended path for underfunded clusters.
```

### SPEC.md Missing Solvency Invariant

**Recommended Addition:**
```markdown
### Solvency Invariant (Critical)

INVARIANT: Protocol ETH solvency
  address(SSVNetwork).balance >=
    Σ(operator.ethSnapshot.balance for all operators) +
    Σ(network earnings payable) +
    Σ(pending staking reward claims)

VIOLATION RISK: If clusters remove validators when balance < fees_owed,
credits can exceed cluster payment, drawing from shared ETH pool.

ENFORCEMENT: v2.0.0 adds pre-removal solvency check - validator removal
reverts if cluster balance < total fees due.
```

---

## Acceptance Criteria

- [ ] Implement solvency check in `_bulkRemoveValidator()` before `updateClusterOperators()`
- [ ] Add deterministic same-block race test: liquidate tx stale-state revert + next-block `ClusterNotLiquidatable`
- [ ] Add comprehensive test: Remove validator when balance < fees → reverts with `InsufficientBalance`
- [ ] Add test: Remove validator when balance >= fees → succeeds
- [ ] Add two-cluster extraction test: attacker withdrawals exceed attacker cluster payment source
- [ ] Update FLOWS.md §1.3 and §1.4 with security note
- [ ] Update SPEC.md §4 with solvency invariant documentation
- [ ] Verify no regression in existing validator removal tests
- [ ] Deploy before mainnet v2.0.0

---

## Conclusion

| Aspect | Assessment |
|--------|------------|
| **Validity** | ✅ VALID - Auditor concern is accurate |
| **Severity** | ⚠️ MEDIUM - Reproduced insolvency path, but bounded and timing/ownership constrained |
| **Root Cause** | Credits/accounting settled before zero-floor payment cap can absorb all usage |
| **Insolvency Risk** | YES - Shared ETH pool enables cross-contamination |
| **Regression** | YES - Worse than SSV clusters due to ETH mixing |
| **Fix Complexity** | LOW - Single check before operator update |
| **Recommended Action** | Implement Option 1: Solvency check before removal |

**Mainnet Readiness Impact:** Should be addressed before launch to prevent protocol insolvency accumulation over time.

---

**Files Affected:**
- [contracts/modules/SSVValidators.sol:192-207](../../contracts/modules/SSVValidators.sol#L192-L207)
- [contracts/libraries/ClusterLib.sol:306-321](../../contracts/libraries/ClusterLib.sol#L306-L321)
- [contracts/libraries/OperatorLib.sol:53-73](../../contracts/libraries/OperatorLib.sol#L53-L73)
- [contracts/modules/SSVClusters.sol:35-64](../../contracts/modules/SSVClusters.sol#L35-L64)
- [test/sanity/ssv-10-liquidatable-attack.test.ts](../../test/sanity/ssv-10-liquidatable-attack.test.ts)

**Generated:** 2026-03-09
**Analysis by:** SSV Bug Fixer Agent

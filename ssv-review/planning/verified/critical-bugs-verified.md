# Verified Security Findings — SSV Network v2.0.0

Verified against current code on branch `verify/critical-bugs` (commit `6a19659`).

---

## Critical Bugs

### 1. `ensureETHDefaults` overwritten by stale memory copy — **STILL OPEN**

**File:** `contracts/libraries/OperatorLib.sol:162-240` (`updateClusterOperatorsOnRegistration`)

**Evidence:** In `updateClusterOperatorsOnRegistration`, line 185 loads the operator into **memory**:
```solidity
ISSVNetworkCore.Operator memory operator = s.operators[operatorId]; // line 185
```

Then line 201 calls `ensureETHDefaults` on the **storage** reference:
```solidity
ensureETHDefaults(s.operators[operatorId]); // line 201
```

This correctly writes to storage. However, the memory copy `operator` was taken BEFORE `ensureETHDefaults` ran. The subsequent code at lines 232-239 uses the stale memory copy and then writes it back to storage at line 239:
```solidity
updateSnapshot(operator, operatorId);        // line 232 — uses stale memory
operator.ethValidatorCount += deltaValidatorCount; // line 233
cumulativeFee += PackedETH.unwrap(operator.ethFee); // line 236 — reads stale ethFee (could be 0)
s.operators[operatorId] = operator;          // line 239 — OVERWRITES storage
```

**Impact:** For a pre-v2 operator that never had ETH fields initialized:
- `ensureETHDefaults` correctly sets `ethSnapshot.block` and `ethFee` in storage (line 201)
- But then `s.operators[operatorId] = operator` (line 239) overwrites storage with the stale memory copy where `ethFee == 0` and `ethSnapshot.block == 0`
- The operator ends up with `ethFee = 0`, meaning they earn zero ETH fees
- `cumulativeFee` (line 236) reads the stale zero fee, so cluster liquidation checks use incorrect burn rate

**Severity:** CRITICAL — operators silently get zero ETH fees, and cluster liquidation thresholds are wrong.

---

### 2. Double deviation cleanup blocks validator removal from liquidated clusters — **PARTIALLY FIXED / STILL OPEN (different variant)**

**File:** `contracts/modules/SSVValidators.sol:164-247` (`_bulkRemoveValidator`)

**Evidence:** At line 194, when a cluster is liquidated (`!cluster.active`), the code skips the operator update path entirely:
```solidity
if (cluster.active) { // line 194
    StorageProtocol storage sp = SSVStorageProtocol.load();
    (uint64 clusterIndex, ) = OperatorLib.updateClusterOperators(
        operatorIds, false, validatorsRemoved, s, sp
    );
    cluster.updateClusterData(hashedCluster, clusterIndex, sp.currentNetworkFeeIndex());
    sp.updateDAO(false, validatorsRemoved);
}
```

For liquidated clusters, the operator `ethValidatorCount` is never decremented when validators are removed. However, looking at `updateClusterOperators` (OperatorLib.sol:253-282), it checks `operator.ethSnapshot.block != 0` before decrementing, which handles removed operators correctly.

The deviation cleanup block at lines 211-240 does handle the case correctly for active clusters. For liquidated clusters, deviation was already cleaned up during liquidation (SSVClusters.sol:566-598). However there's a subtle issue:

**Actual issue:** When removing validators from a **liquidated** ETH cluster, `sp.updateDAO(false, validatorsRemoved)` is NOT called (skipped by the `if (cluster.active)` guard). This means `ethDaoValidatorCount` and `daoTotalEthVUnits` are not decremented. These were already decremented during liquidation (via `_executeLiquidation` → `sp.updateDAO(false, cluster.validatorCount)`), so this is actually correct — the DAO counts were already adjusted.

But the operator `ethValidatorCount` is NOT decremented for liquidated clusters. This was already handled during liquidation via `updateClusterOperators` at SSVClusters.sol:45-51. So this is also correct.

**However:** The `ebSnapshot.vUnits` adjustment at lines 218-237 DOES run for liquidated clusters. If the cluster had explicit EB tracking AND was liquidated, the deviation was already cleaned up during `_executeLiquidation`. Then when validators are removed:
- `ebSnapshot.vUnits -= deltaClusterVUnits` (line 221) — this could underflow if liquidation already cleaned up vUnits

Looking more carefully at `_executeLiquidation` (SSVClusters.sol:554-614): liquidation does NOT zero out `ebSnapshot.vUnits`. It only adjusts operator and DAO deviation. So `ebSnapshot.vUnits` still has its value. Then when `_bulkRemoveValidator` subtracts from it, this should be correct since `ebSnapshot.vUnits` tracks per-cluster vUnits independently.

But if `cluster.validatorCount == 0` after removal (line 224), the code tries to clean up "remaining deviation" by subtracting from `operatorEthVUnits` (line 230) and `daoTotalEthVUnits` (line 233). This deviation was ALREADY subtracted during liquidation. **This is a double-subtraction bug.**

**Severity:** HIGH — Double subtraction of deviation from `operatorEthVUnits` and `daoTotalEthVUnits` when removing the last validators from a liquidated cluster with explicit EB tracking. Could underflow and revert, blocking validator removal.

**Status:** STILL OPEN

---

## High Priority Issues

### 3. Rewards lost when `totalStaked == 0` — **STILL OPEN**

**File:** `contracts/modules/SSVStaking.sol:179-203` (`_syncFees`)

**Evidence:** At line 196:
```solidity
uint256 totalStaked = ICSSVToken(CSSV_ADDRESS).totalSupply();
if (totalStaked != 0) {
    newFeesWei = PackedETHLib.unpack(packedNewFees);
    s.accEthPerShare += uint128((newFeesWei * PRECISION) / totalStaked);
}
s.stakingEthPoolBalance = current; // line 201 — ALWAYS updates
```

When `totalStaked == 0`, the new fees (`current - previous`) are acknowledged (pool balance moves forward) but `accEthPerShare` is NOT incremented. Those fees are permanently lost — they can never be distributed to future stakers.

**Impact:** ETH rewards accumulated while no cSSV exists are permanently unclaimable. The `stakingEthPoolBalance` advances past them, so they become locked in the contract.

**Severity:** MEDIUM — Only affects the period when zero SSV is staked, which may be brief. But any ETH fees earned during that window are permanently lost.

---

### 4. `onCSSVTransfer` missing `nonReentrant` — **STILL OPEN**

**File:** `contracts/modules/SSVStaking.sol:169`

**Evidence:**
```solidity
function onCSSVTransfer(address from, address to, uint256 amount) external virtual { // line 169
    if (msg.sender != CSSV_ADDRESS) revert NotCSSV();
    ...
}
```

No `nonReentrant` modifier. The function calls `_syncFees(s)` which calls `ICSSVToken(CSSV_ADDRESS).totalSupply()` — an external call. It also calls `_settle(from, s)` and `_settle(to, s)` which call `ICSSVToken(CSSV_ADDRESS).balanceOf(user)` — more external calls.

**However:** The reentrancy risk is mitigated by the fact that `onCSSVTransfer` is called from `CSSVToken._beforeTokenTransfer` (CSSVToken.sol:26-31), which is triggered during ERC20 `_transfer`. The token transfer is an atomic operation and reentrancy through the token would require the token itself to be malicious. Since cSSV is a trusted contract deployed by the protocol, the practical risk is low.

**Impact:** Low practical risk given trusted cSSV token, but violates the defense-in-depth pattern established by the codebase. If the cSSV token were ever upgraded or replaced, the lack of reentrancy protection could become exploitable.

**Severity:** LOW — Defensive issue; recommend adding `nonReentrant` for consistency.

---

### 5. Missing `nonReentrant` on `deposit`, `reactivate`, `migrateClusterToETH` — **STILL OPEN**

**File:** `contracts/modules/SSVClusters.sol`

**Evidence:**
- `deposit` (line 190): No `nonReentrant`, no ETH transfer (only receives ETH via `payable`), no external calls. State change is just hash update. **Low risk** — no external calls before state writes.
- `reactivate` (line 133): No `nonReentrant`, no ETH transfer out. Receives ETH via `payable`. **Low risk** — no external calls.
- `migrateClusterToETH` (line 264): No `nonReentrant`. Calls `CoreLib.transferTokenBalance` (line 341) which calls `token.transfer()` — an external call to the SSV ERC20 token. State changes happen BEFORE the transfer (lines 284-331), so this follows checks-effects-interactions. **Medium risk** — if SSV token had a callback (ERC777-style), reentrancy could occur.

**Assessment:**
- `deposit`: FIXED (by design — no external calls)
- `reactivate`: FIXED (by design — no external calls)
- `migrateClusterToETH`: **STILL OPEN** — has external call (`token.transfer`) at line 341 after state changes. The SSV token is a standard ERC20 without callbacks, so practical risk is low, but defense-in-depth recommends `nonReentrant`.

**Severity:** LOW — SSV token is a standard ERC20 without transfer hooks, but `migrateClusterToETH` should have `nonReentrant` for safety.

---

### 6. `reactivate` not re-verifying operator existence — **STILL OPEN**

**File:** `contracts/modules/SSVClusters.sol:133-185` and `contracts/libraries/OperatorLib.sol:295-354`

**Evidence:** `reactivate` calls `updateClusterOperatorsOnReactivation` (line 151), which at line 311 checks:
```solidity
if (operator.ethSnapshot.block != 0) { // line 311
```

For a removed operator (where `_resetOperatorState` sets `ethSnapshot.block = 0`), this check causes the entire operator update to be skipped. The operator contributes nothing to `cumulativeFee` and only adds its frozen `ethSnapshot.index` to `cumulativeIndex` (line 348).

This means the cluster can be reactivated with removed operators. The removed operators won't accumulate new fees (since they're skipped), and their frozen index is used. This is arguably correct behavior — the cluster was originally created with those operators, and the remaining active operators still function.

**However:** There's no explicit check that the operator hasn't been removed (`operator.owner` is still set even after removal since `_resetOperatorState` doesn't clear `owner`). The `ethValidatorCount` is only incremented for active operators (line 341), which is correct.

**Assessment:** The behavior for removed operators during reactivation is **consistent** — they're skipped properly. But there's no explicit validation or documentation that this is intentional. Users might not realize their cluster is running with fewer active operators after reactivation.

**Severity:** LOW — Functionally correct but could benefit from explicit validation or event emission indicating which operators are inactive.

---

### 7. `replaceOracle` not invalidating pending votes — **STILL OPEN**

**File:** `contracts/modules/SSVDAO.sol:205-229`

**Evidence:** `replaceOracle` at line 205 replaces an oracle's address:
```solidity
s.oracleIdOf[oldOracle] = 0;        // line 218
s.oracles[oracleId] = newOracle;     // line 225
s.oracleIdOf[newOracle] = oracleId;  // line 226
```

There is NO invalidation of pending votes. The `hasVoted` mapping in `SSVStorageEB` uses `commitmentKey` (hash of blockNum + merkleRoot) and `oracleId`. Since the oracleId stays the same (only the address changes), the old oracle's votes remain counted. The new oracle with the same ID cannot re-vote on the same commitment (blocked by `hasVoted[commitmentKey][oracleId]` at line 178).

**Impact:**
1. If old oracle voted maliciously before being replaced, that vote persists and counts toward quorum
2. New oracle inherits the old oracle's voting history and cannot vote on pending commitments
3. No way to "reset" pending vote state for a given oracle slot

**Severity:** MEDIUM — Could allow a compromised oracle's stale votes to influence quorum, or prevent a legitimate new oracle from participating in pending votes.

---

### 8. `ensureETHDefaults` resurrects removed operators — **PARTIALLY FIXED**

**File:** `contracts/libraries/OperatorLib.sol:142-150`

**Evidence:**
```solidity
function ensureETHDefaults(ISSVNetworkCore.Operator storage operator) internal {
    if (operator.ethSnapshot.block == 0) {
        operator.ethSnapshot.block = uint32(block.number); // line 144
        operator.ethSnapshot.balance = PACKED_ETH_ZERO;
    }
    if (operator.ethFee.eq(PACKED_ETH_ZERO) && operator.fee.neq(PACKED_SSV_ZERO)) {
        operator.ethFee = defaultOperatorEthFee(); // line 148
    }
}
```

A removed operator has `ethSnapshot.block == 0`, `ethFee == 0`, `fee == 0` (all reset by `_resetOperatorState` at SSVOperators.sol:326-337). When `ensureETHDefaults` is called:
- Line 143: `ethSnapshot.block == 0` → true → sets `ethSnapshot.block = currentBlock` **THIS RESURRECTS THE SNAPSHOT**
- Line 147: `ethFee == 0 && fee != 0` → false (fee was zeroed) → does NOT set ethFee

So the ethSnapshot.block gets set but ethFee stays 0. The operator is now in a weird half-alive state: it has a non-zero ethSnapshot.block (so it passes the `block != 0` checks in `updateClusterOperators`) but zero fee.

**Where called for removed operators:** `updateClusterOperatorsOnRegistration` (line 201) calls it for ALL operators in the cluster, including removed ones. But removed operators would have been caught earlier by the existence checks at lines 187-198 (`operator.owner == address(0)` check). **Wait** — `_resetOperatorState` does NOT clear `operator.owner`. So a removed operator still has `owner != address(0)`, and will pass the existence check at lines 196-198 for existing clusters.

This means when registering validators to an EXISTING cluster that contains a removed operator:
1. The removed operator passes the existence check (owner is still set)
2. `ensureETHDefaults` resurrects its ethSnapshot.block
3. The stale memory copy issue (Bug #1) then overwrites storage anyway

**But also:** In `updateClusterOperatorsMigration` (line 393-395), removed operators with `snapshot.block == 0 && ethSnapshot.block == 0` are skipped (line 380). But if one snapshot is non-zero (e.g., a legacy operator with `snapshot.block != 0` but `ethSnapshot.block == 0`), it won't be skipped. Then `ensureETHDefaults` (line 395) sets `ethSnapshot.block` to current block.

**Status:** STILL OPEN — `ensureETHDefaults` can resurrect ETH snapshots for removed operators. The main protection is that `_resetOperatorState` doesn't clear `owner`, so removed operators are distinguishable only by `block == 0` checks, which `ensureETHDefaults` defeats.

**Severity:** HIGH — Removed operators can be partially resurrected, leading to incorrect accounting.

**Recommended fix:** Add a check for `operator.owner != address(0)` or explicitly zero `owner` in `_resetOperatorState`.

---

### 9. `rescueERC20` access control — **FIXED**

**File:** `contracts/SSVNetwork.sol:225` and `contracts/modules/SSVStaking.sol:150`

**Evidence:** At the proxy level (SSVNetwork.sol:225):
```solidity
function rescueERC20(address token, address to, uint256 amount) external onlyOwner {
    _delegate(SSVStorage.load().ssvContracts[SSVModules.SSV_STAKING]);
}
```

The `onlyOwner` modifier is enforced at the proxy level. The module-level function (SSVStaking.sol:150) has `nonReentrant` but no owner check — but since all calls go through the proxy, the owner check is always enforced.

**However:** The module function (SSVStaking.sol:150) only checks that the token is not SSV or cSSV. It does NOT check that the contract actually holds the token. It will simply fail with a transfer error if insufficient balance.

**Status:** FIXED — Access control is properly enforced via `onlyOwner` at the proxy level.

---

### 10. `setQuorumBps(0)` allows zero-threshold commits — **STILL OPEN**

**File:** `contracts/modules/SSVDAO.sol:234-239`

**Evidence:**
```solidity
function setQuorumBps(uint16 quorum) external override {
    if (quorum > BPS_DENOMINATOR) {     // line 235
        revert InvalidQuorum();
    }
    SSVStorageStaking.load().quorumBps = quorum; // line 238
    emit QuorumUpdated(quorum);
}
```

There is no minimum check. Setting `quorumBps = 0` means the threshold calculation in `commitRoot` (SSVDAO.sol:186) becomes:
```solidity
uint256 threshold = (totalStaked * 0) / BPS_DENOMINATOR; // = 0
```

Any single oracle vote would exceed threshold 0, allowing a single oracle to unilaterally commit roots.

**Impact:** Governance can accidentally or maliciously set quorum to 0, allowing single-oracle root commits.

**Severity:** MEDIUM — Owner-only function, but the lack of a minimum is a dangerous configuration foot-gun. Could be set accidentally.

**Recommended fix:** Add `if (quorum == 0) revert InvalidQuorum();` or set a minimum (e.g., 5000 = 50%).

---

### 11. Governance can set cooldown to 0 — **STILL OPEN**

**File:** `contracts/modules/SSVDAO.sol:245-248`

**Evidence:**
```solidity
function setUnstakeCooldownDuration(uint64 duration) external override {
    SSVStorageStaking.load().cooldownDuration = duration; // line 246
    emit CooldownDurationUpdated(duration);
}
```

No minimum duration check. Setting `cooldownDuration = 0` means unstake requests are immediately withdrawable (the `unlockTime` at SSVStaking.sol:88 would be `block.timestamp + 0`).

**Impact:** Zero cooldown allows instant unstaking, which defeats the economic security mechanism. An attacker could stake, earn oracle voting rights, manipulate a vote, and immediately unstake — all in a single block.

**Severity:** MEDIUM — Owner-only function, but zero cooldown undermines the staking security model.

---

### 12. `totalStaked` changes between oracle votes — **STILL OPEN**

**File:** `contracts/modules/SSVDAO.sol:155-200` (`commitRoot`)

**Evidence:** The `commitRoot` function reads `totalStaked` fresh on every call (line 172):
```solidity
uint256 totalStaked = ICSSVToken(CSSV_ADDRESS).totalSupply();
```

This value is used for:
1. Weight per oracle vote: `weight = totalStaked / s.defaultOracleIds.length` (line 181)
2. Quorum threshold: `threshold = (totalStaked * s.quorumBps) / BPS_DENOMINATOR` (line 186)

Between oracle votes for the same commitment, `totalStaked` can change (via stake/unstake). This means:
- Oracle A votes when totalStaked = 1000: weight = 250, threshold = 750
- Someone stakes 1000 more
- Oracle B votes when totalStaked = 2000: weight = 500, threshold = 1500
- `accumulatedWeight = 250 + 500 = 750`, threshold now = 1500 → quorum NOT reached

Or conversely:
- Oracle A votes when totalStaked = 2000: weight = 500
- Someone unstakes 1000
- Oracle B votes when totalStaked = 1000: weight = 250, threshold = 750
- `accumulatedWeight = 500 + 250 = 750`, threshold = 750 → quorum reached with less actual consensus

**Impact:** Changing totalStaked between votes can either block legitimate quorum or allow premature quorum. The weight calculation is inconsistent within a single voting round.

**Severity:** MEDIUM — Could be exploited by front-running oracle votes with large stake/unstake operations.

---

## Additional Security Issues Discovered

### 13. `_resetOperatorState` does NOT clear `operator.owner` — **NEW FINDING**

**File:** `contracts/modules/SSVOperators.sol:326-337`

**Evidence:**
```solidity
function _resetOperatorState(Operator storage operator) private returns (Operator memory) {
    operator.ethSnapshot.block = 0;
    operator.ethSnapshot.balance = PACKED_ETH_ZERO;
    operator.ethFee = PACKED_ETH_ZERO;
    operator.snapshot.block = 0;
    operator.snapshot.balance = PACKED_SSV_ZERO;
    operator.fee = PACKED_SSV_ZERO;
    operator.ethValidatorCount = 0;
    operator.validatorCount = 0;
    // NOTE: operator.owner is NOT cleared
    // NOTE: operator.whitelisted is NOT cleared
    return operator;
}
```

The operator's `owner` field is never cleared. This means:
- `checkOwner()` (OperatorLib.sol:131-136) uses `snapshot.block == 0 && ethSnapshot.block == 0` to detect non-existent operators, not `owner == address(0)`
- But `updateClusterOperatorsOnRegistration` (OperatorLib.sol:186-198) for existing clusters checks `operator.owner == address(0)` at line 196 — this check will PASS for removed operators (owner is still set), allowing interaction with removed operators

**Impact:** Inconsistent "removed" detection. Some code paths use `block == 0` (correct), others use `owner == address(0)` (misses removed operators). This enables bugs #1 and #8.

**Severity:** HIGH — Root cause for multiple other issues.

---

### 14. `_liquidateAfterEBUpdateIfNeeded` double-decrements `ethValidatorCount` — **NEW FINDING**

**File:** `contracts/modules/SSVClusters.sol:521-552`

**Evidence:** The `_liquidateAfterEBUpdateIfNeeded` function is called after `_applyClusterFeeUpdates`, which already called `updateClusterOperators(operatorIds, false, 0, s, sp)` with `deltaValidatorCount = 0` (line 468). No validator count change happens there.

At line 541-546:
```solidity
for (uint256 i; i < operatorIds.length; ++i) {
    ISSVOperators.Operator storage op = s.operators[operatorIds[i]];
    if (op.ethSnapshot.block != 0 && op.snapshot.block != 0) {
        op.ethValidatorCount -= cluster.validatorCount; // line 544
    }
}
```

Then `_executeLiquidation` is called (line 548), which calls `sp.updateDAO(false, cluster.validatorCount)` (SSVClusters.sol:564). The `updateDAO` function decrements `ethDaoValidatorCount` and `daoTotalEthVUnits` (ProtocolLib.sol:112-113).

But the original `liquidate` function (SSVClusters.sol:35-69) also calls `updateClusterOperators` with `deltaValidatorCount = cluster.validatorCount` and `increaseValidatorCount = false` (lines 45-51), which ALSO decrements `ethValidatorCount` (OperatorLib.sol:275).

In the `updateClusterBalance` → `_liquidateAfterEBUpdateIfNeeded` path:
- `_applyClusterFeeUpdates` calls `updateClusterOperators(operatorIds, false, 0, ...)` — does NOT decrement validatorCount (delta=0)
- `_liquidateAfterEBUpdateIfNeeded` manually decrements `op.ethValidatorCount -= cluster.validatorCount` (line 544)
- `_executeLiquidation` does NOT call `updateClusterOperators` again, but DOES call `sp.updateDAO(false, ...)` which decrements DAO counts

The `_executeLiquidation` function at line 564 calls `sp.updateDAO(false, cluster.validatorCount)` which decrements both `ethDaoValidatorCount` and `daoTotalEthVUnits`. The manual decrement at line 544 handles operator-level counts. This appears intentional for the EB update liquidation path.

**However:** The condition at line 543 (`op.ethSnapshot.block != 0 && op.snapshot.block != 0`) requires BOTH snapshots to be non-zero. For ETH-only operators (registered after v2.0.0 migration) that may have `snapshot.block == 0`, the decrement would be skipped, leaving `ethValidatorCount` inflated.

**Severity:** MEDIUM — Potential for `ethValidatorCount` inflation for ETH-only operators that get auto-liquidated via EB updates.

---

### 15. `withdraw` function skips operator snapshot updates — **NEW FINDING**

**File:** `contracts/modules/SSVClusters.sol:210-259`

**Evidence:** The `withdraw` function (line 210) calculates cluster index without updating operator snapshots to storage:
```solidity
uint64 clusterIndex;
{
    uint256 operatorsLength = operatorIds.length;
    for (uint256 i; i < operatorsLength; ++i) {
        Operator storage operator = SSVStorage.load().operators[operatorIds[i]];
        clusterIndex +=
            operator.ethSnapshot.index +
            (uint64(block.number) - operator.ethSnapshot.block) *
            PackedETH.unwrap(operator.ethFee);        // line 229
        burnRate += PackedETH.unwrap(operator.ethFee); // line 230
    }
}
```

It computes the index inline but does NOT write updated snapshots back. This is different from other functions (like `liquidate`) that call `updateClusterOperators` which updates storage. This is a **read-only** computation, which is correct for the withdrawal use case — the cluster balance is updated, but operator snapshots don't need persisting since no validator count changes.

**Assessment:** This is actually correct behavior — operator snapshots only need to be stored when validator counts change or operator balances need to accrue. For a simple withdrawal, computing the current index without persisting is sufficient. Not a bug.

---

### 16. Missing ETH `receive()` function on SSVNetwork proxy — **LOW RISK**

**File:** `contracts/SSVNetwork.sol`

The SSVNetwork proxy has no `receive()` function. ETH can only be sent via `payable` functions (`deposit`, `reactivate`, `migrateClusterToETH`, `registerValidator`, `bulkRegisterValidator`). Direct ETH transfers to the contract will revert (the `fallback` at line 103 is not `payable`).

This is actually correct and desirable — prevents accidental ETH sends to the contract.

**Status:** NOT AN ISSUE — correct by design.

---

## Summary Table

| # | Issue | Status | Severity |
|---|-------|--------|----------|
| 1 | `ensureETHDefaults` overwritten by stale memory copy | **STILL OPEN** | CRITICAL |
| 2 | Double deviation cleanup on liquidated cluster removal | **STILL OPEN** | HIGH |
| 3 | Rewards lost when `totalStaked == 0` | **STILL OPEN** | MEDIUM |
| 4 | `onCSSVTransfer` missing `nonReentrant` | **STILL OPEN** | LOW |
| 5 | Missing `nonReentrant` on `migrateClusterToETH` | **STILL OPEN** | LOW |
| 6 | `reactivate` not re-verifying operator existence | **STILL OPEN** | LOW |
| 7 | `replaceOracle` not invalidating pending votes | **STILL OPEN** | MEDIUM |
| 8 | `ensureETHDefaults` resurrects removed operators | **STILL OPEN** | HIGH |
| 9 | `rescueERC20` access control | **FIXED** | — |
| 10 | `setQuorumBps(0)` zero-threshold commits | **STILL OPEN** | MEDIUM |
| 11 | Governance can set cooldown to 0 | **STILL OPEN** | MEDIUM |
| 12 | `totalStaked` changes between oracle votes | **STILL OPEN** | MEDIUM |
| 13 | `_resetOperatorState` doesn't clear `owner` (NEW) | **OPEN** | HIGH |
| 14 | `_liquidateAfterEBUpdateIfNeeded` condition too strict (NEW) | **OPEN** | MEDIUM |

**Total: 12 STILL OPEN, 1 FIXED, 2 NEW findings**

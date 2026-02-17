# Verification of Existing MAINNET-READINESS Items

**Date:** 2026-02-17
**Branch:** `verify/existing-items` (based on `ssv-staking`)
**Method:** Manual code review of each referenced contract file

---

## Summary Table

| ID | Title | Status | Evidence |
|----|-------|--------|----------|
| BUG-1 | `ensureETHDefaults` overwritten by stale memory copy | FIXED | `OperatorLib.sol:197-201` |
| BUG-2 | `_resetOperatorState` doesn't clear `operator.owner` | STILL OPEN | `SSVOperators.sol:324-335` |
| BUG-3 | `ensureETHDefaults` resurrects removed operators | STILL OPEN | `OperatorLib.sol:142-153` |
| BUG-4 | Double deviation cleanup on liquidated cluster validator removal | STILL OPEN | `SSVValidators.sol:211-240` |
| BUG-5 | `_liquidateAfterEBUpdateIfNeeded` condition too strict | FIXED | `SSVClusters.sol:544-548` |
| BUG-6 | Rewards lost when `totalStaked == 0` in `_syncFees` | STILL OPEN | `SSVStaking.sol:196-201` |
| BUG-7 | `DEFAULT_OPERATOR_ETH_FEE` value deviates from DIP-X | STILL OPEN | `SSVCoreTypes.sol:14` |
| BUG-8 | Cooldown duration uses `block.timestamp` | STILL OPEN | `SSVStaking.sol:88` |
| SEC-1 | `setQuorumBps(0)` allows zero-threshold oracle commits | STILL OPEN | `SSVDAO.sol:234-240` |
| SEC-2 | `quorumBps` not initialized during upgrade | STILL OPEN | `SSVNetworkSSVStakingUpgrade.sol:8-19` |
| SEC-3 | `replaceOracle` doesn't invalidate pending votes | STILL OPEN | `SSVDAO.sol:205-229` |
| SEC-4 | `setUnstakeCooldownDuration` allows zero cooldown | STILL OPEN | `SSVDAO.sol:245-248` |
| SEC-5 | `totalStaked` changes between oracle votes | STILL OPEN | `SSVDAO.sol:172,181,186` |
| SEC-6 | `migrateClusterToETH` lacks `nonReentrant` | STILL OPEN | `SSVClusters.sol:264` |
| SEC-7 | `onCSSVTransfer` lacks `nonReentrant` | STILL OPEN | `SSVStaking.sol:169` |
| SEC-8 | `reactivate` no warning for removed operators | STILL OPEN | `SSVClusters.sol:133-185` |
| SEC-9 | `operatorMaxFee` function signature differs from DIP-X | STILL OPEN | `SSVDAO.sol:138` |
| SEC-10 | cSSV token lacks `ERC20Votes` | STILL OPEN | `CSSVToken.sol:10` |

**Totals:** 2 FIXED, 16 STILL OPEN, 0 PARTIALLY FIXED

---

## Detailed Findings

### BUG-1: `ensureETHDefaults` overwritten by stale memory copy
- **Status:** FIXED ✅
- **Evidence:** `contracts/libraries/OperatorLib.sol:197-201`
- **Explanation:** The code in `updateClusterOperatorsOnRegistration` now correctly:
  1. Gets a **storage reference** to the operator at line 197: `ISSVNetworkCore.Operator storage operatorSt = s.operators[operatorId];`
  2. Calls `ensureOperatorExist(operatorSt)` on the storage reference at line 198
  3. Calls `ensureETHDefaults(operatorSt)` on the storage reference at line 200
  4. **Only then** copies to memory at line 201: `ISSVNetworkCore.Operator memory operator = operatorSt;`

  This ordering ensures the memory copy (`operator`) contains the ETH defaults written by `ensureETHDefaults`. When `s.operators[operatorId] = operator` writes back at line 239, it preserves the ETH defaults rather than overwriting them with stale zeros. The fix exactly matches the documented resolution.

---

### BUG-2: `_resetOperatorState` doesn't clear `operator.owner`
- **Status:** STILL OPEN ❌
- **Evidence:** `contracts/modules/SSVOperators.sol:324-335`
- **Explanation:** The `_resetOperatorState` function resets the following fields:
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

      return operator;
  }
  ```
  **`operator.owner` is NOT cleared.** After removal, the operator has `owner != address(0)` but `snapshot.block == 0 && ethSnapshot.block == 0`. This inconsistency means:
  - `checkOwner()` at `OperatorLib.sol:131-136` correctly detects removed operators (checks both snapshot blocks)
  - `ensureOperatorExist()` at `OperatorLib.sol:159-164` checks `operator.owner == address(0)` OR both snapshot blocks == 0 — this catches removed operators because snapshot blocks are cleared, but the `owner != address(0)` path doesn't independently detect removal
  - The `owner` field remains stale and could confuse code paths that only check `owner`

- **Concrete Example:** Operator 5 is registered by Alice (`owner = Alice`). Operator 5 is removed. After removal: `owner = Alice`, `snapshot.block = 0`, `ethSnapshot.block = 0`. If any new code path checks `operator.owner != address(0)` to mean "operator exists", it would incorrectly pass.

---

### BUG-3: `ensureETHDefaults` resurrects removed operators
- **Status:** STILL OPEN ❌
- **Evidence:** `contracts/libraries/OperatorLib.sol:142-153`
- **Explanation:** The current `ensureETHDefaults` code:
  ```solidity
  function ensureETHDefaults(ISSVNetworkCore.Operator storage operator) internal {
      if(operator.ethSnapshot.block == 0){
          if (operator.ethSnapshot.block == 0) {
              operator.ethSnapshot.block = uint32(block.number);
              operator.ethSnapshot.balance = PACKED_ETH_ZERO;
          }
          if (operator.ethFee.eq(PACKED_ETH_ZERO) && operator.fee.neq(PACKED_SSV_ZERO)) {
              operator.ethFee = defaultOperatorEthFee();
          }
      }
      // we don't want to revert here because this will block the migration flow
  }
  ```
  There is **no guard for removed operators**. A removed operator has `ethSnapshot.block == 0` (reset by `_resetOperatorState`). If `ensureETHDefaults` is called on such an operator, line 145 sets `ethSnapshot.block = uint32(block.number)`, partially resurrecting it.

  Note: the `ensureETHDefaults` call also has a redundant double-check on `operator.ethSnapshot.block == 0` (lines 143 and 144 are identical conditions). This is cosmetic but worth noting.

  The main call path (`updateClusterOperatorsOnRegistration`) is now guarded by `ensureOperatorExist()` at line 198, which would revert before reaching `ensureETHDefaults`. However, other call paths exist:
  - `declareOperatorFee` at `SSVOperators.sol:106-108` calls `ensureETHDefaults` without an existence check. Though `checkOwner()` at line 100 should catch removed operators (since BUG-2 leaves owner set, `checkOwner` detects removal via snapshot blocks), this is defense-in-depth fragile.
  - `updateClusterOperatorsMigration` at `OperatorLib.sol:393-395` calls `ensureETHDefaults` on operators with `ethSnapshot.block == 0` but only after skipping removed operators at line 380. So this path is safe.

- **Concrete Example:** Operator 7 is removed. `_resetOperatorState` sets `ethSnapshot.block = 0`, `fee = 0`. If `ensureETHDefaults` is called (from migration path on a partially-reset operator or from `declareOperatorFee` if `checkOwner` is somehow bypassed), `ethSnapshot.block` becomes `block.number`, putting the operator in a half-alive state where `ethSnapshot.block != 0` but `snapshot.block == 0`.

---

### BUG-4: Double deviation cleanup on liquidated cluster validator removal
- **Status:** STILL OPEN ❌
- **Evidence:** `contracts/modules/SSVValidators.sol:193-240`
- **Explanation:** In `_bulkRemoveValidator`:
  - At line 193: `if (cluster.active)` guards the operator update block (lines 194-207). For liquidated clusters (`!cluster.active`), this entire block is skipped.
  - At lines 211-240: The EB deviation cleanup block runs **regardless of `cluster.active`**. When `cluster.validatorCount == 0` (all validators removed), lines 224-234 subtract `remainingVUnits` from `operatorEthVUnits` and `daoTotalEthVUnits`.

  However, during liquidation (`_executeLiquidation` at `SSVClusters.sol:557-617`), deviation is already cleaned up at lines 574-601. The `_executeLiquidation` function:
  - Subtracts deviation from `sp.daoTotalEthVUnits` at line 583
  - Subtracts deviation from `seb.operatorEthVUnits[operatorIds[i]]` at line 593

  When a liquidated cluster with explicit EB tracking has its validators removed via `_bulkRemoveValidator`, the deviation cleanup at lines 224-234 runs **again**, double-subtracting. This causes underflow and a revert, effectively blocking validator removal from liquidated clusters with explicit EB.

- **Concrete Example:**
  1. Cluster with 2 validators, explicit EB = 96 ETH → `vUnits = 30000`
  2. Baseline = 2 * 10000 = 20000, deviation = 10000
  3. `operatorEthVUnits[op1] = 10000`, `daoTotalEthVUnits` includes 10000
  4. Cluster is liquidated → `_executeLiquidation` subtracts deviation 10000 from each operator and DAO
  5. Now `operatorEthVUnits[op1] = 0` (deviation removed), but `ebSnapshot.vUnits` is still 30000
  6. User calls `removeValidator` for both validators
  7. `cluster.validatorCount` becomes 0, `ebSnapshot.vUnits = 30000 - 20000 = 10000` (after baseline subtraction at line 221)
  8. `remainingVUnits = 10000` → tries to subtract 10000 from `operatorEthVUnits[op1]` which is 0 → **underflow revert**

---

### BUG-5: `_liquidateAfterEBUpdateIfNeeded` condition too strict for ETH-only operators
- **Status:** FIXED ✅
- **Evidence:** `contracts/modules/SSVClusters.sol:544-548`
- **Explanation:** The current code at `_liquidateAfterEBUpdateIfNeeded`:
  ```solidity
  for (uint256 i; i < operatorIds.length; ++i) {
      ISSVOperators.Operator storage op = s.operators[operatorIds[i]];
      if (op.ethSnapshot.block != 0) {
          op.ethValidatorCount -= cluster.validatorCount;
      }
  }
  ```
  The condition at line 546 is now `op.ethSnapshot.block != 0` **only** — it no longer requires `op.snapshot.block != 0`. This means ETH-only operators (those registered post-migration with `snapshot.block == 0` but `ethSnapshot.block != 0`) correctly have their `ethValidatorCount` decremented during auto-liquidation after EB updates. The fix matches the described requirement.

---

### BUG-6: Rewards lost when `totalStaked == 0` in staking `_syncFees`
- **Status:** STILL OPEN ❌
- **Evidence:** `contracts/modules/SSVStaking.sol:179-203`
- **Explanation:** The current `_syncFees` code:
  ```solidity
  function _syncFees(StorageStaking storage s) internal {
      // ...
      uint256 totalStaked = ICSSVToken(CSSV_ADDRESS).totalSupply();
      if (totalStaked != 0) {
          newFeesWei = PackedETHLib.unpack(packedNewFees);
          s.accEthPerShare += uint128((newFeesWei * PRECISION) / totalStaked);
      }

      s.stakingEthPoolBalance = current;  // <-- Always advances, even when totalStaked == 0
      emit FeesSynced(newFeesWei, s.accEthPerShare);
  }
  ```
  At line 201, `s.stakingEthPoolBalance = current` is executed **unconditionally**. When `totalStaked == 0`, the `accEthPerShare` is not incremented (line 196-198 is skipped), but the pool balance advances. The fees accrued during this zero-staked period are permanently locked — future `_syncFees` calls will see `current == previous` and won't distribute them.

- **Concrete Example:**
  1. Initial state: `stakingEthPoolBalance = packed(100)`, `accEthPerShare = 0`, `totalStaked = 0`
  2. Network fees accrue, `networkTotalEarnings()` returns `packed(200)`
  3. `_syncFees` is called: `current = packed(200)`, `previous = packed(100)`, `packedNewFees = packed(100)`
  4. `totalStaked == 0` → `accEthPerShare` not updated, stays 0
  5. `stakingEthPoolBalance = packed(200)` ← advanced despite no distribution
  6. Alice stakes 1000 SSV, `totalStaked = 1000`
  7. Next `_syncFees`: `current = packed(200)`, `previous = packed(200)` → `current.lte(previous)` → returns immediately
  8. The 100 units of packed fees are lost forever — `accEthPerShare` stays 0

---

### BUG-7: `DEFAULT_OPERATOR_ETH_FEE` value deviates from DIP-X spec
- **Status:** STILL OPEN ❌
- **Evidence:** `contracts/libraries/SSVCoreTypes.sol:14`
- **Explanation:** The current value:
  ```solidity
  uint256 constant DEFAULT_OPERATOR_ETH_FEE = 1770_000_000;
  ```
  This is `1,770,000,000 wei` (1.77 gwei). The DIP-X specifies `0.000000001775464912 ETH` = `1,775,464,912 wei`. The DIP value is not packable (`1,775,464,912 % 100,000 = 64,912 != 0`). The closest packable values are:
  - `1,775,400,000` (round down)
  - `1,775,500,000` (round up)

  The current value `1,770,000,000` is further from the spec than either of these closer options. Per-block difference from spec: `5,464,912 wei`. Annual impact per validator: ~0.0000143 ETH less than DIP target.

---

### BUG-8: Cooldown duration uses `block.timestamp` but DIP specifies blocks
- **Status:** STILL OPEN ❌
- **Evidence:** `contracts/modules/SSVStaking.sol:88` and `SSVStaking.sol:232`
- **Explanation:** The implementation clearly uses `block.timestamp`:
  - `SSVStaking.sol:88`: `uint64 unlockTime = uint64(block.timestamp + s.cooldownDuration);`
  - `SSVStaking.sol:232`: `if (requests[i].unlockTime <= block.timestamp)`

  The DIP-X governance table states `cooldownDuration` is "in blocks" with value "50120 (7 days)" and setter `setUnstakeCooldownDuration(uint64 blocks)`. If the upgrade initializer at `SSVNetworkSSVStakingUpgrade.sol:14` is called with `cooldownDuration = 50120` (thinking it's blocks), the actual cooldown would be `50120 seconds ≈ 13.9 hours` instead of 7 days. The correct 7-day value in seconds is `604,800`.

  The `setUnstakeCooldownDuration` at `SSVDAO.sol:245` takes a `uint64 duration` parameter with no unit validation or documentation.

---

### SEC-1: `setQuorumBps(0)` allows zero-threshold oracle commits
- **Status:** STILL OPEN ❌
- **Evidence:** `contracts/modules/SSVDAO.sol:234-240`
- **Explanation:** The current code:
  ```solidity
  function setQuorumBps(uint16 quorum) external override {
      if (quorum > BPS_DENOMINATOR) {
          revert InvalidQuorum();
      }
      SSVStorageStaking.load().quorumBps = quorum;
      emit QuorumUpdated(quorum);
  }
  ```
  Only checks `quorum > 10000` (max bound). There is **no minimum check**. Setting `quorumBps = 0` is allowed. In `commitRoot` at `SSVDAO.sol:186`:
  ```solidity
  uint256 threshold = (totalStaked * s.quorumBps) / BPS_DENOMINATOR;
  ```
  With `quorumBps = 0`, `threshold = 0`, and at line 188: `if (accumulatedWeight >= threshold)` — any accumulated weight ≥ 0 passes, meaning a single oracle vote immediately commits the root.

---

### SEC-2: `quorumBps` not initialized during upgrade — zero by default
- **Status:** STILL OPEN ❌
- **Evidence:** `contracts/upgrades/stage/hoodi/SSVNetworkSSVStakingUpgrade.sol:8-19`
- **Explanation:** The upgrade initializer:
  ```solidity
  function initializeSSVStaking(
      uint64 cooldownDuration,
      uint32[MAX_DELEGATION_SLOTS] memory defaultOracleIds
  ) external onlyOwner reinitializer(3) {
      StorageStaking storage s = SSVStorageStaking.load();
      s.cooldownDuration = cooldownDuration;
      s.defaultOracleIds = defaultOracleIds;
      emit CooldownDurationUpdated(cooldownDuration);
      emit SSVNetworkUpgradeBlock("v2.0.0", block.number);
  }
  ```
  **`quorumBps` is NOT set.** It is not a parameter and not initialized. After upgrade, `quorumBps` defaults to `0` in storage. Combined with SEC-1, this means immediately after upgrade (before the DAO manually calls `setQuorumBps`), any single oracle can unilaterally commit arbitrary Merkle roots.

---

### SEC-3: `replaceOracle` doesn't invalidate pending votes
- **Status:** STILL OPEN ❌
- **Evidence:** `contracts/modules/SSVDAO.sol:205-229`
- **Explanation:** When `replaceOracle` is called:
  1. Old oracle's address is removed: `s.oracleIdOf[oldOracle] = 0` (line 218)
  2. New oracle's address is set: `s.oracles[oracleId] = newOracle` (line 225)
  3. The `oracleId` stays the same

  The `hasVoted` mapping in `SSVStorageEB` uses `oracleId` (not oracle address): `seb.hasVoted[commitmentKey][oracleId]`. So:
  - Old oracle's votes persist and still count toward quorum in `rootCommitments[commitmentKey]`
  - New oracle **cannot** vote on pending commitments because `hasVoted[commitmentKey][oracleId]` is already `true`
  - A compromised oracle that is replaced mid-vote still influences quorum through its previously cast votes
  - There is no `voteNonce` or any mechanism to invalidate stale votes

---

### SEC-4: `setUnstakeCooldownDuration` allows zero cooldown
- **Status:** STILL OPEN ❌
- **Evidence:** `contracts/modules/SSVDAO.sol:245-248`
- **Explanation:** The current code:
  ```solidity
  function setUnstakeCooldownDuration(uint64 duration) external override {
      SSVStorageStaking.load().cooldownDuration = duration;
      emit CooldownDurationUpdated(duration);
  }
  ```
  **No validation whatsoever.** Setting `duration = 0` is allowed, which makes `unlockTime = block.timestamp + 0 = block.timestamp`, meaning unstake requests are immediately withdrawable. This enables stake/vote/unstake in one block, defeating the staking security model.

---

### SEC-5: `totalStaked` changes between oracle votes (front-running)
- **Status:** STILL OPEN ❌
- **Evidence:** `contracts/modules/SSVDAO.sol:172,181,186`
- **Explanation:** In `commitRoot`:
  ```solidity
  uint256 totalStaked = ICSSVToken(CSSV_ADDRESS).totalSupply();  // line 172
  // ...
  uint256 weight = totalStaked / s.defaultOracleIds.length;       // line 181
  // ...
  uint256 threshold = (totalStaked * s.quorumBps) / BPS_DENOMINATOR; // line 186
  ```
  Each oracle vote reads `totalStaked` fresh from `ICSSVToken.totalSupply()`. Between votes:
  - `totalStaked` can change via `stake()` / `requestUnstake()` (which calls `ICSSVToken.burn`)
  - Weight per oracle at line 181 varies per vote
  - Threshold at line 186 varies per vote
  - No snapshot mechanism exists — there is no `snapshotTotalStaked` field in `SSVStorageEB` or `StorageStaking`

  An attacker could front-run oracle votes with large stake/unstake operations to manipulate the quorum threshold.

---

### SEC-6: Add `nonReentrant` to `migrateClusterToETH`
- **Status:** STILL OPEN ❌
- **Evidence:** `contracts/modules/SSVClusters.sol:264`
- **Explanation:** The function signature:
  ```solidity
  function migrateClusterToETH(uint64[] calldata operatorIds, Cluster memory cluster) external payable override {
  ```
  **No `nonReentrant` modifier.** The function makes an external call at line 341: `CoreLib.transferTokenBalance(msg.sender, ssvClusterBalance)` which is an SSV ERC20 transfer. While the SSV token is a standard ERC20 without transfer hooks, the codebase's established pattern is to use `nonReentrant` on all functions with external calls. Compare with `liquidate` (line 35), `withdraw` (line 210), `liquidateSSV` (line 78) — all have `nonReentrant`.

---

### SEC-7: Add `nonReentrant` to `onCSSVTransfer`
- **Status:** STILL OPEN ❌
- **Evidence:** `contracts/modules/SSVStaking.sol:169`
- **Explanation:** The function signature:
  ```solidity
  function onCSSVTransfer(address from, address to, uint256 amount) external virtual {
  ```
  **No `nonReentrant` modifier.** The function makes external calls to `ICSSVToken(CSSV_ADDRESS).totalSupply()` and `ICSSVToken(CSSV_ADDRESS).balanceOf()` indirectly through `_syncFees` and `_settle`. Compare with all other staking functions: `syncFees` (line 34), `stake` (line 41), `requestUnstake` (line 66), `withdrawUnlocked` (line 99), `claimEthRewards` (line 114) — all have `nonReentrant`.

---

### SEC-8: `reactivate` not emitting warning for removed operators
- **Status:** STILL OPEN ❌
- **Evidence:** `contracts/modules/SSVClusters.sol:133-185` and `contracts/libraries/OperatorLib.sol:295-354`
- **Explanation:** The `reactivate` function at `SSVClusters.sol:133` calls `updateClusterOperatorsOnReactivation` at line 151. In `OperatorLib.sol:311`, the reactivation loop checks:
  ```solidity
  if (operator.ethSnapshot.block != 0) {
      // ... update operator ...
  }
  cumulativeIndex += operator.ethSnapshot.index;
  ```
  Removed operators (with `ethSnapshot.block == 0`) are silently skipped — their `ethValidatorCount` is not incremented, their fee is not added to `cumulativeFee`, but their index still contributes. The cluster is reactivated with fewer active operators providing service, but **no event signals this**. The `ClusterReactivated` event at line 184 doesn't indicate which operators are inactive.

---

### SEC-9: `operatorMaxFee` function signature differs from DIP-X spec
- **Status:** STILL OPEN ❌ (documentation issue)
- **Evidence:** `contracts/modules/SSVDAO.sol:138`
- **Explanation:** The implementation:
  ```solidity
  function updateMaximumOperatorFee(uint256 maxFee) external override {
  ```
  Uses `uint256` parameter. The DIP-X specifies `updateMaximumOperatorFee(uint64 maxFee)`. The `uint256` design is actually user-friendly (users pass full wei values, packing is internal), but the DIP and implementation are not aligned. This is a documentation/spec issue, not a functional bug.

---

### SEC-10: cSSV token lacks governance/voting extensions (ERC20Votes)
- **Status:** STILL OPEN ❌ (governance decision)
- **Evidence:** `contracts/token/CSSVToken.sol:10`
- **Explanation:** The cSSV token:
  ```solidity
  contract CSSVToken is ERC20 {
  ```
  Inherits only from `ERC20` — no `ERC20Votes`, no `ERC20Permit`, no delegation mechanism. The DIP-X claims "Staked SSV, represented by cSSV, retains full governance and voting power." If the DAO uses Snapshot (off-chain), governance can be configured to count cSSV. But there is no on-chain voting capability. This is a product/governance decision that needs explicit documentation.

---

## Additional Notes

1. **BUG-3 mitigation:** While `ensureETHDefaults` itself lacks a removed-operator guard, the primary risk path (`updateClusterOperatorsOnRegistration`) is now protected by the `ensureOperatorExist()` call at `OperatorLib.sol:198`, which reverts for removed operators. The residual risk is from other call paths like `declareOperatorFee` where `checkOwner()` provides indirect protection.

2. **BUG-4 is a blocker:** This bug prevents validator removal from liquidated clusters with explicit EB tracking. Users whose clusters are liquidated after receiving an EB update would be unable to remove their validators, which is a critical UX issue.

3. **SEC-1 + SEC-2 combined:** These two issues together create an immediate post-upgrade vulnerability window where any single oracle can commit arbitrary Merkle roots. This should be the highest-priority security fix.

4. **BUG-5 was silently fixed:** The condition at `_liquidateAfterEBUpdateIfNeeded` now correctly checks only `op.ethSnapshot.block != 0`, matching the fix described in the checklist. The MAINNET-READINESS.md still marks this as "Open" but it has been fixed.

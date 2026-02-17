# Scenario Tests: Effective Balance + Staking

## Discrepancies (Code vs FLOWS.md)

> **FLAG FOR HUMAN REVIEW** — The following items diverge between the documented flows and the actual code.

### DISC-ES-1: `_syncFees` updates `ethDaoBalance` unconditionally

- **FLOWS.md says:** (Section 5.5) "If new fees since last sync: update `accEthPerShare` and `stakingEthPoolBalance`"
- **Code does:** `_syncFees()` in SSVStaking.sol:179-203 ALWAYS sets `sp.ethDaoBalance = current` and `sp.ethDaoIndexBlockNumber = block.number` BEFORE checking if `current > previous`. This means every `_syncFees` call settles the DAO earnings even if accEthPerShare doesn't change.
- **Likely correct:** Code — it must settle DAO earnings to get a consistent snapshot of `networkTotalEarnings()`.
- **Impact:** Low. FLOWS.md is incomplete rather than wrong. The settle-DAO-first pattern is correct; it just wasn't explicitly documented.

### DISC-ES-2: `_syncFees` handles `current <= previous` by setting `stakingEthPoolBalance = current`

- **FLOWS.md says:** (Section 5.5) Only mentions the case where new fees exist.
- **Code does:** SSVStaking.sol:187-189 — when `current.lte(previous)`, it sets `s.stakingEthPoolBalance = current` without emitting new fees. This covers the case where rewards were claimed (reducing `ethDaoBalance`), causing `current < previous`.
- **Likely correct:** Code — necessary to keep `stakingEthPoolBalance` synchronized after claims.
- **Impact:** Medium. Missing documentation could confuse auditors. The pool balance can decrease when stakers claim, but `accEthPerShare` never decreases (monotonic invariant holds).

### DISC-ES-3: `commitRoot` monotonicity uses `<=` (not `<`)

- **FLOWS.md says:** (Section 3.1) `blockNum > latestCommittedBlock` (strictly monotonic).
- **Code does:** SSVDAO.sol:163 — `if (blockNum <= seb.latestCommittedBlock) revert StaleBlockNumber()` — i.e., only passes if `blockNum > latestCommittedBlock`.
- **Likely correct:** Both — they agree. No discrepancy here on closer inspection.
- **Impact:** None.

### DISC-ES-4: `_liquidateAfterEBUpdateIfNeeded` double-decrements `ethValidatorCount`

- **FLOWS.md says:** (Section 3.2) Auto-liquidation should decrement operator counts and execute liquidation.
- **Code does:** SSVClusters.sol:524-555 — `_liquidateAfterEBUpdateIfNeeded` decrements `op.ethValidatorCount -= cluster.validatorCount` at line 547, then calls `_executeLiquidation` which calls `sp.updateDAO(false, cluster.validatorCount)` but does NOT decrement `ethValidatorCount` again (the `updateClusterOperators` in the normal liquidation path is NOT called here because operators were already updated by `_applyClusterFeeUpdates`).
- **Wait — tracing more carefully:** In `_applyClusterFeeUpdates` (line 471), `updateClusterOperators` is called with `deltaValidatorCount = 0` (the third arg), so it does NOT decrement `ethValidatorCount`. Then `_liquidateAfterEBUpdateIfNeeded` at line 547 does `op.ethValidatorCount -= cluster.validatorCount`. This is the ONLY decrement. Correct.
- **Likely correct:** Code.
- **Impact:** None — the code is correct, the separate decrement path for auto-liquidation is intentional.

### DISC-ES-5: `updateClusterBalance` fee settlement passes `deltaValidatorCount = 0` to `updateClusterOperators`

- **FLOWS.md says:** (Section 3.2) "Settle operator and network fees using OLD vUnits"
- **Code does:** SSVClusters.sol:471 — `OperatorLib.updateClusterOperators(operatorIds, false, 0, s, sp)`. The `false` (decrease) with `deltaValidatorCount = 0` means no validator count change — it only updates snapshots and returns indices.
- **Likely correct:** Code — this is an EB update, not a validator add/remove.
- **Impact:** None — just documenting the subtle parameter usage.

### DISC-ES-6: Operator deviation in `_updateOperatorVUnits` applies full delta to EACH operator

- **FLOWS.md says:** (Section 3.2) `operatorEthVUnits[opId] += (newVUnits - effectiveOldVUnits) / operatorCount`
- **Code does:** SSVClusters.sol:496-515 — `_updateOperatorVUnits` applies the FULL `deltaAbs = newVUnits - storedVUnits` to EVERY operator, NOT divided by operator count.
- **Likely correct:** Code. Each operator tracks the sum of deviations from ALL its clusters. Since `operatorEthVUnits` is the raw deviation sum (not per-cluster), the full cluster deviation gets added to each operator. When computing `effectiveVUnits` in `updateSnapshotSt`, the formula is `storedDeviation + ethValidatorCount * VUNITS_PRECISION`. This means the operator sees `(baseline_from_all_clusters) + (sum_of_deviations_from_all_clusters)`. For a single cluster with 2 validators going from 20,000 to 30,000 vUnits, the deviation is 10,000. Each of the (say) 4 operators gets +10,000 deviation. The operator earnings formula then multiplies `ethFee * effectiveVUnits / VUNITS_PRECISION` which gives correct per-operator earnings since the fee is per-vUnit already.
- **Impact:** High — FLOWS.md is misleading. The full deviation goes to each operator, not `deviation / operatorCount`.

### DISC-ES-7: `requestUnstake` uses `_settleWithBalance` (not `_settle`)

- **FLOWS.md says:** (Section 5.2) "Settle rewards using CURRENT cSSV balance (before burn)"
- **Code does:** SSVStaking.sol:75-76 — reads `bal = cSSV.balanceOf(msg.sender)` and calls `_settleWithBalance(user, bal, s)`. This settles with the pre-burn balance.
- **Likely correct:** Both agree. FLOWS.md is accurate.
- **Impact:** None.

### DISC-ES-8: `claimEthRewards` deducts `payout` from `accrued` but leaves dust

- **FLOWS.md says:** (Section 5.4) `accrued[user] -= payout` with remainder < 100,000.
- **Code does:** SSVStaking.sol:139 — `s.accrued[msg.sender] = claimable - payout`. The dust `claimable % ETH_DEDUCTED_DIGITS` remains.
- **Likely correct:** Both agree.
- **Impact:** None — dust < 100,000 wei is negligible.

---

## Global Invariants for This Partition

1. **`accEthPerShare` monotonicity**: `accEthPerShare` only increases, never decreases. (`_syncFees` only adds; the `current <= previous` branch skips the add.)
2. **cSSV supply conservation**: `cSSV.totalSupply() == Σ(all staked SSV) - Σ(all requestUnstake amounts)`. (Mint on stake, burn on requestUnstake.)
3. **`stakingEthPoolBalance` tracks DAO earnings snapshot**: After every `_syncFees`, `stakingEthPoolBalance == sp.networkTotalEarnings()` (modulo claims).
4. **`daoTotalEthVUnits` consistency**: `daoTotalEthVUnits == ethDaoValidatorCount * VUNITS_PRECISION + Σ(all cluster deviations)`.
5. **Operator vUnit consistency**: `operatorEthVUnits[op] == Σ(deviations of all active clusters using op)`.
6. **Staking reward conservation**: Total ETH claimable by all stakers ≤ total ETH earned by DAO as network fees.
7. **Oracle vote uniqueness**: `hasVoted[commitKey][oracleId]` once true stays true (never deleted even after quorum).
8. **EB snapshot staleness**: `clusterEB[id].lastRootBlockNum` strictly increases with each update.
9. **Pending requests bounded**: `withdrawalRequests[user].length <= MAX_PENDING_REQUESTS (10)`.
10. **ETH balance conservation**: `contract.ETH_balance >= Σ(active ETH cluster balances) + Σ(operator ETH earnings) + staking_pool_value`.

---

## Scenarios

### A. Oracle System

---

### ES-1: Single Oracle Commit — Below Quorum

**Category:** Oracle — basic commit
**Actors:** Oracle1 (oracleId=1), 4 oracles total, quorumBps=7500

**Preconditions:**
- 4 oracles registered with IDs 1-4
- `cSSV.totalSupply() = 40_000_000_000` (40 SSV staked, 40e9 in cSSV raw units)
- `latestCommittedBlock = 0`
- `quorumBps = 7500`

**Steps:**
1. Oracle1 calls `commitRoot(rootA, blockNum=100)`

**Trace through SSVDAO.sol:155-200:**
1. `oracleId = s.oracleIdOf[Oracle1]` → 1 (line 159)
2. `blockNum (100) <= latestCommittedBlock (0)` → false, passes (line 163)
3. `blockNum (100) > block.number` → false (assuming block.number >= 100), passes (line 168)
4. `totalStaked = cSSV.totalSupply() = 40_000_000_000` (line 172)
5. `totalStaked != 0` → passes (line 173)
6. `commitmentKey = keccak256(abi.encodePacked(100, rootA))` (line 176)
7. `hasVoted[commitmentKey][1] = false` → passes (line 178)
8. `hasVoted[commitmentKey][1] = true` (line 179)
9. `weight = 40_000_000_000 / 4 = 10_000_000_000` (line 181)
10. `rootCommitments[commitmentKey] += 10_000_000_000` → now 10_000_000_000 (line 182)
11. `accumulatedWeight = 10_000_000_000` (line 184)
12. `threshold = (40_000_000_000 * 7500) / 10_000 = 30_000_000_000` (line 186)
13. `10_000_000_000 >= 30_000_000_000`? No → quorum NOT reached (line 188)
14. Emit `WeightedRootProposed(rootA, 100, 10_000_000_000, 30_000_000_000, 1, Oracle1)` (line 199)

**Assertions:**
- `ebRoots[100] == bytes32(0)` (root NOT stored)
- `latestCommittedBlock == 0` (unchanged)
- `rootCommitments[commitmentKey] == 10_000_000_000`
- `hasVoted[commitmentKey][1] == true`
- Event: `WeightedRootProposed` with correct parameters

---

### ES-2: Quorum Reached — 3 of 4 Oracles Agree

**Category:** Oracle — quorum
**Actors:** Oracle1, Oracle2, Oracle3, Oracle4 (IDs 1-4)

**Preconditions:**
- Same as ES-1
- `cSSV.totalSupply() = 40_000_000_000`

**Steps:**
1. Oracle1 calls `commitRoot(rootA, 100)` → weight = 10e9, accumulated = 10e9, threshold = 30e9 → no quorum
2. Oracle2 calls `commitRoot(rootA, 100)` → accumulated = 20e9 → no quorum
3. Oracle3 calls `commitRoot(rootA, 100)` → accumulated = 30e9 → `30e9 >= 30e9` → QUORUM REACHED

**Trace for Oracle3 (step 3):**
1. `commitmentKey` same as steps 1-2 (same blockNum + root)
2. `hasVoted[commitmentKey][3] = false` → passes
3. `weight = 10_000_000_000`
4. `rootCommitments[commitmentKey] += 10e9` → now `30_000_000_000`
5. `30_000_000_000 >= 30_000_000_000` → YES (line 188)
6. `ebRoots[100] = rootA` (line 189)
7. `latestCommittedBlock = 100` (line 190)
8. `delete rootCommitments[commitmentKey]` (line 192) — sets to 0
9. `hasVoted` NOT deleted (line 193 comment) — prevents re-voting
10. Emit `RootCommitted(rootA, 100)` (line 195)
11. `return` (line 196) — no `WeightedRootProposed` event

**Assertions:**
- `ebRoots[100] == rootA`
- `latestCommittedBlock == 100`
- `rootCommitments[commitmentKey] == 0` (deleted)
- `hasVoted[commitmentKey][1] == true` (preserved)
- `hasVoted[commitmentKey][2] == true` (preserved)
- `hasVoted[commitmentKey][3] == true` (preserved)
- Oracle4 cannot vote for same (rootA, 100) even though quorum reached — `blockNum <= latestCommittedBlock` would revert with `StaleBlockNumber` if they tried a new commitment for block 100

---

### ES-3: Conflicting Roots — Separate Weight Tracking

**Category:** Oracle — conflicting proposals

**Preconditions:**
- Same as ES-1, `latestCommittedBlock = 0`

**Steps:**
1. Oracle1 commits `rootA` for block 100 → `commitKeyA = keccak256(100, rootA)`, weight 10e9
2. Oracle2 commits `rootB` for block 100 → `commitKeyB = keccak256(100, rootB)`, weight 10e9
3. Oracle3 commits `rootA` for block 100 → `commitKeyA` weight += 10e9 = 20e9, no quorum yet
4. Oracle4 commits `rootA` for block 100 → `commitKeyA` weight += 10e9 = 30e9, QUORUM for rootA

**Key insight:** `commitKeyA != commitKeyB` because the root is part of `keccak256(abi.encodePacked(blockNum, merkleRoot))`.

**Assertions:**
- `ebRoots[100] == rootA` (rootA won)
- `rootCommitments[commitKeyA] == 0` (deleted after quorum)
- `rootCommitments[commitKeyB] == 10_000_000_000` (rootB's weight persists, never cleaned up)
- Root B's weight is now stale — no mechanism to clean it up, but it can never reach quorum because `latestCommittedBlock = 100` and any future commit for block 100 would revert `StaleBlockNumber`
- **Note:** This is a minor storage leak but has no functional impact

---

### ES-4: Oracle Replacement Mid-Vote

**Category:** Oracle — governance edge case

**Preconditions:**
- Oracle1 (addr=0xA) has oracleId=1
- Oracle5 (addr=0xB) is the replacement

**Steps:**
1. Oracle1 votes for `rootA, block 100` → `hasVoted[commitKey][oracleId=1] = true`, weight += 10e9
2. Owner calls `replaceOracle(1, 0xB)`:
   - `s.oracleIdOf[0xA] = 0` (line 218)
   - `s.oracles[1] = 0xB` (line 225)
   - `s.oracleIdOf[0xB] = 1` (line 226)
3. Oracle5 (0xB, now oracleId=1) tries to vote for `rootA, block 100`:
   - `oracleId = s.oracleIdOf[0xB] = 1` (line 159)
   - `hasVoted[commitKey][1]` → already `true`! (line 178)
   - **REVERTS with `AlreadyVoted`**

**Analysis:** Oracle1's vote "sticks" to oracleId=1. The replacement oracle inherits the same ID and thus cannot re-vote for the same commitment. This is by design — `hasVoted` is keyed by oracleId, not address.

**Oracle1's old vote weight remains counted** in `rootCommitments[commitKey]`. This means:
- The 10e9 weight from Oracle1's vote persists
- Oracle5 cannot add more weight to this specific commitment
- If 2 more oracles vote for rootA, quorum is reached (30e9 total)

**Assertions:**
- Old oracle (0xA) can no longer call `commitRoot` at all (oracleIdOf = 0 → reverts `NotOracle`)
- New oracle (0xB) cannot re-vote for same commitment (same oracleId)
- Previous vote's weight is preserved in accumulator
- System is consistent — no double-counting

---

### ES-5: Oracle Edge Cases — Reverts

**Category:** Oracle — revert conditions

**ES-5a: Stale block number**
- `latestCommittedBlock = 100`
- Oracle calls `commitRoot(root, 100)` → `100 <= 100` → reverts `StaleBlockNumber`
- Oracle calls `commitRoot(root, 50)` → `50 <= 100` → reverts `StaleBlockNumber`
- Oracle calls `commitRoot(root, 101)` → passes

**ES-5b: Future block number**
- `block.number = 200`
- Oracle calls `commitRoot(root, 201)` → `201 > 200` → reverts `FutureBlockNumber`
- Oracle calls `commitRoot(root, 200)` → passes (equality OK)

**ES-5c: Zero cSSV supply**
- No one has staked SSV → `cSSV.totalSupply() = 0`
- Oracle calls `commitRoot(root, 100)` → reverts `OracleHasZeroWeight` (line 173)
- **Implication:** Oracle system is disabled when no SSV is staked. EB updates impossible without staking.

**ES-5d: Double vote**
- Oracle1 votes for (rootA, block 100)
- Oracle1 votes again for (rootA, block 100) → `hasVoted[commitKey][1] = true` → reverts `AlreadyVoted`
- Oracle1 votes for (rootB, block 100) → different commitKey → passes (if block number still valid)

---

### B. Effective Balance Updates

---

### ES-6: First EB Update — Implicit to Explicit (Same vUnits)

**Category:** EB — initial update

**Preconditions:**
- ETH cluster with 2 validators, operators [1, 2, 3, 4]
- No prior EB update → `clusterEB[id].vUnits = 0` (implicit)
- Implicit vUnits = `2 * 10_000 = 20_000`
- Oracle has committed root at block 100 with EB = 64 ETH for this cluster
- Cluster registered at block 50 with balance = 10 ETH (10e18 wei)
- Each operator ETH fee = `1_770_000_000` (packed, raw value = `1_770_000_000 / 100_000 = 17_700`)
- Network fee = `3_550_929_823` (packed raw = `3_550_929_823 / 100_000 ≈ 35_509`)

**Steps:**
1. Someone calls `updateClusterBalance(100, owner, [1,2,3,4], cluster, 64, proof)` at block 150

**Trace through SSVClusters.sol:373-423:**

1. `_verifyEBRoots`: `ebRoots[100] != bytes32(0)` → passes (line 426)
2. `_verifyEBUpdateFrequency`: `lastUpdateBlock = 0` → `0 != 0` is false → skip check (line 433)
3. `_verifyEBStaleness`: `lastRootBlockNum = 0` → `0 != 0` is false → skip check (line 442)
4. `_verifyMerkleProof`: Verify against `ebRoots[100]` (line 447-453)
5. `_verifyEBLimits`: `64 <= 2 * 2048 = 4096` and `64 >= 2 * 32 = 64` → passes (line 455-461)
6. `newVUnits = ebToVUnits(64)`:
   - `vUnits = 64 * 10_000 = 640_000`
   - `vUnitsPerValidator = 32e18 / 1e18 = 32`
   - `(640_000 - 1) / 32 + 1 = 639_999 / 32 + 1 = 19_999 + 1 = 20_000` (ceiling)
   - `newVUnits = 20_000` (line 390)

7. `version == VERSION_ETH` → true (line 392)
8. `storedVUnits = clusterEB[id].vUnits = 0` (line 394)
9. `effectiveOldVUnits = 0`, then since `== 0`: `effectiveOldVUnits = 2 * 10_000 = 20_000` (lines 395-398)

10. `cluster.active = true` → call `_applyClusterFeeUpdates`:
    - 100 blocks have passed (block 50 → 150)
    - Operator index delta and network fee delta computed with `oldVUnits = 20_000`
    - Cluster balance reduced by fees

11. `newVUnits (20_000) != effectiveOldVUnits (20_000)` → FALSE → skip vUnit update (line 406)

12. `_updateEBSnapshot`: `{vUnits: 20_000, lastRootBlockNum: 100, lastUpdateBlock: 150}` (line 410)

**Assertions:**
- `clusterEB[id].vUnits == 20_000` (now explicit, same as implicit)
- No deviation change — `operatorEthVUnits` unchanged
- `daoTotalEthVUnits` unchanged
- Cluster balance reduced by fees for 100 blocks at implicit rate
- **Future updates can now use this explicit value as baseline**

---

### ES-7: EB Increase — Higher Fee Burn Rate

**Category:** EB — increase

**Preconditions:**
- ETH cluster with 2 validators, operators [1, 2, 3, 4]
- Prior EB update: `clusterEB[id].vUnits = 20_000` (EB = 64 ETH, 32 per validator)
- Cluster at block 200, balance = 5 ETH (5e18 wei)
- Operator ETH fee (packed raw) = 17_700 each
- Network fee (packed raw) = 35_509

**Steps:**
1. Oracle commits root at block 250 with EB = 96 ETH for this cluster (1 val at 32, 1 at 64)
2. Someone calls `updateClusterBalance(250, owner, [1,2,3,4], cluster, 96, proof)` at block 300

**Trace:**
1. `newVUnits = ebToVUnits(96)`:
   - `96 * 10_000 = 960_000`
   - `(960_000 - 1) / 32 + 1 = 959_999 / 32 + 1 = 29_999 + 1 = 30_000`
   - `newVUnits = 30_000`

2. `storedVUnits = 20_000`, `effectiveOldVUnits = 20_000`

3. `_applyClusterFeeUpdates` (100 blocks from 200→300, with OLD vUnits = 20_000):
   - Each operator's ETH snapshot index += `(300 - snapshot.block) * 17_700`
   - `clusterIndex = Σ operator.ethSnapshot.index` (4 operators)
   - `idxOp = clusterIndex - cluster.index` (delta since last cluster update)
   - `idxNet = currentNetworkFeeIndex - cluster.networkFeeIndex`

   Assume operators were all at block 200, so blockDiff = 100:
   - Each operator index += `100 * 17_700 = 1_770_000`
   - `clusterIndex = 4 * (prevIndex + 1_770_000)`
   - `idxOp` = sum of operator deltas = `4 * 1_770_000 = 7_080_000`
   - `idxNet = 100 * 35_509 = 3_550_900`

   Fee calculation with OLD vUnits:
   - `networkFeeUnits = (3_550_900 * 20_000) / 10_000 = 7_101_800_000`
   - `operatorFeeUnits = (7_080_000 * 20_000) / 10_000 = 14_160_000_000`
   - `totalFees = (7_101_800_000 + 14_160_000_000) * 100_000 = 2_126_180_000_000_000_000` (≈2.126 ETH)
   - `cluster.balance = 5e18 - 2.126e18 ≈ 2.874e18`

4. `newVUnits (30_000) != effectiveOldVUnits (20_000)` → TRUE:
   - `_updateOperatorVUnits`: delta = 30_000 - 20_000 = 10_000 (positive)
   - Each of 4 operators: `operatorEthVUnits[i] += 10_000`
   - `sp.updateDAOEthVUnits(20_000, 30_000)`:
     - Settle DAO earnings first
     - `daoTotalEthVUnits += 10_000`

5. `_updateEBSnapshot`: `{vUnits: 30_000, lastRootBlockNum: 250, lastUpdateBlock: 300}`

**After update — verify higher burn rate:**
- Next 100 blocks (300→400) with newVUnits = 30_000:
  - `networkFeeUnits = (3_550_900 * 30_000) / 10_000 = 10_652_700_000`
  - `operatorFeeUnits = (7_080_000 * 30_000) / 10_000 = 21_240_000_000`
  - `totalFees = (10_652_700_000 + 21_240_000_000) * 100_000 = 3_189_270_000_000_000_000` (≈3.189 ETH)
  - **This is exactly 1.5× the old rate** (30,000 / 20,000 = 1.5)

**Assertions:**
- `clusterEB[id].vUnits == 30_000`
- Each `operatorEthVUnits[i] == previous + 10_000`
- `daoTotalEthVUnits == previous + 10_000`
- Fee settlement used OLD vUnits (20,000) — no gap
- Future fees scale at 1.5× rate
- Operator earnings also scale: `effectiveVUnits = storedDeviation + ethValidatorCount * 10_000`

---

### ES-8: EB Decrease — Lower Fee Burn Rate

**Category:** EB — decrease

**Preconditions:**
- Cluster with 2 validators, `clusterEB[id].vUnits = 20_000` (EB = 64 ETH)
- Same operator fees as ES-7

**Steps:**
1. Oracle commits root with EB = 64 ETH → `newVUnits = 20_000` (same as before, no change — this is the floor for 2 validators)

Actually, for a decrease: let's say the prior was EB = 96 (vUnits = 30_000), and new EB = 64:
- `newVUnits = 20_000`
- `effectiveOldVUnits = 30_000`
- Delta = -10_000

**Trace `_updateOperatorVUnits`:**
- `deltaPositive = 20_000 > 30_000` → false
- `deltaAbs = 30_000 - 20_000 = 10_000`
- Each operator: `operatorEthVUnits[i] -= 10_000`
- `sp.updateDAOEthVUnits(30_000, 20_000)`:
  - `newVUnits (20_000) < oldVUnits (30_000)` → `daoTotalEthVUnits -= 10_000`

**After update:**
- Future fees scale at 2/3 of previous rate (20,000 / 30,000)
- Operator earnings decrease proportionally

**Assertions:**
- `clusterEB[id].vUnits == 20_000`
- `operatorEthVUnits` decreased
- `daoTotalEthVUnits` decreased
- No underflow (assuming deviation was >= 10_000)

---

### ES-9: Auto-Liquidation on EB Increase

**Category:** EB — auto-liquidation

**Preconditions:**
- Cluster with 2 validators, operators [1,2,3,4]
- Implicit EB: vUnits = 20_000
- Each operator fee (packed raw) = 17_700
- Network fee (packed raw) = 35_509
- `minimumBlocksBeforeLiquidation = 50_190`
- `minimumLiquidationCollateral` = packed(940_000_000_000_000) = 9_400_000_000 (raw)
- Current cluster balance: just above threshold for 20_000 vUnits

**Calculate threshold for 20,000 vUnits:**
- `burnRate = 4 * 17_700 = 70_800`
- `rate = burnRate + networkFee = 70_800 + 35_509 = 106_309`
- `thresholdUnits = (50_190 * 106_309 * 20_000) / 10_000 = 50_190 * 106_309 * 2 = 10_671_325_620`
- `threshold = 10_671_325_620 * 100_000 = 1_067_132_562_000_000_000` (≈1.067 ETH)
- Cluster balance: 1.1 ETH (just above threshold)

**Steps:**
1. Oracle commits root with EB = 128 ETH → `newVUnits = ebToVUnits(128) = 40_000`
2. `updateClusterBalance(...)` called at same block (no time elapsed for fees)

**Trace:**
1. Fees settled with OLD vUnits (20,000) — in this case, 0 blocks passed, so no fees deducted
2. vUnits updated: 20,000 → 40,000
3. New threshold calculation:
   - `thresholdUnits = (50_190 * 106_309 * 40_000) / 10_000 = 50_190 * 106_309 * 4 = 21_342_651_240`
   - `threshold = 21_342_651_240 * 100_000 = 2_134_265_124_000_000_000` (≈2.134 ETH)
4. `cluster.balance (1.1 ETH) < threshold (2.134 ETH)` → **LIQUIDATABLE**

**`_liquidateAfterEBUpdateIfNeeded` (line 524):**
1. `cluster.active = true` and `validatorCount = 2` → proceed
2. `isLiquidatableWithEB` returns true
3. Decrement each operator: `op.ethValidatorCount -= 2`
4. `_executeLiquidation`:
   - `sp.updateDAO(false, 2)`: ethDaoValidatorCount -= 2, daoTotalEthVUnits -= 20_000 (baseline)
   - Deviation removal: `vUnitsCluster = 40_000` (just set), `baseline = 2 * 10_000 = 20_000`
   - `deviation = 40_000 - 20_000 = 20_000`
   - `daoTotalEthVUnits -= 20_000` (deviation)
   - Each operator: `operatorEthVUnits[i] -= 20_000`
   - `balanceLiquidatable = cluster.balance (1.1 ETH)`
   - `cluster.balance = 0, active = false, index = 0, networkFeeIndex = 0`
   - Transfer 1.1 ETH to `msg.sender` (the updater)

**Assertions:**
- Cluster is liquidated: `active == false, balance == 0`
- Bounty (1.1 ETH) sent to the caller who submitted the EB update
- Each operator's `ethValidatorCount` decreased by 2
- `ethDaoValidatorCount` decreased by 2
- `daoTotalEthVUnits` decreased by `20_000 (baseline) + 20_000 (deviation) = 40_000`
- `operatorEthVUnits[i]` decreased by 20_000 each
- Events: `ClusterBalanceUpdated` AND `ClusterLiquidated`

---

### ES-10: Fee Settlement Uses OLD vUnits — No Gap

**Category:** EB — settlement timing

**Preconditions:**
- Cluster at block 100, vUnits = 10_000, balance = 2 ETH
- Operator fees and network fee as in ES-7
- EB update to vUnits = 20_000 at block 200

**Key code path (SSVClusters.sol:400-409):**
```
if (cluster.active) {
    burnRate = _applyClusterFeeUpdates(..., effectiveOldVUnits, ...);  // OLD vUnits
}
if (cluster.active && newVUnits != effectiveOldVUnits) {
    _updateOperatorVUnits(...);     // Apply NEW vUnits
    sp.updateDAOEthVUnits(...);     // Settle DAO with OLD then apply NEW
}
_updateEBSnapshot(...);            // Store new vUnits
```

**Trace:**
1. **Blocks 100-200 (100 blocks)**: Fees calculated with OLD vUnits = 10_000
   - `networkFeeUnits = (idxNet * 10_000) / 10_000 = idxNet`
   - `operatorFeeUnits = (idxOp * 10_000) / 10_000 = idxOp`

2. **After update**: Future fees (blocks 200+) use NEW vUnits = 20_000
   - `networkFeeUnits = (idxNet * 20_000) / 10_000 = 2 * idxNet`

**Proof of no gap/overlap:**
- At block 200, cluster.index and cluster.networkFeeIndex are set to CURRENT values
- From block 200 onward, the delta (newIndex - cluster.index) starts from 0
- Fee = `(delta * newVUnits) / VUNITS_PRECISION * ETH_DEDUCTED_DIGITS`
- The transition is clean: old period settled in full with old vUnits, new period starts at 0 delta with new vUnits

**Assertions:**
- No block's fees are double-counted
- No block's fees are skipped
- The operator vUnit deviation is applied AFTER fee settlement
- `updateDAOEthVUnits` calls `updateDAOEarnings` first (settling the DAO with OLD vUnits before changing)

---

### ES-11: Operator vUnit Tracking Across Multiple Clusters

**Category:** EB — multi-cluster operator

**Preconditions:**
- Operator 1 serves Cluster A (2 validators, implicit vUnits = 20_000) and Cluster B (3 validators, implicit vUnits = 30_000)
- `operator.ethValidatorCount = 5`
- `operatorEthVUnits[1] = 0`

**Steps:**
1. Cluster A gets EB update: 64 ETH → `newVUnits = 20_000` (same as implicit) → no deviation change
2. Cluster A gets EB update: 96 ETH → `newVUnits = 30_000`
   - `effectiveOldVUnits = 20_000` (from stored explicit)
   - Deviation = 30_000 - 20_000 = 10_000
   - `operatorEthVUnits[1] += 10_000` → now 10_000
3. Cluster B gets EB update: 128 ETH → `newVUnits = ebToVUnits(128) = 40_000`
   - `effectiveOldVUnits = 30_000` (implicit: 3 * 10_000)
   - Deviation = 40_000 - 30_000 = 10_000
   - `operatorEthVUnits[1] += 10_000` → now 20_000

**Operator earnings calculation at block N:**
- `effectiveVUnits = operatorEthVUnits[1] + ethValidatorCount * VUNITS_PRECISION`
- `= 20_000 + 5 * 10_000 = 70_000`
- This means the operator earns fees as if serving 7 standard validators (not 5)
- Correct: Cluster A has 3 "standard equivalents" (30,000 vUnits / 10,000), Cluster B has 4 (40,000 / 10,000) → total 7

**Assertions:**
- `operatorEthVUnits[1] == 20_000` (sum of deviations from both clusters)
- Effective vUnits = 70_000 (baseline 50,000 + deviation 20,000)
- Operator earnings reflect the weighted sum correctly

---

### ES-12: EB Limits Enforcement

**Category:** EB — bounds checking

**Code: SSVClusters.sol:455-461 (`_verifyEBLimits`)**

**ES-12a: Below minimum**
- Cluster with 2 validators
- `effectiveBalance = 63` (less than 2 * 32 = 64)
- `63 < 64` → reverts `EBBelowMinimum`

**ES-12b: At minimum (boundary)**
- `effectiveBalance = 64` (exactly 2 * 32)
- `64 >= 64` → passes

**ES-12c: Above maximum**
- `effectiveBalance = 4097` (more than 2 * 2048 = 4096)
- `4097 > 4096` → reverts `EBExceedsMaximum`

**ES-12d: At maximum (boundary)**
- `effectiveBalance = 4096` (exactly 2 * 2048)
- `4096 <= 4096` → passes

**Note on the code:** `MAX_EB_PER_VALIDATOR = 2048 ether`, and `MAX_EB_PER_VALIDATOR / 1 ether = 2048`. Similarly `DEFAULT_EB_PER_VALIDATOR / 1 ether = 32`. The `effectiveBalance` parameter is `uint32` in whole ETH, so comparisons are against whole ETH values.

---

### ES-13: Merkle Proof Verification

**Category:** EB — cryptographic verification

**Code: SSVClusters.sol:447-453 (`_verifyMerkleProof`)**

The leaf is computed as:
```solidity
keccak256(abi.encodePacked(keccak256(abi.encode(ctx.clusterId, ctx.effectiveBalance))))
```

**ES-13a: Valid proof**
- Correct clusterId, correct EB, correct proof against stored root → passes

**ES-13b: Invalid proof**
- Wrong proof path → `MerkleProof.verify` returns false → reverts `InvalidProof`

**ES-13c: Wrong cluster**
- Proof for cluster X submitted for cluster Y → leaf hash differs → reverts `InvalidProof`

**ES-13d: Wrong EB value**
- Correct cluster but EB=96 instead of 64 → leaf hash differs → reverts `InvalidProof`

**Double-hash convention:**
- Outer: `keccak256(abi.encodePacked(innerHash))`
- Inner: `keccak256(abi.encode(clusterId, effectiveBalance))`
- This prevents second pre-image attacks on the Merkle tree

---

### ES-14: Update Frequency and Staleness

**Category:** EB — timing constraints

**ES-14a: Update too frequent**
- `minBlocksBetweenUpdates = 100`
- Last update at block 300 → `lastUpdateBlock = 300`
- Try update at block 350 → `350 < 300 + 100 = 400` → reverts `UpdateTooFrequent`
- Try update at block 400 → `400 >= 400` → passes

**ES-14b: First update (no frequency check)**
- `lastUpdateBlock = 0` → `0 != 0` is false → skip frequency check entirely (line 433-434)
- First update always passes frequency check

**ES-14c: Stale root**
- Last root used: block 200 → `lastRootBlockNum = 200`
- Try update with `blockNum = 200` → `200 <= 200` → reverts `StaleUpdate`
- Try update with `blockNum = 150` → `150 <= 200` → reverts `StaleUpdate`
- Try update with `blockNum = 201` → passes

**ES-14d: First update (no staleness check)**
- `lastRootBlockNum = 0` → `0 != 0` is false → skip staleness check (line 442)

---

### C. Staking System

---

### ES-15: Basic Stake → Earn → Claim Cycle

**Category:** Staking — full lifecycle

**Preconditions:**
- `accEthPerShare = 0`
- `stakingEthPoolBalance = 0`
- `ethDaoBalance = 0`, `ethDaoIndexBlockNumber = 0`
- 1 active ETH cluster with 1 validator (10,000 vUnits)
- Network fee packed raw = 35_509
- `cSSV.totalSupply() = 0`

**Steps:**

**Step 1: Stake 10 SSV (10e18 tokens)**
- `amount = 10e18 >= MINIMAL_STAKING_AMOUNT (1e9)` → passes
- `_syncFees(s)`:
  - `current = networkTotalEarnings() = ethDaoBalance + (blockDiff * networkFee * daoTotalEthVUnits) / VUNITS_PRECISION`
  - Let's say at block 1000: `current = 0 + (1000 * 35_509 * 10_000) / 10_000 = 1000 * 35_509 = 35_509_000` (packed raw)
  - `previous = stakingEthPoolBalance = 0` (packed raw)
  - `current > previous` → yes
  - `packedNewFees = 35_509_000 - 0 = 35_509_000` (packed)
  - `newFeesWei = 35_509_000 * 100_000 = 3_550_900_000_000_000` (unpacked to wei)
  - `totalStaked = cSSV.totalSupply() = 0` → **skip accEthPerShare update** (line 196-198)
  - `stakingEthPoolBalance = 35_509_000` (packed)
  - **Critical: 3.55e15 wei of fees exist but nobody can claim them because supply was 0**

- `_settle(user)`:
  - `bal = cSSV.balanceOf(user) = 0` → `pending = 0`
  - `userIndex[user] = accEthPerShare = 0`

- Transfer 10e18 SSV from user
- Mint 10e18 cSSV to user
- `cSSV.totalSupply() = 10e18`

**Step 2: 100 blocks pass (block 1000 → 1100), cluster generates more fees**

**Step 3: Call `claimEthRewards()` at block 1100**
- `_syncFees(s)`:
  - `current = networkTotalEarnings()`:
    - `ethDaoBalance` was set to `packed(35_509_000)` during step 1
    - `ethDaoIndexBlockNumber` was set to block 1000
    - `blockDiff = 1100 - 1000 = 100`
    - `earnings = (100 * 35_509 * 10_000) / 10_000 = 3_550_900` (packed raw)
    - `current = 35_509_000 + 3_550_900 = 39_059_900` (packed raw)
  - `previous = stakingEthPoolBalance = 35_509_000` (packed)
  - `packedNewFees = 39_059_900 - 35_509_000 = 3_550_900` (packed)
  - `newFeesWei = 3_550_900 * 100_000 = 355_090_000_000_000` (wei)
  - `totalStaked = 10e18`
  - `accEthPerShare += (355_090_000_000_000 * 1e18) / 10e18 = 35_509_000_000_000` (about 3.55e13)
  - `stakingEthPoolBalance = 39_059_900`

- `_settle(user)`:
  - `bal = 10e18`
  - `idx = accEthPerShare = 35_509_000_000_000`
  - `userIdx = userIndex[user] = 0`
  - `pending = (10e18 * 35_509_000_000_000) / 1e18 = 355_090_000_000_000` (wei)
  - `accrued[user] += 355_090_000_000_000`
  - `userIndex[user] = 35_509_000_000_000`

- Claim:
  - `claimable = 355_090_000_000_000`
  - `payout = 355_090_000_000_000 - (355_090_000_000_000 % 100_000) = 355_090_000_000_000` (no dust — already divisible by 100,000)
  - `packedPayout = pack(355_090_000_000_000) = 3_550_900` (raw)
  - Check: `packedPayout <= stakingEthPoolBalance` → `3_550_900 <= 39_059_900` → yes
  - Check: `packedPayout <= ethDaoBalance` → yes
  - `accrued[user] = 0`
  - `stakingEthPoolBalance -= 3_550_900 = 35_509_000`
  - `ethDaoBalance -= 3_550_900`
  - Transfer 355_090_000_000_000 wei (≈0.000355 ETH) to user

**Assertions:**
- User received exactly the fees generated during the 100 blocks they were staked
- The 3.55e15 wei of pre-stake fees are NOT claimable (lost to the pool permanently)
- `accEthPerShare = 35_509_000_000_000` (only increased, never decreased)

---

### ES-16: Multiple Stakers — Pro-Rata Distribution

**Category:** Staking — fairness

**Preconditions:**
- `accEthPerShare = 0`, no prior fees
- `cSSV.totalSupply() = 0`
- 1 cluster generating network fees

**Steps:**

**Block 0: User A stakes 10e18 SSV**
- `cSSV.totalSupply() = 10e18`
- `userIndex[A] = 0`

**Block 0: User B stakes 30e18 SSV** (same block)
- `_syncFees`: No new blocks → no new fees → `accEthPerShare` unchanged = 0
- `userIndex[B] = 0`
- `cSSV.totalSupply() = 40e18`

**Block 100: Both claim rewards**
Let fees generated = `F` wei over 100 blocks.

`_syncFees` at block 100:
- `newFeesWei = F` (unpacked)
- `accEthPerShare += (F * 1e18) / 40e18 = F / 40`

`_settle(A)`:
- `pending = (10e18 * F/40) / 1e18 = F * 10 / 40 = F / 4`
- User A gets 25% of F

`_settle(B)`:
- `pending = (30e18 * F/40) / 1e18 = F * 30 / 40 = 3F / 4`
- User B gets 75% of F

**Concrete example:** Let F = 4_000_000_000_000_000 (4e15 wei, ~0.004 ETH)
- User A: 1_000_000_000_000_000 wei (1e15)
- User B: 3_000_000_000_000_000 wei (3e15)
- Total: 4e15 = F ✓

**Assertions:**
- Distribution is exactly proportional to cSSV holdings
- A gets F/4, B gets 3F/4
- Sum of rewards = total fees generated (minus any precision dust)

---

### ES-17: Stake Timing Matters — Late Joiner

**Category:** Staking — timing fairness

**Preconditions:**
- `accEthPerShare = 0`, `cSSV.totalSupply() = 0`
- Network fee generates `f` wei per block with current vUnits

**Steps:**

**Block 0: User A stakes 10e18 SSV**
- `cSSV.totalSupply() = 10e18`

**Block 50: User B stakes 30e18 SSV**
- `_syncFees`:
  - Fees for 50 blocks: `newFeesWei = 50f`
  - `accEthPerShare += (50f * 1e18) / 10e18 = 5f`
- `_settle(B)`:
  - `bal = 0` (B has no cSSV yet) → `pending = 0`
  - `userIndex[B] = 5f`
- Mint 30e18 cSSV to B
- `cSSV.totalSupply() = 40e18`

**Block 100: Both claim**
- `_syncFees`:
  - Fees for 50 blocks: `newFeesWei = 50f`
  - `accEthPerShare += (50f * 1e18) / 40e18 = 50f / 40 = 1.25f`
  - `accEthPerShare = 5f + 1.25f = 6.25f`

- `_settle(A)`:
  - `pending = (10e18 * (6.25f - 0)) / 1e18 = 62.5f`
  - **But wait — A was the only staker for first 50 blocks (reward = 50f) + got 25% of second 50 blocks (0.25 * 50f = 12.5f)**
  - Total for A = 50f + 12.5f = 62.5f ✓

- `_settle(B)`:
  - `pending = (30e18 * (6.25f - 5f)) / 1e18 = 30 * 1.25f = 37.5f`
  - B gets 75% of second period only: 0.75 * 50f = 37.5f ✓

**Concrete example with f = 100_000_000_000 (1e11 wei/block):**
- Total fees: 100 blocks * 1e11 = 1e13 wei
- A: 62.5 * 1e11 = 6.25e12 wei
- B: 37.5 * 1e11 = 3.75e12 wei
- Sum: 1e13 ✓

**Assertions:**
- Late joiner B does NOT capture fees from before they staked
- A gets all fees from the solo period
- Second period is split pro-rata (A: 25%, B: 75%)

---

### ES-18: Unstake Request → Cooldown → Withdraw

**Category:** Staking — unstaking lifecycle

**Preconditions:**
- User has 10e18 cSSV, `accrued[user] = 0`
- `cooldownDuration = 604_800` seconds (7 days)
- `accEthPerShare = 1e14` (some accumulated rewards)
- `userIndex[user] = 1e14` (already settled)
- `block.timestamp = T`

**Step 1: `requestUnstake(5e18)`**
1. `_syncFees`: update accEthPerShare to, say, `1.5e14`
2. `_settleWithBalance(user, 10e18, s)`:
   - `bal = 10e18` (pre-burn balance!)
   - `pending = (10e18 * (1.5e14 - 1e14)) / 1e18 = 10 * 0.5e14 = 5e14`
   - `accrued[user] += 5e14 = 5e14`
   - `userIndex[user] = 1.5e14`
3. Check: `5e18 <= 10e18` → passes
4. Check: `requests.length < 10` → passes
5. `unlockTime = T + 604_800`
6. Push `UnstakeRequest{amount: 5e18, unlockTime: T + 604800}`
7. Burn 5e18 cSSV from user → user has 5e18 cSSV
8. `cSSV.totalSupply()` decreased by 5e18

**Step 2: Advance past cooldown (timestamp = T + 700_000)**
More fees accrue during cooldown, but user only earns on 5e18 cSSV (not the burned 5e18).

**Step 3: `withdrawUnlocked()` at timestamp T + 700_000**
1. `calculateTotalUnfrozenBalance(s)`:
   - requests[0].unlockTime = T + 604_800 ≤ T + 700_000 → yes
   - `total += 5e18`
   - Swap-and-pop: removes request[0]
2. Transfer 5e18 SSV tokens to user

**Assertions:**
- Rewards are settled BEFORE burn with pre-burn balance (10e18)
- Burned cSSV stops earning rewards immediately
- SSV tokens are locked during cooldown
- Swap-and-pop correctly handles single-element array

---

### ES-19: cSSV Transfer Settles Rewards

**Category:** Staking — transfer hook

**Preconditions:**
- User A: 10e18 cSSV, `userIndex[A] = 0`
- User B: 0 cSSV, `userIndex[B] = 0`
- `accEthPerShare = 0`

**Steps:**

**Block 0-100: Revenue accrues** → fees = `F` wei

**Block 100: A transfers 5e18 cSSV to B**

This triggers `CSSVToken._beforeTokenTransfer()` (CSSVToken.sol:26-30):
- Conditions: `from != to`, `from != address(0)`, `to != address(0)`, `msg.sender != ssvStaking`, `amount > 0` → all true
- Calls `ISSVStaking(ssvStaking).onCSSVTransfer(A, B, 5e18)`

**`onCSSVTransfer` (SSVStaking.sol:169-177):**
1. Check `msg.sender == CSSV_ADDRESS` → yes (called from cSSV token)
2. `_syncFees(s)`:
   - `accEthPerShare += (F * 1e18) / 10e18 = F/10`
3. `_settle(A, s)`:
   - `bal = cSSV.balanceOf(A) = 10e18` (still pre-transfer!)
   - `pending = (10e18 * F/10) / 1e18 = F`
   - `accrued[A] += F`
   - `userIndex[A] = F/10`
4. `_settle(B, s)`:
   - `bal = cSSV.balanceOf(B) = 0` (still pre-transfer!)
   - `pending = 0`
   - `userIndex[B] = F/10`

Then the ERC20 transfer completes: A has 5e18 cSSV, B has 5e18 cSSV.

**Block 100-200: More revenue accrues** → fees = `G` wei

**Block 200: Both claim**
- `_syncFees`: `accEthPerShare += (G * 1e18) / 10e18 = G/10`
- Total `accEthPerShare = F/10 + G/10`

- `_settle(A)`:
  - `pending = (5e18 * (F/10 + G/10 - F/10)) / 1e18 = 5 * G/10 = G/2`
  - `accrued[A] = F + G/2`

- `_settle(B)`:
  - `pending = (5e18 * (F/10 + G/10 - F/10)) / 1e18 = 5 * G/10 = G/2`
  - `accrued[B] = G/2`

**Total distributed:** F + G/2 + G/2 = F + G = total revenue ✓

**Assertions:**
- A captured ALL pre-transfer revenue (F)
- Post-transfer revenue (G) is split 50/50
- B's index was set to `accEthPerShare` at transfer time → no retroactive earnings
- Settlement happens BEFORE the ERC20 balances change (`_beforeTokenTransfer`)
- The `amount` parameter of `onCSSVTransfer` is not used in the current implementation

---

### ES-20: Accumulator Edge Cases

**Category:** Staking — edge cases

**ES-20a: Zero cSSV supply — fees unclaimable**

1. No one has staked. `cSSV.totalSupply() = 0`
2. Cluster operates for 100 blocks, generating fees
3. `_syncFees`:
   - `current = networkTotalEarnings()` > `previous`
   - `packedNewFees > 0`
   - `totalStaked = 0` → skip `accEthPerShare` update (line 196-198)
   - `stakingEthPoolBalance = current` (line 201)
4. User stakes 10e18 SSV at block 100
   - `_syncFees`: no new blocks passed → no change
   - `_settle(user)`: `userIndex = accEthPerShare = 0`
5. 100 more blocks pass
6. User claims:
   - `_syncFees`: `newFees = fees_for_last_100_blocks`
   - `accEthPerShare += (newFees * 1e18) / 10e18`
   - User gets only the last 100 blocks' worth of fees
   - **First 100 blocks' fees are locked in the contract forever** (they increased `stakingEthPoolBalance` but never `accEthPerShare`)

**Implication:** Revenue generated when `cSSV.totalSupply() == 0` is permanently locked. It increases `stakingEthPoolBalance` and `ethDaoBalance` but is never distributable. This is by design — there were no stakers to receive it.

**ES-20b: accEthPerShare monotonicity proof**

- `accEthPerShare` is only modified in `_syncFees` at line 198:
  ```
  s.accEthPerShare += uint128((newFeesWei * PRECISION) / totalStaked);
  ```
- This line is only reached when `current > previous` (line 187) and `totalStaked != 0` (line 196)
- `newFeesWei > 0` (since current > previous and we unpacked)
- The addition never underflows (it's +=)
- **Guaranteed monotonically non-decreasing**

**ES-20c: Dust accumulation**

- `payout = accrued - (accrued % 100_000)`
- Maximum dust per claim = 99_999 wei
- Dust stays in `accrued[user]` → can accumulate across multiple claims
- Example: claim 1 leaves 50_000 dust, next reward adds 60_000 → accrued = 110_000 → payout = 100_000, dust = 10_000
- **Dust is eventually claimable** when it exceeds 100_000 in total

---

### ES-21: MAX_PENDING_REQUESTS (10)

**Category:** Staking — request limits

**Preconditions:**
- User has 100e18 cSSV

**Steps:**
1. `requestUnstake(1e18)` × 10 → all succeed, `requests.length == 10`
2. `requestUnstake(1e18)` → `requests.length == 10 == MAX_PENDING_REQUESTS` → reverts `MaxRequestsAmountReached` (line 84-86)
3. Advance past cooldown
4. `withdrawUnlocked()` → removes all 10 matured requests, transfers 10e18 SSV
5. `requestUnstake(1e18)` → `requests.length == 0 < 10` → succeeds

**Assertions:**
- Exactly 10 pending requests allowed
- 11th reverts
- Withdrawing unlocked requests frees slots

---

### ES-22: MINIMAL_STAKING_AMOUNT

**Category:** Staking — minimum amount

- `stake(999_999_999)` → `999_999_999 < 1_000_000_000` → reverts `StakeTooLow` (line 45-46)
- `stake(1_000_000_000)` → `1_000_000_000 >= 1_000_000_000` → passes
- `stake(0)` → reverts `ZeroAmount` (line 42-44, checked first)

---

### ES-23: `syncFees()` Public Function

**Category:** Staking — public sync

**Steps:**
1. Random user calls `syncFees()`
2. `_syncFees(s)` updates:
   - `sp.ethDaoBalance` = current total earnings
   - `sp.ethDaoIndexBlockNumber` = current block
   - If new fees: `accEthPerShare` increases, `stakingEthPoolBalance` updated
3. No user settlement happens — no `_settle` call
4. Event `FeesSynced` emitted

**Assertions:**
- `accEthPerShare` updated with latest fees
- No specific user's rewards are settled
- `stakingEthPoolBalance` synchronized
- Useful for front-running protection: users can sync before claiming

---

### D. EB × Staking Interaction

---

### ES-24: EB Increase → Higher Network Fees → More Staking Rewards

**Category:** Cross-system — EB affects staking

**Preconditions:**
- 1 cluster with 1 validator, operators [1,2,3,4]
- Implicit EB: vUnits = 10_000
- Network fee packed raw = 35_509
- `daoTotalEthVUnits = 10_000`
- User has 10e18 cSSV staked

**Phase 1: Before EB update (blocks 0-100)**

DAO earnings per block:
```
earningsPerBlock = (1 * networkFee * daoTotalEthVUnits) / VUNITS_PRECISION
= (1 * 35_509 * 10_000) / 10_000
= 35_509 (packed raw)
= 3_550_900 wei
```

Over 100 blocks: `100 * 3_550_900 = 355_090_000 wei`

Staker reward:
```
accEthPerShare += (355_090_000 * 1e18) / 10e18 = 35_509_000
pending = (10e18 * 35_509_000) / 1e18 = 355_090_000 wei
```

**Phase 2: EB update to 64 ETH (newVUnits = 20_000)**

`daoTotalEthVUnits` = 10_000 (baseline from before) + 10_000 (deviation) = 20_000

**Phase 3: After EB update (blocks 100-200)**

DAO earnings per block:
```
earningsPerBlock = (1 * 35_509 * 20_000) / 10_000
= 71_018 (packed raw)
= 7_101_800 wei
```

Over 100 blocks: `100 * 7_101_800 = 710_180_000 wei`

Staker reward for this phase:
```
accEthPerShare += (710_180_000 * 1e18) / 10e18 = 71_018_000
pending += (10e18 * 71_018_000) / 1e18 = 710_180_000 wei
```

**Full chain trace:**
```
                    EB Update
                        │
Blocks 0-100            │  Blocks 100-200
vUnits=10,000           │  vUnits=20,000
networkFee=35,509 raw   │  networkFee=35,509 raw
earnings/block=35,509   │  earnings/block=71,018
                        │
Total: 355,090,000 wei  │  Total: 710,180,000 wei
                        │
Reward/block: 3,550,900 │  Reward/block: 7,101,800
```

**Assertions:**
- Staking rewards exactly doubled after EB update (3,550,900 → 7,101,800 per block)
- Ratio matches vUnits ratio: 20,000 / 10,000 = 2.0×
- `accEthPerShare` reflects both phases correctly
- Total claimable after 200 blocks: 355,090,000 + 710,180,000 = 1,065,270,000 wei

---

### ES-25: Auto-Liquidation Reduces Active Clusters → Less Staking Revenue

**Category:** Cross-system — liquidation impact on staking

**Preconditions:**
- 3 clusters, each with 1 validator (vUnits = 10_000 each)
- `daoTotalEthVUnits = 30_000`
- `ethDaoValidatorCount = 3`
- Network fee packed raw = 35_509

**Phase 1: All 3 clusters active (blocks 0-100)**

DAO earnings per block:
```
earningsPerBlock = (1 * 35_509 * 30_000) / 10_000
= 106_527 (packed raw)
= 10_652_700 wei
```

Over 100 blocks: `1_065_270_000 wei`

**Phase 2: Cluster 1 auto-liquidated via EB update at block 100**
- `_executeLiquidation` calls `sp.updateDAO(false, 1)`:
  - Settles DAO earnings first (to block 100)
  - `ethDaoValidatorCount -= 1` → now 2
  - `daoTotalEthVUnits -= 10_000` (baseline) → now 20_000
  - If cluster had deviation, that's subtracted too

**Phase 3: Only 2 clusters active (blocks 100-200)**

DAO earnings per block:
```
earningsPerBlock = (1 * 35_509 * 20_000) / 10_000
= 71_018 (packed raw)
= 7_101_800 wei
```

Over 100 blocks: `710_180_000 wei`

**Impact on staking:**
```
Phase 1: 10,652,700 wei/block to stakers
Phase 2: 7,101,800 wei/block to stakers
Reduction: 33.3% (one-third of clusters gone)
```

**Assertions:**
- Staking rewards decreased proportionally to reduction in active vUnits
- `daoTotalEthVUnits` correctly tracks the removal
- DAO earnings were settled at exact block of liquidation (no gap)
- The liquidated cluster's fees up to block 100 are already captured in `ethDaoBalance`

---

### ES-26: EB Update on Inactive (Liquidated) Cluster — SSV Cluster

**Category:** EB — SSV cluster EB tracking

**Preconditions:**
- SSV cluster (VERSION_SSV) with 2 validators
- Root committed for this cluster's EB

**Steps:**
1. `updateClusterBalance(...)` with `version == VERSION_SSV`:
   - Merkle proof verified
   - EB limits verified
   - `newVUnits = ebToVUnits(effectiveBalance)`
   - **Only** `_updateEBSnapshot` is called (SSVClusters.sol:418-420)
   - No fee settlement, no vUnit accounting, no liquidation check

**Assertions:**
- `clusterEB[id].vUnits == newVUnits` (stored for future migration)
- `clusterEB[id].lastRootBlockNum == blockNum`
- No operator or DAO vUnit changes
- No balance changes
- The stored vUnits will be used when the cluster migrates to ETH (`migrateClusterToETH`)

---

### ES-27: Full Staking Reward Math — Worked Example

**Category:** Staking — precision verification

**Setup:**
- Network fee = 3_550_929_823 wei/block (packed raw = 35_509, since 3_550_929_823 is not evenly divisible by 100_000... let's verify)
- Actually: `3_550_929_823 % 100_000 = 29_823 ≠ 0` → this would revert `MaxPrecisionExceeded`!
- **Correct packed network fee must be divisible by 100_000.**
- Example: `3_550_900_000 wei` → packed raw = `35_509`
- Unpacked: `35_509 * 100_000 = 3_550_900_000 wei`

**Scenario:**
- 1 cluster, 1 validator, vUnits = 10_000
- Network fee packed raw = 35_509
- User stakes 1_000_000_000_000_000_000 (1e18) SSV → gets 1e18 cSSV
- 1000 blocks of fee accrual

**Step-by-step math:**

1. DAO earnings for 1000 blocks:
   ```
   earningsRaw = (1000 * 35_509 * 10_000) / 10_000 = 35_509_000
   earningsWei = 35_509_000 * 100_000 = 3_550_900_000_000_000
   ```

2. `_syncFees`:
   ```
   newFeesWei = 3_550_900_000_000_000
   accEthPerShare += (3_550_900_000_000_000 * 1e18) / 1e18 = 3_550_900_000_000_000
   ```

3. `_settle(user)`:
   ```
   pending = (1e18 * 3_550_900_000_000_000) / 1e18 = 3_550_900_000_000_000
   ```

4. `claimEthRewards`:
   ```
   claimable = 3_550_900_000_000_000
   dust = 3_550_900_000_000_000 % 100_000 = 0
   payout = 3_550_900_000_000_000
   ```

**Assertions:**
- User receives exactly `3_550_900_000_000_000 wei` (≈0.00355 ETH)
- No precision loss in this case (all values aligned to ETH_DEDUCTED_DIGITS)
- `accEthPerShare` math is exact when totalSupply equals user balance

---

### ES-28: Staking Reward with Multiple Users and Precision

**Category:** Staking — precision under odd ratios

**Setup:**
- User A stakes 3e18 SSV → 3e18 cSSV
- User B stakes 7e18 SSV → 7e18 cSSV
- Total: 10e18 cSSV
- 100 blocks → `newFeesWei = 3_550_900_000_000_000`

**Math:**
```
accEthPerShare += (3_550_900_000_000_000 * 1e18) / 10e18
= 3_550_900_000_000_000 * 1e18 / 10e18
= 355_090_000_000_000 (exact division)
```

`_settle(A)`:
```
pending = (3e18 * 355_090_000_000_000) / 1e18 = 1_065_270_000_000_000
```

`_settle(B)`:
```
pending = (7e18 * 355_090_000_000_000) / 1e18 = 2_485_630_000_000_000
```

Sum: `1_065_270_000_000_000 + 2_485_630_000_000_000 = 3_550_900_000_000_000` ✓

**Now with odd supply (3e18 total):**
```
accEthPerShare += (3_550_900_000_000_000 * 1e18) / 3e18
= 3_550_900_000_000_000_000_000_000_000_000_000 / 3_000_000_000_000_000_000
= 1_183_633_333_333_333 (truncated — lost 1/3 of a wei equivalent)
```

`_settle(user with 3e18)`:
```
pending = (3e18 * 1_183_633_333_333_333) / 1e18 = 3_550_899_999_999_999
```

Actual fees: `3_550_900_000_000_000`
Distributed: `3_550_899_999_999_999`
**Lost to truncation: 1 wei** — acceptable precision loss.

---

### ES-29: requestUnstake Followed by Immediate Claim

**Category:** Staking — unstake + claim interaction

**Preconditions:**
- User has 10e18 cSSV
- Accumulated but unclaimed: 500_000_000_000 wei

**Steps:**
1. `requestUnstake(5e18)`:
   - `_syncFees`: adds new fees
   - `_settleWithBalance(user, 10e18)`: settles with full pre-burn balance
   - Burns 5e18 cSSV → user has 5e18 cSSV
   - Creates unstake request
2. `claimEthRewards()`:
   - `_syncFees`: no new blocks → no change
   - `_settle(user)`: `bal = 5e18` now (post-burn)
   - Claim all accrued (from step 1 settlement + previous accrued)

**Key insight:** The settlement in `requestUnstake` uses the PRE-BURN balance (10e18), so the user gets all rewards up to that point. The claim step then settles with POST-BURN balance (5e18), which at the same block has 0 new pending. So it just claims the already-accrued amount.

**Assertions:**
- User gets all rewards earned by all 10e18 cSSV up to the unstake block
- From unstake block onward, only 5e18 cSSV earns rewards
- Both `requestUnstake` and `claimEthRewards` can be called in same block

---

### ES-30: cSSV Transfer — Mint/Burn Do NOT Trigger Hook

**Category:** Staking — transfer hook filtering

**Code: CSSVToken.sol:26-29:**
```solidity
if (from != to && from != address(0) && to != address(0) && msg.sender != ssvStaking && amount > 0) {
    ISSVStaking(ssvStaking).onCSSVTransfer(from, to, amount);
}
```

**Cases that do NOT trigger `onCSSVTransfer`:**
1. **Mint** (`from == address(0)`) — skipped. Settlement happens via `_settle` in `stake()` before mint.
2. **Burn** (`to == address(0)`) — skipped. Settlement happens via `_settleWithBalance` in `requestUnstake()` before burn.
3. **SSVStaking calls transfer** (`msg.sender == ssvStaking`) — skipped. Prevents reentrancy.
4. **Self-transfer** (`from == to`) — skipped.
5. **Zero amount** (`amount == 0`) — skipped.

**Cases that DO trigger:**
- Normal user-to-user cSSV transfer → calls `onCSSVTransfer(from, to, amount)`

**Assertions:**
- Double-settlement prevented: stake/unstake settle manually, don't also trigger hook
- Transfer hook correctly settles both parties before balance change

---

### ES-31: Staking with Existing Pre-Upgrade DAO Balance

**Category:** Staking — accumulator initialization

**Preconditions:**
- Pre-upgrade: `ethDaoBalance` already has some value from ETH clusters
- `stakingEthPoolBalance = 0` (staking just initialized)
- `accEthPerShare = 0`

**Steps:**
1. First user stakes:
   - `_syncFees`:
     - `current = networkTotalEarnings()` — includes existing ethDaoBalance + new accrual
     - `previous = stakingEthPoolBalance = 0`
     - `newFees = current - 0 = current` (potentially large!)
     - But `totalStaked = 0` (cSSV not yet minted) → **skip accEthPerShare update**
     - `stakingEthPoolBalance = current`
   - `_settle(user)`: `bal = 0` → no-op
   - Mint cSSV

2. Future fees accrue normally, distributed to stakers

**Key insight:** The pre-existing DAO balance at staking launch is effectively "trapped" — it's absorbed into `stakingEthPoolBalance` but never distributed via `accEthPerShare` because `totalSupply == 0` at that moment. This is the correct behavior: pre-staking revenue doesn't belong to stakers.

**Assertions:**
- Pre-existing DAO revenue is not distributed to first staker
- Only NEW revenue after staking launch goes to stakers
- `accEthPerShare` starts at 0 and only grows from post-stake fees

---

### ES-32: EB Update Followed by syncFees — Full Chain

**Category:** Cross-system — end-to-end chain

This traces the COMPLETE path from EB update to staker reward.

**Setup:**
- 1 cluster with 2 validators at implicit EB (vUnits = 20_000)
- Network fee packed raw = 35_509
- `daoTotalEthVUnits = 20_000`
- `ethDaoBalance = 0`, `ethDaoIndexBlockNumber = 0`
- 1 staker with 10e18 cSSV
- `accEthPerShare = 0`, `stakingEthPoolBalance = 0`

**Block 100: EB update to 96 ETH (newVUnits = 30_000)**

1. `_applyClusterFeeUpdates` at block 100 (settling 100 blocks):
   - Cluster balance reduced (fees deducted)
   - Operator snapshots updated

2. `sp.updateDAOEthVUnits(20_000, 30_000)`:
   - **Calls `updateDAOEarnings(sp)` FIRST** (ProtocolLib.sol:144):
     - `ethDaoBalance = networkTotalEarnings()`:
       - `= 0 + (100 * 35_509 * 20_000) / 10_000 = 71_018_000` (packed raw)
       - `= 71_018_000` packed → `7_101_800_000_000 wei` unpacked
     - `ethDaoIndexBlockNumber = 100`
   - Then: `daoTotalEthVUnits = 20_000 + 10_000 = 30_000`

3. EB snapshot stored

**Block 200: Staker calls `claimEthRewards()`**

4. `_syncFees(s)`:
   - `current = networkTotalEarnings()`:
     - `= 71_018_000 + (100 * 35_509 * 30_000) / 10_000`
     - `= 71_018_000 + 106_527_000 = 177_545_000` (packed raw)
   - `previous = stakingEthPoolBalance = 0`
   - `packedNewFees = 177_545_000 - 0 = 177_545_000`
   - `newFeesWei = 177_545_000 * 100_000 = 17_754_500_000_000_000`
   - `accEthPerShare += (17_754_500_000_000_000 * 1e18) / 10e18 = 1_775_450_000_000_000`

5. `_settle(staker)`:
   - `pending = (10e18 * 1_775_450_000_000_000) / 1e18 = 17_754_500_000_000_000`

6. Payout:
   - `claimable = 17_754_500_000_000_000`
   - `payout = 17_754_500_000_000_000` (divisible by 100_000)

**Verification:**
- Phase 1 (blocks 0-100, vUnits=20,000): `100 * 35_509 * 20_000 / 10_000 = 7_101_800` packed → `710_180_000_000 wei`
- Phase 2 (blocks 100-200, vUnits=30,000): `100 * 35_509 * 30_000 / 10_000 = 10_652_700` packed → `1_065_270_000_000 wei`

Wait — let me recalculate more carefully:
- Phase 1 earnings (packed raw): `100 * 35_509 * 20_000 / 10_000 = 71_018_000`
- Phase 2 earnings (packed raw): `100 * 35_509 * 30_000 / 10_000 = 106_527_000`
- Total packed raw: `177_545_000`
- Total wei: `177_545_000 * 100_000 = 17_754_500_000_000_000`

This confirms: staker receives `17_754_500_000_000_000 wei ≈ 0.01775 ETH`

**Assertions:**
- Full chain traced: EB update → DAO vUnit change → higher earnings rate → syncFees captures → accEthPerShare increases → user claims
- DAO earnings settled BEFORE vUnit change (line 144 of ProtocolLib.sol)
- No fees lost in transition
- Staker receives the sum of both phases' revenue

---

## Appendix: Key Code References

| Concept | File | Lines |
|---------|------|-------|
| commitRoot | SSVDAO.sol | 155-200 |
| replaceOracle | SSVDAO.sol | 205-229 |
| setQuorumBps | SSVDAO.sol | 234-239 |
| updateClusterBalance | SSVClusters.sol | 353-423 |
| _applyClusterFeeUpdates | SSVClusters.sol | 463-494 |
| _updateOperatorVUnits | SSVClusters.sol | 496-515 |
| _liquidateAfterEBUpdateIfNeeded | SSVClusters.sol | 524-555 |
| _executeLiquidation | SSVClusters.sol | 557-617 |
| stake | SSVStaking.sol | 41-61 |
| requestUnstake | SSVStaking.sol | 66-94 |
| withdrawUnlocked | SSVStaking.sol | 99-109 |
| claimEthRewards | SSVStaking.sol | 114-145 |
| _syncFees | SSVStaking.sol | 179-203 |
| _settle | SSVStaking.sol | 205-208 |
| _settleWithBalance | SSVStaking.sol | 210-224 |
| onCSSVTransfer | SSVStaking.sol | 169-177 |
| _beforeTokenTransfer | CSSVToken.sol | 26-30 |
| ebToVUnits | ClusterLib.sol | 353-358 |
| vUnitsToEB | ClusterLib.sol | 365-367 |
| updateBalanceWithEB | ClusterLib.sol | 298-313 |
| isLiquidatableWithEB | ClusterLib.sol | 67-84 |
| updateSnapshotSt (ETH) | OperatorLib.sol | 52-72 |
| networkTotalEarnings | ProtocolLib.sol | 85-91 |
| updateDAO | ProtocolLib.sol | 108-120 |
| updateDAOEthVUnits | ProtocolLib.sol | 143-151 |

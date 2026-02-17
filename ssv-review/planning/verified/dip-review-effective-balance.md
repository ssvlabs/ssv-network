# DIP-X vs Implementation: Effective Balance Accounting Review

**Reviewer:** Claude Code
**Date:** 2026-02-17
**DIP Source:** `ssv-review/Internal - [DIP-X] SSV Staking.txt` lines 116–241
**Branch:** `review/dip-effective-balance`

---

## Executive Summary

The Effective Balance (EB) Accounting implementation is **substantially faithful** to the DIP-X specification. All core claims are implemented. Several implementation choices go beyond what the DIP explicitly specifies (e.g., staleness checks, update frequency limits, deviation-only vUnit tracking model), which are reasonable engineering decisions. A few areas warrant attention around edge cases.

**Overall Verdict: 18 MATCH, 1 PARTIAL, 1 OBSERVATION (implementation-specific concern), 0 MISMATCH, 0 GAP**

---

## Detailed Findings

---

### [EB-01] Core Accounting Model Change
**DIP Says:** "Effective Balance Accounting updates how fees, cluster runway, and liquidations are calculated across the SSV Network by aligning them with validators' actual effective balance, rather than assuming a fixed 32 ETH per validator." (line 117)

**Implementation:**
- `ClusterLib.updateBalanceWithEB()` at `ClusterLib.sol:300-315` uses `vUnits = getVUnits(clusterId, validatorCount)` to compute fees scaled by EB rather than validatorCount.
- `ClusterLib.isLiquidatableWithEB()` at `ClusterLib.sol:67-84` uses vUnits for liquidation threshold calculation.
- `OperatorLib.updateSnapshotSt()` at `OperatorLib.sol:52-72` accumulates operator earnings using `effectiveVUnits` instead of raw validatorCount.
- `ProtocolLib.networkTotalEarnings()` at `ProtocolLib.sol:85-91` uses `daoTotalEthVUnits` for DAO earnings.

**Verdict:** MATCH

**Details:** All three dimensions (fees, runway/liquidation, operator earnings) are EB-aware. The implementation consistently uses vUnits throughout the ETH cluster path.

---

### [EB-02] Fees Defined Per 32 ETH
**DIP Says:** "Fees are defined per 32 ETH of effective balance and scale with a cluster's total effective balance" (line 146)

**Implementation:**
- `ClusterLib.ebToVUnits()` at `ClusterLib.sol:355-360`:
  ```solidity
  uint256 vUnitsPerValidator = DEFAULT_EB_PER_VALIDATOR / 1 ether; // = 32
  return uint64(vUnits == 0 ? 0 : (vUnits - 1) / vUnitsPerValidator + 1);
  ```
- `DEFAULT_EB_PER_VALIDATOR = 32 ether` defined at `SSVStorageEB.sol:6`
- `VUNITS_PRECISION = 10_000` at `SSVStorageEB.sol:4`
- Fee calculation in `ClusterLib.updateBalanceWithEB()` at `ClusterLib.sol:311-313`:
  ```solidity
  uint128 networkFeeUnits = (idxNet * units) / VUNITS_PRECISION;
  uint128 usageUnits = (idxOp * units) / VUNITS_PRECISION + networkFeeUnits;
  uint256 usage = uint256(usageUnits) * ETH_DEDUCTED_DIGITS;
  ```
  One validator at 32 ETH = 10,000 vUnits. Division by VUNITS_PRECISION (10,000) normalizes back, so fees scale as `feePerBlock * (effectiveBalance / 32)`.

**Verdict:** MATCH

**Details:** The vUnit system correctly normalizes fees per 32 ETH of effective balance. A validator at 64 ETH = 20,000 vUnits = 2x the fee of a 32 ETH validator.

---

### [EB-03] Total Effective Balance is Cluster-Level Aggregate
**DIP Says:** "total effective balance refers to the cumulative effective balance of all validators belonging to the cluster. All accounting is performed using this aggregated cluster-level value." (line 148)

**Implementation:**
- `ClusterEBSnapshot.vUnits` at `SSVStorageEB.sol:9` stores a single cluster-level value.
- `updateClusterBalance()` at `SSVClusters.sol:350-368` takes `uint32 effectiveBalance` as the total cluster EB.
- `_verifyEBLimits()` at `SSVClusters.sol:452-458` validates against `cluster.validatorCount * MAX_EB_PER_VALIDATOR` and `cluster.validatorCount * DEFAULT_EB_PER_VALIDATOR` — confirming EB is the aggregate of all validators.
- The Merkle leaf encodes `(clusterID, effectiveBalance)` — a single value per cluster, not per validator.

**Verdict:** MATCH

**Details:** The implementation stores and operates on cluster-level aggregated EB, never per-validator. The oracle produces per-cluster Merkle leaves.

---

### [EB-04] SSV Clusters Continue Under Validator-Count Model
**DIP Says:** "Effective balance-based accounting applies only to ETH-based clusters. SSV-based clusters continue operating under the validator-count model until they migrate" (line 150)

**Implementation:**
- `ClusterLib.updateBalanceSSV()` at `ClusterLib.sol:21-29` uses `cluster.validatorCount` directly.
- `ClusterLib.isLiquidatable()` at `ClusterLib.sol:40-55` uses `cluster.validatorCount` for SSV liquidation.
- `_updateClusterBalanceInternal()` at `SSVClusters.sol:414-417`: for SSV clusters (`version != VERSION_ETH`), only the EB snapshot is updated — no balance/fee recalculation.
- `SSVClusters.liquidateSSV()` at `SSVClusters.sol:74-128` uses the SSV path entirely.

**Verdict:** MATCH

**Details:** Clean separation between SSV and ETH paths. SSV clusters are unaffected by EB accounting.

---

### [EB-05] Oracle Set: Permissioned 4 Oracles with 3-of-4 Threshold
**DIP Says:** "the protocol will operate with a permissioned set of four Effective Balance Oracles, operating under a 3-of-4 threshold for oracle commitments." (line 160)

**Implementation:**
- `SSVStorageStaking.sol:32`: `uint32[MAX_DELEGATION_SLOTS] defaultOracleIds` where `MAX_DELEGATION_SLOTS = 4`.
- `SSVDAO.commitRoot()` at `SSVDAO.sol:155-200`:
  ```solidity
  uint256 weight = totalStaked / s.defaultOracleIds.length;  // Equal weight per oracle
  seb.rootCommitments[commitmentKey] += weight;
  uint256 threshold = (totalStaked * s.quorumBps) / BPS_DENOMINATOR;
  ```
- `quorumBps` is initialized to `7500` (75%) per governance parameters.
- With 4 oracles each having 25% weight: 3 oracles = 75% >= 75% threshold = quorum reached.

**Verdict:** MATCH

**Details:** The 3-of-4 threshold is achieved via `quorumBps = 7500` combined with equal weight distribution across 4 oracle slots. The math checks out: 3 * (totalStaked / 4) = 75% of totalStaked >= 75% threshold.

---

### [EB-06] Oracle Consensus: Threshold-Based Commitment
**DIP Says:** "each oracle independently commits the Merkle root representing this snapshot. Once a threshold of oracle commitments is reached, the snapshot is accepted by the protocol" (line 177)

**Implementation:**
- `SSVDAO.commitRoot()` at `SSVDAO.sol:155-200`:
  1. Validates oracle identity: `oracleIdOf[msg.sender] != 0` (line 160)
  2. Prevents double-voting: `hasVoted[commitmentKey][oracleId]` check (line 178)
  3. Accumulates weight (line 182)
  4. On quorum: stores root `ebRoots[blockNum] = merkleRoot` (line 189)
  5. Updates `latestCommittedBlock = blockNum` (line 190)
  6. Emits `RootCommitted` (line 195) or `WeightedRootProposed` (line 199)

**Verdict:** MATCH

**Details:** Each oracle independently calls `commitRoot`. The contract tracks per-oracle votes and accumulated weight. Once the threshold is met, the root is accepted as authoritative. The `hasVoted` mapping is not cleaned up after quorum to prevent re-voting on the same commitment key.

---

### [EB-07] Merkle Tree Structure for Balance Proofs
**DIP Says:** "take a snapshot of all validator balances, aggregate them per cluster, and construct a Merkle tree representing the effective balances of all clusters" (line 176)

**Implementation:**
- `_verifyMerkleProof()` at `SSVClusters.sol:444-450`:
  ```solidity
  MerkleProof.verify(ctx.merkleProof, root,
      keccak256(abi.encodePacked(keccak256(abi.encode(ctx.clusterId, ctx.effectiveBalance)))))
  ```
- Uses OpenZeppelin's `MerkleProof.verify` library.
- Double-hash convention: `keccak256(keccak256(abi.encode(clusterID, effectiveBalance)))` — inner hash prevents second pre-image attacks.
- `clusterID = keccak256(abi.encodePacked(owner, operatorIds))` (from `ClusterLib.validateHashedCluster()` at `ClusterLib.sol:137`).
- `effectiveBalance` is `uint32` in whole ETH.

**Verdict:** MATCH

**Details:** The Merkle leaf structure follows the OpenZeppelin StandardMerkleTree convention with double hashing. The inner encoding uses `abi.encode` (padded) and the outer uses `abi.encodePacked` with `keccak256`, matching the standard pattern.

---

### [EB-08] Cluster Balance Update: Two-Step Process
**DIP Says:** "Effective balance updates are performed in two steps, moving from global observation to cluster-level updates." (line 174)
- Step 1: Oracles commit Merkle root (line 176-177)
- Step 2: Anyone submits proof to update a specific cluster (line 179-180)

**Implementation:**
- Step 1: `SSVDAO.commitRoot()` at `SSVDAO.sol:155-200` — oracles commit root.
- Step 2: `SSVClusters.updateClusterBalance()` at `SSVClusters.sol:350-368` — permissionless, anyone can call with a valid proof.
- The `updateClusterBalance` function takes `blockNum` (identifying which root), `effectiveBalance`, and `merkleProof`.

**Verdict:** MATCH

**Details:** The two-step flow is cleanly separated. `commitRoot` stores the root, `updateClusterBalance` uses it.

---

### [EB-09] Permissionless Cluster Updates
**DIP Says:** "Updating cluster balances is permissionless: anyone can submit a valid proof and bear the transaction cost." (line 180)

**Implementation:**
- `SSVClusters.updateClusterBalance()` at `SSVClusters.sol:350-368`: no access control modifier, no `msg.sender` check. Anyone can call it.
- The function is `external override nonReentrant` — no `onlyOwner` or similar restriction.

**Verdict:** MATCH

**Details:** The function is fully permissionless. The only validation is the Merkle proof itself and the cluster state.

---

### [EB-10] Fee Recalculation on EB Update
**DIP Says:** "When a cluster's effective balance is updated, the protocol updates all related accounting based on the new value. This affects cluster runway calculations as well as future network and operator fee accruals tied to the amount of effective balance being managed." (line 181)

**Implementation:**
- `_updateClusterBalanceInternal()` at `SSVClusters.sol:370-420`:
  1. Settles existing fees using OLD vUnits: `_applyClusterFeeUpdates()` (line 399)
  2. Updates operator vUnits: `_updateOperatorVUnits()` (line 404)
  3. Updates DAO vUnits: `sp.updateDAOEthVUnits()` (line 405)
  4. Updates EB snapshot (line 407)
- `_applyClusterFeeUpdates()` at `SSVClusters.sol:460-491`: explicitly settles fees using `oldVUnits` before switching to new vUnits.

**Verdict:** MATCH

**Details:** The implementation correctly settles all accrued fees at the old rate before switching to the new rate. This prevents retroactive fee changes and ensures accounting integrity.

---

### [EB-11] Auto-Liquidation After EB Increase
**DIP Says:** "If an update causes a cluster to fall below liquidation thresholds, the cluster can be liquidated as part of the same process, ensuring that increases in effective balance are always matched by sufficient funding and collateral." (line 181)

**Implementation:**
- `_liquidateAfterEBUpdateIfNeeded()` at `SSVClusters.sol:521-552`:
  ```solidity
  if (cluster.isLiquidatableWithEB(clusterId, burnRate, ...)) {
      // Decrement operator validator counts
      for (uint256 i; i < operatorIds.length; ++i) {
          op.ethValidatorCount -= cluster.validatorCount;
      }
      _executeLiquidation(clusterOwner, msg.sender, clusterId, ...);
      return true;
  }
  ```
- The liquidation bounty goes to `msg.sender` (the updater), incentivizing updates.
- New vUnits are applied BEFORE the liquidation check (line 402-406), so the check uses the updated EB.

**Verdict:** MATCH

**Details:** The auto-liquidation is correctly positioned after vUnit updates but within the same transaction. The updater receives the liquidation bounty as incentive. Note: this only triggers for EB *increases* (or fee changes that make the cluster undercollateralized) since EB decreases reduce the burn rate.

---

### [EB-12] Default 32 ETH Assumption for New Validators
**DIP Says:** "validators added to or removed from a cluster are initially accounted for using a default assumption of 32 ETH per validator. The actual effective balance of these validators [...] will only be reflected once the next sweep occurs." (line 183)

**Implementation:**
- `ClusterLib.getVUnits()` at `ClusterLib.sol:279-291`:
  ```solidity
  if (vUnits == 0) {
      return uint64(validatorCount) * VUNITS_PRECISION;
  }
  ```
- When `clusterEB.vUnits == 0` (no oracle update yet), the system uses `validatorCount * 10_000` which equals 32 ETH per validator.
- After first `updateClusterBalance`, the stored vUnits are used instead.

**Verdict:** MATCH

**Details:** The implicit/explicit EB distinction is correctly implemented. New clusters and clusters that haven't received an oracle update operate at 32 ETH/validator by default. After the first `updateClusterBalance` call with a Merkle proof, explicit vUnits are stored and used.

---

### [EB-13] EB Bounds: Min 32 ETH, Max 2048 ETH Per Validator
**DIP Says:** Implied by overall design — EB must be within [32, 2048] ETH per validator.

**Implementation:**
- `_verifyEBLimits()` at `SSVClusters.sol:452-458`:
  ```solidity
  if (ctx.effectiveBalance > uint256(cluster.validatorCount) * (MAX_EB_PER_VALIDATOR / 1 ether)) {
      revert EBExceedsMaximum();
  } else if (ctx.effectiveBalance < uint256(cluster.validatorCount) * (DEFAULT_EB_PER_VALIDATOR / 1 ether)) {
      revert EBBelowMinimum();
  }
  ```
- `MAX_EB_PER_VALIDATOR = 2048 ether` at `SSVStorageEB.sol:5`
- `DEFAULT_EB_PER_VALIDATOR = 32 ether` at `SSVStorageEB.sol:6`
- Division by `1 ether` converts to whole ETH for comparison with `effectiveBalance` (uint32 in whole ETH).

**Verdict:** MATCH

**Details:** Bounds are enforced at the per-cluster aggregate level: `validatorCount * 32 <= effectiveBalance <= validatorCount * 2048`. This correctly validates that the average EB per validator is within [32, 2048].

---

### [EB-14] vUnit Precision: Ceiling for ETH→vUnits, Floor for vUnits→ETH
**DIP Says:** Implied by spec: ceiling and floor used for precision safety.

**Implementation:**
- `ClusterLib.ebToVUnits()` at `ClusterLib.sol:355-360`:
  ```solidity
  uint256 vUnits = uint256(effectiveBalance) * VUNITS_PRECISION;
  uint256 vUnitsPerValidator = DEFAULT_EB_PER_VALIDATOR / 1 ether; // = 32
  return uint64(vUnits == 0 ? 0 : (vUnits - 1) / vUnitsPerValidator + 1);
  ```
  This is the standard ceiling division formula: `ceil(x/y) = (x - 1) / y + 1` for `x > 0`.

- `ClusterLib.vUnitsToEB()` at `ClusterLib.sol:367-369`:
  ```solidity
  return uint32((uint256(vUnits) * (DEFAULT_EB_PER_VALIDATOR / 1 ether)) / VUNITS_PRECISION);
  ```
  This is standard floor division (Solidity default).

**Verdict:** MATCH

**Details:** Ceiling for ETH→vUnits ensures fees are never underpaid. Floor for vUnits→ETH ensures displayed EB is never overstated. Both are correct and safe.

**Edge case analysis:**
- `effectiveBalance = 0`: returns 0 vUnits (handled by `vUnits == 0` check).
- `effectiveBalance = 32` (1 validator): `32 * 10000 = 320000`, `(320000 - 1) / 32 + 1 = 9999 + 1 = 10000`. Correct.
- `effectiveBalance = 33` (1 validator): `33 * 10000 = 330000`, `(330000 - 1) / 32 + 1 = 10312 + 1 = 10313`. Ceiling applied correctly.
- `effectiveBalance = 64` (2 validators or 1 validator at 64 ETH): `64 * 10000 = 640000`, `(640000 - 1) / 32 + 1 = 19999 + 1 = 20000`. Correct.

---

### [EB-15] Block Number Monotonicity for Oracle Commits
**DIP Says:** Implied by "at defined intervals" and snapshot ordering requirements.

**Implementation:**
- `SSVDAO.commitRoot()` at `SSVDAO.sol:163-164`:
  ```solidity
  if (blockNum <= seb.latestCommittedBlock) {
      revert StaleBlockNumber();
  }
  ```
- Also checks not in the future at `SSVDAO.sol:168-170`:
  ```solidity
  if (blockNum > block.number) {
      revert FutureBlockNumber();
  }
  ```

**Verdict:** MATCH

**Details:** Strictly monotonically increasing block numbers enforced via `blockNum > latestCommittedBlock` (not `>=`). Future blocks are also rejected. This prevents both stale and premature root submissions.

---

### [EB-16] Staleness Check for Cluster EB Updates
**DIP Says:** Not explicitly stated in DIP but implied by the "next sweep" language and update ordering.

**Implementation:**
- `_verifyEBStaleness()` at `SSVClusters.sol:437-442`:
  ```solidity
  if (ebSnapshot.lastRootBlockNum != 0 && ctx.blockNum <= ebSnapshot.lastRootBlockNum) {
      revert StaleUpdate();
  }
  ```
- Per-cluster staleness: ensures each cluster's EB is updated only with roots newer than the last one used for that cluster.

**Verdict:** MATCH

**Details:** This is an implementation-level safeguard beyond what the DIP explicitly requires. It prevents applying an older EB snapshot to a cluster that has already been updated with a newer one. The `lastRootBlockNum != 0` check allows the first update without a stale check.

---

### [EB-17] Update Frequency Limit
**DIP Says:** Not explicitly stated in DIP.

**Implementation:**
- `_verifyEBUpdateFrequency()` at `SSVClusters.sol:428-435`:
  ```solidity
  if (ebSnapshot.lastUpdateBlock != 0 && block.number < ebSnapshot.lastUpdateBlock + seb.minBlocksBetweenUpdates) {
      revert UpdateTooFrequent();
  }
  ```
- `minBlocksBetweenUpdates` at `SSVStorageEB.sol:24` is a governance parameter.

**Verdict:** MATCH

**Details:** This is a protective measure to prevent rapid-fire updates that could be used for griefing or gas-wasting attacks. While not in the DIP, it's a reasonable engineering addition. The parameter is governance-controlled.

---

### [EB-18] Governance Parameters: quorumBps and replaceOracle
**DIP Says:**
- `quorumBps`: "7500 (75.00%) considering a 3/4 threshold" with update function `setQuorumBps(uint16 quorum)` (line 190-193)
- `replaceOracle(uint32 oracleId, address newOracle)`: "Replaces an existing Oracle with another one." (line 196-197)

**Implementation:**
- `SSVDAO.setQuorumBps()` at `SSVDAO.sol:234-240`:
  ```solidity
  function setQuorumBps(uint16 quorum) external override {
      if (quorum > BPS_DENOMINATOR) revert InvalidQuorum();
      SSVStorageStaking.load().quorumBps = quorum;
      emit QuorumUpdated(quorum);
  }
  ```
- `SSVDAO.replaceOracle()` at `SSVDAO.sol:205-229`:
  ```solidity
  function replaceOracle(uint32 oracleId, address newOracle) external override {
      // Validates non-zero ID and address, prevents duplicate assignments
      // Updates both forward (oracles[id] → address) and reverse (oracleIdOf[address] → id) mappings
  }
  ```

**Verdict:** MATCH

**Details:** Both governance functions match the DIP signatures exactly. `setQuorumBps` correctly validates `quorum <= 10_000`. `replaceOracle` includes additional safety checks (non-zero validation, prevents duplicate assignments).

---

### [EB-19] Deviation-Only vUnit Tracking Model
**DIP Says:** The DIP describes EB accounting at a high level but doesn't prescribe the internal tracking architecture.

**Implementation:**
The implementation uses a "deviation-only" model for operator and DAO vUnit tracking:
- **Baseline**: `ethValidatorCount * VUNITS_PRECISION` (always 32 ETH per validator assumed)
- **Deviation**: `operatorEthVUnits[operatorId]` stores only the excess above baseline
- **Effective**: `effectiveVUnits = baseline + deviation`

This is visible in:
- `OperatorLib.updateSnapshotSt()` at `OperatorLib.sol:60-64`:
  ```solidity
  uint64 storedDeviation = seb.operatorEthVUnits[operatorId];
  uint64 effectiveVUnits = storedDeviation + (uint64(operator.ethValidatorCount) * VUNITS_PRECISION);
  ```
- `ProtocolLib.updateDAO()` at `ProtocolLib.sol:108-120`: Adds/subtracts baseline vUnits with validator count changes.
- `SSVClusters._executeLiquidation()` at `SSVClusters.sol:554-614`: Only subtracts deviation from `operatorEthVUnits`.

**Verdict:** MATCH

**Details:** The deviation-only model is an efficient implementation choice. It avoids storing redundant baseline data and allows validator count changes to automatically adjust the baseline without touching the EB-specific storage. This is internally consistent across all code paths (registration, liquidation, migration, reactivation, EB updates).

---

### [EB-20] Edge Case: Cluster with 0 Validators + EB Update
**DIP Says:** Not explicitly addressed.

**Implementation:**
- `_verifyEBLimits()` at `SSVClusters.sol:452-458`: With `validatorCount == 0`, the limits become `effectiveBalance >= 0` and `effectiveBalance <= 0`, so `effectiveBalance` must be exactly 0. This means `newVUnits = ebToVUnits(0) = 0`.
- `_liquidateAfterEBUpdateIfNeeded()` at `SSVClusters.sol:531`: Returns `false` if `cluster.validatorCount == 0` — no auto-liquidation.
- The EB snapshot will still be updated with `vUnits = 0`.

**Verdict:** MATCH

**Details:** The edge case is handled gracefully. A cluster with 0 validators can only receive an EB update of 0, which is a no-op in effect. The early return in `_liquidateAfterEBUpdateIfNeeded` prevents unnecessary liquidation attempts.

---

### [EB-OBS-1] Operator vUnit Decrement in Auto-Liquidation
**DIP Says:** N/A — implementation detail.

**Implementation:**
- `_liquidateAfterEBUpdateIfNeeded()` at `SSVClusters.sol:541-546`:
  ```solidity
  for (uint256 i; i < operatorIds.length; ++i) {
      ISSVOperators.Operator storage op = s.operators[operatorIds[i]];
      if (op.ethSnapshot.block != 0 && op.snapshot.block != 0) {
          op.ethValidatorCount -= cluster.validatorCount;
      }
  }
  ```

  Note: The condition checks `op.snapshot.block != 0` (SSV snapshot block) in addition to `op.ethSnapshot.block != 0`. This means an operator that was never in an SSV cluster (only ETH) would NOT have its `ethValidatorCount` decremented here.

- **However**, in `_executeLiquidation()` at `SSVClusters.sol:564`, `sp.updateDAO(false, cluster.validatorCount)` is called, which decrements `ethDaoValidatorCount` and `daoTotalEthVUnits` unconditionally.

- Compare with the `liquidate()` function at `SSVClusters.sol:35-69`, which calls `updateClusterOperators()` at line 45-51. Inside `updateClusterOperators()` at `OperatorLib.sol:267-276`, the condition is only `operator.ethSnapshot.block != 0`:
  ```solidity
  if (operator.ethSnapshot.block != 0) {
      ...
      operator.ethValidatorCount -= deltaValidatorCount;
  }
  ```

**Verdict:** OBSERVATION

**Details:** The condition `op.ethSnapshot.block != 0 && op.snapshot.block != 0` in `_liquidateAfterEBUpdateIfNeeded` is more restrictive than the analogous check in `updateClusterOperators()` (which only checks `ethSnapshot.block != 0`). This could cause a discrepancy for ETH-only operators (operators created after the ETH migration who were never in an SSV cluster and thus have `snapshot.block == 0`). In practice, all existing operators should have `snapshot.block != 0` from their initial registration, and new operators get both snapshots initialized via `ensureETHDefaults()` + `registerOperator()`. **However, if an operator is removed (which sets `snapshot.block = 0` and `ethSnapshot.block = 0`), the check wouldn't matter since both would be 0.** The concern is primarily theoretical — operators that somehow have `ethSnapshot.block != 0` but `snapshot.block == 0` would skip the validator count decrement during auto-liquidation but not during normal liquidation. This scenario seems unlikely given current operator lifecycle code, but the inconsistency between the two code paths warrants attention.

---

### [EB-21] DAO vUnit Consistency: Operator Deviations + Baselines
**DIP Says:** Not explicitly specified at the DIP level — this is an implementation invariant.

**Implementation:**
The invariant is: `daoTotalEthVUnits == ethDaoValidatorCount * VUNITS_PRECISION + Σ(all cluster deviations)`

This is maintained across all state transitions:

| Operation | Baseline (validatorCount) | Deviation (operatorEthVUnits) | daoTotalEthVUnits |
|---|---|---|---|
| Register validator | `ethValidatorCount += delta` | No change | `+= delta * VUNITS_PRECISION` |
| Remove validator | `ethValidatorCount -= delta` | No change | `-= delta * VUNITS_PRECISION` |
| EB Update (increase) | No change | `+= newVUnits - oldVUnits` | `+= newVUnits - oldVUnits` |
| EB Update (decrease) | No change | `-= oldVUnits - newVUnits` | `-= oldVUnits - newVUnits` |
| Liquidation | `ethValidatorCount -= count` | `-= deviation` | `-= count * VUNITS_PRECISION + deviation` |
| Migration | `ethValidatorCount += count` | `+= deviation (if explicit EB)` | `+= count * VUNITS_PRECISION + deviation` |
| Reactivation | `ethValidatorCount += count` | `+= deviation (if explicit EB)` | `+= count * VUNITS_PRECISION + deviation` |

Verified across:
- `ProtocolLib.updateDAO()` at `ProtocolLib.sol:108-120`
- `ProtocolLib.updateDAOEthVUnits()` at `ProtocolLib.sol:143-151`
- `SSVClusters._executeLiquidation()` at `SSVClusters.sol:564-598`
- `SSVClusters.migrateClusterToETH()` at `SSVClusters.sol:309-331`
- `SSVClusters.reactivate()` at `SSVClusters.sol:146-181`

**Verdict:** MATCH

**Details:** The deviation-only model maintains the DAO invariant correctly across all paths. Each transition adjusts both operator-level and DAO-level tracking consistently.

---

### [EB-22] Oracle Security: Double-Hash Convention
**DIP Says:** Implied by Merkle tree security requirements and referenced in CLAUDE.md: "Merkle proofs use OpenZeppelin's double-hash convention: keccak256(keccak256(abi.encode(clusterID, effectiveBalance)))"

**Implementation:**
- `_verifyMerkleProof()` at `SSVClusters.sol:447`:
  ```solidity
  keccak256(abi.encodePacked(keccak256(abi.encode(ctx.clusterId, ctx.effectiveBalance))))
  ```
- Uses `abi.encode` (padded) for the inner hash and `abi.encodePacked` for the outer, matching OpenZeppelin's `StandardMerkleTree` convention.

**Verdict:** MATCH

**Details:** The double-hash prevents second pre-image attacks on the Merkle tree. The encoding matches the OpenZeppelin standard exactly.

---

### [EB-23] What Happens When EB Decreases?
**DIP Says:** "The cluster-level update adjusts the cluster's accounting" / "Protocol adjusts its response based on how much the balance has changed" (paraphrased)

**Implementation:**
When EB decreases (e.g., validator slashing):
1. Fees are settled at the OLD (higher) rate: `_applyClusterFeeUpdates(operatorIds, cluster, effectiveOldVUnits, s, sp)` — line 399
2. Operator vUnits decrease: `_updateOperatorVUnits(operatorIds, seb, effectiveOldVUnits, newVUnits)` — line 404, where `deltaPositive = false`, so `operatorEthVUnits[opId] -= deltaAbs`.
3. DAO vUnits decrease: `sp.updateDAOEthVUnits(effectiveOldVUnits, newVUnits)` — line 405.
4. Future fees accrue at the LOWER rate.
5. Liquidation check still runs but is less likely to trigger (lower burn rate).

**Verdict:** MATCH

**Details:** EB decreases are handled symmetrically to increases. The cluster benefits from lower future fees, and the operator/DAO earn less going forward. The settlement at old rates ensures no retroactive adjustment.

---

### [EB-24] What Happens When EB Increases?
**DIP Says:** "ensuring that increases in effective balance are always matched by sufficient funding and collateral" (line 181)

**Implementation:**
When EB increases:
1. Fees settled at OLD rate (line 399)
2. Operator/DAO vUnits increase (lines 404-405)
3. Auto-liquidation check runs with NEW (higher) vUnits (line 409)
4. If cluster becomes undercollateralized at new rate → auto-liquidated
5. Liquidation bounty goes to `msg.sender`

**Verdict:** MATCH

**Details:** The auto-liquidation mechanism ensures that EB increases cannot leave clusters underfunded. This creates a natural incentive for cluster owners to maintain sufficient runway to cover potential EB increases.

---

### [EB-25] What Happens if Oracle Submits Stale Data?
**DIP Says:** Not explicitly addressed.

**Implementation:**
Multiple guards prevent stale data:
1. `commitRoot`: `blockNum > latestCommittedBlock` at `SSVDAO.sol:163` — rejects any root for an older block.
2. `updateClusterBalance`: `blockNum > ebSnapshot.lastRootBlockNum` at `SSVClusters.sol:439` — rejects using an older root than the one already applied to this cluster.
3. `hasVoted[commitmentKey][oracleId]` at `SSVDAO.sol:178` — prevents double voting on the same commitment.

**Verdict:** MATCH

**Details:** Stale data is comprehensively guarded against at both the root commitment level (globally) and the cluster update level (per-cluster). An oracle cannot submit a root for a block older than the latest committed block, and a cluster cannot be updated with a root older than its last applied root.

---

## Summary Table

| Ref | Claim | Verdict |
|-----|-------|---------|
| EB-01 | Core accounting model change to EB | MATCH |
| EB-02 | Fees defined per 32 ETH | MATCH |
| EB-03 | Total EB is cluster-level aggregate | MATCH |
| EB-04 | SSV clusters use validator-count model | MATCH |
| EB-05 | 4 oracles, 3-of-4 threshold | MATCH |
| EB-06 | Threshold-based oracle consensus | MATCH |
| EB-07 | Merkle tree for balance proofs | MATCH |
| EB-08 | Two-step update process | MATCH |
| EB-09 | Permissionless cluster updates | MATCH |
| EB-10 | Fee recalculation on EB update | MATCH |
| EB-11 | Auto-liquidation after EB increase | MATCH |
| EB-12 | Default 32 ETH for new validators | MATCH |
| EB-13 | EB bounds: 32-2048 ETH per validator | MATCH |
| EB-14 | vUnit ceiling/floor precision | MATCH |
| EB-15 | Block number monotonicity | MATCH |
| EB-16 | Per-cluster staleness check | MATCH |
| EB-17 | Update frequency limit | MATCH |
| EB-18 | Governance params (quorumBps, replaceOracle) | MATCH |
| EB-19 | Deviation-only vUnit tracking | MATCH |
| EB-20 | 0 validators + EB update edge case | MATCH |
| EB-OBS-1 | Auto-liquidation operator decrement condition | OBSERVATION |
| EB-21 | DAO vUnit consistency invariant | MATCH |
| EB-22 | Double-hash Merkle proof convention | MATCH |
| EB-23 | EB decrease behavior | MATCH |
| EB-24 | EB increase + auto-liquidation | MATCH |
| EB-25 | Stale oracle data protection | MATCH |

---

## Observations & Recommendations

### 1. EB-OBS-1: Auto-Liquidation Operator Decrement Condition Inconsistency
**Severity:** Low
**Location:** `SSVClusters.sol:543`
**Issue:** The condition `op.ethSnapshot.block != 0 && op.snapshot.block != 0` in `_liquidateAfterEBUpdateIfNeeded` is stricter than `operator.ethSnapshot.block != 0` used in `updateClusterOperators` for the normal liquidation path. While unlikely to cause issues in practice (all operators should have both snapshot blocks initialized), the inconsistency between auto-liquidation and normal liquidation paths could theoretically cause accounting mismatches for edge-case operator states.
**Recommendation:** Align the condition with `updateClusterOperators` (check only `op.ethSnapshot.block != 0`) or add a comment explaining why both are required.

### 2. Implementation Goes Beyond DIP (Positive)
The implementation includes several safeguards not mentioned in the DIP:
- **Update frequency limit** (`minBlocksBetweenUpdates`): prevents rapid-fire EB updates
- **Per-cluster staleness check**: prevents applying older roots to already-updated clusters
- **Future block rejection**: prevents oracle from committing roots for future blocks
- **cSSV totalSupply check**: requires staking to be active before oracle commits

These are all reasonable engineering additions that improve the security and robustness of the system.

### 3. Gas Optimization Note
The `_updateOperatorVUnits` loop at `SSVClusters.sol:503-511` iterates all operators even when `deltaAbs == 0` (which can happen when `newVUnits == storedVUnits`). However, the caller at line 403 already guards with `newVUnits != effectiveOldVUnits`, so this is not actually triggered.

# SSV Network v2.0.0 — Technical Specification

This document is the **source of truth** for design intent, rules, and accounting formulas for the SSV Staking upgrade (v2.0.0), derived from the DIP-X proposal. For step-by-step execution flows and implementation verification, see [FLOWS.md](./FLOWS.md).

| Document | Purpose |
|---|---|
| **SPEC.md** (this file) | Design intent · rules · formulas · invariants · source of truth |
| **FLOWS.md** | Step-by-step execution · preconditions · state mutations · test checklist |

### Task Mapping Guide

When working on a BUG-X, TEST-Y, or FUZZ-Z task, use this map to find the relevant documentation:

| Task area | FLOWS section | SPEC section |
|---|---|---|
| Cluster operations (register, remove, deposit, withdraw, liquidate, reactivate) | §1 Cluster Flows | §1 ETH Payments, §2 Effective Balance Accounting |
| Migration (SSV → ETH) | §2 Migration Flows | §1 ETH Payments — Cluster Migration |
| Effective balance / oracle | §3 Effective Balance Flows | §4 Oracle System |
| Operator operations (fees, earnings, whitelist) | §4 Operator Flows | §10 Accounting Formulas — Fee Settlement Rule |
| Staking / unstaking / rewards | §5 Staking Flows | §3 SSV Staking |
| DAO governance | §6 DAO Governance Flows | §11 Governance Parameters |
| Accounting verification | §1.8 Accounting Invariant | §10 Accounting Formulas |
| Access control | §9 Access Control Matrix | §9 Access Control Matrix |
| Error codes | — | §12 Error Codes |
| Constants | — | §13 Constants |

### Decision Trees

Use these to quickly locate the right section when resolving a BUG/TEST/FUZZ task. Questions are grouped by topic.

---

#### Cluster Accounting

**Q: How do I calculate what a cluster currently owes in fees?**
- ETH cluster → SPEC §10 "ETH Cluster Balance Update" + FLOWS §1.1 State Mutations
- SSV cluster (legacy) → SPEC §10 "SSV Cluster Balance Update (Legacy)"

**Q: What is `cluster.index` and `cluster.networkFeeIndex`?**
- Snapshots of the cumulative operator/network fee indices at the last settlement point. Current debt = `(currentIndex - cluster.index) * vUnits` → SPEC §10 "Accounting Formulas"

**Q: What is `vUnits` and how does it relate to ETH?**
- Internal accounting unit: `vUnits = ceil(effectiveBalanceETH * 10_000 / 32)`. 1 validator at 32 ETH = 10,000 vUnits → SPEC §2 "vUnit System"

**Q: When does a cluster switch from implicit to explicit EB?**
- On first successful `updateClusterBalance` call with a valid Merkle proof. Before that, `clusterEB.vUnits == 0` and the system uses `validatorCount * VUNITS_PRECISION` → SPEC §2 "Implicit vs Explicit EB"

**Q: Does EB affect SSV legacy cluster fee calculations?**
- No. SSV clusters store the EB snapshot (for future migration) but fees continue using `validatorCount * fee`. EB only affects ETH cluster accounting → SPEC §2 "Implicit vs Explicit EB" note

**Q: Can a liquidated cluster withdraw ETH?**
- Yes — `withdraw` does not require an active cluster. Fee settlement is skipped; balance is deducted directly → FLOWS §1.8 preconditions

**Q: Can a liquidated cluster receive deposits?**
- Yes — `deposit` has no active-cluster check. Useful for funding a cluster in preparation for reactivation → FLOWS §1.7, SPEC §1 "Existing Clusters"

**Q: What is the minimum ETH required to reactivate or migrate a cluster?**
- `max(minimumLiquidationCollateral, burnRateThreshold)` where `burnRateThreshold = minimumBlocksBeforeLiquidation * totalBurnRate * vUnits / VUNITS_PRECISION * ETH_DEDUCTED_DIGITS` → SPEC §1 "Minimum ETH Calculation"

---

#### Effective Balance & Oracle

**Q: When is the EB snapshot updated?**
- Always on `updateClusterBalance`, even if the cluster is liquidated. Fee/accounting updates are skipped for inactive clusters, but `clusterEB.vUnits` is always written → SPEC §4 "Behavior on liquidated clusters"

**Q: Does `updateClusterBalance` auto-liquidate?**
- Only for active ETH clusters. If the cluster becomes undercollateralized after the EB update, it is auto-liquidated within the same call → SPEC §4 "Update Flow" step 7

**Q: What happens if oracle quorum is not reached?**
- The `commitRoot` call does NOT revert — it emits `WeightedRootProposed` and persists the partial vote. The root is only committed (and `RootCommitted` emitted) when accumulated weight reaches quorum → SPEC §4 "Failed Quorum Behavior"

**Q: Can oracles re-vote on the same block number with a different root?**
- Yes — `commitmentKey = keccak256(blockNum, merkleRoot)`, so a different root = a different key. Oracles cannot re-vote on the exact same `(blockNum, merkleRoot)` pair → SPEC §4 "Failed Quorum Behavior"

**Q: What is the risk of reactivating a cluster with a stale EB snapshot?**
- If EB increased during liquidation: solvency check passes with less ETH than needed → risk of immediate auto-liquidation after next `updateClusterBalance`. Mitigation: call `updateClusterBalance` before reactivating → SPEC §2 "Stale EB Risk on Reactivation"

**Q: How is the Merkle leaf encoded?**
- `keccak256(keccak256(abi.encode(clusterID, effectiveBalance)))` where `effectiveBalance` is `uint32` in whole ETH and `clusterID = keccak256(abi.encodePacked(owner, sortedOperatorIds))` → SPEC §4 "Merkle Tree Structure"

---

#### Operator Fees & Earnings

**Q: Which fee rate applies after `executeOperatorFee` or `reduceOperatorFee`?**
- Old rate up to (and including) the current block; new rate from the next block onward. The ETH snapshot is settled at the old rate before the new fee is stored → SPEC §10 "Fee Settlement Rule"

**Q: How is operator ETH earnings balance computed?**
- `operator.ethSnapshot.balance + (block.number - ethSnapshot.block) * PackedETH.unwrap(operator.ethFee) * ethValidatorCount` — but scaled by vUnits for EB-weighted clusters → SPEC §10 "ETH Operator Fee Index"

**Q: What happens to operator earnings when an operator is removed?**
- Final SSV and ETH snapshots are settled and stored. Earnings remain withdrawable by the owner even after removal. `operator.owner` is preserved (non-zero) → FLOWS §4.2 State Mutations

**Q: Can an ETH-only operator call `withdrawOperatorEarningsSSV`?**
- Yes (no guard), but it is a no-op — SSV snapshot balance is zero. See SEC-18 → FLOWS §4.8

**Q: What is `DEFAULT_OPERATOR_ETH_FEE` and when is it applied?**
- 1,770,000,000 wei/block/validator. Applied automatically on first ETH cluster interaction for pre-v2 operators that had SSV fee > 0. Operators with SSV fee = 0 get ETH fee = 0 → SPEC §1 "Operator Fee Transition"

---

#### Staking & Rewards

**Q: How are ETH rewards distributed to stakers?**
- Accumulator pattern: `accEthPerShare` grows as DAO earns ETH. On `settle(user)`: `pending = cSSVBalance * (accEthPerShare - userIndex) / 1e18`. Rewards stop accruing for burned cSSV → SPEC §3 "Reward Distribution"

**Q: What happens to rewards when cSSV is transferred?**
- `_beforeTokenTransfer` hook calls `onCSSVTransfer(from, to, amount)` which settles both sender and receiver before the transfer. Rewards earned up to that point stay with the sender → SPEC §3 "cSSV Token Behavior", FLOWS §5.6

**Q: How many unstake requests can be pending at once?**
- Up to `MAX_PENDING_REQUESTS = 2000` per user. Exceeding this reverts with `MaxRequestsAmountReached` → SPEC §3 "Unstaking (Two-Step)"

**Q: Does `withdrawUnlocked` process all matured requests or just one?**
- All matured requests in a single call (swap-and-pop iteration). Immature requests remain untouched → SPEC §3 "Unstaking (Two-Step)"

**Q: What is the minimum stake amount?**
- `MINIMAL_STAKING_AMOUNT = 1,000,000,000` SSV wei → SPEC §13 "Constants"

**Q: What happens if `syncFees` is called when `totalStaked == 0`?**
- `accEthPerShare` is not updated (division by zero avoided). DAO balance is still updated. Fees accrued during this period are effectively lost to stakers (see BUG-6) → FLOWS §5.5

---

#### Cluster Lifecycle & Versioning

**Q: How do I tell if a cluster is ETH or SSV?**
- Check `validateHashedCluster` return value: `version == VERSION_ETH` (2) → ETH cluster in `s.ethClusters`; `version == VERSION_SSV` (1) → SSV cluster in `s.clusters` → SPEC §6 "Type System & Packing"

**Q: What operations are blocked on legacy SSV clusters?**
- Blocked: `registerValidator`, `bulkRegisterValidator`, `removeValidator` (BUG-11), `bulkRemoveValidator` (BUG-11), `reactivate`, `deposit` (SSV), `withdraw` (SSV)
- Allowed: `exitValidator`, `bulkExitValidator`, `liquidate`, `liquidateSSV`, `migrateClusterToETH`, `updateClusterBalance` → SPEC §1 "Existing Clusters"

**Q: What happens to removed operators in a cluster?**
- Removed operators are skipped during `updateClusterOperatorsOnReactivation` and migration. The cluster operates with reduced operator coverage (e.g., 3/4). No on-chain event signals which operators were skipped — detectable off-chain by checking operator states → FLOWS §1.8 note, SPEC §1 "Minimum ETH Calculation" special cases

**Q: Can a cluster be reactivated after migration to ETH?**
- Migration is one-way and irreversible. A migrated cluster that is later liquidated can be reactivated via `reactivate` (ETH flow) → SPEC §1 "Cluster Migration"

---

#### Storage & Data Structures

**Q: Where is ETH cluster state stored vs SSV cluster state?**
- ETH clusters: `StorageData.ethClusters[hashedCluster]` (hashed `Cluster` struct)
- SSV clusters: `StorageData.clusters[hashedCluster]`
- Both use the same key: `keccak256(abi.encodePacked(owner, sortedOperatorIds))` → SPEC §5 "Storage Layout"

**Q: Where is EB data stored?**
- `SSVStorageEB.clusterEB[clusterId]` → `ClusterEBSnapshot{vUnits, lastRootBlockNum, lastUpdateBlock}`
- `SSVStorageEB.operatorEthVUnits[operatorId]` → deviation vUnits per operator
- `SSVStorageEB.ebRoots[blockNum]` → committed Merkle root → SPEC §5 "SSVStorageEB"

**Q: How is `PackedETH` different from raw wei?**
- `PackedETH` stores values divided by `ETH_DEDUCTED_DIGITS` (100,000) to fit in `uint64`. Unpack with `PackedETH.unwrap(x)` which multiplies by 100,000. Operator fees must be divisible by 100,000 → SPEC §6 "Type System & Packing"

**Q: What does `operator.snapshot.block == 0 && operator.ethSnapshot.block == 0` mean?**
- The operator has been removed (`_resetOperatorState` zeroed all fields except `owner`). Such operators are skipped during cluster operations → SPEC §1 "Minimum ETH Calculation" special cases

### Version Delta (v1.x → v2.0.0)

| Area | v1.x | v2.0.0 |
|---|---|---|
| Payment token | SSV | ETH (new clusters); SSV (legacy) |
| Fee unit | SSV/block/validator | ETH/block/validator, scaled by vUnits (EB) |
| Cluster creation | SSV deposit | ETH deposit via `msg.value` |
| Validator count scaling | flat per-validator | EB-weighted via vUnits |
| Operator earnings | SSV | ETH (new) + SSV (legacy accrual continues) |
| Staking | none | SSV → cSSV, earns ETH rewards from network fees |
| Oracle | none | Merkle-root EB oracle with quorum voting |
| Liquidation collateral | SSV-denominated | SSV-denominated (legacy SSV clusters) and ETH-denominated, EB-aware |
| SSV cluster operations | full | blocked (remove, liquidate, and migrate only) |
| Withdraw from liquidated | blocked | allowed (ETH clusters) |

### Related Documents

- [FLOWS.md](./FLOWS.md): Step-by-step contract flows for all external functions.

## Table of Contents

1. [ETH Payments](#1-eth-payments)
2. [Effective Balance Accounting](#2-effective-balance-accounting)
3. [SSV Staking](#3-ssv-staking)
4. [Oracle System](#4-oracle-system)
5. [Storage Layout](#5-storage-layout)
6. [Type System & Packing](#6-type-system--packing)
7. [All Events](#7-all-events)
8. [All External Functions](#8-all-external-functions)
9. [Access Control Matrix](#9-access-control-matrix)
10. [Accounting Formulas](#10-accounting-formulas)
11. [Governance Parameters](#11-governance-parameters)
12. [Error Codes](#12-error-codes)
13. [Constants](#13-constants)

---

## 1. ETH Payments

### Overview

ETH replaces SSV as the payment asset for network and operator fees. All new clusters operate exclusively with ETH. Existing SSV clusters are legacy — they cannot add/remove validators, deposit SSV, or reactivate. The only forward path is migration to ETH.

### New Clusters (ETH-based)

- Operator fees paid in ETH
- Network fees paid in ETH
- Operates with EB accounting
- ETH deposited upfront for runway
- Fees scale with effective balance (vUnits), not validator count

### Existing Clusters (SSV-based, Legacy)

- Continue running with existing SSV runway
- **Blocked operations**: add validators, remove validators, reactivate, deposit SSV, withdraw SSV
- **Allowed operations**: self-liquidate, migrate to ETH, exit validators
- SSV fee accrual continues normally until runway depletes or migration occurs

### Cluster Migration (`migrateClusterToETH`)

- One-way, irreversible
- Single transaction: switches accounting from SSV to ETH
- Only callable by the cluster owner
- Remaining SSV balance refunded to cluster owner
- ETH deposited via `msg.value` as new cluster balance
- Must pass ETH liquidation check post-migration or reverts with `InsufficientBalance`

**Minimum ETH Calculation (Post-Migration Liquidation Check):**

The migrated cluster must have sufficient balance to avoid immediate liquidation. The minimum required ETH is computed in steps:

```
Step 1: Compute vUnits (EB-normalized accounting units)
  vUnits = clusterEB[clusterId].vUnits
  if (vUnits == 0):
    vUnits = validatorCount * VUNITS_PRECISION  // implicit EB (32 ETH/validator)

Step 2: Compute total burn rate (operator fees + network fee)
  operatorFeeSum = Σ(operator.ethFee) for all operators in cluster  // packed wei/block
  networkFee = ethNetworkFee  // packed wei/block
  totalBurnRate = operatorFeeSum + networkFee  // packed wei/block

Step 3: Compute burn-rate-based threshold (how much ETH consumed over liquidation period)
  burnRateThresholdUnits = (minimumBlocksBeforeLiquidation * totalBurnRate * vUnits) / VUNITS_PRECISION
  burnRateThreshold = burnRateThresholdUnits * ETH_DEDUCTED_DIGITS  // convert to wei

Step 4: Take maximum of both thresholds
  minimumETHRequired = max(minimumLiquidationCollateral, burnRateThreshold)
```

**Special Cases:**
- With zero-fee operators: `operatorFeeSum = 0`, so `totalBurnRate = networkFee` only
- The absolute floor is always `minimumLiquidationCollateral` (currently 0.00094 ETH)
- **Removed operators** are skipped during migration (detected by `operator.snapshot.block == 0 && operator.ethSnapshot.block == 0`; their fees do not contribute to `operatorFeeSum`)
- Reactivates a liquidated cluster and emits the `ClusterReactivated` event in addition to `ClusterMigratedToETH`

### Operator Fee Transition

**New operators**: Register with ETH fee only (no SSV fee option)

**Existing operators**:
- SSV fees frozen (cannot modify)
- SSV fee accrual continues for non-migrated clusters
- Default ETH fee assigned automatically on first ETH cluster interaction:
  - If SSV fee = 0 → ETH fee = 0
  - If SSV fee > 0 → ETH fee = `DEFAULT_OPERATOR_ETH_FEE` (1,770,000,000 wei = ~0.00464 ETH/year per 32 ETH validator)

### Breaking Function Signature Changes

| Old Signature | New Signature | Change |
|---|---|---|
| `registerValidator(..., uint256 amount, Cluster)` | `registerValidator(..., Cluster) payable` | `amount` removed, now `payable` |
| `bulkRegisterValidator(..., uint256 amount, Cluster)` | `bulkRegisterValidator(..., Cluster) payable` | `amount` removed, now `payable` |
| `deposit(..., uint256 amount, Cluster)` | `deposit(..., Cluster) payable` | `amount` removed, now `payable` |
| `reactivate(..., uint256 amount, Cluster)` | `reactivate(..., Cluster) payable` | `amount` removed, now `payable` |
| `getBalance(...) returns (uint256)` | `getBalance(...) returns (uint256, uint256)` | Now also returns `ebBalance` |

---

## 2. Effective Balance Accounting

### Overview

Fees are calculated based on a cluster's total effective balance rather than validator count. Effective balance is always an integer number of ETH (e.g. 32 ETH, 64 ETH) — fractional values are not valid, matching the beacon chain's own representation. This supports post-Pectra validators with variable effective balances (32–2048 ETH per validator).

### vUnit System

vUnits are the internal accounting unit that normalizes effective balance:

```
ETH → vUnits (ceiling): vUnits = ceil(effectiveBalanceETH * VUNITS_PRECISION / 32)
vUnits → ETH (floor):   effectiveBalanceETH = floor(vUnits * 32 / VUNITS_PRECISION)

VUNITS_PRECISION = 10,000
```

Examples:
- 1 validator at 32 ETH → 10,000 vUnits
- 1 validator at 64 ETH → 20,000 vUnits
- 3 validators at 32 ETH each → 30,000 vUnits

### Implicit vs Explicit EB

- **Implicit** (default): `clusterEB.vUnits == 0` → system uses `validatorCount * VUNITS_PRECISION`
- **Explicit**: Set after first `updateClusterBalance` call with oracle Merkle proof

> **Note — EB tracking vs EB-based accounting:** While both ETH and SSV clusters can have their EB snapshot updated via `updateClusterBalance`, **only ETH clusters use EB for fee accounting**. SSV legacy clusters store the EB snapshot (for future migration) but continue to use validator-count-based fee calculations (`validatorCount * fee`). The EB snapshot does not affect SSV cluster balance deductions.

### EB Update Constraints

- `effectiveBalance >= validatorCount * 32` (minimum 32 ETH per validator)
- `effectiveBalance <= validatorCount * 2048` (maximum 2048 ETH per validator)
- Block numbers must be strictly monotonically increasing
- Minimum blocks between updates enforced (`minBlocksBetweenUpdates`)

### DAO vUnit Tracking

```
daoTotalEthVUnits = ethDaoValidatorCount * VUNITS_PRECISION + Σ(cluster_deviations)
```

Where deviation = `cluster.vUnits - (cluster.validatorCount * VUNITS_PRECISION)` for clusters with explicit EB.

### Operator vUnit Deviation Cleanup on Liquidation

When a cluster is liquidated (via `liquidate`, `liquidateSSV`, or auto-liquidation in `updateClusterBalance`):
- **Baseline** is removed by decrementing `operator.ethValidatorCount` for each operator
- **Deviation** (explicit EB above baseline) is removed from `operatorEthVUnits[opId]` and `daoTotalEthVUnits`
- Implicit clusters (`clusterEB.vUnits == 0`) have no deviation — only baseline removal applies

### Stale EB Risk on Reactivation

**Oracle behavior:** SSV oracles typically do not proactively update EB for liquidated clusters in their regular sweeps (since fee/accounting updates are skipped for inactive clusters and there is no economic benefit to the liquidated cluster owner). However, **the protocol allows permissionless EB updates** — the `updateClusterBalance` function can be called by anyone (including the cluster owner) on liquidated clusters to refresh the EB snapshot in preparation for reactivation.

**Why this matters:** During the liquidation period, the beacon-chain EB may diverge from the stored snapshot:

- **EB increases** (e.g. owner consolidates validators): reactivation solvency check uses stale lower EB → cluster passes with less ETH than required → auto-liquidation risk on next `updateClusterBalance` (if not updated before reactivation)
- **EB decreases** (e.g. slashing): reactivation solvency check uses stale higher EB → cluster owner overestimates required deposit → wastes ETH (conservative but safe)

**Mitigation:** Cluster owners (or any interested party) can call `updateClusterBalance` on a liquidated cluster **before reactivation** to ensure the stored EB snapshot reflects current beacon-chain state. This eliminates the risk of immediate auto-liquidation after reactivation. If the owner does not perform this update, they should deposit a conservative ETH buffer to account for potential EB drift during the liquidation period.

---

## 3. SSV Staking

### Overview

SSV holders stake tokens → receive cSSV (ERC-20, 1:1 ratio) → earn pro-rata share of ETH protocol revenue (network fees).

### Staking Flow

1. User approves SSV token transfer
2. User calls `stake(amount)` — minimum `MINIMAL_STAKING_AMOUNT` (1,000,000,000) SSV wei
3. SSV tokens transferred to contract
4. cSSV minted to user at 1:1 ratio
5. Rewards begin accruing immediately

### Reward Distribution (Accumulator Pattern)

```solidity
// On syncFees():
currentDaoEarnings = sp.networkTotalEarnings()    // total ETH DAO has earned
newFees = currentDaoEarnings - stakingEthPoolBalance
accEthPerShare += (unpack(newFees) * 1e18) / cSSV.totalSupply()
stakingEthPoolBalance = currentDaoEarnings

// On settle(user):
pending = (cSSVBalance * (accEthPerShare - userIndex[user])) / 1e18
accrued[user] += pending
userIndex[user] = accEthPerShare
```

### Claiming Rewards

- Call `claimEthRewards()` at any time
- Payout truncated to ETH_DEDUCTED_DIGITS precision: `payout = accrued - (accrued % 100_000)`
- Deducted from both `stakingEthPoolBalance` and `sp.ethDaoBalance`
- ETH transferred to user

### cSSV Token Behavior

- Mint: only by SSVStaking on `stake()`
- Burn: only by SSVStaking on `requestUnstake()`
- Transfer hook: `_beforeTokenTransfer` calls `SSVStaking.onCSSVTransfer(from, to, amount)`
  - Settles rewards for both sender and receiver before transfer
  - Ensures rewards accrued up to transfer point stay with original holder
- Retains full DAO governance voting power

### Unstaking (Two-Step)

Stakers may submit multiple withdrawal requests over time. When finalizing an unstake, the staker can claim the **cumulative amount of all requests whose lock period has fully elapsed**, while any requests still in their lock period remain locked. A maximum of **2,000 active withdrawal requests per staker** is supported.

1. **`requestUnstake(amount)`**: Burns cSSV, creates `UnstakeRequest{amount, unlockTime = now + cooldownDuration}`. Reverts with `ZeroAmount` if `amount == 0`, `MaxRequestsAmountReached` if pending request count exceeds `MAX_PENDING_REQUESTS` (2000).

2. **`withdrawUnlocked()`**: After cooldown, returns SSV at 1:1. Processes **all** matured requests in a single call — iterates the full request array, removes every entry where `unlockTime <= block.timestamp` via swap-and-pop, and transfers the cumulative sum. **Immature requests (still in lock period) remain untouched** in the array. Reverts with `NothingToWithdraw` if no matured requests exist.

**Rewards behavior:** Rewards STOP accruing for the unstaked portion at the moment of `requestUnstake`. Previously accrued rewards remain claimable via `claimEthRewards`.

---

## 4. Oracle System

### Overview

Effective Balance Oracles track validator balances on the beacon chain and commit Merkle roots on-chain. The protocol uses a permissioned set of 4 oracles with a 3-of-4 (75%) quorum threshold.

**Initialization:** Oracle addresses, cooldown duration, and quorum are bootstrapped during the upgrade via `initializeSSVStaking`, which sets `StorageStaking.defaultOracleIds`, `cooldownDuration`, and `quorumBps` atomically. The initializer validates `quorumBps != 0 && quorumBps <= 10_000` — zero or out-of-range values revert with `InvalidQuorum`. There is no window where the contract is live with oracles uninitialized or quorum unset.

### Commit Flow (`commitRoot`)

1. Oracle calls `commitRoot(merkleRoot, blockNum)`
2. Contract validates: `blockNum > latestCommittedBlock` (monotonic), `blockNum <= block.number` (not future)
3. Requires `cSSV.totalSupply() > 0` (reverts with `OracleHasZeroWeight` otherwise)
4. Each oracle has equal weight: `weight = totalCSSVSupply / 4`
5. Accumulated weight tracked per `commitmentKey = keccak256(blockNum, merkleRoot)`
6. When `accumulatedWeight >= (totalCSSVSupply * quorumBps) / 10_000`:
   - Root is committed: `ebRoots[blockNum] = merkleRoot`
   - `latestCommittedBlock = blockNum`
   - Cleanup: `delete rootCommitments[commitmentKey]`
   - Emits `RootCommitted`
7. Below quorum: emits `WeightedRootProposed`

**Failed Quorum Behavior:**
- If a proposal fails to reach quorum (e.g., only 2 of 4 oracles vote), the `hasVoted[commitmentKey][oracleId]` mappings and `rootCommitments[commitmentKey]` persist indefinitely
- Oracles cannot re-vote on the exact same `(blockNum, merkleRoot)` pair (reverts with `AlreadyVoted`)
- Oracles **can** vote on the same `blockNum` with a **different** `merkleRoot` since the `commitmentKey` is computed from both parameters
- No automatic cleanup occurs for failed proposals — storage entries remain until overwritten by future successful commits or contract upgrade
- If the last oracle to vote still does not bring the proposal to quorum, the state remains unchanged (no root is committed, no cleanup occurs)

### Merkle Tree Structure (OpenZeppelin StandardMerkleTree compatible)

**Leaf encoding**: `keccak256(keccak256(abi.encode(clusterID, effectiveBalance)))`
- Double-hash prevents second pre-image attacks
- `clusterID`: `keccak256(abi.encodePacked(owner, sortedOperatorIds))`
- `effectiveBalance`: `uint32` in whole ETH

**Tree construction**:
- Leaves sorted by hash value
- Internal nodes: siblings sorted before hashing (smaller hash first)
- Odd nodes duplicated

### Update Flow (`updateClusterBalance`)

Permissionless — anyone can submit a valid proof:

1. Verify committed root exists for `blockNum`
2. Verify update frequency (min blocks between updates)
3. Verify staleness (blockNum > last root used for this cluster)
4. Verify Merkle proof against committed root
5. Verify EB limits (32–2048 ETH per validator)
6. Convert to vUnits, update EB snapshot
7. **ETH clusters only**: apply fee settlements, update operator/DAO vUnit deviations, auto-liquidate if undercollateralized
8. **SSV clusters**: no fee/accounting updates; EB snapshot stored for future migration only

**Behavior on liquidated clusters:** The EB snapshot (`clusterEB[clusterId].vUnits`) is **always updated**, even if the cluster is liquidated (`cluster.active == false`). Fee settlements, vUnit deviation updates, and the auto-liquidation check are all skipped. `ClusterBalanceUpdated` is still emitted. This means the stale EB is corrected in storage even while the cluster is inactive, so that reactivation uses the latest known EB.

**SSV cluster accounting:** Legacy SSV clusters continue to use `validatorCount`-based fee calculations (see "SSV Cluster Balance Update (Legacy)" in Accounting Formulas). The EB snapshot is stored but does not affect fee deductions — it only prepares the cluster for future migration to ETH.

### Oracle API (External Reference)

The SSV Oracle (`github.com/ssvlabs/ssv-oracle`) exposes:
- `GET /api/commit` — latest committed root info
- `GET /api/proof/{clusterId}` — Merkle proof for a specific cluster

---

## 5. Storage Layout

### SSVStorage (`keccak256("ssv.network.storage.main") - 1`)

```solidity
struct StorageData {
    mapping(bytes32 => bytes32) validatorPKs;         // keccak256(pubkey, owner) → hashed(operatorIds | active)
    mapping(bytes32 => bytes32) clusters;              // SSV clusters: keccak256(owner, opIds) → clusterHash
    mapping(bytes32 => uint64) operatorsPKs;           // keccak256(pubkey) → operatorId
    mapping(SSVModules => address) ssvContracts;       // module enum → implementation
    mapping(uint64 => address) operatorsWhitelist;     // operatorId → whitelist address/contract
    mapping(uint64 => OperatorFeeChangeRequest) operatorFeeChangeRequests;
    mapping(uint64 => Operator) operators;             // operatorId → Operator struct
    IERC20 token;                                      // SSV ERC-20
    Counters.Counter lastOperatorId;                   // auto-increment
    mapping(address => mapping(uint256 => uint256)) addressWhitelistedForOperators; // bitmap
    mapping(bytes32 => bytes32) ethClusters;            // ETH clusters: same key → clusterHash
}
```

### Operator Struct

```solidity
struct Operator {
    uint32 validatorCount;       // SSV validator count
    PackedSSV fee;               // SSV fee (packed /10M)
    address owner;
    bool whitelisted;            // private flag
    Snapshot snapshot;           // SSV earnings: {uint32 block, uint64 index, PackedSSV balance}
    uint32 ethValidatorCount;    // ETH validator count
    PackedETH ethFee;            // ETH fee (packed /100K)
    EthSnapshot ethSnapshot;     // ETH earnings: {uint32 block, uint64 index, PackedETH balance}
}
```

### Cluster Struct

```solidity
struct Cluster {
    uint32 validatorCount;
    uint64 networkFeeIndex;     // snapshot of cumulative network fee index
    uint64 index;               // snapshot of cumulative operator fee index
    bool active;
    uint256 balance;            // ETH wei (ETH clusters) or SSV tokens (SSV clusters)
}
```

### SSVStorageProtocol (`keccak256("ssv.network.storage.protocol") - 1`)

```solidity
struct StorageProtocol {
    // SSV (legacy) fields
    uint32 networkFeeIndexBlockNumber;
    uint32 daoValidatorCount;
    uint32 daoIndexBlockNumber;
    uint32 validatorsPerOperatorLimit;
    PackedSSV networkFee;
    uint64 networkFeeIndex;
    PackedSSV daoBalance;
    uint64 minimumBlocksBeforeLiquidationSSV;
    PackedSSV minimumLiquidationCollateralSSV;
    uint64 declareOperatorFeePeriod;
    uint64 executeOperatorFeePeriod;
    uint64 operatorMaxFeeIncrease;
    uint64 operatorMaxFeeSSV;

    // ETH fields
    uint32 ethNetworkFeeIndexBlockNumber;
    uint32 ethDaoValidatorCount;
    uint32 ethDaoIndexBlockNumber;
    PackedETH ethNetworkFee;
    uint64 ethNetworkFeeIndex;
    PackedETH ethDaoBalance;
    PackedETH minimumLiquidationCollateral;
    uint64 minimumBlocksBeforeLiquidation;
    PackedETH operatorMaxFee;

    // EB fields
    uint64 daoTotalEthVUnits;
    PackedETH minimumOperatorEthFee;
}
```

### SSVStorageEB (`keccak256("ssv.network.storage.eb") - 1`)

```solidity
struct StorageEB {
    mapping(uint64 => bytes32) ebRoots;                    // blockNum → Merkle root
    mapping(bytes32 => ClusterEBSnapshot) clusterEB;       // clusterId → EB snapshot
    mapping(uint64 => uint64) operatorEthVUnits;           // operatorId → deviation vUnits
    uint64 latestCommittedBlock;
    uint32 minBlocksBetweenUpdates;
    mapping(bytes32 => uint256) rootCommitments;           // commitKey → accumulated weight
    mapping(bytes32 => mapping(uint32 => bool)) hasVoted;  // commitKey → oracleId → voted
}

struct ClusterEBSnapshot {
    uint64 vUnits;              // 0 = implicit (use validatorCount * 10_000)
    uint64 lastRootBlockNum;    // block of last root used
    uint64 lastUpdateBlock;     // actual block.number of last update
}
```

### SSVStorageStaking (`keccak256("ssv.network.storage.staking") - 1`)

```solidity
struct StorageStaking {
    uint64 cooldownDuration;
    PackedETH stakingEthPoolBalance;
    uint128 accEthPerShare;                                // scaled by 1e18
    mapping(address => uint256) userIndex;
    mapping(address => uint256) accrued;                   // unclaimed ETH in wei
    mapping(uint32 => address) oracles;                    // oracleId → address
    mapping(address => uint32) oracleIdOf;                 // address → oracleId
    uint32[4] defaultOracleIds;
    uint16 quorumBps;
    mapping(address => UnstakeRequest[]) withdrawalRequests;
}

struct UnstakeRequest {
    uint192 amount;
    uint64 unlockTime;
}
```

---

## 6. Type System & Packing

### PackedSSV (uint64)

```
Pack:   raw = value / 10_000_000
Unpack: value = raw * 10_000_000
```

Reverts with `MaxPrecisionExceeded` if `value % 10_000_000 != 0`.

### PackedETH (uint64)

```
Pack:   raw = value / 100_000
Unpack: value = raw * 100_000
```

Reverts with `MaxPrecisionExceeded` if `value % 100_000 != 0`.

### Version Constants

```
VERSION_SSV = 0       // Legacy SSV-fee clusters
VERSION_ETH = 1       // New ETH-fee clusters
VERSION_UNDEFINED = 255
```

### Cluster Hashing

```solidity
keccak256(abi.encodePacked(
    cluster.validatorCount,
    cluster.networkFeeIndex,
    cluster.index,
    cluster.balance,
    cluster.active
))
```

### Cluster ID (Identity Key)

```solidity
keccak256(abi.encodePacked(ownerAddress, operatorIds))
```

---

## 7. All Events

### Operator Events

```solidity
event OperatorAdded(uint64 indexed operatorId, address indexed owner, bytes publicKey, uint256 fee);
event OperatorRemoved(uint64 indexed operatorId);
event OperatorFeeDeclared(address indexed owner, uint64 indexed operatorId, uint256 blockNumber, uint256 fee);
event OperatorFeeDeclarationCancelled(address indexed owner, uint64 indexed operatorId);
event OperatorFeeExecuted(address indexed owner, uint64 indexed operatorId, uint256 blockNumber, uint256 fee);
event OperatorWithdrawn(address indexed owner, uint64 indexed operatorId, uint256 value);
event OperatorWithdrawnSSV(address indexed owner, uint64 indexed operatorId, uint256 value);
event OperatorPrivacyStatusUpdated(uint64[] operatorIds, bool toPrivate);
event FeeRecipientAddressUpdated(address indexed owner, address recipientAddress);
```

### Whitelist Events

```solidity
event OperatorMultipleWhitelistUpdated(uint64[] operatorIds, address[] whitelistAddresses);
event OperatorMultipleWhitelistRemoved(uint64[] operatorIds, address[] whitelistAddresses);
event OperatorWhitelistingContractUpdated(uint64[] operatorIds, address whitelistingContract);
```

### Validator Events

```solidity
event ValidatorAdded(address indexed owner, uint64[] operatorIds, bytes publicKey, bytes shares, Cluster cluster);
event ValidatorRemoved(address indexed owner, uint64[] operatorIds, bytes publicKey, Cluster cluster);
event ValidatorExited(address indexed owner, uint64[] operatorIds, bytes publicKey);
```

### Cluster Events

```solidity
event ClusterLiquidated(address indexed owner, uint64[] operatorIds, Cluster cluster);
event ClusterReactivated(address indexed owner, uint64[] operatorIds, Cluster cluster);
event ClusterMigratedToETH(address indexed owner, uint64[] operatorIds, uint256 ethDeposited, uint256 ssvRefunded, uint32 effectiveBalance, Cluster cluster);
event ClusterWithdrawn(address indexed owner, uint64[] operatorIds, uint256 value, Cluster cluster);
event ClusterDeposited(address indexed owner, uint64[] operatorIds, uint256 value, Cluster cluster);
event ClusterBalanceUpdated(address indexed owner, uint64[] operatorIds, uint64 indexed blockNum, uint32 effectiveBalance, Cluster cluster);
```

### DAO Events

```solidity
event NetworkFeeUpdated(uint256 oldFee, uint256 newFee);
event NetworkFeeUpdatedSSV(uint256 oldFee, uint256 newFee);
event NetworkEarningsWithdrawn(uint256 value, address recipient);
event OperatorFeeIncreaseLimitUpdated(uint64 value);
event DeclareOperatorFeePeriodUpdated(uint64 value);
event ExecuteOperatorFeePeriodUpdated(uint64 value);
event LiquidationThresholdPeriodUpdated(uint64 value);
event LiquidationThresholdPeriodSSVUpdated(uint64 value);
event MinimumLiquidationCollateralUpdated(uint256 value);
event MinimumLiquidationCollateralSSVUpdated(uint256 value);
event OperatorMaximumFeeUpdated(uint256 maxFee);
event MinimumOperatorEthFeeUpdated(uint256 minFee);
event RootCommitted(bytes32 indexed merkleRoot, uint64 indexed blockNum);
event WeightedRootProposed(bytes32 indexed merkleRoot, uint64 indexed blockNum, uint256 accumulatedWeight, uint256 quorum, uint32 oracleId, address oracle);
event OracleReplaced(uint32 indexed oracleId, address indexed oldOracle, address indexed newOracle);
event QuorumUpdated(uint16 newQuorum);
event CooldownDurationUpdated(uint64 newCooldownDuration);
```

### Staking Events

```solidity
event Staked(address indexed user, uint256 amount);
event UnstakeRequested(address indexed user, uint256 amount, uint256 unlockTime);
event UnstakedWithdrawn(address indexed user, uint256 amount);
event FeesSynced(uint256 newFeesWei, uint256 accEthPerShare);
event RewardsSettled(address indexed user, uint256 pending, uint256 accrued, uint256 userIndex);
event RewardsClaimed(address indexed user, uint256 amount);
event ERC20Rescued(address indexed token, address indexed to, uint256 amount);
```

### Module Events

```solidity
event ModuleUpgraded(SSVModules indexed moduleId, address moduleAddress);
```

---

## 8. All External Functions

### SSVOperators

```solidity
function registerOperator(bytes calldata publicKey, uint256 fee, bool setPrivate) external returns (uint64)
function removeOperator(uint64 operatorId) external nonReentrant
function declareOperatorFee(uint64 operatorId, uint256 fee) external
function executeOperatorFee(uint64 operatorId) external
function cancelDeclaredOperatorFee(uint64 operatorId) external
function reduceOperatorFee(uint64 operatorId, uint256 fee) external
function setOperatorsPrivateUnchecked(uint64[] calldata operatorIds) external
function setOperatorsPublicUnchecked(uint64[] calldata operatorIds) external
function withdrawOperatorEarnings(uint64 operatorId, uint256 amount) external nonReentrant
function withdrawAllOperatorEarnings(uint64 operatorId) external nonReentrant
function withdrawAllVersionOperatorEarnings(uint64 operatorId) external nonReentrant
function withdrawOperatorEarningsSSV(uint64 operatorId, uint256 amount) external nonReentrant
function withdrawAllOperatorEarningsSSV(uint64 operatorId) external nonReentrant
```

### SSVOperatorsWhitelist

```solidity
function setOperatorsWhitelists(uint64[] calldata operatorIds, address[] calldata whitelistAddresses) external
function removeOperatorsWhitelists(uint64[] calldata operatorIds, address[] calldata whitelistAddresses) external
function setOperatorsWhitelistingContract(uint64[] calldata operatorIds, ISSVWhitelistingContract whitelistingContract) external
function removeOperatorsWhitelistingContract(uint64[] calldata operatorIds) external
```

### SSVValidators

```solidity
function registerValidator(bytes calldata publicKey, uint64[] memory operatorIds, bytes calldata sharesData, Cluster memory cluster) external payable
function bulkRegisterValidator(bytes[] memory publicKeys, uint64[] memory operatorIds, bytes[] calldata sharesData, Cluster memory cluster) external payable
function removeValidator(bytes calldata publicKey, uint64[] memory operatorIds, Cluster memory cluster) external
function bulkRemoveValidator(bytes[] calldata publicKeys, uint64[] memory operatorIds, Cluster memory cluster) external
function exitValidator(bytes calldata publicKey, uint64[] calldata operatorIds) external
function bulkExitValidator(bytes[] calldata publicKeys, uint64[] calldata operatorIds) external
```

### SSVClusters

```solidity
function liquidate(address clusterOwner, uint64[] calldata operatorIds, Cluster memory cluster) external nonReentrant
function liquidateSSV(address clusterOwner, uint64[] calldata operatorIds, Cluster memory cluster) external nonReentrant
function reactivate(uint64[] calldata operatorIds, Cluster memory cluster) external payable
function deposit(address clusterOwner, uint64[] calldata operatorIds, Cluster memory cluster) external payable
function withdraw(uint64[] calldata operatorIds, uint256 amount, Cluster memory cluster) external nonReentrant
function migrateClusterToETH(uint64[] calldata operatorIds, Cluster memory cluster) external payable
function updateClusterBalance(uint64 blockNum, address clusterOwner, uint64[] calldata operatorIds, Cluster memory cluster, uint32 effectiveBalance, bytes32[] calldata merkleProof) external nonReentrant
```

### SSVDAO

```solidity
function updateNetworkFee(uint256 fee) external                          // onlyOwner
function updateNetworkFeeSSV(uint256 fee) external                       // onlyOwner
function withdrawNetworkSSVEarnings(uint256 amount) external nonReentrant // onlyOwner
function updateOperatorFeeIncreaseLimit(uint64 percentage) external       // onlyOwner
function updateDeclareOperatorFeePeriod(uint64 timeInSeconds) external    // onlyOwner
function updateExecuteOperatorFeePeriod(uint64 timeInSeconds) external    // onlyOwner
function updateLiquidationThresholdPeriod(uint64 blocks) external        // onlyOwner
function updateLiquidationThresholdPeriodSSV(uint64 blocks) external     // onlyOwner
function updateMinimumLiquidationCollateral(uint256 amount) external     // onlyOwner
function updateMinimumLiquidationCollateralSSV(uint256 amount) external  // onlyOwner
function updateMaximumOperatorFee(uint256 maxFee) external               // onlyOwner
function updateMinimumOperatorEthFee(uint256 minFee) external            // onlyOwner
function commitRoot(bytes32 merkleRoot, uint64 blockNum) external        // oracle only
function replaceOracle(uint32 oracleId, address newOracle) external      // onlyOwner
function setQuorumBps(uint16 quorum) external                            // onlyOwner
function setUnstakeCooldownDuration(uint64 duration) external            // onlyOwner
```

### SSVStaking

```solidity
function syncFees() external nonReentrant
function stake(uint256 amount) external nonReentrant
function requestUnstake(uint256 amount) external nonReentrant
function withdrawUnlocked() external nonReentrant
function claimEthRewards() external nonReentrant
function rescueERC20(address token, address to, uint256 amount) external nonReentrant // onlyOwner
function onCSSVTransfer(address from, address to, uint256 amount) external           // cSSV only
```

### SSVNetwork (Proxy-level)

```solidity
function initialize(...) external initializer onlyProxy
function setFeeRecipientAddress(address recipientAddress) external    // anyone
function updateModule(SSVModules moduleId, address moduleAddress) external // onlyOwner
function getVersion() external pure returns (string memory)           // "v2.0.0"
```

---

## 9. Access Control Matrix

| Role | Who | Functions |
|---|---|---|
| **Owner** | Contract owner (Ownable2Step) | All `update*`, `withdraw*Network*`, `replaceOracle`, `setQuorumBps`, `setUnstakeCooldownDuration`, `updateModule`, `rescueERC20`, `_authorizeUpgrade` |
| **Operator Owner** | `msg.sender == operator.owner` | `removeOperator`, `declareOperatorFee`, `executeOperatorFee`, `cancelDeclaredOperatorFee`, `reduceOperatorFee`, `setOperators*`, `withdraw*OperatorEarnings*` |
| **Cluster Owner** | `msg.sender == owner` in cluster key | `reactivate`, `withdraw`, `migrateClusterToETH`, `registerValidator`, `bulkRegisterValidator`, `removeValidator`, `bulkRemoveValidator`, `exitValidator`, `bulkExitValidator` |
| **Oracle** | `oracleIdOf[msg.sender] != 0` | `commitRoot` |
| **cSSV Token** | `msg.sender == CSSV_ADDRESS` | `onCSSVTransfer` |
| **Anyone** | Any address | `liquidate` (if liquidatable), `liquidateSSV` (if liquidatable), `deposit`, `updateClusterBalance`, `registerOperator`, `syncFees`, `stake`, `requestUnstake`, `withdrawUnlocked`, `claimEthRewards`, `setFeeRecipientAddress`, all view functions |

---

## 10. Accounting Formulas

### Fee Settlement Rule

When an operator fee changes (`executeOperatorFee`, `reduceOperatorFee`), the operator's ETH snapshot is updated **before** the new fee is stored. This ensures all earnings accrued up to the current block are settled at the **old** fee rate. The new fee applies only to blocks going forward — there is no retroactive impact on cluster index calculations.

```
// On fee change:
operator.ethSnapshot.balance += (block.number - ethSnapshot.block) * PackedETH.unwrap(operator.ethFee)
operator.ethSnapshot.block = block.number
operator.ethFee = newFee   // takes effect from this block onward
```

### ETH Network Fee Index

```
currentIndex = sp.ethNetworkFeeIndex + (block.number - sp.ethNetworkFeeIndexBlockNumber) * PackedETH.unwrap(sp.ethNetworkFee)
```

### ETH Operator Fee Index

```
operator.ethSnapshot.index += (block.number - ethSnapshot.block) * PackedETH.unwrap(operator.ethFee)
```

### ETH Operator Earnings (with EB)

```
effectiveVUnits = seb.operatorEthVUnits[operatorId] + operator.ethValidatorCount * VUNITS_PRECISION
operator.ethSnapshot.balance += (blockDiff * ethFee * effectiveVUnits) / VUNITS_PRECISION
```

### ETH Cluster Balance Update

```
clusterVUnits = (seb.clusterEB[id].vUnits == 0) ? validatorCount * 10_000 : seb.clusterEB[id].vUnits

idxOp = clusterIndex - cluster.index
idxNet = currentNetworkFeeIndex - cluster.networkFeeIndex
networkFeeUnits = (idxNet * clusterVUnits) / VUNITS_PRECISION
operatorFeeUnits = (idxOp * clusterVUnits) / VUNITS_PRECISION
totalFees = (networkFeeUnits + operatorFeeUnits) * ETH_DEDUCTED_DIGITS

cluster.balance = max(0, cluster.balance - totalFees)
```

### SSV Network Fee Index (Legacy)

```
currentIndex = sp.networkFeeIndex + (block.number - sp.networkFeeIndexBlockNumber) * PackedSSV.unwrap(sp.networkFee)
```

### SSV Cluster Balance Update (Legacy)

```
usage = (clusterIndexSSV - cluster.index + currentNetworkFeeIndexSSV - cluster.networkFeeIndex) * cluster.validatorCount
cluster.balance = max(0, cluster.balance - unpack(usage))
```

### ETH Liquidation Check

```
burnRate = Σ PackedETH.unwrap(operator.ethFee) for all operators in cluster
networkFee = PackedETH.unwrap(sp.ethNetworkFee)
thresholdUnits = (minimumBlocksBeforeLiquidation * (burnRate + networkFee) * vUnits) / VUNITS_PRECISION

liquidatable = (balance < unpack(minimumLiquidationCollateral))
            || (balance < thresholdUnits * ETH_DEDUCTED_DIGITS)
```

### SSV Liquidation Check (Legacy)

```
burnRate = Σ PackedSSV.unwrap(operator.fee)
networkFee = PackedSSV.unwrap(sp.networkFee)

liquidatable = (balance < unpack(minimumLiquidationCollateralSSV))
            || (balance < unpack((burnRate + networkFee) * validatorCount * minimumBlocksBeforeLiquidationSSV))
```

### Staking Reward Accumulation

```
// syncFees:
newDaoEarnings = sp.networkTotalEarnings()    // ETH DAO total
newFees = newDaoEarnings - stakingEthPoolBalance
accEthPerShare += (unpack(newFees) * 1e18) / cSSV.totalSupply()
stakingEthPoolBalance = newDaoEarnings

// settle(user):
pending = (cSSVBalance * (accEthPerShare - userIndex[user])) / 1e18
accrued[user] += pending
userIndex[user] = accEthPerShare
```

---

## 11. Governance Parameters

### ETH Cluster Parameters

| Parameter | Initial Value | Update Function |
|---|---|---|
| `ethNetworkFee` | 0.000000003550929823 ETH/block (~0.00928 ETH/year) | `updateNetworkFee(uint256)` |
| `minimumLiquidationCollateral` | 0.00094 ETH | `updateMinimumLiquidationCollateral(uint256)` |
| `minimumBlocksBeforeLiquidation` | 50,190 blocks (~7 days) | `updateLiquidationThresholdPeriod(uint64)` |
| `operatorMaxFee` | TBD | `updateMaximumOperatorFee(uint256)` |
| `minimumOperatorEthFee` | TBD | `updateMinimumOperatorEthFee(uint256)` |

### SSV Cluster Parameters (Legacy)

| Parameter | Current Value | Proposed Value | Update Function |
|---|---|---|---|
| `networkFee` (SSV) | current | current | `updateNetworkFeeSSV(uint256)` |
| `minimumLiquidationCollateralSSV` | 1.53 SSV | 0.883 SSV | `updateMinimumLiquidationCollateralSSV(uint256)` |
| `minimumBlocksBeforeLiquidationSSV` | 100,380 (~14 days) | 100,380 (~14 days) | `updateLiquidationThresholdPeriodSSV(uint64)` |
| `operatorMaxFeeSSV` | current | -- | No update function (read-only, frozen) |

### Staking Parameters

| Parameter | Initial Value | Update Function |
|---|---|---|
| `cooldownDuration` | 604,800 seconds (7 days) | `setUnstakeCooldownDuration(uint64)` |

**Note on units:** `cooldownDuration` is measured in **seconds** (timestamp-based, via `block.timestamp`), not blocks. The value 604,800 = 7 days in seconds. See `SSVStaking.sol:88`: `uint64(block.timestamp + s.cooldownDuration)`.

### Oracle Parameters

| Parameter | Initial Value | Update Function |
|---|---|---|
| `quorumBps` | 7,500 (75%) | `setQuorumBps(uint16)` |
| Oracle set | 4 oracles | `replaceOracle(uint32, address)` |

### Operator Fee Parameters

| Parameter | Value | Update Function |
|---|---|---|
| `defaultOperatorETHFee` | 1,770,000,000 wei (~0.00464 ETH/year) | Hardcoded |
| `declareOperatorFeePeriod` | Governance-set | `updateDeclareOperatorFeePeriod(uint64)` |
| `executeOperatorFeePeriod` | Governance-set | `updateExecuteOperatorFeePeriod(uint64)` |
| `operatorMaxFeeIncrease` | Governance-set | `updateOperatorFeeIncreaseLimit(uint64)` |

---

## 12. Error Codes

### Cluster Errors
- `ClusterAlreadyEnabled` — reactivating an already active cluster
- `ClusterIsLiquidated` — operating on a liquidated cluster
- `ClusterNotLiquidatable` — liquidation attempted but cluster is solvent
- `ClusterDoesNotExist` — cluster not found
- `InsufficientBalance` — balance too low for operation
- `InvalidPublicKeyLength` — validator public key wrong length
- `ValidatorAlreadyExistsWithData(bytes publicKey)` — validator already registered
- `ValidatorDoesNotExist` — validator not found
- `IncorrectClusterState` — submitted cluster struct doesn't match stored hash
- `IncorrectClusterVersion` — operating on wrong cluster version (e.g. SSV cluster for ETH operation)
- `IncorrectValidatorStateWithData(bytes publicKey)` — validator state mismatch
- `NewBlockPeriodIsBelowMinimum` — liquidation threshold too low
- `InvalidOperatorIdsLength` — wrong number of operator IDs
- `UnsortedOperatorsList` — operator IDs not sorted
- `EmptyPublicKeysList` — no public keys provided
- `PublicKeysSharesLengthMismatch` — public keys and shares arrays differ in length

### Operator Errors
- `CallerNotOwnerWithData(address caller, address owner)` — msg.sender not operator owner
- `CallerNotWhitelistedWithData(uint64 operatorId)` — whitelist check failed
- `OperatorAlreadyExists` — duplicate operator registration
- `OperatorDoesNotExist` — operator not found
- `InsufficientBalance` — insufficient earnings to withdraw
- `FeeTooLow` — fee below minimum operator ETH fee
- `FeeTooHigh` — fee exceeds maximum operator fee
- `FeeExceedsIncreaseLimit` — fee increase exceeds max allowed
- `FeeIncreaseNotAllowed` — zero-fee operator cannot increase
- `SameFeeChangeNotAllowed` — declared fee same as current
- `ApprovalNotWithinTimeframe` — fee execute outside window
- `NoFeeDeclared` — no pending fee change request
- `ExceedValidatorLimitWithData(uint64 operatorId)` — operator at validator capacity
- `TargetModuleDoesNotExistWithData(uint8 moduleId)` — module not registered
- `IncorrectOperatorVersion(uint8 operatorVersion)` — wrong operator version for operation
- `LegacyOperatorFeeDeclarationInvalid` — pre-migration fee declaration
- `OperatorsListNotUnique` — duplicate operator IDs in list

### Whitelist Errors
- `InvalidContractAddress` — invalid whitelist contract address
- `AddressIsWhitelistingContract(address contractAddress)` — address already a whitelisting contract
- `InvalidWhitelistingContract(address contractAddress)` — contract doesn't implement interface
- `InvalidWhitelistAddressesLength` — whitelist address array length mismatch
- `ZeroAddressNotAllowed` — zero address not permitted

### Packing Errors
- `MaxValueExceeded` — packed value overflow
- `MaxPrecisionExceeded` — fee value not divisible by precision factor

### Oracle/EB Errors
- `NotOracle` — caller not registered oracle
- `AlreadyVoted` — oracle already voted for this block
- `StaleBlockNumber` — block number not newer than last committed
- `FutureBlockNumber` — block number in the future
- `InvalidProof` — Merkle proof verification failed
- `RootNotFound` — no committed root for block number
- `StaleUpdate` — EB update is outdated
- `UpdateTooFrequent` — min blocks between updates not met
- `EBBelowMinimum` — effective balance below minimum
- `EBExceedsMaximum` — effective balance above maximum
- `OracleAlreadyAssigned` — oracle address already in use
- `OracleHasZeroWeight` — cSSV totalSupply is zero (no oracle weight)
- `InvalidQuorum` — quorum value out of valid range

### Staking Errors
- `NothingToWithdraw` — no unlocked unstake requests
- `NothingToClaim` — no accrued rewards to claim
- `MaxRequestsAmountReached` — exceeded MAX_PENDING_REQUESTS (2000)
- `UnstakeAmountExceedsBalance` — unstake amount exceeds cSSV balance
- `StakeTooLow` — stake amount below MINIMAL_STAKING_AMOUNT
- `ZeroAmount` — amount is zero
- `InvalidToken` — cannot rescue protected tokens
- `NotCSSV` — caller is not the cSSV token contract
- `ZeroAmount` — SSV amount to stake is zero

### General Errors
- `NotAuthorized` — unauthorized action
- `ZeroAddress` — zero address not allowed
- `ETHTransferFailed` — ETH transfer reverted
- `TokenTransferFailed` — ERC-20 transfer reverted

---

## 13. Constants

```solidity
// Precision
uint32 constant VUNITS_PRECISION = 10_000;
uint256 constant ETH_DEDUCTED_DIGITS = 100_000;
uint256 constant DEDUCTED_DIGITS = 10_000_000;

// EB Limits
uint256 constant MAX_EB_PER_VALIDATOR = 2048 ether;
uint256 constant DEFAULT_EB_PER_VALIDATOR = 32 ether;

// Operator Defaults
uint256 constant DEFAULT_OPERATOR_ETH_FEE = 1_770_000_000;  // 1.77 gwei/vUnit/block

// Protocol Limits
uint64 constant MINIMAL_LIQUIDATION_THRESHOLD = 21_480;  // blocks
uint256 constant MAX_PENDING_REQUESTS = 2000;
uint256 constant MINIMAL_STAKING_AMOUNT = 1_000_000_000;
uint256 constant MAX_DELEGATION_SLOTS = 4;

// Version
uint8 constant VERSION_SSV = 0;
uint8 constant VERSION_ETH = 1;
uint8 constant VERSION_UNDEFINED = 255;
```

---

END OF SPEC.md

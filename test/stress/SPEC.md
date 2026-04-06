# SSV Network — Stress Test Specification

**Location**: `test/stress/`
**Purpose**: Simulate ~5 years of mainnet operation at large scale with thousands of randomized transactions, verify all accounting is exact, find edge cases the protocol has not seen in production, and produce a detailed HTML run report.

---

## Critical Rule — Never Assert From a Getter

**NEVER use a contract getter's return value as ground truth.**
Always compute the expected value in TypeScript first (using real protocol math, from state we track), then call the contract getter and verify it matches what we computed.

If a getter disagrees with our TS computation, the TS math is the reference for debugging. Either the TS math is wrong (fix it) or there is a bug in the contract (report it).

This rule applies to every single assertion in the stress test, no exceptions.

---

## File Structure

```
test/stress/
├── SPEC.md             ← this file
├── index.test.ts       ← Mocha describe block, main runner
├── state.ts            ← TS database — all tracked state + computation functions
├── actions.ts          ← All write action implementations
├── checkState.ts       ← Post-action view verification + invariants
├── setup.ts            ← Deploy, fund, operators, clusters, oracles
├── teardown.ts         ← Final conservation check + dust report
├── random.ts           ← Seeded RNG + weighted action pool
├── report.ts           ← RunReport accumulator + HTML generator
└── constants.ts        ← Stress-test specific constants
```

---

## Contract Parameters Reference

All parameter values used or referenced in the stress test. Three categories:
- **Hardcoded** — immutable Solidity constants, never change
- **Fixture defaults** — values set by `test/setup/fixtures.ts` at deploy/upgrade time
- **Stress test overrides** — values we change from defaults to allow 5-year simulation without burning all block budget on timeouts

### Hardcoded Protocol Constants (Solidity)

Source: `contracts/libraries/SSVCoreTypes.sol`, `contracts/modules/SSVStaking.sol`, `contracts/modules/SSVDAO.sol`, `contracts/libraries/storage/SSVStorageStaking.sol`

| Constant | Value | Notes |
|---|---|---|
| `BPS_DENOMINATOR` | `10_000` | vUnit scaling denominator |
| `ETH_DEDUCTED_DIGITS` | `100_000` | Packed ETH precision factor (packed × 100_000 = wei) |
| `DEDUCTED_DIGITS` | `10_000_000` | Packed SSV precision factor |
| `DEFAULT_OPERATOR_ETH_FEE` | `1_778_800_000` wei/block | Default fee for new ETH operators (~0.00464 ETH/year at 32 ETH) |
| `DEFAULT_EB_PER_VALIDATOR` | `32 ether` | Baseline assumption per validator |
| `MAX_EB_PER_VALIDATOR` | `2048 ether` | Maximum EB per validator |
| `VERSION_SSV` | `0` | Legacy SSV cluster version |
| `VERSION_ETH` | `1` | New ETH cluster version |
| `PRECISION` | `1e18` | Staking accumulator precision |
| `MAX_DELEGATION_SLOTS` | `4` | Oracle slot count (slots 1–4) |
| `MINIMAL_STAKING_AMOUNT` | `1_000_000_000` | Min SSV to stake (in SSV wei) |
| `MAX_PENDING_REQUESTS` | `2_000` | Max concurrent unstake requests per address |
| `MINIMAL_LIQUIDATION_THRESHOLD` | `21_480` blocks | Absolute floor for liquidation threshold (cannot be set lower) |

### Fixture Defaults (Test Deployment Values)

Source: `test/setup/fixtures.ts` + `test/common/constants.ts`

These are the values the existing test suite uses. The stress test starts from these and then overrides a few (see next section).

| Parameter | Fixture Value | Unit | Notes |
|---|---|---|---|
| **ETH Protocol** | | | |
| `ethNetworkFee` | `3_000_000_000` | wei/block (packed) | Set via `updateNetworkFee()` |
| `minimumLiquidationCollateral` | `1_000_000_000_000_000` | wei (0.001 ETH) | Set via `updateMinimumLiquidationCollateral()` |
| `minimumBlocksBeforeLiquidation` | `214_800` | blocks (~30 days) | Set via `updateLiquidationThresholdPeriod()` |
| `maximumOperatorFee` | `76_528_650_000_000` | wei/block | Set via `updateMaximumOperatorFee()` |
| `minimumOperatorEthFee` | `1_778_800_000` | wei/block | Set via `updateMinimumOperatorEthFee()` |
| `operatorMaxFeeIncrease` | `10_000` BPS (100%) | BPS | Set via `updateOperatorFeeIncreaseLimit()` |
| `declareOperatorFeePeriod` | `604_800` | seconds (7 days) | Set via `updateDeclareOperatorFeePeriod()` |
| `executeOperatorFeePeriod` | `604_800` | seconds (7 days) | Set via `updateExecuteOperatorFeePeriod()` |
| `validatorsPerOperatorLimit` | `3_000` | validators | Set in initializer params |
| **SSV Legacy Protocol** | | | |
| `ssvNetworkFee` | `382_640_000_000` | wei/block (packed) | Set via `updateNetworkFeeSSV()` |
| `minimumLiquidationCollateralSSV` | `1_000_000_000_000_000` | wei | Set via same call |
| `minimumBlocksBeforeLiquidationSSV` | `214_800` | blocks | Set in params |
| **Staking / Oracle** | | | |
| `cooldownDuration` | `604_800` | seconds (7 days) | Set in reinitializer |
| `quorumBps` | `7_500` | BPS (75%) | Set in reinitializer |
| `defaultOracleIds` | `[1, 2, 3, 4]` | slot IDs | Set in reinitializer (4 slots) |
| `minBlocksBetweenUpdates` | `0` | blocks | Never set in fixture — storage default |

### Mainnet Reference Values (Hoodi-Prod / DIP-X Targets)

Source: `deployments/hoodi-prod/config.json` + `docs/SPEC.md §12`

These are the **real-world target values** the network intends to run with. Provided here for context — the stress test does NOT use these directly (we use fixture defaults + overrides), but governance change actions should stay within a reasonable range of these.

| Parameter | Hoodi-Prod / DIP-X Value | Unit | Notes |
|---|---|---|---|
| `ethNetworkFee` | `3_550_900_000` | wei/block | ~0.00928 ETH/year |
| `minimumLiquidationCollateral` | `940_000_000_000_000` | wei (0.00094 ETH) | ~7-day runway |
| `minimumBlocksBeforeLiquidation` | `50_190` | blocks (~7 days) | |
| `maximumOperatorFee` | `5_326_300_000` | wei/block | ~0.014 ETH/year |
| `minimumOperatorEthFee` | `1_065_200_000` | wei/block | ~0.0028 ETH/year |
| `operatorMaxFeeIncrease` | `1_000` BPS (10%) | BPS | Much stricter than test |
| `minimumBlocksBeforeLiquidationSSV` | `100_380` | blocks (~14 days) | |
| `cooldownDuration` | `604_800` | seconds (7 days) | Same as fixture |
| `quorumBps` | `7_500` | BPS (75%) | Same as fixture |
| `minBlocksBetweenUpdates` | `0` | blocks | No EB update frequency limit |

### Stress Test Overrides

Applied at the start of the stress test (after fixture initialization) to allow full coverage without exhausting block budget on 7-day waits:

| Parameter | Fixture Default | Stress Override | Reason |
|---|---|---|---|
| `declareOperatorFeePeriod` | `604_800` s | **`500` s** | Fee change cycle testable in 500 blocks (not 50k) |
| `executeOperatorFeePeriod` | `604_800` s | **`500` s** | Same — execute window also 500 s |
| `cooldownDuration` | `604_800` s | **`500` s** | Unstake cycle testable without burning 50k blocks |

All other parameters use **fixture defaults** as the initial state. The random governance change actions may then alter `ethNetworkFee`, `minimumLiquidationCollateral`, and `minimumBlocksBeforeLiquidation` during the simulation (within the 1% liquidatable cap / 2× current value bounds).

### Parameter Encoding Notes

Critical for TS math — always use the correct unit when reading from or writing to the contract:

```
Packed ETH fee (stored):    rawPacked  (uint64)
Actual wei/block:           rawPacked * ETH_DEDUCTED_DIGITS (×100_000)
Actual wei/block → packed:  weiPerBlock / ETH_DEDUCTED_DIGITS  (must be divisible, else MaxPrecisionExceeded)

Packed SSV fee (stored):    rawPacked  (uint64)
Actual wei/block:           rawPacked * DEDUCTED_DIGITS (×10_000_000)

cluster.balance:            ALWAYS in wei (uint256) — NOT packed
operator.ethSnapshotBalance: packed (uint64) — must ×ETH_DEDUCTED_DIGITS to get wei
```

---

## Simulation Flow Diagrams

### Main Loop

```
┌─────────────────────────────────────────────────────────────────────────────┐
│                          STRESS TEST MAIN LOOP                              │
└─────────────────────────────────────────────────────────────────────────────┘

  ┌──────────┐
  │  SETUP   │  Deploy contracts, seed ETH/SSV, register 250 operators,
  │          │  create ~620 ETH clusters, stake ~300 stakers, initial EB oracle
  └────┬─────┘
       │
       ▼
  ┌──────────────────────────────────────────────────────────┐
  │              MAIN LOOP  (~8,000–12,000 iterations)        │
  │                                                          │
  │  ┌─────────────────────────────────────────────────┐     │
  │  │  Pick next action from weighted random pool     │     │
  │  └──────────────────┬──────────────────────────────┘     │
  │                     │                                    │
  │         ┌───────────┴───────────┐                        │
  │         ▼                       ▼                        │
  │   ┌───────────┐         ┌──────────────────┐             │
  │   │  MINE     │         │  WRITE ACTION    │             │
  │   │  BLOCKS   │         │  (5-10% batched) │             │
  │   └─────┬─────┘         └────────┬─────────┘             │
  │         │                        │                       │
  │         │ Pre-mine scan:         │ Execute TX(s):        │
  │         │ project all cluster    │ · Single action, OR   │
  │         │ balances at            │ · Batch of 2–8 TXs    │
  │         │ currentBlock+n         │   in same block       │
  │         │                        │                       │
  │         │ If any cluster hits 0: │ Update TS state to    │
  │         │ → liquidate BEFORE     │ match contract state  │
  │         │   mining               │                       │
  │         │                        │                       │
  │         │ hardhat_mine(n)        │                       │
  │         │                        │                       │
  │         │ Post-mine:             │                       │
  │         │ liquidate any that     │                       │
  │         │ became liquidatable    ▼                       │
  │         │              ┌──────────────────┐              │
  │         └─────────────►│   checkState()   │              │
  │                        └────────┬─────────┘              │
  │                                 │                        │
  │                    ┌────────────┴────────────┐           │
  │                    ▼                          ▼           │
  │              ✅ PASS                     ❌ FAIL          │
  │         Log to report              Log failure record    │
  │                                    with causal chain     │
  │                                    Continue running      │
  └──────────────────────────────────────────────────────────┘
       │
       ▼
  ┌──────────┐
  │ TEARDOWN │  Withdraw all, claim all, dust check, generate HTML report
  └──────────┘
```

### checkState — What Gets Verified Every Write TX

```
                        ┌─────────────────────────────────────────┐
                        │              checkState()               │
                        └──────────────────┬──────────────────────┘
                                           │
           ┌───────────────────────────────┼───────────────────────────────┐
           ▼                               ▼                               ▼
  ┌─────────────────┐           ┌──────────────────┐           ┌──────────────────────┐
  │  CLUSTER CHECKS │           │ OPERATOR CHECKS  │           │   STAKING CHECKS     │
  │  (per cluster)  │           │  (per operator)  │           │   (per staker)       │
  ├─────────────────┤           ├──────────────────┤           ├──────────────────────┤
  │ getBalance      │           │ getOperatorEarning│           │ accEthPerShare       │
  │ isLiquidatable  │           │ getOperatorById   │           │ totalStaked          │
  │ isLiquidated    │           │   .fee            │           │ stakedBalanceOf      │
  │ getValidator    │           │   .validatorCount │           │ previewClaimableEth  │
  │ getEffective    │           │   .isActive       │           │ pendingUnstake       │
  │   Balance       │           │   .isPrivate      │           │ stakingEthPoolBalance│
  │ getClusterAsset │           │ getOperatorFee    │           └──────────────────────┘
  │   Type          │           │ getOperatorDeclared
  │ getBurnRate     │           │   Fee             │                      ▼
  │ getBalanceSSV   │           │ getOperatorEarning│           ┌──────────────────────┐
  │  (SSV clusters) │           │   SSV             │           │   PROTOCOL CHECKS    │
  └─────────────────┘           └──────────────────┘           ├──────────────────────┤
                                                               │ getNetworkValidators │
                                                               │   Count              │
                                                               │ getNetworkEarnings   │
                                                               │ getNetworkFee        │
                                                               │ getNetworkEarningsSSV│
                                                               │ getCommittedRoot     │
                                                               └──────────────────────┘
                                                                          │
                                                                          ▼
                                                               ┌──────────────────────┐
                                                               │   SUM INVARIANTS     │
                                                               ├──────────────────────┤
                                                               │ contractBalance ≥    │
                                                               │   sumClusters        │
                                                               │ + sumOperators       │
                                                               │ + networkEarnings    │
                                                               │ + stakingPool        │
                                                               │ + stakerPending      │
                                                               │                      │
                                                               │ cSSV supply ==       │
                                                               │   totalStaked        │
                                                               │                      │
                                                               │ accEthPerShare       │
                                                               │   monotonic ↑        │
                                                               └──────────────────────┘
```

### EB Oracle Update Flow

```
  updateClusterBalance selected from action pool
            │
            ▼
  Pick 10–30% of active ETH clusters randomly
            │
            ▼
  For each chosen cluster:
    ebPerValidator = random choice [32, 48, 64, ..., 2048] ETH
    totalEB = ebPerValidator × validatorCount
            │
            ▼
  Build Merkle tree over ALL ETH clusters
  (changed subset + unchanged clusters at current EB)
            │
            ▼
  ┌─────────────────────────────────────────────┐
  │  Same block:                                │
  │  oracle[0].commitRoot(root, blockNum)       │
  │  oracle[1].commitRoot(root, blockNum)       │
  │  oracle[2].commitRoot(root, blockNum)  ←── quorum reached
  └─────────────────────────────────────────────┘
            │
            ▼
  For each cluster in changed subset:
    network.updateClusterBalance(blockNum, owner, opIds, cluster, totalEB, proof)
            │
            ▼
  TS state update per cluster:
    newEbVUnits = ceil(totalEB × 10_000 / 32)
    deltaVUnits = newEbVUnits - oldEbVUnits
    c.ebVUnits = newEbVUnits
    for each op: op.ethVUnitsDeviation += deltaVUnits
    proto.daoTotalEthVUnits += deltaVUnits
    syncStakingPool(proto, currentBlock)   ← _syncFees called internally
            │
            ▼
  checkState()  ← verify getCommittedRoot + getNetworkEarnings + all cluster balances
```

### Liquidation Safety Net (Two Layers)

```
  ┌─────────────────────────────────────────────────────────────────┐
  │                    LAYER 1: Pre-Mine Scan                       │
  │                                                                 │
  │  Before hardhat_mine(n):                                        │
  │    for each active cluster:                                     │
  │      projectedBalance = computeClusterBalance(block + n)        │
  │      if projectedBalance <= 0    → liquidate() NOW (before mine)│
  │      if projectedBalance < threshold → mark pendingLiquidation  │
  │                                                                 │
  │  hardhat_mine(n)                                                │
  │                                                                 │
  │  for each pendingLiquidation:                                   │
  │    liquidate() immediately after mine                           │
  └─────────────────────────────────────────────────────────────────┘

  ┌─────────────────────────────────────────────────────────────────┐
  │                    LAYER 2: checkState Scan                     │
  │                                                                 │
  │  After every write TX:                                          │
  │    if cluster.balance == 0 && active → HARD FAIL               │
  │    if isLiquidatable && active:                                 │
  │      if liquidatable for 3+ consecutive checks → force liquidate│
  │      else → 50% liquidate, 50% top up                          │
  └─────────────────────────────────────────────────────────────────┘
```

---

## Simulation Parameters

| Parameter | Value | Notes |
|---|---|---|
| Simulated blocks | 13,140,000 | ~5 years @ 12s/block |
| Total write transactions | ~8,000–12,000 | weighted random |
| Block-mine actions | ~400–600 mine calls | vary 1 → 1,000,000 blocks per call |
| Same-block batch frequency | ~5–10% of all actions | multiple TXs in one block |
| Same-block batch size | 2–8 TXs | |
| RNG seed | fixed constant (configurable) | for reproducibility |
| Hardhat mine method | `hardhat_mine(n)` | fast, no TX execution |

### Block Coverage Strategy

Total blocks must sum to ~13,140,000 across all mine calls. Strategy:
- **Small mines** (1–100 blocks): ~50% of mine actions — simulates normal activity
- **Medium mines** (101–50,000 blocks): ~35% — simulates quiet periods
- **Large mines** (50,001–1,000,000 blocks): ~15% — simulates long idle periods (~10–15 of these total)

After every mine action, check if `totalBlocksMined + remaining_budget` requires the next mine to be larger, and adjust distribution accordingly.

### Same-Block Batch Execution

5–10% of the time instead of executing a single action, pick a "batch" of 2–8 random actions and execute them all in the same block (no `hardhat_mine` between them). This tests:
- Two fee-changing events hitting the staking accumulator in same block
- Liquidation + reactivation in same block (from different accounts)
- Multiple validator registrations by different owners in same block
- DAO fee update + cluster withdraw in same block
- Oracle `commitRoot` × 3 in same block (normal operation)

---

## Setup Phase

### 1. Deploy & Start Post-Migration

- Deploy full SSVNetwork stack using existing fixture helpers
- `upgradeToStakingVersion` immediately (no pre-migration simulation needed — contracts are already 3+ years on mainnet; this test is all about the migration)
- Set governance params to known test values — record everything in TS `ProtocolState`

### 2. Seed Contract Directly

Send **100 ETH** and **100 SSV tokens** directly to the SSVNetwork contract address via raw `sendTransaction` / `ssvToken.transfer` — NOT through protocol functions. These simulate "trapped" funds (e.g., accidental sends).

Track separately: `SEED_ETH = 100e18`, `SEED_SSV = 100e18`. All teardown conservation assertions account for this.

### 3. Oracle Setup

- **3 oracle signers** (slots 1, 2, 3 only — slot 4 left unset)
- `replaceOracle(1, addr1)`, `replaceOracle(2, addr2)`, `replaceOracle(3, addr3)`
- Quorum = 75% (default) — 3 of 3 oracles always satisfies quorum
- **Every `commitRoot` call sends exactly 3 commits**, one per oracle. Never more.
- Record oracle addresses in TS state

### 4. Stakers — EOA + Contract Stakers

**~250 EOA stakers**: mint SSV, approve, `stake()`. Record in `StakeRecord[]`.

**~50 contract stakers**: Deploy simple hold-and-claim contracts. Each can:
- Receive cSSV (via `cssvToken.transfer`)
- Call `claimEthRewards()` on the staking contract
- Transfer cSSV to other addresses (via `cssvToken.transfer`)

No special `onCSSVTransfer` implementation needed on the contracts — the cSSV token calls into the SSVStaking contract internally when `transfer` is called; there is nothing for the receiving contract to implement. The test just calls `cssvToken.connect(contractSigner).transfer(to, amount)` as normal.

Total target: **~300 stakers** (~250 EOA + ~50 contract).

### Role Overlap Distribution

Most addresses hold multiple roles. When drawing addresses from the signer pool, use this distribution:

| Role combination | Frequency | Notes |
|---|---|---|
| Staker only (no operator, no cluster) | ~100 addresses | Pure capital allocators |
| Staker + cluster owner | ~150 addresses | Most cluster owners also stake |
| Staker + operator owner | ~200 addresses | Most operator owners also stake |
| Staker + operator owner + cluster owner | ~10 addresses | A handful of "full participants" |
| Cluster owner only (not staking) | ~20 addresses | Rare — cluster owners who don't stake |
| Operator owner only (not staking) | ~40 addresses | Operators who haven't discovered staking |

**Important**: Operator owner AND cluster owner (same address, without staking) is uncommon — only a few such addresses. Most operators who also run clusters also stake SSV.

Total unique signers: **~520 addresses**. Hardhat supports this via `hardhat_addAccount` or using a large HD wallet derivation path.

### 5. Operators

**Pre-upgrade operators** (SSV version, registered BEFORE the upgrade — required to build SSV legacy clusters):
- **~150 operators** registered using the old `registerOperator` flow (SSV fee path)
- These operators have `ethSnapshot.block == 0` after upgrade (not yet ETH-initialized)
- They become ETH-initialized when: a cluster using them is migrated (`migrateClusterToETH` calls `ensureETHDefaults`), or when the operator calls `declareOperatorFee` (which also calls `ensureETHDefaults`)
- Record initial SSV fee in TS state; `ethFee` starts at 0 until initialized
- Mix of public and private operators

**Post-upgrade operators** (ETH version, registered after upgrade):
- **~100 operators** registered post-upgrade with ETH fees
- Mix of public (~60%) and private (~40%)
- Fee range: from `MINIMAL_OPERATOR_ETH_FEE` up to 20× that value

Total: **~250 operators**. All recorded in `OperatorRecord[]`.

**TS handling of pre-upgrade operators**:
- `ethSnapshotBlock = 0` initially (uninitialized)
- First ETH interaction (migration, `declareOperatorFee`) sets `ethSnapshotBlock = currentBlock`, `ethFee = DEFAULT_OPERATOR_ETH_FEE`
- Until then: operator contributes 0 to ETH cluster fee calculations (skipped in `computeClusterBalance`)

### 6. SSV Legacy Clusters (Pre-Existing, Now Migrated)

- Create **~15–20 SSV clusters** (by registering on the SSV path before/during upgrade window)
- Register 1–5 validators each
- Then migrate them all with `migrateClusterToETH`
- After migration, these clusters are now ETH version
- Keep **3–5 SSV clusters intentionally unmigrated** to test the legacy path

### 7. New ETH Clusters (Post-Migration — Primary Focus)

- Create **~600 new ETH clusters** across diverse operator combinations
- Operator set sizes: 4, 7, 10, 13 (all valid SSV operator set sizes)
- Validators per cluster: 1–50 at creation
- Deposits sized to last at least `minimumBlocksBeforeLiquidation × burnRate × 2`
- Total validators at setup: ~3,000–5,000

This is the majority of the simulation load. New ETH clusters heavily outnumber migrated ones.

### 8. Initial EB Oracle Baseline

- Build Merkle tree over all ~620 ETH clusters
- `commitRoot` × 3 oracles
- `updateClusterBalance` for each cluster with initial EB = 32 ETH per validator (baseline)
- Record `ebVUnits = validatorCount * BPS_DENOMINATOR` for each cluster in TS state

---

## TS State

### OperatorRecord

```typescript
interface OperatorRecord {
  id: bigint;
  owner: string;

  // ETH operator state
  ethFee: bigint;               // packed raw (divide by ETH_DEDUCTED_DIGITS for actual wei)
  ethSnapshotBlock: bigint;     // 0 if ethSnapshot never initialized
  ethSnapshotBalance: bigint;   // packed ETH balance at checkpoint
  ethSnapshotIndex: bigint;     // cumulative fee index at checkpoint
  ethValidatorCount: bigint;    // active ETH validators on this operator

  // SSV operator state (legacy)
  ssvFee: bigint;
  ssvSnapshotBlock: bigint;
  ssvSnapshotBalance: bigint;
  ssvSnapshotIndex: bigint;
  ssvValidatorCount: bigint;

  // Deviation tracking (from SSVStorageEB)
  ethVUnitsDeviation: bigint;   // operator-level EB deviation (not baseline)

  // Metadata
  isPrivate: boolean;
  whitelistedAddresses: Set<string>;
  isRemoved: boolean;

  // Pending fee change
  pendingFee?: bigint;
  pendingFeeApprovalBeginTimestamp?: bigint;  // unix seconds
  pendingFeeApprovalEndTimestamp?: bigint;
}
```

**ETH earnings computation** (never use getter):
```
currentIndex = ethSnapshotIndex + (currentBlock - ethSnapshotBlock) * ethFee
effectiveVUnits = ethVUnitsDeviation + ethValidatorCount * BPS_DENOMINATOR
// Since last checkpoint, balance accrued = (currentIndex - ethSnapshotIndex) * effectiveVUnits / BPS_DENOMINATOR
// But index already includes the new blocks, so:
newAccrual = (currentBlock - ethSnapshotBlock) * ethFee * effectiveVUnits / BPS_DENOMINATOR
earningsWei = (ethSnapshotBalance + newAccrual) * ETH_DEDUCTED_DIGITS
```

### ClusterRecord

```typescript
interface ClusterRecord {
  id: string;               // keccak256(owner, operatorIds)
  owner: string;
  operatorIds: bigint[];    // sorted ascending

  version: 0 | 1;          // 0 = SSV, 1 = ETH

  // Current cluster struct (from last write TX event)
  validatorCount: bigint;
  networkFeeIndex: bigint;
  index: bigint;            // cumulative operator index at last checkpoint
  balance: bigint;          // packed balance at last checkpoint (wei / ETH_DEDUCTED_DIGITS)
  active: boolean;

  // TS tracking
  lastActionBlock: bigint;  // hardhat block number when cluster struct was last written
  validators: Map<string, boolean>;  // pubkeyHex → registered

  // EB tracking (ETH clusters only)
  ebVUnits: bigint;         // 0 = implicit (32 ETH/validator); >0 = explicit from oracle
  lastEBRootBlock: bigint;  // block of the committed root this EB came from
}
```

**ETH balance computation**:

`cluster.balance` is stored in **wei** (uint256, not packed). The fees are computed in packed units then converted to wei by × ETH_DEDUCTED_DIGITS before subtracting.

```typescript
function computeClusterBalance(c: ClusterRecord, currentBlock: bigint, proto: ProtocolState, ops: Map<bigint, OperatorRecord>): bigint {
  if (!c.active) return 0n;
  const effectiveVUnits = c.ebVUnits > 0n ? c.ebVUnits : c.validatorCount * BPS_DENOMINATOR;
  const networkFeeIndexDelta = computeNetworkFeeIndex(proto, currentBlock) - c.networkFeeIndex;
  // Accumulate current operator index sum — SKIP removed operators (ethSnapshotBlock == 0)
  // Removed operators: block=0, fee=0. Skipping them matches contract's updateClusterOperators behavior.
  let currentOpIndexSum = 0n;
  for (const opId of c.operatorIds) {
    const op = ops.get(opId)!;
    if (op.ethSnapshotBlock === 0n) continue;  // skip removed operators
    currentOpIndexSum += op.ethSnapshotIndex + (currentBlock - op.ethSnapshotBlock) * op.ethFee;
  }
  const operatorIndexDelta = currentOpIndexSum - c.index;  // c.index = sum of op indices at last cluster action
  const feeUnits = (operatorIndexDelta + networkFeeIndexDelta) * effectiveVUnits / BPS_DENOMINATOR;
  const feesWei = feeUnits * ETH_DEDUCTED_DIGITS;  // packed units → wei
  return c.balance > feesWei ? c.balance - feesWei : 0n;
  // c.balance is in wei already — no ETH_DEDUCTED_DIGITS multiplication needed
}
```

### StakeRecord

```typescript
interface StakeRecord {
  address: string;
  isContract: boolean;     // true if staker is a smart contract
  cssvBalance: bigint;
  userIndex: bigint;       // accEthPerShare at last settlement point
  settledPendingReward: bigint;  // rewards settled but not yet claimed
  pendingUnstakes: Array<{ amount: bigint; unlockTimestamp: bigint }>;
}
```

**Reward computation**:
```
unsettledReward = cssvBalance * (currentAccEthPerShare - userIndex) / 1e18
totalClaimable = settledPendingReward + unsettledReward
```

### ProtocolState

```typescript
interface ProtocolState {
  // ETH fee index
  ethNetworkFee: bigint;            // packed raw
  ethNetworkFeeIndex: bigint;       // last checkpointed value
  ethNetworkFeeIndexBlock: bigint;  // block of last checkpoint

  // DAO balance
  ethDaoBalance: bigint;            // ETH balance checkpointed
  ethDaoIndexBlockNumber: bigint;   // block when ethDaoBalance was last written
  daoTotalEthVUnits: bigint;        // sum of all active ETH cluster effective vUnits

  // SSV fee (legacy)
  ssvNetworkFee: bigint;
  ssvNetworkFeeIndex: bigint;
  ssvNetworkFeeIndexBlock: bigint;
  ssvDaoBalance: bigint;

  // Staking
  accEthPerShare: bigint;           // 18-decimal accumulator
  stakingEthPoolBalance: bigint;    // fees pending distribution (when totalStaked was 0)
  totalStaked: bigint;              // = cSSV totalSupply

  // Oracle tracking
  latestCommittedBlock: bigint;    // blockNum of the most recent commitRoot
  latestCommittedRoot: string;     // bytes32 root of the most recent commitRoot

  // Governance (track changes)
  minimumBlocksBeforeLiquidation: bigint;
  minimumLiquidationCollateral: bigint;
  declareOperatorFeePeriod: bigint;  // in seconds (not blocks)
  executeOperatorFeePeriod: bigint;
  operatorMaxFeeIncrease: bigint;
  cooldownDuration: bigint;          // unstake cooldown in seconds
}
```

**Network fee index**:
```
currentNetworkFeeIndex = ethNetworkFeeIndex + (currentBlock - ethNetworkFeeIndexBlock) * ethNetworkFee
```

**Network earnings** (always computed on the fly — no separate running total stored in TS):
```
networkEarnings = ethDaoBalance + (currentBlock - ethDaoIndexBlockNumber) * ethNetworkFee * daoTotalEthVUnits / BPS_DENOMINATOR * ETH_DEDUCTED_DIGITS
```

There is no need to accumulate a separate "total ETH earned by network" field in TS state. The current DAO ETH balance is always derivable from `ethDaoBalance` (last checkpoint) + the accrual formula above. This is how the contract computes it too — `ProtocolLib.networkTotalEarnings(sp)` uses the same formula.

---

## Random Action Pool

### Block Mining (not counted as write TXs)

| Action | Weight | Block Range |
|---|---|---|
| `mineBlocks` small | 25 | 1–100 |
| `mineBlocks` medium | 20 | 101–50,000 |
| `mineBlocks` large | 5 | 50,001–1,000,000 |

### Cluster + Validator Operations (combined — validators always belong to a cluster)

| Action | Weight | Notes |
|---|---|---|
| `registerValidator` (1 key) | 12 | Random ETH cluster |
| `bulkRegisterValidator` (2–50 keys) | 8 | Batch |
| `bulkRegisterValidator` up to operator limit | 2 | **BOUNDARY** — push cluster to 3000 validator cap |
| `removeValidator` (1 key) | 8 | Random ETH cluster |
| `bulkRemoveValidator` (2–20 keys) | 6 | Batch |
| `exitValidator` | 4 | Emit only, no state |
| `deposit` (ETH) | 10 | Random ETH cluster |
| `withdraw` (ETH, partial) | 8 | |
| `withdraw` (ETH, full) | 3 | |
| `reactivate` (ETH) | 5 | Only if `!active` |
| `liquidate` | 6 | Only if `isLiquidatable` — see Liquidation section |
| `updateClusterBalance` (oracle EB update) | 5 | See EB section — can cause liquidations (acceptable) |
| `migrateClusterToETH` | 2 | Remaining SSV clusters |

### SSV Legacy Cluster Operations (intentionally small pool — these should mostly fail)

| Action | Weight | Notes |
|---|---|---|
| `registerValidator` on SSV cluster | 1 | **MUST revert** `IncorrectClusterVersion` |
| `depositSSV` | 2 | Valid — SSV clusters can still receive deposits |
| `withdrawSSV` | 2 | Valid |
| `reactivateSSV` on SSV cluster | 1 | **MUST revert** post-migration |
| `removeValidator` on SSV cluster | 2 | Valid — allowed on SSV clusters |
| Allow SSV cluster to go insolvent (skip deposits) | passive | Triggers liquidation path |

### Operator Operations

| Action | Weight | Notes |
|---|---|---|
| `registerOperator` | 4 | Add to pool |
| `removeOperator` | 2 | Only if `ethValidatorCount == 0` |
| `declareOperatorFee` | 5 | Start fee change |
| `executeOperatorFee` | 4 | After `declareOperatorFeePeriod` elapsed |
| `cancelDeclaredOperatorFee` | 2 | Cancel pending |
| `reduceOperatorFee` | 4 | Immediate reduction |
| `reduceOperatorFee` to 0 | 1 | **BOUNDARY** |
| `declareOperatorFee` at max allowed | 1 | **BOUNDARY** — 100% increase |
| `declareOperatorFee` over max | 1 | **BOUNDARY** — must revert |
| `withdrawOperatorEarnings` (partial) | 5 | |
| `withdrawAllOperatorEarnings` | 4 | |
| `setOperatorsPrivateUnchecked` | 2 | |
| `setOperatorsPublicUnchecked` | 2 | |

### Staking Operations

| Action | Weight | Notes |
|---|---|---|
| `stake` (EOA) | 6 | |
| `stake` (contract staker) | 3 | Must work identically |
| `requestUnstake` | 5 | |
| `completeUnstake` | 5 | Only after cooldown |
| `claimEthRewards` | 6 | |
| cSSV `transfer` (EOA → EOA) | 4 | Triggers `onCSSVTransfer` reward settlement |
| cSSV `transfer` (EOA → contract) | 3 | Contract must handle reward hook |
| cSSV `transfer` (contract → EOA) | 3 | |

### DAO / Governance Operations

| Action | Weight | Notes |
|---|---|---|
| `updateNetworkFee` | 2 | DAO changes ETH network fee |
| `updateLiquidationThresholdPeriod` | 1 | Changes liquidation window (blocks) |
| `updateMinimumLiquidationCollateral` | 1 | Changes minimum ETH a cluster must hold |
| `withdrawNetworkSSVEarnings` (partial) | 2 | DAO withdraws legacy SSV earnings mid-simulation |
| `withdrawNetworkSSVEarnings` (full) | 1 | DAO drains all legacy SSV earnings |

DAO actions must: (1) call `syncStakingPool` in TS first (checkpoint earnings), (2) update the governance param in TS `ProtocolState`, (3) for fee changes, update `ethNetworkFeeIndex` and `ethNetworkFeeIndexBlock`.

### Governance Change Safety Rules

`updateNetworkFee`, `updateLiquidationThresholdPeriod`, and `updateMinimumLiquidationCollateral` can cause many clusters to become liquidatable or insolvent if applied aggressively. On mainnet, the DAO would never do this — it would break the entire network. The test must reflect this constraint.

**Hard rule**: After applying any governance change, **no active cluster's computed balance may be ≤ 0**. A cluster can be liquidatable (balance > 0 but below threshold) — the liquidator will catch it next block — but the change itself must never instantly drain any cluster to zero.

**Procedure for each governance change action:**
1. Compute a random new value within a reasonable range (e.g., network fee ≤ 2× current)
2. For each active ETH cluster, compute `computeClusterBalance(cluster, currentBlock)` with the proposed new value
3. Count how many would become **newly liquidatable** (balance > 0 but below threshold) — cap at ≤ 1% of active clusters
4. Verify zero clusters would have `balance == 0` under the new value — if any would, reduce the change further
5. Apply the (now bounded) change
6. After applying, for each cluster that is now liquidatable:
   - 50% chance: immediately **liquidate** it (while balance > 0) — the liquidator earns the remainder
   - 50% chance: **deposit** additional ETH to bring it back above the threshold
7. **All** newly-liquidatable clusters must be handled (either liquidated or topped up) before the next random action is drawn

**`updateClusterBalance` is exempt.** EB changes causing liquidations is an expected real-world scenario (validator slashed / EB drops). TS still ensures no cluster hits balance = 0 during or after an EB update.

For `updateNetworkFee` specifically: new fee must be within 2× of current fee. For `updateLiquidationThresholdPeriod`: new value must be within 2× of current. For `updateMinimumLiquidationCollateral`: new value must be within 2× of current.

### Pre-Mine Cluster Balance Scan

Before every `hardhat_mine(n)` call, scan all active ETH clusters and project their balance at `currentBlock + n`:

```typescript
for (const cluster of activeClusters) {
  const projectedBalance = computeClusterBalance(cluster, currentBlock + BigInt(n), proto, ops);
  if (projectedBalance <= 0n) {
    // Cluster would hit 0 during this mine — must handle BEFORE mining
    // Liquidate it now (while balance is still positive)
    await actions.liquidate(cluster);  // injected forcibly
  } else if (projectedBalance < computeLiquidationThreshold(cluster, proto, ops)) {
    // Cluster will become liquidatable during the mine — handle after mining
    // (Mark it so we liquidate it immediately after mineBlocks completes)
    pendingLiquidations.add(cluster.id);
  }
}
await hardhat_mine(n);
for (const clusterId of pendingLiquidations) {
  await actions.liquidate(clusters.get(clusterId));  // immediately post-mine
}
```

This pre-mine scan is the primary mechanism guaranteeing no cluster ever reaches balance = 0 while active.

### checkState Liquidation Scan (secondary safety net)

Inside `checkState` (called after every write TX), also scan all active clusters:

```typescript
for (const cluster of activeClusters) {
  const currentBalance = computeClusterBalance(cluster, currentBlock, proto, ops);
  const isLiquidatable = computeIsLiquidatable(cluster, currentBlock, proto, ops);

  if (currentBalance <= 0n && cluster.active) {
    // CRITICAL FAILURE — cluster hit 0 while active; pre-mine scan should have caught this
    report.failures.push({ failedCheck: "CLUSTER_WENT_NEGATIVE", ... });
    throw new Error(`Cluster ${cluster.id} balance hit 0 while active at block ${currentBlock}`);
  }

  if (isLiquidatable && cluster.active) {
    // Inject forced handling — either liquidate or deposit
    // This catches cases that slipped past the pre-mine scan (e.g., same-block batches)
    const shouldLiquidate = rng.bool();
    if (shouldLiquidate) {
      await actions.liquidate(cluster);  // forced injection
    } else {
      await actions.deposit(cluster, computeSafeTopUpAmount(cluster, proto, ops));
    }
  }
}
```

The pre-mine scan handles large time gaps. The `checkState` scan handles anything that slips through (e.g., same-block batch where one TX makes a cluster liquidatable and no mine happened between).

---

## EB Oracle Updates

### When to Trigger

When `updateClusterBalance` is selected from random pool:
1. Pick a random subset of ETH clusters (10–30% of active clusters)
2. Assign each a random new EB value per validator (see range below)
3. Build a full Merkle tree over ALL ETH clusters (include unchanged ones with their current EB)
4. `commitRoot` × 3 oracles (all in same block — this is the normal pattern)
5. `updateClusterBalance` for each cluster in the changed subset

### EB Value Strategy

`effectiveBalance` in `updateClusterBalance` is the **TOTAL cluster EB in ETH** (uint32, whole ETH units). Not per-validator — the total across all validators. Constraints enforced by `_verifyEBLimits`:
- Min: `validatorCount * 32` ETH
- Max: `validatorCount * 2048` ETH

For each cluster being updated, choose a random multiplier per validator and compute total:
```typescript
const ebPerValidator = randomChoice([32, 48, 64, 128, 256, 512, 1024, 2048]);  // ETH per validator
const totalEffectiveBalance = ebPerValidator * cluster.validatorCount;  // uint32, whole ETH
```

Distribution of per-validator EB choices:
- **32 ETH** (~30%) — baseline, no change
- **48–64 ETH** (~25%) — modest increase
- **65–128 ETH** (~20%) — moderate increase
- **129–512 ETH** (~15%) — large increase
- **513–2048 ETH** (~10%) — maximum range

**Boundary EB tests** (scheduled explicitly):
- `effectiveBalance = validatorCount * 2048` (max per validator) — must succeed
- `effectiveBalance = validatorCount * 32 - 1` (below min) — must revert `EBBelowMinimum`
- `effectiveBalance = validatorCount * 2048 + 1` (above max) — must revert `EBExceedsMaximum`

### Merkle Tree Construction

Use `generateMerkleForClusterEB` from `test/helpers/oracle.ts`:
- Leaves: `keccak256(keccak256(abi.encode(clusterId, effectiveBalance)))` for each cluster
- Sort leaves numerically before building tree
- Block number in `commitRoot` must be strictly greater than `latestCommittedBlock`

### TS State Update After `updateClusterBalance`

```typescript
// effectiveBalance = total cluster EB in whole ETH (e.g., 10 validators × 64 ETH = 640)
const totalEffectiveBalanceETH = BigInt(effectiveBalance);  // uint32, already whole ETH
const newEbVUnits = (totalEffectiveBalanceETH * BPS_DENOMINATOR + 31n) / 32n;  // ceiling division
const oldEbVUnits = c.ebVUnits > 0n ? c.ebVUnits : c.validatorCount * BPS_DENOMINATOR;
const deltaVUnits = newEbVUnits - oldEbVUnits;
c.ebVUnits = newEbVUnits;

// Update operator deviation for each operator in cluster
for (const opId of c.operatorIds) {
  ops.get(opId).ethVUnitsDeviation += deltaVUnits;
}

// Update DAO total vUnits
proto.daoTotalEthVUnits += deltaVUnits;

// Checkpoint staking pool (updateClusterBalance calls _syncFees)
syncStakingPool(proto, currentBlock);
```

---

## checkState Function

Called after **every write transaction** (and after every same-block batch). This is the heart of correctness verification.

### Cluster Checks

```typescript
for (const [clusterId, cluster] of tsState.clusters) {
  const { owner, operatorIds } = cluster;
  const csCluster = toContractCluster(cluster);

  // 1. Balance
  const expectedBalance = computeClusterBalance(cluster, currentBlock, proto, ops);
  const onChain = await views.getBalance(owner, operatorIds, csCluster);
  assert(onChain === expectedBalance, `cluster ${clusterId} balance: expected ${expectedBalance}, got ${onChain}`);

  // 2. Liquidatable
  const expectedLiq = computeIsLiquidatable(cluster, currentBlock, proto, ops);
  assert(await views.isLiquidatable(owner, operatorIds, csCluster) === expectedLiq);

  // 3. Liquidated (inactive)
  assert(await views.isLiquidated(owner, operatorIds, csCluster) === !cluster.active);

  // 4. Validators (sample: check all registered + recently removed)
  for (const [pk, registered] of cluster.validators) {
    assert(await views.getValidator(owner, hexToBytes(pk)) === registered);
  }

  // 5. Effective balance (if explicit EB)
  if (cluster.ebVUnits > 0n) {
    const expectedEbPerValidator = cluster.ebVUnits * 32n / BPS_DENOMINATOR / BigInt(cluster.validatorCount);
    assert(await views.getEffectiveBalance(owner, operatorIds, csCluster) === Number(expectedEbPerValidator));
  }

  // 6. Version
  assert(await views.getClusterAssetType(owner, operatorIds) === cluster.version);

  // 7. Burn rate — compute expected as (sumOpFees + networkFee) * effectiveVUnits / BPS_DENOMINATOR * ETH_DEDUCTED_DIGITS
  if (cluster.active) {
    const effectiveVUnits = cluster.ebVUnits > 0n ? cluster.ebVUnits : cluster.validatorCount * BPS_DENOMINATOR;
    let opFeeSum = 0n;
    for (const opId of cluster.operatorIds) {
      const op = ops.get(opId)!;
      if (op.ethSnapshotBlock === 0n) continue;  // skip removed operators
      opFeeSum += op.ethFee;
    }
    const expectedBurnRate = (opFeeSum + proto.ethNetworkFee) * effectiveVUnits / BPS_DENOMINATOR * ETH_DEDUCTED_DIGITS;
    const onChainBurnRate = await views.getBurnRate(owner, operatorIds, csCluster);
    assert(onChainBurnRate === expectedBurnRate, `cluster ${clusterId} burnRate: expected ${expectedBurnRate}, got ${onChainBurnRate}`);
  }

  // 8. SSV cluster balance (for unmigrated SSV clusters)
  if (cluster.version === VERSION_SSV) {
    const expectedSSVBalance = computeClusterBalanceSSV(cluster, currentBlock, proto);
    const onChainSSV = await views.getBalanceSSV(owner, operatorIds, csCluster);
    assert(onChainSSV === expectedSSVBalance, `SSV cluster ${clusterId} balance mismatch`);
  }
}
```

### Operator Checks

```typescript
for (const [opId, op] of tsState.operators) {
  if (op.isRemoved) continue;

  // 1. ETH Earnings
  const expectedEarnings = computeOperatorEthEarnings(op, currentBlock);
  const onChain = await views.getOperatorEarnings(opId);
  assert(onChain === expectedEarnings, `operator ${opId} ETH earnings: expected ${expectedEarnings}, got ${onChain}`);

  // 2. Operator data
  const opData = await views.getOperatorById(opId);
  assert(opData.fee === unpackETH(op.ethFee));
  assert(BigInt(opData.validatorCount) === op.ethValidatorCount);
  assert(opData.isActive === true);
  assert(opData.isPrivate === op.isPrivate);

  // 3. ETH fee getter (standalone, in addition to getOperatorById.fee)
  const onChainFee = await views.getOperatorFee(opId);
  assert(onChainFee === unpackETH(op.ethFee), `operator ${opId} fee getter mismatch`);

  // 4. Declared fee (pending fee change)
  const declData = await views.getOperatorDeclaredFee(opId);
  if (op.pendingFee !== undefined) {
    assert(declData.isFeeDeclared === true);
    assert(declData.fee === unpackETH(op.pendingFee));
    assert(declData.approvalBeginTime === op.pendingFeeApprovalBeginTimestamp);
    assert(declData.approvalEndTime === op.pendingFeeApprovalEndTimestamp);
  } else {
    assert(declData.isFeeDeclared === false);
  }

  // 5. SSV earnings (pre-upgrade operators still accumulate legacy SSV earnings)
  if (op.ssvSnapshotBlock > 0n) {
    const expectedSSVEarnings = computeOperatorSSVEarnings(op, currentBlock);
    const onChainSSV = await views.getOperatorEarningsSSV(opId);
    assert(onChainSSV === expectedSSVEarnings, `operator ${opId} SSV earnings mismatch`);
  }
}
```

### Staking Checks

```typescript
// 1. Accumulator
const expectedAcc = computeAccEthPerShare(proto, currentBlock);
assert(await views.accEthPerShare() === expectedAcc, `accEthPerShare mismatch`);

// 2. Total staked / cSSV supply
assert(await views.totalStaked() === proto.totalStaked);
assert(await cssvToken.totalSupply() === proto.totalStaked);

// 3. Per-staker
for (const [addr, staker] of tsState.stakers) {
  const expectedReward = computeStakingReward(staker, expectedAcc);
  assert(await views.previewClaimableEth(addr) === expectedReward);
  assert(await views.stakedBalanceOf(addr) === staker.cssvBalance);

  // 4. Pending unstakes — verify count and each {amount, unlockTime}
  const onChainUnstakes = await views.pendingUnstake(addr);
  assert(onChainUnstakes.length === staker.pendingUnstakes.length, `${addr} pendingUnstake count mismatch`);
  for (let i = 0; i < staker.pendingUnstakes.length; i++) {
    assert(BigInt(onChainUnstakes[i].amount) === staker.pendingUnstakes[i].amount);
    assert(BigInt(onChainUnstakes[i].unlockTime) === staker.pendingUnstakes[i].unlockTimestamp);
  }
}

// 5. Staking pool balance
assert(await views.stakingEthPoolBalance() === proto.stakingEthPoolBalance);
```

### Protocol Checks

```typescript
// 1. DAO validator count
const expectedVCount = sum(activeClusters.map(c => c.validatorCount));
assert(await views.getNetworkValidatorsCount() === expectedVCount);

// 2. ETH network earnings (accrued but not yet synced to staking pool)
const expectedNetworkEarnings = computeNetworkEarnings(proto, currentBlock);
assert(await views.getNetworkEarnings() === expectedNetworkEarnings);

// 3. ETH network fee (governance param)
assert(await views.getNetworkFee() === unpackETH(proto.ethNetworkFee));

// 4. SSV legacy network earnings
const expectedSSVEarnings = computeNetworkEarningsSSV(proto, currentBlock);
assert(await views.getNetworkEarningsSSV() === expectedSSVEarnings);

// 5. Committed Merkle root (after every commitRoot sequence)
// Called immediately after each commitRoot — verified in the oracle action handler, not here.
// Here: spot-check that the most recently committed root is still retrievable.
if (proto.latestCommittedBlock > 0n) {
  const onChainRoot = await views.getCommittedRoot(proto.latestCommittedBlock);
  assert(onChainRoot === proto.latestCommittedRoot, `committed root mismatch at block ${proto.latestCommittedBlock}`);
}
```

### Sum Invariants (Every checkState Call)

```typescript
const contractBalance = await provider.getBalance(networkAddress);

const sumClusterBalances = sum(
  activeClusters.map(c => computeClusterBalance(c, currentBlock, proto, ops))
);
const sumOperatorEarnings = sum(
  activeOperators.map(op => computeOperatorEthEarnings(op, currentBlock))
);
// Network earnings = fees accrued since last _syncFees call (not yet moved to staking pool)
const networkEarningsWei = computeNetworkEarnings(proto, currentBlock);
// Staking pool = fees synced but not yet claimed by stakers (accumulated when totalStaked == 0)
const stakingPoolWei = proto.stakingEthPoolBalance * ETH_DEDUCTED_DIGITS;
// Staker pending rewards = ETH already distributed via accEthPerShare but not yet claimed
// These funds ARE already in the contract, backing the accEthPerShare accumulator
const currentAcc = computeAccEthPerShare(proto, currentBlock);
const sumStakerPendingRewards = sum(
  stakers.map(s => computeStakingReward(s, currentAcc))
);

// NOTE: ETH network earnings CANNOT be withdrawn by DAO — all ETH goes to stakers.
// Only SSV legacy earnings can be withdrawn by DAO via withdrawNetworkSSVEarnings.
const totalClaimsWei = sumClusterBalances + sumOperatorEarnings + networkEarningsWei
                     + stakingPoolWei + sumStakerPendingRewards;

// Contract must hold at least this much (seed ETH + precision dust can only add to it)
assert(contractBalance >= totalClaimsWei, `ETH CONSERVATION VIOLATED: contract=${contractBalance}, claims=${totalClaimsWei}`);

// Record excess (= seed + dust) for report
const excess = contractBalance - totalClaimsWei;
report.conservationHistory.push({ block: currentBlock, excess });

// cSSV supply
assert(await cssvToken.totalSupply() === proto.totalStaked, `cSSV SUPPLY MISMATCH`);

// Accumulator monotonicity
assert(expectedAcc >= report.lastAccEthPerShare, `ACCUMULATOR DECREASED`);
report.lastAccEthPerShare = expectedAcc;
```

---

## Boundary / Invariant Scenarios

Scheduled at specific points (not purely random — explicitly injected):

| Scenario | Expected Result |
|---|---|
| `bulkRegisterValidator` filling operator to exactly 3000 | Succeeds |
| `registerValidator` to same operator when at 3000 | Reverts `ExceedValidatorLimit` |
| `declareOperatorFee` at exactly max allowed increase (100%) | Succeeds |
| `declareOperatorFee` at max + 1 | Reverts `FeeExceedsIncreaseLimit` |
| `reduceOperatorFee` to exactly 0 | Succeeds |
| `reduceOperatorFee` to `MINIMAL_OPERATOR_ETH_FEE - 1` | Reverts `FeeTooLow` |
| `reduceOperatorFee` to a value ≥ current fee | Reverts `FeeIncreaseNotAllowed` |
| `withdrawOperatorEarnings` exact balance | Succeeds |
| `withdrawOperatorEarnings` balance + 1 wei | Reverts `InsufficientBalance` |
| `reactivate` ETH cluster where one operator was removed | Succeeds (FLOWS.md §1.11 intentional) |
| `registerValidator` on SSV version cluster | Reverts `IncorrectClusterVersion` |
| `reactivate` on SSV version cluster post-migration | Reverts |
| EB = 2048 ETH per validator in oracle update | Succeeds |
| EB = 31 ETH per validator | Reverts |
| `migrateClusterToETH` same cluster twice | Reverts (already ETH version) |
| `deposit` to bring cluster exactly to liquidation threshold | Cluster not liquidatable (boundary) |
| cSSV `transfer` to contract that does NOT implement hook | Behavior per contract spec |
| `stake` then `requestUnstake` then `completeUnstake` before cooldown | Reverts |
| `updateNetworkFee` to 0 (free network) | Succeeds — verify all clusters stop paying network fee |
| Same-block: `updateNetworkFee` + `liquidate` same cluster | Both succeed; staking pool gets correct fees |
| Same-block: `commitRoot` × 3 + `updateClusterBalance` | Succeeds (normal oracle pattern) |
| Same-block: `stake` + `claimEthRewards` by same user | Verify reward doesn't double-count |

---

## Liquidation Mechanics

### Dedicated Liquidator

A single dedicated `liquidator` address performs all liquidations in the stress test (not a random address). After **every** `liquidate()` call:

```typescript
const expectedLiquidatorPayout = computeClusterBalance(cluster, currentBlock, proto, ops);
const liquidatorBalanceBefore = await provider.getBalance(liquidator.address);
// ... call liquidate() ...
const liquidatorBalanceAfter = await provider.getBalance(liquidator.address);
const gasCost = receipt.gasUsed * receipt.gasPrice;
const actualPayout = liquidatorBalanceAfter - liquidatorBalanceBefore + gasCost;
assert(actualPayout === expectedLiquidatorPayout, `liquidator payout mismatch: expected ${expectedLiquidatorPayout}, got ${actualPayout}`);
```

**Note**: The liquidator receives `balanceLiquidatable` = the cluster's remaining ETH balance at the time of liquidation (from `CoreLib.transferBalance(liquidator, balanceLiquidatable)` in `_executeLiquidation`). This is the TS-computed `computeClusterBalance` value, NOT `minimumLiquidationCollateral` which is just the threshold parameter.

When `balanceLiquidatable == 0` (cluster was already fully drained): liquidator still pays gas but gets nothing. TS tracks this correctly since `computeClusterBalance` returns 0 in that case.

### Near-Liquidatable Cluster Monitoring

At every `checkState` call, for each cluster where `computeIsLiquidatable(cluster) == true`:
- If the cluster has been liquidatable for more than 3 consecutive `checkState` calls without being liquidated, inject a forced `liquidate` action immediately
- This prevents clusters from lingering in an impossible state (on mainnet, liquidators always catch these)

---

## Operator Fee Change Flow

Fee changes require time-based sequencing. **Test setup**: reduce `declareOperatorFeePeriod` and `executeOperatorFeePeriod` to **500 seconds each** (with 1s-per-block Hardhat default this = 500 blocks). This gives full fee-change coverage without burning 604,800 blocks per fee cycle. Set via `updateDeclareOperatorFeePeriod(500)` and `updateExecuteOperatorFeePeriod(500)` during setup.

Similarly, **cooldownDuration** defaults to 604,800 seconds (7 days). Reduce to **500 seconds** via `updateUnstakeCooldownDuration(500)`. This allows `completeUnstake` to be tested without burning 4.6% of the block budget per unstake cycle. Record `cooldownDuration = 500` in TS `ProtocolState`.

**`minBlocksBetweenUpdates`** defaults to 0 in storage (never initialized by the upgrade fixture). With value 0 the check `block.number < lastUpdateBlock + 0` is always false — no restriction on EB update frequency. No configuration needed.

1. `declareOperatorFee(id, newFee)`:
   - TS: record `pendingFee`, `pendingFeeApprovalBeginTimestamp = now + declareOperatorFeePeriod`
   - TS: record `pendingFeeApprovalEndTimestamp = approvalBegin + executeOperatorFeePeriod`

2. Mine `declareOperatorFeePeriod` worth of blocks (so `block.timestamp` advances past the window open):
   - Use `hardhat_mine(n, { interval: 1 })` where `n * 1 > declareOperatorFeePeriod`

3. `executeOperatorFee(id)`:
   - TS: checkpoint operator's ETH snapshot FIRST (same as contract calls `updateSnapshotSt` inside)
   - TS: update `ethFee = pendingFee`
   - TS: clear pending fee fields
   - After this, all clusters using this operator have changed burn rates

4. TS must recompute all cluster burn rates using the new fee from this block forward.

---

## Staking Pool Sync Points

The following contract functions call `_syncFees` internally, transferring accrued DAO ETH into the staking pool. TS must mirror this on every call:

```typescript
function syncStakingPool(proto: ProtocolState, currentBlock: bigint): void {
  const newFees = computeNetworkEarnings(proto, currentBlock) - proto.ethDaoBalance;
  // Actually: newFees = (currentBlock - proto.ethDaoIndexBlockNumber) * ethNetworkFee * daoTotalEthVUnits / BPS_DENOMINATOR * ETH_DEDUCTED_DIGITS
  if (proto.totalStaked > 0n) {
    proto.accEthPerShare += (newFees * 10n**18n) / proto.totalStaked;
  } else {
    proto.stakingEthPoolBalance += newFees;  // permanently stranded if nobody staked
  }
  proto.ethDaoBalance = 0n;
  proto.ethDaoIndexBlockNumber = currentBlock;
}
```

Triggers: `updateClusterBalance`, `liquidate`, `withdraw`, `reactivate`, `updateNetworkFee` (DAO).

**Same-block edge case**: If two sync-triggering events fire in the same block (e.g., two `liquidate` calls), the second sync adds 0 new fees (block diff = 0). TS handles this correctly by checking `currentBlock === proto.ethDaoIndexBlockNumber`.

---

## Teardown Phase

1. Advance time past all pending unstake cooldowns (`hardhat_mine` by `cooldownDuration + 1`)
2. **Withdraw all ETH cluster balances** — each owner calls `withdraw(balance)` on active clusters
3. **Withdraw all operator earnings** — every non-removed operator calls `withdrawAllOperatorEarnings()`
4. **Complete all unstake requests** — every staker calls `completeUnstake()`
5. **Claim all staker rewards** — every staker calls `claimEthRewards()`
6. **Withdraw legacy SSV network earnings** — DAO calls `withdrawNetworkSSVEarnings(ssvAmount)` (ETH earnings go entirely to stakers — no ETH withdrawal function exists for DAO)
7. **Final balance check**:

```typescript
const remaining = await provider.getBalance(networkAddress);
const remainingSSV = await ssvToken.balanceOf(networkAddress);

const ethDust = remaining - SEED_ETH;  // should be small positive
const ssvDust = remainingSSV - SEED_SSV;

report.finalDustETH = ethDust;
report.finalDustSSV = ssvDust;

const MAX_ACCEPTABLE_DUST = 100_000_000_000_000n;  // 0.0001 ETH in wei

// Dust should be positive (we never underpay)
assert(ethDust >= 0n, "CRITICAL: seed ETH was consumed — contract underflowed");
assert(ssvDust >= 0n, "CRITICAL: seed SSV was consumed — contract underflowed");

// Hard fail if dust exceeds tolerance
assert(ethDust <= MAX_ACCEPTABLE_DUST,
  `DUST EXCEEDED TOLERANCE: ${ethers.formatEther(ethDust)} ETH dust after 5 years (max allowed: 0.0001 ETH)`);
assert(ssvDust <= MAX_ACCEPTABLE_DUST,
  `SSV DUST EXCEEDED TOLERANCE: ${ethers.formatEther(ssvDust)} SSV dust (max allowed: 0.0001 SSV)`);
```

The HTML report highlights the dust amount prominently regardless of pass/fail. If the assertion fails, the test fails hard.

---

## HTML Report

Generated at the end of the test run as `test/stress/report-[timestamp].html`. Self-contained (no external CDN dependencies — inline minimal CSS + Chart.js bundle or SVG charts).

### Section 1 — Run Summary (top of page)

```
Run ID: stress-2026-03-24-abc123
Duration: 5.02 years simulated (13,144,320 blocks)
Wall clock time: 4m 22s
Total write TXs: 9,847
Total checkState calls: 9,847
checkState PASSED: 9,841 | FAILED: 6
Same-block batches executed: 892 (9.1% of actions)
Max TXs in one block: 7
RNG Seed: 0xdeadbeef
```

### Section 2 — Economic Flow

Large visual breakdown of where ETH went:
- Total ETH deposited into clusters: X ETH
- Total ETH burned as operator fees: X ETH (breakdown per operator)
- Total ETH burned as network fee: X ETH
- Total ETH distributed to stakers: X ETH
- Total ETH withdrawn by cluster owners: X ETH
- Total ETH withdrawn by operators: X ETH
- Total ETH withdrawn by stakers: X ETH
- Total ETH withdrawn by DAO: X ETH
- Final dust remaining: **X ETH** (seed = 100 ETH, protocol dust = X ETH) — ⚠️ highlighted if > 1 ETH
- Final SSV dust remaining: **X SSV**

Include a **Sankey-style diagram** (or simple stacked bar chart) showing ETH flow from cluster deposits → operator fees + network fees + staking rewards.

### Section 3 — Action Breakdown Table

Every write function with:
| Function | Calls | Successes | Expected Reverts | Unexpected Reverts |
|---|---|---|---|---|
| registerValidator | 847 | 840 | 7 | 0 |
| bulkRegisterValidator | 412 | 409 | 3 | 0 |
| ... | | | | |

Clicking a function name filters the action log below.

### Section 4 — Invariant / Boundary Test Results

Table of all explicitly scheduled boundary scenarios:
| Scenario | Block | Result | Notes |
|---|---|---|---|
| Fill operator to 3000 validators | 2,341,001 | ✅ PASS | |
| Register 3001st validator | 2,341,001 | ✅ PASS (expected revert) | ExceedValidatorLimit |
| ... | | | |

### Section 5 — Conservation Check Over Time

Line chart: `contractBalance - sum(claims)` over blocks.
- Y-axis: excess ETH (should always be ≥ 100 ETH seed, never decreasing below seed)
- X-axis: block number (labeled in years: Year 1, Year 2, ...)
- Any dip below seed line = critical alert

### Section 6 — staking APY chart

Line chart: computed APY over time:
```
APY = (feesDistributedInWindow / totalStakedAtWindowStart) * (blocksPerYear / windowSizeBlocks) * 100
```
Shows how APY evolves as network fee, validator count, and staked amount change.

### Section 7 — vUnits / EB Evolution

Line chart: `daoTotalEthVUnits` over blocks.
- Shows growth as EB oracle updates raise effective balances above 32 ETH baseline
- Annotated with each `commitRoot` event

### Section 8 — Cluster Lifecycle Dashboard

Four stats:
- Total clusters created: N
- Clusters that survived (still active at end): N
- Clusters liquidated: N (and average time-to-liquidation in blocks)
- Clusters manually closed (withdrew all balance): N

Pie chart: Active / Liquidated / Closed at end of simulation.

Bonus: histogram of cluster lifetimes (blocks active before liquidation/closure).

### Section 9 — Operator Leaderboard

Top 20 operators by ETH earned. Table:
| Rank | Operator ID | Owner | Total ETH Earned | Fee (wei) | Validator Count Peak | Fee Changes |
|---|---|---|---|---|---|---|

### Section 10 — Staker Dashboard

Per-staker summary table:
| Address | Type (EOA/Contract) | SSV Staked | cSSV Balance | ETH Rewards Claimed | Unstakes |
|---|---|---|---|---|---|

### Section 11 — Account Explorer

Searchable, clickable list of all addresses. Clicking an address shows:
- **Role**: operator_owner / cluster_owner / staker / oracle / dao / liquidator
- **ETH in / out**: total ETH deposited and withdrawn
- **SSV in / out**: total SSV token flow
- **cSSV minted / burned**: staking activity
- **Action log**: chronological table of every TX this address performed:
  | Block | Action | Input Parameters | Result | Gas Used |
  |---|---|---|---|---|
  | 1,234,567 | deposit | owner=0x.., ids=[1,2,3,4], amount=5 ETH | ✅ | 87,432 |

Includes "Related State Changes" tooltip: hover over a TX to see what other state changed at the same block (e.g., "operator #3 changed fee at same block").

### Section 12 — Failure Details (if any)

Each `checkState` failure gets a full entry:

```
FAILURE #1 — Block 7,234,001
Triggering TX: withdraw(owner=0xA, ids=[1,2,3,4], cluster={...}, amount=2.3 ETH)
Failed Check: cluster balance mismatch
  Expected (TS computed): 2,100,000,000 wei
  Actual (contract):      1,950,000,000 wei
  Delta: -150,000,000 wei

Causal Chain — State changes affecting this cluster since last successful check:
  Block 7,100,000: updateNetworkFee(newFee=5000000000) — network fee changed from 3000000000 to 5000000000
    Effect: cluster burn rate increased by ~12%
  Block 7,200,000: executeOperatorFee(operatorId=3) — operator fee changed from 1778800000 to 2000000000
    Effect: operator #3 in this cluster increased fee
  Block 7,220,000: updateClusterBalance(clusterId=0x.., effectiveBalance=64) — EB updated
    Effect: ebVUnits doubled from 10000 to 20000
```

Every failure shows all state changes that touched the same cluster/operators/stakers since the last passing check.

### Section 13 — Same-Block Stress Summary

Table of all same-block batches:
| Block | TXs in Batch | Actions | All Succeeded? |
|---|---|---|---|
| 4,512,001 | 5 | liquidate + deposit + updateNetworkFee + commitRoot×3 | ✅ |

Highlight batches that triggered invariant failures.

### Section 14 — Oracle Activity Log

| Block | Root (truncated) | Clusters Updated | EB Range (ETH) | Committed By |
|---|---|---|---|---|

Shows the rhythm of oracle updates over 5 years.

### Section 15 — Gas Usage Summary

Uses a standard mainnet gas price of **30 gwei** and a **live ETH/USD price fetched at the start of the test run** (from CoinGecko public API — no API key required). The price is stored in `report.ethPriceUSD` and embedded in the HTML for reproducibility.

```typescript
// Fetched once at the very start of index.test.ts before any setup:
const resp = await fetch("https://api.coingecko.com/api/v3/simple/price?ids=ethereum&vs_currencies=usd");
const data = await resp.json();
report.ethPriceUSD = data.ethereum.usd;  // e.g., 3200
// If fetch fails (offline/CI), fall back to FALLBACK_ETH_PRICE_USD = 3000 and log a warning.
```

| Function | Calls | Avg Gas | Min Gas | Max Gas | Total Gas | Avg Cost (USD) | Total Cost (USD) |
|---|---|---|---|---|---|---|---|

```
avgCostUSD = avgGas * 30_000_000_000 (30 gwei in wei) * ethPriceUSD / 1e18
```

Helps identify gas spikes (e.g., large `bulkRegisterValidator` batches) and gives a real-world cost intuition. The ETH price used and its fetch timestamp are shown at the top of this section.

### Section 16 — Time Scale Reference

```
Simulation: 13,140,000 blocks = ~5.00 years
Block 0:       Setup complete
Block 657,000: Year 0.25
Block 1,314,000: Year 0.5
Block 2,628,000: Year 1
Block 5,256,000: Year 2
Block 7,884,000: Year 3
Block 10,512,000: Year 4
Block 13,140,000: Year 5 (end)
```

Chart X-axes labeled in years for readability.

---

## Report Architecture

```typescript
// report.ts

interface RunReport {
  runId: string;
  rngSeed: string;
  startWallTime: number;
  endWallTime: number;
  ethPriceUSD: number;             // live price fetched at start; fallback = 3000 if offline
  ethPriceFetchedAt: number;       // unix timestamp of price fetch

  // Block counters
  totalBlocksMined: bigint;
  currentBlock: bigint;

  // TX counters
  totalWriteTxs: number;
  totalCheckStateCalls: number;
  checkStatePassed: number;
  checkStateFailed: number;
  sameBlockBatches: number;
  maxTxsInSingleBlock: number;

  // Per-action stats
  actionStats: Map<string, { calls: number; successes: number; expectedReverts: number; unexpectedReverts: number; totalGas: bigint; minGas: bigint; maxGas: bigint }>;

  // Economic totals
  totalEthDepositedWei: bigint;
  totalEthWithdrawnByOwnersWei: bigint;
  totalOperatorEthEarnedWei: bigint;
  totalOperatorEthWithdrawnWei: bigint;
  totalNetworkEthEarnedWei: bigint;
  totalNetworkEthWithdrawnWei: bigint;
  totalStakingEthDistributedWei: bigint;
  totalStakingEthClaimedWei: bigint;
  totalSSVStaked: bigint;
  totalCSSVMinted: bigint;
  totalCSSVBurned: bigint;
  totalSSVUnstaked: bigint;

  // Cluster stats
  totalClustersCreated: number;
  totalClustersLiquidated: number;
  totalValidatorsRegistered: number;
  totalValidatorsRemoved: number;
  peakValidatorCount: bigint;
  clusterLiquidationTimes: bigint[];  // age in blocks at liquidation

  // Operator stats
  totalOperatorsRegistered: number;
  totalOperatorsRemoved: number;
  operatorFeeChanges: number;

  // EB oracle stats
  totalRootCommits: number;
  totalClusterEBUpdates: number;
  ebUpdateHistory: Array<{ block: bigint; clustersUpdated: number; ebRangeMin: number; ebRangeMax: number }>;

  // Boundary test results
  boundaryResults: Array<{ name: string; block: bigint; result: 'PASS' | 'FAIL' | 'EXPECTED_REVERT'; notes: string }>;

  // Failures
  failures: FailureRecord[];

  // Time-series (sampled every ~100k blocks)
  conservationHistory: Array<{ block: bigint; excess: bigint }>;
  accEthPerShareHistory: Array<{ block: bigint; value: bigint }>;
  daoVUnitsHistory: Array<{ block: bigint; vUnits: bigint }>;
  stakingApyHistory: Array<{ block: bigint; apyBps: bigint }>;
  validatorCountHistory: Array<{ block: bigint; count: bigint }>;

  // Per-account
  accounts: Map<string, AccountReport>;

  // Same-block batches
  sameBlockBatchLog: Array<{ block: bigint; actions: string[]; allPassed: boolean }>;

  // Dust (final)
  finalDustETH: bigint;
  finalDustSSV: bigint;

  lastAccEthPerShare: bigint;  // for monotonicity check
}

interface FailureRecord {
  failureIndex: number;
  block: bigint;
  triggerAction: string;
  triggerInputs: Record<string, string>;
  triggerTxHash: string;
  failedCheck: string;
  expectedValue: string;
  actualValue: string;
  causalChain: Array<{
    block: bigint;
    action: string;
    inputs: Record<string, string>;
    stateEffect: string;
  }>;
}

interface AccountReport {
  address: string;
  role: string[];  // can have multiple roles
  totalEthIn: bigint;
  totalEthOut: bigint;
  totalSSVIn: bigint;
  totalSSVOut: bigint;
  cssvBalance: bigint;
  totalCSSVMinted: bigint;
  totalCSSVBurned: bigint;
  actions: Array<{
    block: bigint;
    action: string;
    inputs: Record<string, string>;
    result: 'success' | 'expected_revert' | 'unexpected_revert';
    gasUsed: bigint;
    relatedBlockStateChanges: string[];
  }>;
}
```

The `generateHTMLReport(report: RunReport): string` function produces a fully self-contained HTML file with:
- Inline CSS (dark theme, professional)
- Inline Chart.js (or SVG-based charts for zero dependencies)
- All data embedded as a JSON blob in a `<script>` tag
- Clickable/filterable tables using vanilla JS

File written to: `test/stress/report-{runId}.html`

---

## Open Questions — Resolved

### Q1 — Dust tolerance ✅
Hard fail if dust > 0.0001 ETH or 0.0001 SSV. `MAX_ACCEPTABLE_DUST = 1e14 wei`. Prominent in HTML report regardless.

### Q2 — Block timestamp / fee period ✅
Option b: reduce `declareOperatorFeePeriod` and `executeOperatorFeePeriod` to **500 seconds** in test setup. With Hardhat default 1s/block, this = 500 blocks to wait. The fee change flow is fully covered without burning block budget. Set via `updateDeclareOperatorFeePeriod(500)` and `updateExecuteOperatorFeePeriod(500)` during setup.

Note: fee period is time-based (seconds), not block-based. `block.timestamp` advances 1 second per block in Hardhat default config.

### Q3 — Validator keys ✅
Sequential dummy bytes (`0x010000...N`).

### Q4 — Liquidation actor ✅
Dedicated `liquidator` address. Assert exact balance increase = cluster remaining balance on every liquidation. See Liquidation Mechanics section.

---

## Open Questions — Resolved

### QA — Governance change safety ✅
Cap at 1% newly liquidatable per change. No cluster's balance may hit 0 from the change itself. After change: 50% of affected clusters get liquidated immediately, 50% get topped up. Pre-mine scan handles the general case. See Governance Change Safety Rules section.

### QB — DAO network earnings withdrawal ✅
`withdrawNetworkSSVEarnings` (SSV only — ETH goes to staking pool entirely). A few random calls added to DAO action pool.

### QC — Contract stakers ✅
~50 simple hold-and-claim contract stakers (plus ~250 EOA stakers = ~300 total). Just call `cssvToken.transfer` — no special `onCSSVTransfer` implementation needed on the receiver. Mint SSV directly to the contract address, call `stake()` from the contract.

### QD — Role overlaps ✅
Operator + staker: super common. Cluster owner + staker: super common. Pure staker: super common. Operator + cluster owner (no staking): uncommon. See Role Overlap Distribution table.

---

## Open Questions — Resolved (Round 3)

### QE — Multiple clusters per address ✅
70–80% of cluster owner addresses must own multiple clusters. Average 4–5 clusters per address gives ~600–750 total ETH clusters, consistent with the existing ~600 target. A single address owning 2–8 clusters with different operator sets is normal.

### QF — Contract staker SSV minting ✅
Mint SSV directly to the contract address, then call `stake()` from the contract. Simplest approach.

### QG — DAO owner ✅
Deployer address is the DAO owner. No separate signer needed.

---

## Open Questions — Resolved (Final)

### QH — Cooldown duration ✅
Reduce to 500 seconds via `updateUnstakeCooldownDuration(500)` during setup. Same reasoning as fee periods.

### QI — Private operators and whitelist ✅
Whitelist only the RELEVANT addresses — each cluster owner is whitelisted for the specific private operators they'll actually use. Allow **1–2 expected `CallerNotWhitelisted` reverts** during the simulation (not every attempt, just a deliberate handful). Track `operator.whitelistedAddresses` in TS state.

### QJ — SSV legacy cluster fate ✅
Both:
- ~2–3 unmigrated SSV clusters: let them drain naturally → `liquidateSSV` (tests SSV liquidation path)
- ~1–2 unmigrated SSV clusters: top up periodically with `depositSSV` to keep alive

Same pre-mine and checkState scanning applies to SSV clusters using SSV balance formula.

---

## All Questions Resolved — Spec Ready for Review

---

## Implementation Order

Once all open questions answered:
1. `constants.ts`
2. `state.ts` — all interfaces + TS math functions
3. `setup.ts`
4. `checkState.ts`
5. `actions.ts`
6. `random.ts`
7. `report.ts` — RunReport + HTML generator
8. `teardown.ts`
9. `index.test.ts`

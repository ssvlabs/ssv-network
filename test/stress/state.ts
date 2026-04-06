// TS simulation state — mirrors Solidity's packed-ETH arithmetic for all ETH-side calculations.
//
// ETH cluster formulas (per block, using effectiveBalance):
//   packedFee     = feeWei / ETH_DEDUCTED_DIGITS  (stored in contract as uint64)
//   cluster.balance  -= blockDiff * burnRate * effectiveBalance / DEFAULT_EB
//   operator.balance += blockDiff * packedFee * op.effectiveBalance / DEFAULT_EB * ETH_DEDUCTED_DIGITS
//   network.ethNetworkEarnings += blockDiff * feeWei * net.totalEffectiveBalance / DEFAULT_EB
//
//   All effectiveBalance values are always multiples of DEFAULT_EB (32), so division is exact.
//   burnRate = sum(opFeeWei) + networkFeeWei  (per block per DEFAULT_EB of effective balance)
//
// SSV cluster formulas (per block, using validator count — legacy path):
//   cluster.ssvBalance  -= blockDiff * ssvBurnRate * validatorCount
//   operator.ssvBalance += blockDiff * ssvFeeWei   * ssvValidatorCount
//   network.ssvNetworkEarnings += blockDiff * feeSSVWei * totalSSVValidators
//
// advanceAll(state, block) is called:
//   1. At the start of every action handler (at the TX block), BEFORE mutating state.
//   2. At the start of checkState (at the current block), BEFORE asserting.

import {
  VERSION_SSV,
  VERSION_ETH,
  ETH_DEDUCTED_DIGITS,
  PRECISION,
} from './constants.ts';

export { VERSION_SSV, VERSION_ETH };

// Default effective balance per validator in whole ETH.
export const DEFAULT_EB = 32n;

// BPS denominator — matches BPS_DENOMINATOR in the contract (10_000).
// Used as scaling factor: fees per block per DEFAULT_EB of effective balance.
export const BPS_DENOMINATOR = 10_000n;

// ─── Types ─────────────────────────────────────────────────────────────────

export interface OperatorRecord {
  id:             bigint;
  owner:          string;
  // ETH tracking (validators in ETH clusters, including migrated-from-SSV)
  feeWei:         bigint;          // ETH fee per block per DEFAULT_EB of effective balance (unpacked wei)
  block:          bigint;          // ETH snapshot block
  balance:        bigint;          // accumulated ETH earnings in wei
  effectiveBalance: bigint;        // total ETH across all ETH cluster validators (whole ETH, always multiple of 32)
  // SSV tracking (pre-migration operators only; 0 for post-migration operators)
  ssvFeeWei:      bigint;          // SSV fee per block per validator (unpacked SSV wei)
  ssvBlock:       bigint;          // SSV snapshot block
  ssvBalance:     bigint;          // accumulated SSV earnings in SSV wei
  ssvValidatorCount: bigint;       // validators in SSV clusters using this operator
  // Pending fee change (ETH operators only)
  pendingFeeWei:              bigint;  // declared but not yet executed (0n if none)
  pendingFeeBlock:            bigint;  // block of declaration (0n if none)
  pendingFeeApprovalBeginTime: bigint; // Unix timestamp when execute window opens (0n if none)
  pendingFeeApprovalEndTime:   bigint; // Unix timestamp when execute window closes (0n if none)
  // Meta
  isRemoved:      boolean;
  isPrivate:      boolean;
  whitelistedAddresses: Set<string>;
}

export interface ClusterStruct {
  validatorCount:   bigint;
  networkFeeIndex:  bigint;
  index:            bigint;
  active:           boolean;
  balance:          bigint;
}

export interface ClusterRecord {
  id:             string;          // keccak256(owner, operatorIds)
  owner:          string;
  operatorIds:    bigint[];        // sorted ascending
  version:        bigint;          // VERSION_SSV = 0, VERSION_ETH = 1
  // ETH fields (version === VERSION_ETH)
  block:          bigint;          // ETH snapshot block
  balance:        bigint;          // ETH balance in wei at snapshot
  burnRate:       bigint;          // ETH fee rate per block per DEFAULT_EB = sum(opFeeWei) + networkFeeWei
  effectiveBalance: bigint;        // total ETH across all validators (whole ETH, always multiple of 32)
                                   // mirrors seb.clusterEB: oracle-set total, +32 on register, -32 on remove
  // SSV fields (version === VERSION_SSV)
  ssvBlock:       bigint;          // SSV snapshot block
  ssvBalance:     bigint;          // SSV balance in SSV wei at snapshot
  ssvBurnRate:    bigint;          // SSV wei per block per validator = sum(opSSVFeeWei) + networkFeeSSV
  // Common
  createdBlock:   bigint;          // block when this cluster was first created (or migrated to ETH)
  validatorCount: bigint;          // number of validators (used for SSV math and metadata)
  active:         boolean;
  canRegister:    boolean;         // false once a removed operator is in this cluster (registerValidator reverts)
  // Oracle EB tracking: last value committed via updateClusterBalance (0 = never oracle-updated).
  // Used to floor the next oracle EB so the delta in _updateOperatorVUnits is never negative,
  // preventing a Solidity overflow when operatorEthVUnits < (storedVUnits - newVUnits).
  lastOracleEB:   bigint;
  validators:     Set<string>;
  lastStruct:     ClusterStruct;   // parsed from latest TX event — used for view calls in checkState
}

export interface NetworkRecord {
  block:                  bigint;
  // ETH side — feeds the staking pool (accEthPerShare accumulator)
  ethNetworkEarnings:     bigint;    // accumulated ETH network fees in wei
  accEthPerShare:         bigint;    // staking accumulator — updated ONLY on onSyncFees (mirrors _syncFees)
  lastSyncedPackedEarnings: bigint;  // packed earnings at last onSyncFees call (mirrors stakingEthPoolBalance)
  feeWei:                 bigint;    // ETH fee per block per DEFAULT_EB of effective balance
  totalEffectiveBalance:  bigint;    // total ETH EB across all active ETH clusters (whole ETH, always multiple of 32)
  // SSV side — goes to SSV DAO treasury
  ssvNetworkEarnings:     bigint;    // accumulated SSV DAO fees in SSV wei
  feeSSVWei:              bigint;    // SSV fee per block per validator
  totalSSVValidators:     bigint;    // validators in active SSV clusters
}

export interface UnstakeRequest {
  amount:     bigint;  // SSV wei
  unlockTime: bigint;  // Unix timestamp (seconds) when withdrawal is allowed
}

export interface StakerRecord {
  address:        string;
  cssvBalance:    bigint;           // current cSSV balance (↑ on stake, ↓ on requestUnstake)
  pendingUnstake: UnstakeRequest[]; // mirrors on-chain withdrawalRequests[] (insertion order)
  ethClaimed:     bigint;           // accumulated ETH rewards claimed
  totalEthAmount: bigint;           // settled (unclaimed) ETH rewards = mirrors accrued[user]
  userIndex:      bigint;           // accumulator snapshot at last settle = mirrors userIndex[user]
}

export interface PendingEBEntry {
  oldEB: bigint;   // cluster.effectiveBalance before this round (whole ETH)
  newEB: bigint;   // new effective balance to apply (whole ETH)
  proof: string[]; // merkle proof (bytes32[])
}

export interface PendingEBRound {
  blockNum: number;                      // snapshot block passed to commitRoot
  entries:  Map<string, PendingEBEntry>; // keyed by clusterId (hex string)
}

export interface SimState {
  operators:  Map<bigint, OperatorRecord>;
  clusters:   Map<string, ClusterRecord>;
  stakers:    Map<string, StakerRecord>;  // keyed by lowercase address
  network:    NetworkRecord;
  minimumBlocksBeforeLiquidation: bigint;
  minimumLiquidationCollateral:    bigint;  // ETH wei — used for ETH clusters
  minimumLiquidationCollateralSSV: bigint;  // SSV wei — used for SSV clusters
  nextValidatorSeed: number;
  // Cumulative excess from cluster balance clamping.
  // When a cluster's computed fees exceed its balance, the contract clamps to 0 and backs
  // the shortfall with SEED_ETH. Operators/network still accrue the full index-based amount.
  // This causes expectedETH > contractETH by exactly this excess in the conservation check.
  totalClampingExcess: bigint;
  // Cumulative ETH precision loss from staker reward distribution.
  // Each advanceAll floors delta to ETH_DEDUCTED_DIGITS granularity (mirrors contract PackedETH).
  // The discarded wei accumulates here and is surfaced in the HTML report.
  totalStakingDust: bigint;
  // Pending EB round: committed merkle root waiting for updateClusterBalance calls.
  // Replaced (old entries abandoned) each time actCommitEBRoot succeeds.
  pendingEBRound: PendingEBRound | null;
}

// ─── advanceAll ─────────────────────────────────────────────────────────────

function advanceOperator(op: OperatorRecord, block: bigint): void {
  if (op.isRemoved) return;
  // ETH earnings: mirror Solidity's two-step packed arithmetic (OperatorLib.updateSnapshotSt).
  // Solidity: delta_packed = floor(blockDiff * packedFee * (effectiveBalance * BPS / 32) / BPS)
  //           balance_wei  += delta_packed * ETH_DEDUCTED_DIGITS
  // Since effectiveBalance is always a multiple of 32, this simplifies to:
  // => packedDelta = blockDiff * packedFee * effectiveBalance / 32
  if (op.block < block && op.effectiveBalance > 0n) {
    const packedFee = op.feeWei / ETH_DEDUCTED_DIGITS;
    const packedDelta = (block - op.block) * packedFee * op.effectiveBalance / DEFAULT_EB;
    op.balance += packedDelta * ETH_DEDUCTED_DIGITS;
    op.block = block;
  } else if (op.block < block) {
    op.block = block;
  }
  // SSV earnings (only for pre-migration operators with active SSV clusters)
  if (op.ssvFeeWei > 0n && op.ssvBlock < block) {
    op.ssvBalance += (block - op.ssvBlock) * op.ssvFeeWei * op.ssvValidatorCount;
    op.ssvBlock = block;
  }
}

function advanceCluster(cluster: ClusterRecord, block: bigint): bigint {
  if (!cluster.active) return 0n;
  if (cluster.version === VERSION_ETH) {
    if (cluster.block >= block) return 0n;
    // ETH fee per spec: blockDiff * burnRate * effectiveBalance / DEFAULT_EB
    // (effectiveBalance is always a multiple of DEFAULT_EB, so division is exact)
    const cost = (block - cluster.block) * cluster.burnRate * cluster.effectiveBalance / DEFAULT_EB;
    const excess = cost > cluster.balance ? cost - cluster.balance : 0n;
    cluster.balance = cluster.balance > cost ? cluster.balance - cost : 0n;
    cluster.block = block;
    return excess;
  } else {
    // SSV cluster: fee scales with validator count
    if (cluster.ssvBlock >= block) return 0n;
    const cost = (block - cluster.ssvBlock) * cluster.ssvBurnRate * cluster.validatorCount;
    cluster.ssvBalance = cluster.ssvBalance > cost ? cluster.ssvBalance - cost : 0n;
    cluster.ssvBlock = block;
    return 0n;
  }
}

function advanceNetwork(net: NetworkRecord, block: bigint): void {
  if (net.block >= block) return;
  const blockDiff = block - net.block;
  // ETH side: feeds the staking pool accumulator.
  // totalEffectiveBalance is always a multiple of 32, so division is exact.
  // earnings += blockDiff * feeWei * totalEffectiveBalance / DEFAULT_EB
  net.ethNetworkEarnings += blockDiff * net.feeWei * net.totalEffectiveBalance / DEFAULT_EB;
  // SSV side: goes to SSV DAO treasury (uses plain validator count)
  net.ssvNetworkEarnings += blockDiff * net.feeSSVWei * net.totalSSVValidators;
  net.block = block;
}

/**
 * Advance operators, clusters, and network earnings forward to `block`.
 * Does NOT touch the staking accumulator (accEthPerShare / lastSyncedPackedEarnings) —
 * those are updated only by onSyncFees, which is called explicitly at staker TX time.
 * Call before any state mutation and at the top of checkState.
 */
export function advanceAll(state: SimState, block: bigint): void {
  for (const op of state.operators.values()) advanceOperator(op, block);
  for (const cluster of state.clusters.values()) {
    state.totalClampingExcess += advanceCluster(cluster, block);
  }

  // Capture earnings before advancing the network so we can compute the delta.
  const prevEarnings = state.network.ethNetworkEarnings;
  advanceNetwork(state.network, block);
  const rawDelta = state.network.ethNetworkEarnings - prevEarnings;

  // (no dust here: rawDelta is always a multiple of ETH_DEDUCTED_DIGITS because
  //  feeWei is enforced to be a multiple of ETH_DEDUCTED_DIGITS by the contract
  //  and totalEffectiveBalance is always a multiple of DEFAULT_EB = 32)
}

/**
 * Mirror contract's _syncFees: compute a single-batch diff from lastSyncedPackedEarnings
 * to the current packed earnings, update accEthPerShare, and advance lastSyncedPackedEarnings.
 * Call at staker TX time (stake, requestUnstake, claimEthRewards) AFTER advanceAll(txBlock).
 */
export function onSyncFees(state: SimState): void {
  const currentPacked = (state.network.ethNetworkEarnings / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS;
  const diff = currentPacked > state.network.lastSyncedPackedEarnings
    ? currentPacked - state.network.lastSyncedPackedEarnings
    : 0n;

  if (diff > 0n) {
    let totalCSSV = 0n;
    for (const staker of state.stakers.values()) totalCSSV += staker.cssvBalance;
    if (totalCSSV > 0n) {
      const accDelta = diff * PRECISION / totalCSSV;
      state.network.accEthPerShare += accDelta;
      // Real dust: ETH that entered the pool but can't be recovered because
      // integer division in accEthPerShare loses diff % (totalCSSV / PRECISION) per sync.
      // Exact formula: diff - floor(accDelta * totalCSSV / PRECISION)
      state.totalStakingDust += diff - (accDelta * totalCSSV / PRECISION);
    } else {
      // No stakers — ETH enters pool but no one can claim it. All of diff is dust.
      state.totalStakingDust += diff;
    }
  }
  // Always advance the watermark (mirrors contract updating stakingEthPoolBalance
  // even when totalStaked == 0 or diff == 0).
  state.network.lastSyncedPackedEarnings = currentPacked;
}

/**
 * Mirror contract's _settleWithBalance: credit the staker's pending accumulator
 * rewards into totalEthAmount (= accrued[user]) and advance their userIndex.
 * Call AFTER onSyncFees, using the staker's balance at the moment the contract
 * calls _settle (i.e. BEFORE any mint/burn on this TX).
 */
export function onSettleUser(staker: StakerRecord, state: SimState): void {
  if (staker.cssvBalance > 0n) {
    const pending = staker.cssvBalance * (state.network.accEthPerShare - staker.userIndex) / PRECISION;
    staker.totalEthAmount += pending;
  }
  staker.userIndex = state.network.accEthPerShare;
}

// ─── Liquidation helpers ─────────────────────────────────────────────────────

/** Burn cost per block for a cluster (in the cluster's currency: ETH wei or SSV wei). */
export function burnPerBlock(cluster: ClusterRecord): bigint {
  if (cluster.version === VERSION_ETH) {
    return cluster.burnRate * cluster.effectiveBalance / DEFAULT_EB;
  }
  return cluster.ssvBurnRate * cluster.validatorCount;
}

/** Minimum balance that keeps the cluster alive (ETH wei for ETH clusters, SSV wei for SSV clusters). */
export function liquidationThreshold(cluster: ClusterRecord, state: SimState): bigint {
  const bpb = burnPerBlock(cluster);
  const blockThreshold = state.minimumBlocksBeforeLiquidation * bpb;
  const minCollateral = cluster.version === VERSION_ETH
    ? state.minimumLiquidationCollateral
    : state.minimumLiquidationCollateralSSV;
  return blockThreshold > minCollateral ? blockThreshold : minCollateral;
}

/** True if the cluster (after advanceAll) is eligible for liquidation. */
export function isLiquidatable(cluster: ClusterRecord, state: SimState): boolean {
  if (!cluster.active) return false;
  if (cluster.version === VERSION_ETH) {
    if (cluster.effectiveBalance === 0n) return false;
    return cluster.balance < liquidationThreshold(cluster, state);
  } else {
    if (cluster.validatorCount === 0n) return false;
    return cluster.ssvBalance < liquidationThreshold(cluster, state);
  }
}

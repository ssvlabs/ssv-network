import {
  VERSION_ETH,
  ETH_DEDUCTED_DIGITS,
  PRECISION,
} from './constants.ts';

export const DEFAULT_EB = 32n;

export interface OperatorRecord {
  id:             bigint;
  owner:          string;
  feeWei:         bigint;          // ETH fee per block per DEFAULT_EB of effective balance (unpacked wei)
  block:          bigint;          // ETH snapshot block
  balance:        bigint;          // accumulated ETH earnings in wei
  effectiveBalance: bigint;        // total ETH across all ETH cluster validators (whole ETH, always multiple of 32)
  ssvFeeWei:      bigint;          // SSV fee per block per validator (unpacked SSV wei)
  ssvBlock:       bigint;          // SSV snapshot block
  ssvBalance:     bigint;          // accumulated SSV earnings in SSV wei
  ssvValidatorCount: bigint;       // validators in SSV clusters using this operator
  pendingFeeWei:              bigint;  // declared but not yet executed (0n if none)
  pendingFeeBlock:            bigint;  // block of declaration (0n if none)
  pendingFeeApprovalBeginTime: bigint; // Unix timestamp when execute window opens (0n if none)
  pendingFeeApprovalEndTime:   bigint; // Unix timestamp when execute window closes (0n if none)
  useDefaultEthFee: boolean;       // true until operator executes a custom fee (tracks DEFAULT_OPERATOR_ETH_FEE dependency)
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
  block:          bigint;          // ETH snapshot block
  balance:        bigint;          // ETH balance in wei at snapshot
  burnRate:       bigint;          // ETH fee rate per block per DEFAULT_EB = sum(opFeeWei) + networkFeeWei
  effectiveBalance: bigint;        // total ETH across all validators (whole ETH, always multiple of 32)
  ssvBlock:       bigint;          // SSV snapshot block
  ssvBalance:     bigint;          // SSV balance in SSV wei at snapshot
  ssvBurnRate:    bigint;          // SSV wei per block per validator = sum(opSSVFeeWei) + networkFeeSSV
  createdBlock:   bigint;          // block when this cluster was first created (or migrated to ETH)
  validatorCount: bigint;          // number of validators (used for SSV math and metadata)
  active:         boolean;
  canRegister:    boolean;         // false once a removed operator is in this cluster (registerValidator reverts)
  lastOracleEB:   bigint;
  validators:     Set<string>;
  lastStruct:     ClusterStruct;   // parsed from latest TX event — used for view calls in checkState
}

export interface NetworkRecord {
  block:                  bigint;
  ethNetworkEarnings:     bigint;    // accumulated ETH network fees in wei
  accEthPerShare:         bigint;    // staking accumulator — updated ONLY on onSyncFees (mirrors _syncFees)
  lastSyncedPackedEarnings: bigint;  // packed earnings at last onSyncFees call (mirrors stakingEthPoolBalance)
  feeWei:                 bigint;    // ETH fee per block per DEFAULT_EB of effective balance
  totalEffectiveBalance:  bigint;    // total ETH EB across all active ETH clusters (whole ETH, always multiple of 32)
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

export interface SimState {
  operators:  Map<bigint, OperatorRecord>;
  clusters:   Map<string, ClusterRecord>;
  stakers:    Map<string, StakerRecord>;  // keyed by lowercase address
  network:    NetworkRecord;
  minimumBlocksBeforeLiquidation: bigint;
  minimumLiquidationCollateral:    bigint;  // ETH wei — used for ETH clusters
  minimumLiquidationCollateralSSV: bigint;  // SSV wei — used for SSV clusters
  nextValidatorSeed: number;
  nextFreshWalletIndex: number;
  totalClampingExcess: bigint;
  totalStakingDust: bigint;
  defaultOperatorEthFee: bigint;   // current DEFAULT_OPERATOR_ETH_FEE (can change mid-run via module upgrade)
}

function advanceOperator(op: OperatorRecord, block: bigint): void {
  if (op.isRemoved) return;
  if (op.block < block && op.effectiveBalance > 0n) {
    const packedFee = op.feeWei / ETH_DEDUCTED_DIGITS;
    const packedDelta = (block - op.block) * packedFee * op.effectiveBalance / DEFAULT_EB;
    op.balance += packedDelta * ETH_DEDUCTED_DIGITS;
    op.block = block;
  } else if (op.block < block) {
    op.block = block;
  }
  if (op.ssvFeeWei > 0n && op.ssvBlock < block) {
    op.ssvBalance += (block - op.ssvBlock) * op.ssvFeeWei * op.ssvValidatorCount;
    op.ssvBlock = block;
  }
}

function advanceCluster(cluster: ClusterRecord, block: bigint): bigint {
  if (!cluster.active) return 0n;
  if (cluster.version === VERSION_ETH) {
    if (cluster.block >= block) return 0n;
    const cost = (block - cluster.block) * cluster.burnRate * cluster.effectiveBalance / DEFAULT_EB;
    const excess = cost > cluster.balance ? cost - cluster.balance : 0n;
    cluster.balance = cluster.balance > cost ? cluster.balance - cost : 0n;
    cluster.block = block;
    return excess;
  } else {
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
  net.ethNetworkEarnings += blockDiff * net.feeWei * net.totalEffectiveBalance / DEFAULT_EB;
  net.ssvNetworkEarnings += blockDiff * net.feeSSVWei * net.totalSSVValidators;
  net.block = block;
}

export function advanceAll(state: SimState, block: bigint): void {
  for (const op of state.operators.values()) advanceOperator(op, block);
  for (const cluster of state.clusters.values()) {
    state.totalClampingExcess += advanceCluster(cluster, block);
  }

  advanceNetwork(state.network, block);
}

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
      state.totalStakingDust += diff - (accDelta * totalCSSV / PRECISION);
    } else {
      state.totalStakingDust += diff;
    }
  }
  state.network.lastSyncedPackedEarnings = currentPacked;
}

export function onSettleUser(staker: StakerRecord, state: SimState): void {
  if (staker.cssvBalance > 0n) {
    const pending = staker.cssvBalance * (state.network.accEthPerShare - staker.userIndex) / PRECISION;
    staker.totalEthAmount += pending;
  }
  staker.userIndex = state.network.accEthPerShare;
}

export function burnPerBlock(cluster: ClusterRecord): bigint {
  if (cluster.version === VERSION_ETH) {
    return cluster.burnRate * cluster.effectiveBalance / DEFAULT_EB;
  }
  return cluster.ssvBurnRate * cluster.validatorCount;
}

export function liquidationThreshold(cluster: ClusterRecord, state: SimState): bigint {
  const bpb = burnPerBlock(cluster);
  const blockThreshold = state.minimumBlocksBeforeLiquidation * bpb;
  const minCollateral = cluster.version === VERSION_ETH
    ? state.minimumLiquidationCollateral
    : state.minimumLiquidationCollateralSSV;
  return blockThreshold > minCollateral ? blockThreshold : minCollateral;
}

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

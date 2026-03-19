import { BPS_DENOMINATOR, ETH_DEDUCTED_DIGITS, DEDUCTED_DIGITS, } from "../common/constants.ts";

const DEFAULT_EB_PER_VALIDATOR = 32n;
const VUNITS_PRECISION = BPS_DENOMINATOR;

export function calcOperatorFeeAccrual(blockDiff: bigint, ethFee: bigint, effectiveVUnits: bigint): bigint {
  return (blockDiff * ethFee * effectiveVUnits) / BPS_DENOMINATOR;
}

export function calcNetworkFeeAccrual(networkFeeIndexDelta: bigint, effectiveVUnits: bigint): bigint {
  return ((networkFeeIndexDelta * effectiveVUnits) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
}

export function calcClusterBurn(params: {
  blockDiff: bigint;
  numOperators: bigint;
  ethFee: bigint;
  networkFee: bigint;
  effectiveVUnits: bigint;
}): bigint {
  const { blockDiff, numOperators, ethFee, networkFee, effectiveVUnits } = params;
  const operatorIndexDelta = numOperators * blockDiff * ethFee;
  const networkFeeIndexDelta = blockDiff * networkFee;
  const operatorFeeUnits = (operatorIndexDelta * effectiveVUnits) / VUNITS_PRECISION;
  const networkFeeUnits = (networkFeeIndexDelta * effectiveVUnits) / VUNITS_PRECISION;
  return (operatorFeeUnits + networkFeeUnits) * ETH_DEDUCTED_DIGITS;
}

export function calcVUnits(effectiveBalanceETH: bigint): bigint {
  return (effectiveBalanceETH * BPS_DENOMINATOR + DEFAULT_EB_PER_VALIDATOR - 1n) / DEFAULT_EB_PER_VALIDATOR;
}

export function defaultVUnits(validatorCount: bigint): bigint {
  return validatorCount * BPS_DENOMINATOR;
}

export function calcLiquidationThreshold(params: {
  minimumBlocksBeforeLiquidation: bigint;
  numOperators: bigint;
  ethFee: bigint;
  networkFee: bigint;
  effectiveVUnits: bigint;
}): bigint {
  const { minimumBlocksBeforeLiquidation, numOperators, ethFee, networkFee, effectiveVUnits } = params;
  const burnRate = numOperators * ethFee;
  const thresholdUnits = (minimumBlocksBeforeLiquidation * (burnRate + networkFee) * effectiveVUnits) / BPS_DENOMINATOR;
  return thresholdUnits * ETH_DEDUCTED_DIGITS;
}

export function calcAccEthPerShareDelta(newFeesWei: bigint, totalCSSVSupply: bigint): bigint {
  return (newFeesWei * 10n ** 18n) / totalCSSVSupply;
}

export function calcStakingReward(cSSVBalance: bigint, accEthPerShare: bigint, userIndex: bigint): bigint {
  return (cSSVBalance * (accEthPerShare - userIndex)) / 10n ** 18n;
}

export function calcSSVClusterFees(params: {
  currentBlock: bigint;
  opSnapshots: {
    block: bigint;
    index: bigint;
  }[];
  opFeeRaw: bigint;
  netFeeBlock: bigint;
  netFeeRaw: bigint;
  storedNetFeeIndex: bigint;
  validatorCount: bigint;
  clusterIndex: bigint;
  clusterNetworkFeeIndex: bigint;
}): bigint {
  const { currentBlock, opSnapshots, opFeeRaw, netFeeBlock, netFeeRaw, storedNetFeeIndex, validatorCount, clusterIndex, clusterNetworkFeeIndex, } = params;
  let cumulativeOpIndex = 0n;
  for (const snap of opSnapshots) {
    const blockDiff = currentBlock - snap.block;
    const currentIndex = snap.index + blockDiff * opFeeRaw;
    cumulativeOpIndex += currentIndex;
  }
  const opFeePacked = (cumulativeOpIndex - clusterIndex) * validatorCount;
  const currentNetFeeIndex = storedNetFeeIndex + (currentBlock - netFeeBlock) * netFeeRaw;
  const netFeePacked = (currentNetFeeIndex - clusterNetworkFeeIndex) * validatorCount;
  return (opFeePacked + netFeePacked) * DEDUCTED_DIGITS;
}

export async function setupMockProtocol(contract: any, opts: {
  ethNetworkFee?: bigint;
  networkFeeIndex?: bigint;
  minBlocks?: bigint;
  minCollateral?: bigint;
} = {}): Promise<void> {
  const { ethNetworkFee, networkFeeIndex, minBlocks, minCollateral } = opts;
  if (ethNetworkFee !== undefined)
    await contract.mockEthNetworkFee(ethNetworkFee);
  if (networkFeeIndex !== undefined)
    await contract.mockCurrentNetworkFeeIndex(networkFeeIndex);
  if (minBlocks !== undefined)
    await contract.mockMinimumBlocksBeforeLiquidation(minBlocks);
  if (minCollateral !== undefined)
    await contract.mockMinimumLiquidationCollateral(minCollateral);
}

/**
 * Pure BigInt math matching SPEC.md formulas for fee settlement.
 * All functions take and return bigint. No approximations.
 *
 * Constants imported from test/common/constants.ts where available,
 * with local fallbacks referencing CLAUDE.md values.
 */

import {
  VUNITS_PRECISION,
  ETH_DEDUCTED_DIGITS,
} from "../../common/constants.ts";

// DEFAULT_EB_PER_VALIDATOR is not exported from constants as a bigint in ETH.
// CLAUDE.md: DEFAULT_EB_PER_VALIDATOR = 32 ETH
const DEFAULT_EB_PER_VALIDATOR = 32n;

/**
 * SPEC.md Section 8: ETH operator fee accrual per operator.
 * operator.ethSnapshot.balance += (blockDiff * ethFee * effectiveVUnits) / VUNITS_PRECISION
 *
 * @param blockDiff - number of blocks elapsed
 * @param ethFee - packed ETH fee (raw value, without ETH_DEDUCTED_DIGITS multiplier)
 * @param effectiveVUnits - effective vUnits for the operator
 * @returns accrual in packed ETH units (multiply by ETH_DEDUCTED_DIGITS for wei)
 */
export function calcOperatorFeeAccrual(
  blockDiff: bigint,
  ethFee: bigint,
  effectiveVUnits: bigint,
): bigint {
  return (blockDiff * ethFee * effectiveVUnits) / VUNITS_PRECISION;
}

/**
 * SPEC.md Section 8: Network fee accrual per cluster.
 * networkFeeUnits = (networkFeeIndexDelta * clusterVUnits) / VUNITS_PRECISION
 * totalNetworkFee = networkFeeUnits * ETH_DEDUCTED_DIGITS
 *
 * @param networkFeeIndexDelta - delta in network fee index
 * @param effectiveVUnits - cluster's effective vUnits
 * @returns network fee in wei
 */
export function calcNetworkFeeAccrual(
  networkFeeIndexDelta: bigint,
  effectiveVUnits: bigint,
): bigint {
  return ((networkFeeIndexDelta * effectiveVUnits) / VUNITS_PRECISION) * ETH_DEDUCTED_DIGITS;
}

/**
 * Total cluster burn over blockDiff.
 *
 * SPEC.md Section 10:
 *   operatorIndex += blockDiff * ethFee (per operator, then summed for N ops)
 *   clusterIndex = N * operatorIndex (when all ops have same fee)
 *   operatorFeeUnits = (indexDelta * vUnits) / VUNITS_PRECISION
 *   networkFeeUnits = (networkFeeIndexDelta * vUnits) / VUNITS_PRECISION
 *   totalFees = (operatorFeeUnits + networkFeeUnits) * ETH_DEDUCTED_DIGITS
 *
 * This function computes the combined burn for a cluster with N operators
 * all charging the same ethFee.
 */
export function calcClusterBurn(params: {
  blockDiff: bigint;
  numOperators: bigint;
  ethFee: bigint; // per operator (packed ETH, raw value without ETH_DEDUCTED_DIGITS)
  networkFee: bigint; // packed ETH raw value
  effectiveVUnits: bigint;
}): bigint {
  const { blockDiff, numOperators, ethFee, networkFee, effectiveVUnits } = params;

  // Cluster operator index delta = sum of all operator index deltas = numOperators * blockDiff * ethFee
  const operatorIndexDelta = numOperators * blockDiff * ethFee;

  // Network fee index delta = blockDiff * networkFee
  const networkFeeIndexDelta = blockDiff * networkFee;

  // Fee units scaled by vUnits
  const operatorFeeUnits = (operatorIndexDelta * effectiveVUnits) / VUNITS_PRECISION;
  const networkFeeUnits = (networkFeeIndexDelta * effectiveVUnits) / VUNITS_PRECISION;

  // Convert from packed to wei
  return (operatorFeeUnits + networkFeeUnits) * ETH_DEDUCTED_DIGITS;
}

/**
 * vUnits from effectiveBalance: ceil(effectiveBalanceETH * VUNITS_PRECISION / DEFAULT_EB_PER_VALIDATOR)
 *
 * SPEC.md Section 2.
 */
export function calcVUnits(effectiveBalanceETH: bigint): bigint {
  return (effectiveBalanceETH * VUNITS_PRECISION + DEFAULT_EB_PER_VALIDATOR - 1n) / DEFAULT_EB_PER_VALIDATOR;
}

/**
 * Default vUnits for N validators (implicit EB): N * VUNITS_PRECISION
 * When no explicit EB has been set, each validator is assumed to be 32 ETH.
 */
export function defaultVUnits(validatorCount: bigint): bigint {
  return validatorCount * VUNITS_PRECISION;
}

/**
 * Liquidation threshold in wei.
 *
 * SPEC.md Section 10:
 *   burnRate = sum of operator ethFees = numOperators * ethFee (when uniform)
 *   thresholdUnits = (minimumBlocksBeforeLiquidation * (burnRate + networkFee) * vUnits) / VUNITS_PRECISION
 *   threshold = thresholdUnits * ETH_DEDUCTED_DIGITS
 */
export function calcLiquidationThreshold(params: {
  minimumBlocksBeforeLiquidation: bigint;
  numOperators: bigint;
  ethFee: bigint;
  networkFee: bigint;
  effectiveVUnits: bigint;
}): bigint {
  const { minimumBlocksBeforeLiquidation, numOperators, ethFee, networkFee, effectiveVUnits } = params;

  const burnRate = numOperators * ethFee;
  const thresholdUnits =
    (minimumBlocksBeforeLiquidation * (burnRate + networkFee) * effectiveVUnits) / VUNITS_PRECISION;

  return thresholdUnits * ETH_DEDUCTED_DIGITS;
}

/**
 * Staking accumulator delta: accEthPerShare += (newFeesWei * 1e18) / totalCSSVSupply
 *
 * SPEC.md Section 10.
 */
export function calcAccEthPerShareDelta(
  newFeesWei: bigint,
  totalCSSVSupply: bigint,
): bigint {
  return (newFeesWei * 10n ** 18n) / totalCSSVSupply;
}

/**
 * Staking reward: cSSVBalance * (accEthPerShare - userIndex) / 1e18
 *
 * SPEC.md Section 10.
 */
export function calcStakingReward(
  cSSVBalance: bigint,
  accEthPerShare: bigint,
  userIndex: bigint,
): bigint {
  return (cSSVBalance * (accEthPerShare - userIndex)) / 10n ** 18n;
}

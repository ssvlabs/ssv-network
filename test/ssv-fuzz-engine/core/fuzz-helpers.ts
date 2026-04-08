import { ETH_DEDUCTED_DIGITS, BPS_DENOMINATOR } from "../../common/constants.ts";

export function validatorCountToVUnits(validatorCount: bigint): bigint {
  return validatorCount * BPS_DENOMINATOR;
}

export function ebToVUnits(effectiveBalance: bigint): bigint {
  const vUnits = effectiveBalance * BPS_DENOMINATOR;
  if (vUnits === 0n) return 0n;
  return (vUnits - 1n) / 32n + 1n;
}

export function sumPackedFees(unpackedFees: bigint[]): bigint {
  let packed = 0n;
  for (const fee of unpackedFees) {
    packed += fee / ETH_DEDUCTED_DIGITS;
  }
  return packed;
}

export function computeMinViableBalanceCore(
  minBlocksBeforeLiquidation: bigint,
  packedRate: bigint,
  vUnits: bigint,
  minimumLiquidationCollateral: bigint,
): bigint {
  // Keep this pure: callers own RNG sampling to preserve seed trajectories.
  const thresholdUnits = (minBlocksBeforeLiquidation * packedRate * vUnits) / BPS_DENOMINATOR;
  const liquidationThreshold = thresholdUnits * ETH_DEDUCTED_DIGITS;
  return liquidationThreshold > minimumLiquidationCollateral
    ? liquidationThreshold
    : minimumLiquidationCollateral;
}

export function computeMinViableBalanceFromFees(
  operatorFees: bigint[],
  networkFee: bigint,
  vUnits: bigint,
  minBlocksBeforeLiquidation: bigint,
  minimumLiquidationCollateral: bigint,
): bigint {
  const packedRate = sumPackedFees(operatorFees) + networkFee / ETH_DEDUCTED_DIGITS;
  return computeMinViableBalanceCore(
    minBlocksBeforeLiquidation,
    packedRate,
    vUnits,
    minimumLiquidationCollateral,
  );
}

export function computeMinViableBalanceForValidatorCount(
  operatorFees: bigint[],
  networkFee: bigint,
  validatorCount: bigint,
  minBlocksBeforeLiquidation: bigint,
  minimumLiquidationCollateral: bigint,
): bigint {
  return computeMinViableBalanceFromFees(
    operatorFees,
    networkFee,
    validatorCountToVUnits(validatorCount),
    minBlocksBeforeLiquidation,
    minimumLiquidationCollateral,
  );
}

export function computeMinViableBalanceForEffectiveBalance(
  operatorFees: bigint[],
  networkFee: bigint,
  effectiveBalance: bigint,
  minBlocksBeforeLiquidation: bigint,
  minimumLiquidationCollateral: bigint,
): bigint {
  return computeMinViableBalanceFromFees(
    operatorFees,
    networkFee,
    ebToVUnits(effectiveBalance),
    minBlocksBeforeLiquidation,
    minimumLiquidationCollateral,
  );
}

export function computeBurnRate(operatorFees: bigint[], networkFee: bigint, validatorCount: bigint): bigint {
  if (validatorCount === 0n) return 0n;
  const vUnits = validatorCountToVUnits(validatorCount);

  const packedTotal = sumPackedFees(operatorFees) + networkFee / ETH_DEDUCTED_DIGITS;

  return (packedTotal * ETH_DEDUCTED_DIGITS * vUnits) / BPS_DENOMINATOR;
}

export function computeClusterBalance(
  prevBalance: bigint,
  operatorFees: bigint[],
  networkFee: bigint,
  validatorCount: bigint,
  blocks: bigint,
): bigint {
  if (validatorCount === 0n || blocks === 0n) return prevBalance;
  const vUnits = validatorCountToVUnits(validatorCount);

  const packedOpTotal = sumPackedFees(operatorFees);
  const packedNetFee = networkFee / ETH_DEDUCTED_DIGITS;

  const opIndexDelta = packedOpTotal * blocks;
  const netIndexDelta = packedNetFee * blocks;

  const networkFeeUnits = (netIndexDelta * vUnits) / BPS_DENOMINATOR;
  const usageUnits = (opIndexDelta * vUnits) / BPS_DENOMINATOR + networkFeeUnits;
  const usage = usageUnits * ETH_DEDUCTED_DIGITS;

  return usage > prevBalance ? 0n : prevBalance - usage;
}

export function computeClusterBalanceWithVUnits(
  prevBalance: bigint,
  operatorFees: bigint[],
  networkFee: bigint,
  vUnits: bigint,
  blocks: bigint,
): bigint {
  if (vUnits === 0n || blocks === 0n) return prevBalance;

  const packedOpTotal = sumPackedFees(operatorFees);
  const packedNetFee = networkFee / ETH_DEDUCTED_DIGITS;

  const opIndexDelta = packedOpTotal * blocks;
  const netIndexDelta = packedNetFee * blocks;

  const networkFeeUnits = (netIndexDelta * vUnits) / BPS_DENOMINATOR;
  const usageUnits = (opIndexDelta * vUnits) / BPS_DENOMINATOR + networkFeeUnits;
  const usage = usageUnits * ETH_DEDUCTED_DIGITS;

  return usage > prevBalance ? 0n : prevBalance - usage;
}

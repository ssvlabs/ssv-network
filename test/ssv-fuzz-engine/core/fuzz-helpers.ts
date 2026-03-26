import { ETH_DEDUCTED_DIGITS, BPS_DENOMINATOR } from "../../common/constants.ts";

export function computeBurnRate(operatorFees: bigint[], networkFee: bigint, validatorCount: bigint): bigint {
  if (validatorCount === 0n) return 0n;
  const vUnits = validatorCount * BPS_DENOMINATOR;

  let packedTotal = networkFee / ETH_DEDUCTED_DIGITS;
  for (const fee of operatorFees) {
    packedTotal += fee / ETH_DEDUCTED_DIGITS;
  }

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
  const vUnits = validatorCount * BPS_DENOMINATOR;

  let packedOpTotal = 0n;
  for (const fee of operatorFees) {
    packedOpTotal += fee / ETH_DEDUCTED_DIGITS;
  }
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

  let packedOpTotal = 0n;
  for (const fee of operatorFees) {
    packedOpTotal += fee / ETH_DEDUCTED_DIGITS;
  }
  const packedNetFee = networkFee / ETH_DEDUCTED_DIGITS;

  const opIndexDelta = packedOpTotal * blocks;
  const netIndexDelta = packedNetFee * blocks;

  const networkFeeUnits = (netIndexDelta * vUnits) / BPS_DENOMINATOR;
  const usageUnits = (opIndexDelta * vUnits) / BPS_DENOMINATOR + networkFeeUnits;
  const usage = usageUnits * ETH_DEDUCTED_DIGITS;

  return usage > prevBalance ? 0n : prevBalance - usage;
}

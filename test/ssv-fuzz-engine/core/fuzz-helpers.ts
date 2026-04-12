import { ETH_DEDUCTED_DIGITS, BPS_DENOMINATOR, MINIMAL_OPERATOR_ETH_FEE, OPERATOR_MAX_FEE_INCREASE, DEDUCTED_DIGITS } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { setupOracles } from "../../helpers/oracle.ts";
import { alignFee } from "./setup.ts";
import type { FuzzContext } from "./types.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";

export function parseFeeExecutedEvents(network: any, receipt: any): { operatorId: bigint; fee: bigint }[] {
  const events: { operatorId: bigint; fee: bigint }[] = [];
  for (const log of receipt?.logs ?? []) {
    try {
      const parsed = network.interface.parseLog(log);
      if (parsed?.name === Events.OPERATOR_FEE_EXECUTED) {
        events.push({ operatorId: BigInt(parsed.args.operatorId), fee: BigInt(parsed.args.fee) });
      }
    } catch {}
  }
  return events;
}

export function computeMaxAllowedFee(currentFee: bigint): bigint {
  const packedCurrent = currentFee / ETH_DEDUCTED_DIGITS;
  const maxAllowedPacked = (packedCurrent * (BPS_DENOMINATOR + OPERATOR_MAX_FEE_INCREASE) + BPS_DENOMINATOR - 1n) / BPS_DENOMINATOR;
  return maxAllowedPacked * ETH_DEDUCTED_DIGITS;
}

export const DEFAULT_FUZZ_SEED_COUNT = 15;

export const ORACLE_SIGNER_INDICES = [10, 11, 12, 13] as const;

export function validatorCountToVUnits(validatorCount: bigint): bigint {
  return validatorCount * BPS_DENOMINATOR;
}

export function ebToVUnits(eb: bigint | number): bigint {
  const v = BigInt(eb) * BPS_DENOMINATOR;
  return v === 0n ? 0n : (v - 1n) / 32n + 1n;
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

export async function setupFuzzOracles(ctx: FuzzContext<any>, staker: HardhatEthersSigner): Promise<HardhatEthersSigner[]> {
  const oracles = ORACLE_SIGNER_INDICES.map(i => ctx.signers[i]);
  await setupOracles(ctx.network, ctx.ssvToken, staker, oracles);
  return oracles;
}

export function generateRandomFees(ctx: FuzzContext<any>, count: number, min: bigint = MINIMAL_OPERATOR_ETH_FEE, max: bigint = MINIMAL_OPERATOR_ETH_FEE * 5n): bigint[] {
  const fees: bigint[] = [];
  for (let i = 0; i < count; i++) {
    fees.push(alignFee(ctx.rng.nextInRange(min, max)));
  }
  return fees;
}

export function computeLiquidationMetrics(
  operatorFees: bigint[],
  networkFee: bigint,
  vUnits: bigint,
  minBlocks: bigint,
): { threshold: bigint; burnPerBlock: bigint } {
  let packedTotal = networkFee / ETH_DEDUCTED_DIGITS;
  for (const fee of operatorFees) packedTotal += fee / ETH_DEDUCTED_DIGITS;
  const threshold = (minBlocks * packedTotal * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
  const burnPerBlock = (packedTotal * vUnits / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
  return { threshold, burnPerBlock };
}

export function computeOperatorEarningsDelta(
  packedFee: bigint,
  blocks: bigint,
  effectiveVUnits: bigint,
): bigint {
  const deltaPacked = (blocks * packedFee * effectiveVUnits) / BPS_DENOMINATOR;
  return deltaPacked * ETH_DEDUCTED_DIGITS;
}

export function computeDAOEarningsDelta(
  blocks: bigint,
  packedNetworkFee: bigint,
  daoTotalEthVUnits: bigint,
): bigint {
  const deltaPacked = (blocks * packedNetworkFee * daoTotalEthVUnits) / BPS_DENOMINATOR;
  return deltaPacked * ETH_DEDUCTED_DIGITS;
}

export function computeBurnRate(operatorFees: bigint[], networkFee: bigint, vUnits: bigint): bigint {
  if (vUnits === 0n) return 0n;

  const packedTotal = sumPackedFees(operatorFees) + networkFee / ETH_DEDUCTED_DIGITS;

  return (packedTotal * ETH_DEDUCTED_DIGITS * vUnits) / BPS_DENOMINATOR;
}

export function computeClusterBalance(
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

export function computeSSVClusterBalance(
  prevBalance: bigint,
  operatorFees: bigint[],
  networkFee: bigint,
  validatorCount: bigint,
  blocks: bigint,
): bigint {
  if (validatorCount === 0n || blocks === 0n) return prevBalance;
  let packedOpTotal = 0n;
  for (const fee of operatorFees) packedOpTotal += fee / DEDUCTED_DIGITS;
  const usage = ((packedOpTotal + networkFee / DEDUCTED_DIGITS) * blocks * validatorCount) * DEDUCTED_DIGITS;
  return usage > prevBalance ? 0n : prevBalance - usage;
}

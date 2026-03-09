/**
 * Operator actions for Monte Carlo simulation.
 *
 * - actionRegisterOperator
 * - actionRemoveOperator
 * - actionDeclareOperatorFee
 * - actionExecuteOperatorFee
 * - actionWithdrawOperatorEarnings
 */

import {
  MINIMAL_OPERATOR_ETH_FEE,
  MAXIMUM_OPERATORS_FEE,
  ETH_DEDUCTED_DIGITS,
} from "../../common/constants.ts";
import type { SimulationState, ActionResult } from "../types.ts";


function makeOperatorKey(seed: bigint): string {
  return `0x${(Number(seed & 0xFFFFFFFFn) + 1000).toString(16).padStart(96, "0")}`;
}

/**
 * Register a new operator with a random ETH fee within bounds.
 */
export async function actionRegisterOperator(state: SimulationState): Promise<ActionResult> {
  const NAME = "registerOperator";
  const signerCandidates = [
    ...state.stakerPool.map((s) => s.signer),
    ...[...state.operatorPool.values()].map((op) => op.ownerSigner),
  ];
  if (signerCandidates.length === 0) {
    return { name: NAME, success: false, revertReason: "SKIP: no signers available" };
  }

  const signer = state.rng.pick(signerCandidates);
  const seed = state.rng.next();
  const minFeeRaw = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
  const maxFeeRaw = (MAXIMUM_OPERATORS_FEE / ETH_DEDUCTED_DIGITS) < minFeeRaw * 10n
    ? MAXIMUM_OPERATORS_FEE / ETH_DEDUCTED_DIGITS
    : minFeeRaw * 10n;
  const feeRaw = state.rng.nextInRange(minFeeRaw, maxFeeRaw);
  const fee = feeRaw * ETH_DEDUCTED_DIGITS;

  try {
    const addr = await signer.getAddress();
    await state.provider.send("hardhat_setBalance", [
      addr,
      "0x" + (10n ** 18n).toString(16),
    ]);

    const operatorId = await state.network
      .connect(signer)
      .registerOperator.staticCall(makeOperatorKey(seed), fee, false);

    const tx = await state.network
      .connect(signer)
      .registerOperator(makeOperatorKey(seed), fee, false);
    const receipt = await tx.wait();

    state.operatorPool.set(BigInt(operatorId), {
      id: BigInt(operatorId),
      owner: addr,
      ownerSigner: signer,
      fee: feeRaw,
      isActive: true,
    });

    if (receipt) state.currentBlock = receipt.blockNumber;

    return { name: NAME, success: true };
  } catch (err) {
    return { name: NAME, success: false, revertReason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Remove an operator that has no validators across any tracked cluster.
 * Per DISC-OV-3: skip operators with active validators.
 */
export async function actionRemoveOperator(state: SimulationState): Promise<ActionResult> {
  const NAME = "removeOperator";
  const opsWithValidators = new Set<bigint>();
  for (const cr of state.clusterBook.values()) {
    if (cr.cluster.validatorCount > 0n) {
      for (const opId of cr.operatorIds) {
        opsWithValidators.add(opId);
      }
    }
  }

  const removable = [...state.operatorPool.values()].filter(
    (op) => op.isActive && !opsWithValidators.has(op.id),
  );
  if (removable.length === 0) {
    return { name: NAME, success: false, revertReason: "SKIP: no operators with 0 validators" };
  }

  const op = state.rng.pick(removable);

  try {
    const tx = await state.network.connect(op.ownerSigner).removeOperator(op.id);
    const receipt = await tx.wait();

    op.isActive = false;
    if (receipt) state.currentBlock = receipt.blockNumber;

    return { name: NAME, success: true };
  } catch (err) {
    return { name: NAME, success: false, revertReason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Declare a fee change for a random active operator (1-50% increase).
 */
export async function actionDeclareOperatorFee(state: SimulationState): Promise<ActionResult> {
  const NAME = "declareOperatorFee";

  const ops = [...state.operatorPool.values()].filter((op) => op.isActive);
  if (ops.length === 0) {
    return { name: NAME, success: false, revertReason: "SKIP: no active operators" };
  }

  const op = state.rng.pick(ops);
  const increasePct = state.rng.nextInRange(1n, 50n);
  const newFeeRaw = op.fee + (op.fee * increasePct) / 100n;
  const newFee = newFeeRaw * ETH_DEDUCTED_DIGITS;

  try {
    const tx = await state.network
      .connect(op.ownerSigner)
      .declareOperatorFee(op.id, newFee);
    const receipt = await tx.wait();

    if (receipt) state.currentBlock = receipt.blockNumber;

    return { name: NAME, success: true };
  } catch (err) {
    return { name: NAME, success: false, revertReason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Execute a pending fee declaration for a random active operator.
 * May revert if timing window isn't open — that's expected.
 */
export async function actionExecuteOperatorFee(state: SimulationState): Promise<ActionResult> {
  const NAME = "executeOperatorFee";

  const ops = [...state.operatorPool.values()].filter((op) => op.isActive);
  if (ops.length === 0) {
    return { name: NAME, success: false, revertReason: "SKIP: no active operators" };
  }

  const op = state.rng.pick(ops);

  try {
    const tx = await state.network.connect(op.ownerSigner).executeOperatorFee(op.id);
    const receipt = await tx.wait();
    const newFee = await state.views.getOperatorFee(op.id);
    op.fee = BigInt(newFee) / ETH_DEDUCTED_DIGITS;

    if (receipt) state.currentBlock = receipt.blockNumber;

    return { name: NAME, success: true };
  } catch (err) {
    return { name: NAME, success: false, revertReason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Withdraw all ETH earnings for a random active operator.
 */
export async function actionWithdrawOperatorEarnings(state: SimulationState): Promise<ActionResult> {
  const NAME = "withdrawOperatorEarnings";

  const ops = [...state.operatorPool.values()].filter((op) => op.isActive);
  if (ops.length === 0) {
    return { name: NAME, success: false, revertReason: "SKIP: no active operators" };
  }

  const op = state.rng.pick(ops);

  try {
    const tx = await state.network
      .connect(op.ownerSigner)
      .withdrawAllOperatorEarnings(op.id);
    const receipt = await tx.wait();

    if (receipt) state.currentBlock = receipt.blockNumber;

    return { name: NAME, success: true };
  } catch (err) {
    return { name: NAME, success: false, revertReason: err instanceof Error ? err.message : String(err) };
  }
}

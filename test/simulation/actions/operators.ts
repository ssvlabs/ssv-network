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
 * Remove a random active operator — preferring those with active validators
 * to exercise the BUG-21 class (removing operators while clusters still reference them).
 *
 * On-chain, removeOperator resets all state (fee=0, snapshots=0, vUnits=0)
 * regardless of validator count, so this is always valid for the owner to call.
 *
 * After removal we verify on-chain state: isActive==false, fee==0.
 */
export async function actionRemoveOperator(state: SimulationState): Promise<ActionResult> {
  const NAME = "removeOperator";

  // Identify operators that have validators in active clusters (the interesting case)
  const opsWithValidators = new Set<bigint>();
  for (const cr of state.clusterBook.values()) {
    if (cr.cluster.validatorCount > 0n && cr.cluster.active) {
      for (const opId of cr.operatorIds) {
        opsWithValidators.add(opId);
      }
    }
  }

  const activeOps = [...state.operatorPool.values()].filter((op) => op.isActive);
  if (activeOps.length === 0) {
    return { name: NAME, success: false, revertReason: "SKIP: no active operators" };
  }

  // 80% chance to pick an operator WITH validators (BUG-21 surface), 20% without
  const withValidators = activeOps.filter((op) => opsWithValidators.has(op.id));
  const withoutValidators = activeOps.filter((op) => !opsWithValidators.has(op.id));

  let op;
  if (withValidators.length > 0 && (withoutValidators.length === 0 || state.rng.nextFloat() < 0.8)) {
    op = state.rng.pick(withValidators);
  } else if (withoutValidators.length > 0) {
    op = state.rng.pick(withoutValidators);
  } else {
    return { name: NAME, success: false, revertReason: "SKIP: no removable operators" };
  }

  try {
    const tx = await state.network.connect(op.ownerSigner).removeOperator(op.id);
    const receipt = await tx.wait();

    // Post-removal on-chain verification
    const onChain = await state.views.getOperatorById(op.id);
    if (onChain.isActive) {
      return { name: NAME, success: false, revertReason: `ASSERT: operator ${op.id} still active after removal` };
    }
    if (onChain.fee !== 0n) {
      return { name: NAME, success: false, revertReason: `ASSERT: operator ${op.id} fee != 0 after removal` };
    }

    // Update sim state
    op.isActive = false;
    op.fee = 0n;

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

/**
 * Shared helpers for operator and whitelist scenarios.
 *
 * Provides reusable building blocks for operator registration, fee changes,
 * earnings withdrawal, whitelist management, and related assertions.
 */

import type { ScenarioContext } from "../simulation/scenario-context.ts";
import type { StateSnapshot } from "../simulation/state-snapshot.ts";
import type { OperatorRecord } from "../simulation/types.ts";
import { ScenarioSkipped } from "../simulation/scenario-types.ts";

// ---------------------------------------------------------------------------
// Entity selection helpers
// ---------------------------------------------------------------------------

/**
 * Pick an active operator from the global operator pool.
 * Throws ScenarioSkipped if none available.
 */
export function pickActiveOperator(ctx: ScenarioContext): OperatorRecord {
  const active = [...ctx.actors.operators.values()].filter(
    (op) => op.isActive,
  );
  if (active.length === 0) {
    throw new ScenarioSkipped("No active operators available");
  }
  return ctx.rng.pick(active);
}

/**
 * Pick a second active operator (different from excludeId).
 * Throws ScenarioSkipped if none available.
 */
export function pickSecondActiveOperator(
  ctx: ScenarioContext,
  excludeId: bigint,
): OperatorRecord {
  const active = [...ctx.actors.operators.values()].filter(
    (op) => op.isActive && op.id !== excludeId,
  );
  if (active.length === 0) {
    throw new ScenarioSkipped("No second active operator available");
  }
  return ctx.rng.pick(active);
}

// ---------------------------------------------------------------------------
// Action helpers
// ---------------------------------------------------------------------------

/**
 * Withdraw partial operator earnings.
 * Returns the amount withdrawn.
 */
export async function withdrawPartialEarnings(
  ctx: ScenarioContext,
  op: OperatorRecord,
  amount: bigint,
): Promise<void> {
  const tx = await ctx.contracts.network
    .connect(op.ownerSigner)
    .withdrawOperatorEarnings(op.id, amount);
  await tx.wait();
}

/**
 * Withdraw all operator earnings.
 */
export async function withdrawAllEarnings(
  ctx: ScenarioContext,
  op: OperatorRecord,
): Promise<void> {
  const tx = await ctx.contracts.network
    .connect(op.ownerSigner)
    .withdrawAllOperatorEarnings(op.id);
  await tx.wait();
}

/**
 * Withdraw all version (ETH + SSV) operator earnings.
 */
export async function withdrawAllVersionEarnings(
  ctx: ScenarioContext,
  op: OperatorRecord,
): Promise<void> {
  const tx = await ctx.contracts.network
    .connect(op.ownerSigner)
    .withdrawAllVersionOperatorEarnings(op.id);
  await tx.wait();
}

/**
 * Remove an operator and mark it inactive in the local state.
 */
export async function removeOperator(
  ctx: ScenarioContext,
  op: OperatorRecord,
): Promise<void> {
  const tx = await ctx.contracts.network
    .connect(op.ownerSigner)
    .removeOperator(op.id);
  await tx.wait();
  op.isActive = false;
}

/**
 * Reduce operator fee immediately.
 */
export async function reduceOperatorFee(
  ctx: ScenarioContext,
  op: OperatorRecord,
  newFee: bigint,
): Promise<void> {
  const tx = await ctx.contracts.network
    .connect(op.ownerSigner)
    .reduceOperatorFee(op.id, newFee);
  await tx.wait();
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/**
 * Assert an operator is active.
 */
export function assertOperatorActive(
  snap: StateSnapshot,
  opId: bigint,
  label: string,
): void {
  const opSnap = snap.operators.get(opId);
  if (!opSnap) throw new Error(`${label}: operator ${opId} not in snapshot`);
  if (!opSnap.isActive) {
    throw new Error(`${label}: operator ${opId} is not active`);
  }
}

/**
 * Assert an operator is inactive (removed).
 */
export function assertOperatorInactive(
  snap: StateSnapshot,
  opId: bigint,
  label: string,
): void {
  const opSnap = snap.operators.get(opId);
  if (!opSnap) throw new Error(`${label}: operator ${opId} not in snapshot`);
  if (opSnap.isActive) {
    throw new Error(`${label}: operator ${opId} is still active`);
  }
}

/**
 * Assert operator earnings increased between pre and post snapshots.
 */
export function assertEarningsIncreased(
  pre: StateSnapshot,
  post: StateSnapshot,
  opId: bigint,
  label: string,
): void {
  const preSn = pre.operators.get(opId);
  const postSn = post.operators.get(opId);
  if (!preSn || !postSn) {
    throw new Error(`${label}: operator ${opId} missing from snapshot`);
  }
  if (postSn.earnings <= preSn.earnings) {
    throw new Error(
      `${label}: operator ${opId} earnings did not increase (pre=${preSn.earnings}, post=${postSn.earnings})`,
    );
  }
}

/**
 * Assert operator earnings did not decrease between pre and post snapshots.
 */
export function assertEarningsNonDecreasing(
  pre: StateSnapshot,
  post: StateSnapshot,
  opId: bigint,
  label: string,
): void {
  const preSn = pre.operators.get(opId);
  const postSn = post.operators.get(opId);
  if (!preSn || !postSn) {
    throw new Error(`${label}: operator ${opId} missing from snapshot`);
  }
  if (postSn.earnings < preSn.earnings) {
    throw new Error(
      `${label}: operator ${opId} earnings decreased (pre=${preSn.earnings}, post=${postSn.earnings})`,
    );
  }
}

/**
 * Assert operator earnings decreased (after withdrawal).
 */
export function assertEarningsDecreased(
  pre: StateSnapshot,
  post: StateSnapshot,
  opId: bigint,
  label: string,
): void {
  const preSn = pre.operators.get(opId);
  const postSn = post.operators.get(opId);
  if (!preSn || !postSn) {
    throw new Error(`${label}: operator ${opId} missing from snapshot`);
  }
  if (postSn.earnings >= preSn.earnings) {
    throw new Error(
      `${label}: operator ${opId} earnings did not decrease (pre=${preSn.earnings}, post=${postSn.earnings})`,
    );
  }
}

/**
 * Assert operator earnings are zero.
 */
export function assertEarningsZero(
  snap: StateSnapshot,
  opId: bigint,
  label: string,
): void {
  const opSnap = snap.operators.get(opId);
  if (!opSnap) throw new Error(`${label}: operator ${opId} not in snapshot`);
  if (opSnap.earnings !== 0n) {
    throw new Error(
      `${label}: operator ${opId} earnings=${opSnap.earnings} (expected 0)`,
    );
  }
}

/**
 * Assert operator fee equals expected value.
 */
export function assertOperatorFee(
  snap: StateSnapshot,
  opId: bigint,
  expectedFee: bigint,
  label: string,
): void {
  const opSnap = snap.operators.get(opId);
  if (!opSnap) throw new Error(`${label}: operator ${opId} not in snapshot`);
  if (opSnap.fee !== expectedFee) {
    throw new Error(
      `${label}: operator ${opId} fee=${opSnap.fee} (expected ${expectedFee})`,
    );
  }
}

/**
 * Assert operator fee changed between pre and post.
 */
export function assertFeeChanged(
  pre: StateSnapshot,
  post: StateSnapshot,
  opId: bigint,
  label: string,
): void {
  const preSn = pre.operators.get(opId);
  const postSn = post.operators.get(opId);
  if (!preSn || !postSn) {
    throw new Error(`${label}: operator ${opId} missing from snapshot`);
  }
  if (preSn.fee === postSn.fee) {
    throw new Error(
      `${label}: operator ${opId} fee unchanged at ${preSn.fee}`,
    );
  }
}

/**
 * Assert operator fee decreased between pre and post.
 */
export function assertFeeDecreased(
  pre: StateSnapshot,
  post: StateSnapshot,
  opId: bigint,
  label: string,
): void {
  const preSn = pre.operators.get(opId);
  const postSn = post.operators.get(opId);
  if (!preSn || !postSn) {
    throw new Error(`${label}: operator ${opId} missing from snapshot`);
  }
  if (postSn.fee >= preSn.fee) {
    throw new Error(
      `${label}: operator ${opId} fee did not decrease (pre=${preSn.fee}, post=${postSn.fee})`,
    );
  }
}

/**
 * Assert all operators in the snapshot with the same fee have equal earnings.
 */
export function assertEqualFeeOperatorsEarnSame(
  snap: StateSnapshot,
  opIds: bigint[],
  label: string,
): void {
  if (opIds.length < 2) return;
  const first = snap.operators.get(opIds[0]);
  if (!first) throw new Error(`${label}: operator ${opIds[0]} not in snapshot`);
  for (let i = 1; i < opIds.length; i++) {
    const other = snap.operators.get(opIds[i]);
    if (!other) throw new Error(`${label}: operator ${opIds[i]} not in snapshot`);
    if (first.fee === other.fee && first.earnings !== other.earnings) {
      throw new Error(
        `${label}: operators ${opIds[0]} and ${opIds[i]} have same fee but different earnings (${first.earnings} vs ${other.earnings})`,
      );
    }
  }
}

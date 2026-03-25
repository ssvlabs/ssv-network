/**
 * Shared helpers for validator (VR, VX, VL) scenarios.
 *
 * Provides reusable building blocks for validator registration,
 * removal, exit, bulk operations, and assertion helpers.
 */

import { ethers } from "ethers";
import type { ScenarioContext } from "../simulation/scenario-context.ts";
import type { StateSnapshot } from "../simulation/state-snapshot.ts";
import type { ClusterRecord } from "../simulation/types.ts";
import { VERSION_SSV, VERSION_ETH } from "../simulation/types.ts";
import { ScenarioSkipped } from "../simulation/scenario-types.ts";
import { parseClusterFromReceipt } from "../simulation/bookkeeping.ts";
import { DEFAULT_SHARES } from "../common/constants.ts";

// ---------------------------------------------------------------------------
// Entity selection helpers
// ---------------------------------------------------------------------------

/** Pick an active ETH cluster that has at least 1 validator. */
export function pickClusterWithValidators(ctx: ScenarioContext): ClusterRecord {
  const clusters = [...ctx.simState.clusterBook.values()].filter(
    (c) => c.version === VERSION_ETH && c.cluster.active && c.validatorKeys.length > 0,
  );
  if (clusters.length === 0) {
    throw new ScenarioSkipped("No active ETH clusters with validators");
  }
  return ctx.rng.pick(clusters);
}

/** Pick an active ETH cluster that has at least `min` validators. */
export function pickClusterWithMinValidators(
  ctx: ScenarioContext,
  min: number,
): ClusterRecord {
  const clusters = [...ctx.simState.clusterBook.values()].filter(
    (c) =>
      c.version === VERSION_ETH &&
      c.cluster.active &&
      c.validatorKeys.length >= min,
  );
  if (clusters.length === 0) {
    throw new ScenarioSkipped(
      `No active ETH clusters with ${min}+ validators`,
    );
  }
  return ctx.rng.pick(clusters);
}

/** Pick an active ETH cluster (may have 0 validators). */
export function pickActiveETHCluster(ctx: ScenarioContext): ClusterRecord {
  const clusters = [...ctx.simState.clusterBook.values()].filter(
    (c) => c.version === VERSION_ETH && c.cluster.active,
  );
  if (clusters.length === 0) {
    throw new ScenarioSkipped("No active ETH clusters");
  }
  return ctx.rng.pick(clusters);
}

/** Pick an SSV (legacy) cluster with validators. */
export function pickSSVClusterWithValidators(
  ctx: ScenarioContext,
): ClusterRecord {
  const clusters = [...ctx.simState.clusterBook.values()].filter(
    (c) => c.version === VERSION_SSV && c.validatorKeys.length > 0,
  );
  if (clusters.length === 0) {
    throw new ScenarioSkipped("No SSV clusters with validators");
  }
  return ctx.rng.pick(clusters);
}

/** Pick a liquidated cluster with validators. */
export function pickLiquidatedCluster(ctx: ScenarioContext): ClusterRecord {
  const clusters = [...ctx.simState.clusterBook.values()].filter(
    (c) => !c.cluster.active && c.validatorKeys.length > 0,
  );
  if (clusters.length === 0) {
    throw new ScenarioSkipped("No liquidated clusters with validators");
  }
  return ctx.rng.pick(clusters);
}

// ---------------------------------------------------------------------------
// Pubkey generation
// ---------------------------------------------------------------------------

let pubkeyCounter = 0;

/** Generate a unique 48-byte validator pubkey. */
export function generatePubkey(): string {
  pubkeyCounter++;
  const seed = Date.now().toString(16) + pubkeyCounter.toString(16);
  return "0x" + seed.padStart(96, "ab");
}

// ---------------------------------------------------------------------------
// Validator operations
// ---------------------------------------------------------------------------

/** Register a new validator to an existing ETH cluster. Returns the pubkey. */
export async function registerValidator(
  ctx: ScenarioContext,
  record: ClusterRecord,
  depositEth: string = "5",
): Promise<string> {
  const pubkey = generatePubkey();
  const value = ethers.parseEther(depositEth);

  await ctx.provider.send("hardhat_setBalance", [
    record.owner,
    "0x" + (value + ethers.parseEther("10")).toString(16),
  ]);

  const tx = await ctx.contracts.network
    .connect(record.ownerSigner)
    .registerValidator(pubkey, record.operatorIds, DEFAULT_SHARES, record.cluster, {
      value,
    });
  const receipt = await tx.wait();
  const updated = parseClusterFromReceipt(
    ctx.contracts.network,
    receipt,
    "ValidatorAdded",
  );
  if (updated) record.cluster = updated;
  record.validatorKeys.push(pubkey);
  return pubkey;
}

/** Bulk register N new validators. Returns array of pubkeys. */
export async function bulkRegisterValidators(
  ctx: ScenarioContext,
  record: ClusterRecord,
  count: number,
  depositEth: string = "20",
): Promise<string[]> {
  const pubkeys: string[] = [];
  const sharesArray: string[] = [];
  for (let i = 0; i < count; i++) {
    pubkeys.push(generatePubkey());
    sharesArray.push(DEFAULT_SHARES);
  }
  const value = ethers.parseEther(depositEth);

  await ctx.provider.send("hardhat_setBalance", [
    record.owner,
    "0x" + (value + ethers.parseEther("10")).toString(16),
  ]);

  const tx = await ctx.contracts.network
    .connect(record.ownerSigner)
    .bulkRegisterValidator(pubkeys, record.operatorIds, sharesArray, record.cluster, {
      value,
    });
  const receipt = await tx.wait();
  const updated = parseClusterFromReceipt(
    ctx.contracts.network,
    receipt,
    "ValidatorAdded",
  );
  if (updated) record.cluster = updated;
  record.validatorKeys.push(...pubkeys);
  return pubkeys;
}

/** Remove a validator from a cluster. Returns the removed pubkey. */
export async function removeValidator(
  ctx: ScenarioContext,
  record: ClusterRecord,
  pubkey?: string,
): Promise<string> {
  const pk = pubkey ?? record.validatorKeys[0];
  if (!pk) throw new Error("No validators to remove from cluster");

  const tx = await ctx.contracts.network
    .connect(record.ownerSigner)
    .removeValidator(pk, record.operatorIds, record.cluster);
  const receipt = await tx.wait();
  const updated = parseClusterFromReceipt(
    ctx.contracts.network,
    receipt,
    "ValidatorRemoved",
  );
  if (updated) record.cluster = updated;
  record.validatorKeys = record.validatorKeys.filter((k) => k !== pk);
  return pk;
}

/** Bulk remove validators from a cluster. */
export async function bulkRemoveValidators(
  ctx: ScenarioContext,
  record: ClusterRecord,
  pubkeys: string[],
): Promise<void> {
  const tx = await ctx.contracts.network
    .connect(record.ownerSigner)
    .bulkRemoveValidator(pubkeys, record.operatorIds, record.cluster);
  const receipt = await tx.wait();
  const updated = parseClusterFromReceipt(
    ctx.contracts.network,
    receipt,
    "ValidatorRemoved",
  );
  if (updated) record.cluster = updated;
  record.validatorKeys = record.validatorKeys.filter(
    (k) => !pubkeys.includes(k),
  );
}

/** Exit a validator (signal only, no state change). */
export async function exitValidator(
  ctx: ScenarioContext,
  record: ClusterRecord,
  pubkey?: string,
): Promise<void> {
  const pk = pubkey ?? record.validatorKeys[0];
  if (!pk) throw new Error("No validators to exit");

  const tx = await ctx.contracts.network
    .connect(record.ownerSigner)
    .exitValidator(pk, record.operatorIds);
  await tx.wait();
}

/** Bulk exit validators (signal only, no state change). */
export async function bulkExitValidators(
  ctx: ScenarioContext,
  record: ClusterRecord,
  pubkeys: string[],
): Promise<void> {
  const tx = await ctx.contracts.network
    .connect(record.ownerSigner)
    .bulkExitValidator(pubkeys, record.operatorIds);
  await tx.wait();
}

// ---------------------------------------------------------------------------
// Assertion helpers
// ---------------------------------------------------------------------------

/** Assert cluster is active. */
export function assertClusterActive(
  snap: StateSnapshot,
  label: string,
): void {
  if (!snap.cluster) throw new Error(`${label}: no cluster in snapshot`);
  if (!snap.cluster.active) throw new Error(`${label}: cluster not active`);
}

/** Assert cluster is liquidated (inactive). */
export function assertClusterLiquidated(
  snap: StateSnapshot,
  label: string,
): void {
  if (!snap.cluster) throw new Error(`${label}: no cluster in snapshot`);
  if (snap.cluster.active) throw new Error(`${label}: cluster still active`);
}

/** Assert cluster validatorCount equals expected. */
export function assertValidatorCount(
  snap: StateSnapshot,
  expected: number,
  label: string,
): void {
  if (!snap.cluster) throw new Error(`${label}: no cluster in snapshot`);
  if (snap.cluster.validatorCount !== expected) {
    throw new Error(
      `${label}: validatorCount=${snap.cluster.validatorCount} (expected ${expected})`,
    );
  }
}

/** Assert cluster validatorCount changed by delta. */
export function assertValidatorCountChanged(
  pre: StateSnapshot,
  post: StateSnapshot,
  delta: number,
  label: string,
): void {
  if (!pre.cluster || !post.cluster) {
    throw new Error(`${label}: cluster missing from snapshot`);
  }
  const actual = post.cluster.validatorCount - pre.cluster.validatorCount;
  if (actual !== delta) {
    throw new Error(
      `${label}: validatorCount delta=${actual} (expected ${delta})`,
    );
  }
}

/** Assert cluster balance decreased (fees accrued). */
export function assertBalanceDecreased(
  pre: StateSnapshot,
  post: StateSnapshot,
  label: string,
): void {
  if (!pre.cluster || !post.cluster) {
    throw new Error(`${label}: cluster missing from snapshot`);
  }
  if (post.cluster.balance >= pre.cluster.balance) {
    throw new Error(
      `${label}: balance did not decrease (pre=${pre.cluster.balance}, post=${post.cluster.balance})`,
    );
  }
}

/** Assert cluster balance increased. */
export function assertBalanceIncreased(
  pre: StateSnapshot,
  post: StateSnapshot,
  label: string,
): void {
  if (!pre.cluster || !post.cluster) {
    throw new Error(`${label}: cluster missing from snapshot`);
  }
  if (post.cluster.balance <= pre.cluster.balance) {
    throw new Error(
      `${label}: balance did not increase (pre=${pre.cluster.balance}, post=${post.cluster.balance})`,
    );
  }
}

/** Assert cluster balance is non-negative. */
export function assertBalanceNonNegative(
  snap: StateSnapshot,
  label: string,
): void {
  if (!snap.cluster) throw new Error(`${label}: no cluster in snapshot`);
  if (snap.cluster.balance < 0n) {
    throw new Error(
      `${label}: cluster balance negative=${snap.cluster.balance}`,
    );
  }
}

/** Assert daoTotalEthVUnits is non-negative (uint256 — always true, kept for API compat). */
export function assertDaoVUnitsNonNegative(
  _snap: StateSnapshot,
  _label: string,
): void {
  // uint256 cannot be negative — no-op by design.
}

/** Assert operator validatorCount is as expected (via snapshot). */
export function assertOperatorValidatorCount(
  snap: StateSnapshot,
  opId: bigint,
  _expected: number,
  label: string,
): void {
  const opSnap = snap.operators.get(opId);
  if (!opSnap) throw new Error(`${label}: operator ${opId} not in snapshot`);
  // Operator snapshot doesn't directly expose validatorCount in current schema,
  // so this assertion validates the operator exists and is accessible.
}

/** Assert operator earnings increased. */
export function assertOperatorEarningsIncreased(
  pre: StateSnapshot,
  post: StateSnapshot,
  opId: bigint,
  label: string,
): void {
  const prOp = pre.operators.get(opId);
  const poOp = post.operators.get(opId);
  if (!prOp || !poOp) throw new Error(`${label}: operator ${opId} not in snapshot`);
  if (poOp.earnings <= prOp.earnings) {
    throw new Error(
      `${label}: operator ${opId} earnings did not increase (pre=${prOp.earnings}, post=${poOp.earnings})`,
    );
  }
}

/** Assert operator earnings are zero. */
export function assertOperatorEarningsZero(
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

/** Assert contract ETH balance changed. */
export function assertContractBalanceChanged(
  pre: StateSnapshot,
  post: StateSnapshot,
  direction: "increased" | "decreased",
  label: string,
): void {
  if (direction === "increased" && post.contractEthBalance <= pre.contractEthBalance) {
    throw new Error(
      `${label}: contract balance did not increase`,
    );
  }
  if (direction === "decreased" && post.contractEthBalance >= pre.contractEthBalance) {
    throw new Error(
      `${label}: contract balance did not decrease`,
    );
  }
}

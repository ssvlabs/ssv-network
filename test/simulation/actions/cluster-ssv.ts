/**
 * SSV (legacy) cluster actions for Monte Carlo simulation.
 *
 * - actionDepositSsv
 * - actionLiquidateSsv
 * - actionReactivateSsv
 */

import { ethers } from "ethers";
import {
  DEDUCTED_DIGITS,
} from "../../common/constants.ts";
import type { SimulationState, ActionResult, ClusterRecord } from "../types.ts";
import { VERSION_SSV } from "../types.ts";
import {
  clusterKey,
  parseClusterFromReceipt,
  trackSsvFlow,
} from "../bookkeeping.ts";

/** Get all active SSV clusters. */
function activeSsvClusters(state: SimulationState): ClusterRecord[] {
  return [...state.clusterBook.values()].filter(
    (c) => c.version === VERSION_SSV && c.cluster.active,
  );
}

/** Get all liquidated SSV clusters. */
function liquidatedSsvClusters(state: SimulationState): ClusterRecord[] {
  return [...state.clusterBook.values()].filter(
    (c) => c.version === VERSION_SSV && !c.cluster.active,
  );
}

/**
 * Provision SSV tokens to an address via hardhat_setStorageAt.
 */
async function provisionSSV(
  provider: any,
  ssvToken: any,
  recipient: string,
  amount: bigint,
): Promise<void> {
  const tokenAddr = await ssvToken.getAddress();
  const balanceSlot = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["address", "uint256"],
      [recipient, 0],
    ),
  );
  await provider.send("hardhat_setStorageAt", [
    tokenAddr,
    balanceSlot,
    ethers.zeroPadValue(ethers.toBeHex(amount), 32),
  ]);
}

/**
 * Deposit SSV tokens into an active SSV cluster.
 */
export async function actionDepositSsv(state: SimulationState): Promise<ActionResult> {
  const NAME = "ssvDeposit";

  const clusters = activeSsvClusters(state);
  if (clusters.length === 0) {
    return { name: NAME, success: false, revertReason: "SKIP: no active SSV clusters" };
  }

  const cr = state.rng.pick(clusters);
  const key = clusterKey(ethers, cr.owner, cr.operatorIds);

  // Deposit 10-100 SSV tokens (aligned to DEDUCTED_DIGITS)
  const minAmount = 10n * 10n ** 18n;
  const maxAmount = 100n * 10n ** 18n;
  const rawAmount = state.rng.nextInRange(minAmount, maxAmount);
  const amount = (rawAmount / DEDUCTED_DIGITS) * DEDUCTED_DIGITS;

  try {
    await provisionSSV(state.provider, state.ssvToken, cr.owner, amount * 2n);

    const networkAddr = await state.network.getAddress();
    await state.ssvToken.connect(cr.ownerSigner).approve(networkAddr, amount);

    // SSV deposit uses the legacy overload with uint256 amount (not in typed interface)
    const connected = state.network.connect(cr.ownerSigner) as any;
    const tx = await connected[
      "deposit(address,uint64[],uint256,(uint32,uint64,uint64,bool,uint256))"
    ](cr.owner, cr.operatorIds, amount, cr.cluster);
    const receipt = await tx.wait();

    const updatedCluster = parseClusterFromReceipt(state.network, receipt, "ClusterDeposited");
    if (updatedCluster) cr.cluster = updatedCluster;

    trackSsvFlow(state, "in", amount);
    if (receipt) state.currentBlock = receipt.blockNumber;

    return { name: NAME, success: true, clusterKeyUpdated: key };
  } catch (err) {
    return { name: NAME, success: false, revertReason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Attempt to liquidate an SSV cluster. May revert if solvent.
 */
export async function actionLiquidateSsv(state: SimulationState): Promise<ActionResult> {
  const NAME = "ssvLiquidate";

  const clusters = activeSsvClusters(state);
  if (clusters.length === 0) {
    return { name: NAME, success: false, revertReason: "SKIP: no active SSV clusters" };
  }

  const cr = state.rng.pick(clusters);
  const key = clusterKey(ethers, cr.owner, cr.operatorIds);

  const liquidator = state.stakerPool.length > 0
    ? state.rng.pick(state.stakerPool).signer
    : cr.ownerSigner;

  try {
    const tx = await state.network
      .connect(liquidator)
      .liquidateSSV(cr.owner, cr.operatorIds, cr.cluster);
    const receipt = await tx.wait();

    const updatedCluster = parseClusterFromReceipt(state.network, receipt, "ClusterLiquidated");
    if (updatedCluster) cr.cluster = updatedCluster;

    if (receipt) state.currentBlock = receipt.blockNumber;

    return { name: NAME, success: true, clusterKeyUpdated: key };
  } catch (err) {
    return { name: NAME, success: false, revertReason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Reactivate a liquidated SSV cluster with generous deposit.
 */
export async function actionReactivateSsv(state: SimulationState): Promise<ActionResult> {
  const NAME = "ssvReactivate";

  const clusters = liquidatedSsvClusters(state);
  if (clusters.length === 0) {
    return { name: NAME, success: false, revertReason: "SKIP: no liquidated SSV clusters" };
  }

  const cr = state.rng.pick(clusters);
  const key = clusterKey(ethers, cr.owner, cr.operatorIds);

  const reactivateAmount = 100n * 10n ** 18n;
  const alignedAmount = (reactivateAmount / DEDUCTED_DIGITS) * DEDUCTED_DIGITS;

  try {
    await provisionSSV(state.provider, state.ssvToken, cr.owner, alignedAmount * 2n);

    const networkAddr = await state.network.getAddress();
    await state.ssvToken.connect(cr.ownerSigner).approve(networkAddr, alignedAmount);

    // SSV reactivate uses the legacy overload with uint256 amount (not in typed interface)
    const connected = state.network.connect(cr.ownerSigner) as any;
    const tx = await connected[
      "reactivate(uint64[],uint256,(uint32,uint64,uint64,bool,uint256))"
    ](cr.operatorIds, alignedAmount, cr.cluster);
    const receipt = await tx.wait();

    const updatedCluster = parseClusterFromReceipt(state.network, receipt, "ClusterReactivated");
    if (updatedCluster) cr.cluster = updatedCluster;

    trackSsvFlow(state, "in", alignedAmount);
    if (receipt) state.currentBlock = receipt.blockNumber;

    return { name: NAME, success: true, clusterKeyUpdated: key };
  } catch (err) {
    return { name: NAME, success: false, revertReason: err instanceof Error ? err.message : String(err) };
  }
}

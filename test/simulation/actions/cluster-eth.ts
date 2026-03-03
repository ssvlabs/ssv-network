/**
 * ETH cluster actions for Monte Carlo simulation.
 *
 * - actionRegisterValidator
 * - actionRemoveValidator
 * - actionDepositEth
 * - actionWithdrawEth
 * - actionLiquidateEth
 * - actionReactivateEth
 */

import { ethers } from "ethers";
import {
  DEFAULT_SHARES,
  ETH_DEDUCTED_DIGITS,
} from "../../common/constants.ts";
import { calcLiquidationThreshold, defaultVUnits } from "../../e2e/helpers/fee-calculator.ts";
import type { SimulationState, ActionResult, ClusterRecord } from "../types.ts";
import { VERSION_ETH } from "../types.ts";
import {
  clusterKey,
  parseClusterFromReceipt,
  trackEthFlow,
} from "../bookkeeping.ts";

/** Generate a unique 48-byte validator public key from RNG. */
function makeValidatorKey(rng: any): string {
  const seed = rng.next();
  return `0x${seed.toString(16).padStart(96, "0")}`;
}

/** Get all active ETH clusters with validators. */
function activeEthClusters(state: SimulationState): ClusterRecord[] {
  return [...state.clusterBook.values()].filter(
    (c) => c.version === VERSION_ETH && c.cluster.active && c.cluster.validatorCount > 0n,
  );
}

/** Get all liquidated ETH clusters. */
function liquidatedEthClusters(state: SimulationState): ClusterRecord[] {
  return [...state.clusterBook.values()].filter(
    (c) => c.version === VERSION_ETH && !c.cluster.active,
  );
}

/** Compute avg operator fee (raw packed) for a set of operator IDs. */
function avgOperatorFee(state: SimulationState, operatorIds: bigint[]): bigint {
  let totalFee = 0n;
  let count = 0n;
  for (const id of operatorIds) {
    const op = state.operatorPool.get(id);
    if (op) {
      totalFee += op.fee;
      count++;
    }
  }
  return count > 0n ? totalFee / count : 0n;
}

/** Compute minimum deposit with safety buffer. */
function minDeposit(numOperators: bigint, ethFee: bigint, vUnits: bigint): bigint {
  const threshold = calcLiquidationThreshold({
    minimumBlocksBeforeLiquidation: 214800n,
    numOperators,
    ethFee,
    networkFee: 35509n,
    effectiveVUnits: vUnits,
  });
  const minCollateral = 1_000_000_000_000_000n; // 0.001 ETH
  const base = threshold > minCollateral ? threshold : minCollateral;
  return base + base / 2n; // 50% buffer
}

/**
 * Register a new validator in an ETH cluster.
 * Picks 4 random active operators, creates a new cluster or adds to existing.
 */
export async function actionRegisterValidator(state: SimulationState): Promise<ActionResult> {
  const NAME = "ethRegisterValidator";

  const activeOps = [...state.operatorPool.values()].filter((op) => op.isActive);
  if (activeOps.length < 4) {
    return { name: NAME, success: false, revertReason: "SKIP: fewer than 4 active operators" };
  }

  // Pick 4 random operators, sorted by ID
  const shuffled = state.rng.shuffle([...activeOps]);
  const selectedOps = shuffled.slice(0, 4).sort((a, b) => Number(a.id - b.id));
  const operatorIds = selectedOps.map((op) => op.id);

  // Pick a signer
  const signerCandidates = [
    ...state.stakerPool.map((s) => s.signer),
    ...[...state.operatorPool.values()].map((op) => op.ownerSigner),
  ];
  if (signerCandidates.length === 0) {
    return { name: NAME, success: false, revertReason: "SKIP: no signers" };
  }
  const signer = state.rng.pick(signerCandidates);
  const owner = await signer.getAddress();

  const validatorKey = makeValidatorKey(state.rng);
  const key = clusterKey(ethers, owner, operatorIds);
  const existing = state.clusterBook.get(key);

  // Compute deposit
  const validatorCount = existing ? existing.cluster.validatorCount + 1n : 1n;
  const vUnits = defaultVUnits(validatorCount);
  const avgFee = avgOperatorFee(state, operatorIds);
  const depositAmount = minDeposit(BigInt(operatorIds.length), avgFee, vUnits);

  const clusterStruct = existing
    ? existing.cluster
    : { validatorCount: 0n, networkFeeIndex: 0n, index: 0n, active: true, balance: 0n };

  try {
    await state.provider.send("hardhat_setBalance", [
      owner,
      "0x" + (depositAmount + 10n ** 18n).toString(16),
    ]);

    const tx = await state.network
      .connect(signer)
      .registerValidator(validatorKey, operatorIds, DEFAULT_SHARES, clusterStruct, {
        value: depositAmount,
      });
    const receipt = await tx.wait();

    const updatedCluster = parseClusterFromReceipt(state.network, receipt, "ValidatorAdded");
    if (!updatedCluster) {
      return { name: NAME, success: false, revertReason: "ValidatorAdded event not found" };
    }

    if (existing) {
      existing.cluster = updatedCluster;
      existing.validatorKeys.push(validatorKey);
    } else {
      state.clusterBook.set(key, {
        owner,
        ownerSigner: signer,
        operatorIds,
        cluster: updatedCluster,
        version: VERSION_ETH,
        validatorKeys: [validatorKey],
      });
    }

    trackEthFlow(state, "in", depositAmount);
    if (receipt) state.currentBlock = receipt.blockNumber;

    return { name: NAME, success: true, clusterKeyUpdated: key };
  } catch (err) {
    return { name: NAME, success: false, revertReason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Remove a validator from a random active ETH cluster.
 */
export async function actionRemoveValidator(state: SimulationState): Promise<ActionResult> {
  const NAME = "ethRemoveValidator";

  const clusters = activeEthClusters(state);
  if (clusters.length === 0) {
    return { name: NAME, success: false, revertReason: "SKIP: no active ETH clusters" };
  }

  const cr = state.rng.pick(clusters);
  if (cr.validatorKeys.length === 0) {
    return { name: NAME, success: false, revertReason: "SKIP: no tracked validator keys" };
  }

  const validatorKey = cr.validatorKeys[cr.validatorKeys.length - 1];
  const key = clusterKey(ethers, cr.owner, cr.operatorIds);

  try {
    const tx = await state.network
      .connect(cr.ownerSigner)
      .removeValidator(validatorKey, cr.operatorIds, cr.cluster);
    const receipt = await tx.wait();

    const updatedCluster = parseClusterFromReceipt(state.network, receipt, "ValidatorRemoved");
    if (updatedCluster) cr.cluster = updatedCluster;
    cr.validatorKeys.pop();

    if (receipt) state.currentBlock = receipt.blockNumber;

    return { name: NAME, success: true, clusterKeyUpdated: key };
  } catch (err) {
    return { name: NAME, success: false, revertReason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Deposit random ETH (0.1-5 ETH) into an active ETH cluster.
 */
export async function actionDepositEth(state: SimulationState): Promise<ActionResult> {
  const NAME = "ethDeposit";

  const clusters = activeEthClusters(state);
  if (clusters.length === 0) {
    return { name: NAME, success: false, revertReason: "SKIP: no active ETH clusters" };
  }

  const cr = state.rng.pick(clusters);
  const key = clusterKey(ethers, cr.owner, cr.operatorIds);

  const minWei = ethers.parseEther("0.1");
  const maxWei = ethers.parseEther("5");
  const rawAmount = state.rng.nextInRange(minWei, maxWei);
  const amount = (rawAmount / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS;

  try {
    await state.provider.send("hardhat_setBalance", [
      cr.owner,
      "0x" + (amount + 10n ** 18n).toString(16),
    ]);

    const tx = await state.network
      .connect(cr.ownerSigner)
      .deposit(cr.owner, cr.operatorIds, cr.cluster, { value: amount });
    const receipt = await tx.wait();

    const updatedCluster = parseClusterFromReceipt(state.network, receipt, "ClusterDeposited");
    if (updatedCluster) cr.cluster = updatedCluster;

    trackEthFlow(state, "in", amount);
    if (receipt) state.currentBlock = receipt.blockNumber;

    return { name: NAME, success: true, clusterKeyUpdated: key };
  } catch (err) {
    return { name: NAME, success: false, revertReason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Withdraw a safe amount from an active ETH cluster.
 * Leaves 3x liquidation threshold as safety margin.
 */
export async function actionWithdrawEth(state: SimulationState): Promise<ActionResult> {
  const NAME = "ethWithdraw";

  const clusters = activeEthClusters(state);
  if (clusters.length === 0) {
    return { name: NAME, success: false, revertReason: "SKIP: no active ETH clusters" };
  }

  const cr = state.rng.pick(clusters);
  const key = clusterKey(ethers, cr.owner, cr.operatorIds);

  const vUnits = defaultVUnits(cr.cluster.validatorCount);
  const avgFee = avgOperatorFee(state, cr.operatorIds);
  const threshold = calcLiquidationThreshold({
    minimumBlocksBeforeLiquidation: 214800n,
    numOperators: BigInt(cr.operatorIds.length),
    ethFee: avgFee,
    networkFee: 35509n,
    effectiveVUnits: vUnits,
  });

  const safeMin = threshold * 3n;
  if (cr.cluster.balance <= safeMin) {
    return { name: NAME, success: false, revertReason: "SKIP: balance too low for safe withdrawal" };
  }

  const surplus = cr.cluster.balance - safeMin;
  const pct = state.rng.nextInRange(10n, 50n);
  const rawAmount = (surplus * pct) / 100n;
  const amount = (rawAmount / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS;

  if (amount === 0n) {
    return { name: NAME, success: false, revertReason: "SKIP: withdrawal rounds to 0" };
  }

  try {
    const tx = await state.network
      .connect(cr.ownerSigner)
      .withdraw(cr.operatorIds, amount, cr.cluster);
    const receipt = await tx.wait();

    const updatedCluster = parseClusterFromReceipt(state.network, receipt, "ClusterWithdrawn");
    if (updatedCluster) cr.cluster = updatedCluster;

    trackEthFlow(state, "out", amount);
    if (receipt) state.currentBlock = receipt.blockNumber;

    return { name: NAME, success: true, clusterKeyUpdated: key };
  } catch (err) {
    return { name: NAME, success: false, revertReason: err instanceof Error ? err.message : String(err) };
  }
}

/**
 * Attempt to liquidate a random ETH cluster. May revert if solvent.
 */
export async function actionLiquidateEth(state: SimulationState): Promise<ActionResult> {
  const NAME = "ethLiquidate";

  const clusters = activeEthClusters(state);
  if (clusters.length === 0) {
    return { name: NAME, success: false, revertReason: "SKIP: no active ETH clusters" };
  }

  const cr = state.rng.pick(clusters);
  const key = clusterKey(ethers, cr.owner, cr.operatorIds);

  const liquidator = state.stakerPool.length > 0
    ? state.rng.pick(state.stakerPool).signer
    : cr.ownerSigner;

  try {
    const tx = await state.network
      .connect(liquidator)
      .liquidate(cr.owner, cr.operatorIds, cr.cluster);
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
 * Reactivate a liquidated ETH cluster with sufficient deposit.
 */
export async function actionReactivateEth(state: SimulationState): Promise<ActionResult> {
  const NAME = "ethReactivate";

  const clusters = liquidatedEthClusters(state);
  if (clusters.length === 0) {
    return { name: NAME, success: false, revertReason: "SKIP: no liquidated ETH clusters" };
  }

  const cr = state.rng.pick(clusters);
  const key = clusterKey(ethers, cr.owner, cr.operatorIds);

  const validatorCount = cr.cluster.validatorCount > 0n ? cr.cluster.validatorCount : 1n;
  const vUnits = defaultVUnits(validatorCount);
  const avgFee = avgOperatorFee(state, cr.operatorIds);
  const deposit = minDeposit(BigInt(cr.operatorIds.length), avgFee, vUnits);

  try {
    await state.provider.send("hardhat_setBalance", [
      cr.owner,
      "0x" + (deposit + 10n ** 18n).toString(16),
    ]);

    const tx = await state.network
      .connect(cr.ownerSigner)
      .reactivate(cr.operatorIds, cr.cluster, { value: deposit });
    const receipt = await tx.wait();

    const updatedCluster = parseClusterFromReceipt(state.network, receipt, "ClusterReactivated");
    if (updatedCluster) cr.cluster = updatedCluster;

    trackEthFlow(state, "in", deposit);
    if (receipt) state.currentBlock = receipt.blockNumber;

    return { name: NAME, success: true, clusterKeyUpdated: key };
  } catch (err) {
    return { name: NAME, success: false, revertReason: err instanceof Error ? err.message : String(err) };
  }
}

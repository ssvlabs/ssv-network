/**
 * Migration action for Monte Carlo simulation.
 *
 * - actionMigrateCluster — migrate an SSV cluster to ETH payments
 */

import { ethers } from "ethers";
import {
  ETH_DEDUCTED_DIGITS,
} from "../../common/constants.ts";
import { calcLiquidationThreshold, defaultVUnits } from "../../helpers/fee.ts";
import type { SimulationState, ActionResult, ClusterRecord } from "../types.ts";
import { VERSION_SSV, VERSION_ETH } from "../types.ts";
import {
  clusterKey,
  parseClusterFromReceipt,
  trackEthFlow,
} from "../bookkeeping.ts";

async function protocolLiquidationInputs(state: SimulationState): Promise<{
  minimumBlocksBeforeLiquidation: bigint;
  networkFee: bigint;
  minimumLiquidationCollateral: bigint;
}> {
  return {
    minimumBlocksBeforeLiquidation: BigInt(await state.views.getLiquidationThresholdPeriod()),
    networkFee: BigInt(await state.views.getNetworkFee()) / ETH_DEDUCTED_DIGITS,
    minimumLiquidationCollateral: BigInt(await state.views.getMinimumLiquidationCollateral()),
  };
}

/** Get all active SSV clusters eligible for migration. */
function migratableClusters(state: SimulationState): ClusterRecord[] {
  return [...state.clusterBook.values()].filter(
    (c) => c.version === VERSION_SSV && c.cluster.active,
  );
}

/**
 * Migrate a random active SSV cluster to ETH.
 *
 * 1. Pick random active SSV cluster
 * 2. Compute minimum ETH needed (max of collateral and threshold formula)
 * 3. Fund owner and call migrateClusterToETH
 * 4. Update cluster version in bookkeeping
 */
export async function actionMigrateCluster(state: SimulationState): Promise<ActionResult> {
  const NAME = "migrateClusterToETH";

  const clusters = migratableClusters(state);
  if (clusters.length === 0) {
    return { name: NAME, success: false, revertReason: "SKIP: no active SSV clusters to migrate" };
  }

  const cr = state.rng.pick(clusters);
  const key = clusterKey(ethers, cr.owner, cr.operatorIds);
  const validatorCount = cr.cluster.validatorCount > 0n ? cr.cluster.validatorCount : 1n;
  const vUnits = defaultVUnits(validatorCount);
  let avgFee = 0n;
  let feeCount = 0n;
  for (const id of cr.operatorIds) {
    const op = state.operatorPool.get(id);
    if (op) {
      avgFee += op.fee;
      feeCount++;
      continue;
    }
    try {
      avgFee += BigInt(await state.views.getOperatorFee(id)) / ETH_DEDUCTED_DIGITS;
      feeCount++;
    } catch {
    }
  }
  if (feeCount > 0n) avgFee = avgFee / feeCount;

  const protocol = await protocolLiquidationInputs(state);
  const threshold = calcLiquidationThreshold({
    minimumBlocksBeforeLiquidation: protocol.minimumBlocksBeforeLiquidation,
    numOperators: BigInt(cr.operatorIds.length),
    ethFee: avgFee,
    networkFee: protocol.networkFee,
    effectiveVUnits: vUnits,
  });

  const base = threshold > protocol.minimumLiquidationCollateral
    ? threshold
    : protocol.minimumLiquidationCollateral;
  const ethDeposit = ((base + base / 2n) / ETH_DEDUCTED_DIGITS + 1n) * ETH_DEDUCTED_DIGITS;

  try {
    await state.provider.send("hardhat_setBalance", [
      cr.owner,
      "0x" + (ethDeposit + 10n ** 18n).toString(16),
    ]);

    const tx = await state.network
      .connect(cr.ownerSigner)
      .migrateClusterToETH(cr.operatorIds, cr.cluster, {
        value: ethDeposit,
      });
    const receipt = await tx.wait();

    const updatedCluster = parseClusterFromReceipt(state.network, receipt, "ClusterMigratedToETH");
    if (updatedCluster) cr.cluster = updatedCluster;

    cr.version = VERSION_ETH;
    cr.ebModeHint = "implicit";

    trackEthFlow(state, "in", ethDeposit);
    if (receipt) state.currentBlock = receipt.blockNumber;

    return { name: NAME, success: true, clusterKeyUpdated: key };
  } catch (err) {
    return { name: NAME, success: false, revertReason: err instanceof Error ? err.message : String(err) };
  }
}

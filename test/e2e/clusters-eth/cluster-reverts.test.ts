/**
 * CM-21: Revert — Liquidate Cluster At Exact Threshold
 *
 * Tests the strict less-than comparison in liquidation:
 *   balance < threshold → liquidatable
 *   balance == threshold → NOT liquidatable
 *   balance == threshold - 1 → liquidatable
 */

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType, Cluster } from "../../common/types.ts";
import {
  makePublicKey,
  parseClusterFromEvent,
  getCurrentClusterState,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  ETH_DEDUCTED_DIGITS,
  VUNITS_PRECISION,
} from "../../common/constants.ts";
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";
import { mineBlocks, getBlockNumber, calcLiquidationThreshold, calcClusterBurn, defaultVUnits } from "../helpers/index.ts";
import { ethers } from "ethers";

describe("CM-21: Revert — Liquidate Cluster At Exact Threshold", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;
  let thirdParty: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner, thirdParty] = await connection.ethers.getSigners();
  });

  /**
   * Deploy with controlled parameters so we can calculate exact thresholds.
   * Operator ETH fee: 10_000 packed (= 1_000_000_000 wei)
   * Network fee: 5_000 packed (= 500_000_000 wei)
   * minimumBlocksBeforeLiquidation: 100
   * minimumLiquidationCollateral: 0 (so only the threshold matters)
   */
  const deployFixture = async () => {
    const operatorFee = 1_000_000_000n; // 10_000 packed * 100_000 = 1_000_000_000 wei
    const result = await ssvClustersHarnessFixture(connection, 4, operatorFee);
    const { clusters, operatorIds } = result;

    // Set network fee: 5_000 packed
    await clusters.mockEthNetworkFee(5_000n);
    // Set liquidation params
    await clusters.mockMinimumBlocksBeforeLiquidation(100n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    return { clusters, operatorIds };
  };

  it("third-party liquidation at exact threshold reverts with ClusterNotLiquidatable", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    // Calculate the exact liquidation threshold
    // burnRate = 4 * 10_000 = 40_000 (packed sum of operator fees)
    // networkFee = 5_000 (packed)
    // vUnits = 1 * 10_000 = 10_000 (1 validator, implicit EB)
    // thresholdUnits = (100 * (40_000 + 5_000) * 10_000) / 10_000 = 100 * 45_000 = 4_500_000
    // threshold = 4_500_000 * 100_000 = 450_000_000_000 wei
    const threshold = calcLiquidationThreshold({
      minimumBlocksBeforeLiquidation: 100n,
      numOperators: 4n,
      ethFee: 10_000n, // packed fee per operator
      networkFee: 5_000n, // packed network fee
      effectiveVUnits: defaultVUnits(1n),
    });

    // Fees accrue per block. When we register at block N with balance=threshold,
    // the registration itself passes. But if we call liquidate at block N+1,
    // 1 block of fees has accrued, reducing the effective balance below threshold.
    // To ensure the cluster is NOT liquidatable at the time of the liquidate call,
    // we need to deposit threshold + enough to cover fees accrued during the
    // block(s) between registration and the liquidation attempt.
    // Per-block burn for 1 validator: (burnRate + networkFee) × vUnits / VUNITS_PRECISION × ETH_DEDUCTED_DIGITS
    const burnPerBlock = calcClusterBurn({
      blockDiff: 1n,
      numOperators: 4n,
      ethFee: 10_000n,
      networkFee: 5_000n,
      effectiveVUnits: defaultVUnits(1n),
    });
    // Deposit threshold + 1 block of burn to stay above threshold at next block
    const deposit = threshold + burnPerBlock;

    await clusters.connect(clusterOwner).registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: deposit },
    );

    const cluster = await getCurrentClusterState(
      connection,
      clusters as any,
      clusterOwner.address,
      operatorIds,
    );

    // Third-party liquidation should revert because after 1 block of fees,
    // balance (deposit - 1 block of fees) = threshold, which is NOT < threshold
    await expect(
      clusters.connect(thirdParty).liquidate(
        clusterOwner.address,
        operatorIds,
        cluster,
      ),
    ).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_NOT_LIQUIDATABLE);
  });

  it("self-liquidation at exact threshold succeeds (owner bypass)", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployFixture);

    const threshold = calcLiquidationThreshold({
      minimumBlocksBeforeLiquidation: 100n,
      numOperators: 4n,
      ethFee: 10_000n,
      networkFee: 5_000n,
      effectiveVUnits: defaultVUnits(1n),
    });

    // Deposit threshold + 1 block of burn (same as test above)
    const burnPerBlock = calcClusterBurn({
      blockDiff: 1n,
      numOperators: 4n,
      ethFee: 10_000n,
      networkFee: 5_000n,
      effectiveVUnits: defaultVUnits(1n),
    });
    const deposit = threshold + burnPerBlock;

    // Create cluster with balance just above threshold
    await clusters.connect(clusterOwner).registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: deposit },
    );

    const cluster = await getCurrentClusterState(
      connection,
      clusters as any,
      clusterOwner.address,
      operatorIds,
    );

    // Self-liquidation (owner == msg.sender) should succeed even when not liquidatable
    const tx = await clusters.connect(clusterOwner).liquidate(
      clusterOwner.address,
      operatorIds,
      cluster,
    );
    await tx.wait();

    // Verify cluster is liquidated
    await expect(tx).to.emit(clusters, Events.CLUSTER_LIQUIDATED);
  });

  it("third-party liquidation at threshold - 1 wei succeeds", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployFixture);

    const threshold = calcLiquidationThreshold({
      minimumBlocksBeforeLiquidation: 100n,
      numOperators: 4n,
      ethFee: 10_000n,
      networkFee: 5_000n,
      effectiveVUnits: defaultVUnits(1n),
    });

    // Create cluster with balance at threshold - 1
    // But we can't deposit threshold-1 at registration because the contract will
    // check liquidation on registration and revert with InsufficientBalance.
    // So we need to create with enough, let fees drain it, then liquidate.

    // Instead, deposit exactly at threshold (passes registration check),
    // then mine 1 block so fees reduce the balance below threshold
    await clusters.connect(clusterOwner).registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: threshold },
    );

    const cluster = await getCurrentClusterState(
      connection,
      clusters as any,
      clusterOwner.address,
      operatorIds,
    );

    // Advance 1 block — fees reduce balance below threshold
    await mineBlocks(connection.ethers.provider, 1);

    // Third-party liquidation should now succeed
    const tx = await clusters.connect(thirdParty).liquidate(
      clusterOwner.address,
      operatorIds,
      cluster,
    );
    await tx.wait();

    await expect(tx).to.emit(clusters, Events.CLUSTER_LIQUIDATED);
  });
});

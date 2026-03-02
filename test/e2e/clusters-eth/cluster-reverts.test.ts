import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  makePublicKey,
  getCurrentClusterState,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
} from "../../common/constants.ts";
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";
import { mineBlocks, calcLiquidationThreshold, calcClusterBurn, defaultVUnits } from "../helpers/index.ts";

describe("Revert — Liquidate Cluster At Exact Threshold", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;
  let thirdParty: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner, thirdParty] = await connection.ethers.getSigners();
  });

  const deployFixture = async () => {
    const operatorFee = 1_000_000_000n;
    const result = await ssvClustersHarnessFixture(connection, 4, operatorFee);
    const { clusters, operatorIds } = result;

    await clusters.mockEthNetworkFee(5_000n);
    await clusters.mockMinimumBlocksBeforeLiquidation(100n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    return { clusters, operatorIds };
  };

  it("Third-party liquidation at exact threshold reverts with ClusterNotLiquidatable", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployFixture);

    const threshold = calcLiquidationThreshold({
      minimumBlocksBeforeLiquidation: 100n,
      numOperators: 4n,
      ethFee: 10_000n,
      networkFee: 5_000n,
      effectiveVUnits: defaultVUnits(1n),
    });

    const burnPerBlock = calcClusterBurn({
      blockDiff: 1n,
      numOperators: 4n,
      ethFee: 10_000n,
      networkFee: 5_000n,
      effectiveVUnits: defaultVUnits(1n),
    });
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

    await expect(
      clusters.connect(thirdParty).liquidate(
        clusterOwner.address,
        operatorIds,
        cluster,
      ),
    ).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_NOT_LIQUIDATABLE);
  });

  it("Self-liquidation at exact threshold succeeds (owner bypass)", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployFixture);

    const threshold = calcLiquidationThreshold({
      minimumBlocksBeforeLiquidation: 100n,
      numOperators: 4n,
      ethFee: 10_000n,
      networkFee: 5_000n,
      effectiveVUnits: defaultVUnits(1n),
    });

    const burnPerBlock = calcClusterBurn({
      blockDiff: 1n,
      numOperators: 4n,
      ethFee: 10_000n,
      networkFee: 5_000n,
      effectiveVUnits: defaultVUnits(1n),
    });
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

    const tx = await clusters.connect(clusterOwner).liquidate(
      clusterOwner.address,
      operatorIds,
      cluster,
    );
    await tx.wait();

    await expect(tx).to.emit(clusters, Events.CLUSTER_LIQUIDATED);
  });

  it("Third-party liquidation at threshold - 1 wei succeeds", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployFixture);

    const threshold = calcLiquidationThreshold({
      minimumBlocksBeforeLiquidation: 100n,
      numOperators: 4n,
      ethFee: 10_000n,
      networkFee: 5_000n,
      effectiveVUnits: defaultVUnits(1n),
    });

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

    await mineBlocks(connection.ethers.provider, 1);

    const tx = await clusters.connect(thirdParty).liquidate(
      clusterOwner.address,
      operatorIds,
      cluster,
    );
    await tx.wait();

    await expect(tx).to.emit(clusters, Events.CLUSTER_LIQUIDATED);
  });
});

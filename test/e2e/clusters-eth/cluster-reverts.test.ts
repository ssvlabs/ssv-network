import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  makePublicKey,
  getCurrentClusterState,
  registerOperators,
  whitelistAddresses,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_LIQUIDATION_THRESHOLD,
  OP_ETH_FEE_RAW,
  DEFAULT_NETWORK_FEE_RAW,
  DEFAULT_NETWORK_FEE_UNPACKED,
} from "../../common/constants.ts";
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";
import { mineBlocks, calcLiquidationThreshold, calcClusterBurn, defaultVUnits } from "../../helpers/index.ts";

const MIN_BLOCKS_BEFORE_LIQ = MINIMAL_LIQUIDATION_THRESHOLD;

describe("Revert — Liquidate Cluster At Exact Threshold", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;
  let thirdParty: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner, thirdParty] } = await setupTestContext());
  });

  const deployFixture = async () => {
    const { network, views } = await ssvNetworkFullFixture(connection);

    await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
    await network.updateLiquidationThresholdPeriod(MIN_BLOCKS_BEFORE_LIQ);
    await network.updateMinimumLiquidationCollateral(0n);

    const operatorIds = await registerOperators(network, clusterOwner, 4);
    await whitelistAddresses(network, clusterOwner, operatorIds, [clusterOwner.address]);

    return { network, views, operatorIds };
  };

  it("Third-party liquidation at exact threshold reverts with ClusterNotLiquidatable", async function () {
    const { network, operatorIds } =
      await networkHelpers.loadFixture(deployFixture);

    const threshold = calcLiquidationThreshold({
      minimumBlocksBeforeLiquidation: MIN_BLOCKS_BEFORE_LIQ,
      numOperators: 4n,
      ethFee: OP_ETH_FEE_RAW,
      networkFee: DEFAULT_NETWORK_FEE_RAW,
      effectiveVUnits: defaultVUnits(1n),
    });

    const burnPerBlock = calcClusterBurn({
      blockDiff: 1n,
      numOperators: 4n,
      ethFee: OP_ETH_FEE_RAW,
      networkFee: DEFAULT_NETWORK_FEE_RAW,
      effectiveVUnits: defaultVUnits(1n),
    });
    const deposit = threshold + burnPerBlock;

    await network.connect(clusterOwner).registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: deposit },
    );

    const cluster = await getCurrentClusterState(
      connection,
      network as any,
      clusterOwner.address,
      operatorIds,
    );

    await expect(
      network.connect(thirdParty).liquidate(
        clusterOwner.address,
        operatorIds,
        cluster,
      ),
    ).to.be.revertedWithCustomError(network, Errors.CLUSTER_NOT_LIQUIDATABLE);
  });

  it("Self-liquidation at exact threshold succeeds (owner bypass)", async function () {
    const { network, operatorIds } =
      await networkHelpers.loadFixture(deployFixture);

    const threshold = calcLiquidationThreshold({
      minimumBlocksBeforeLiquidation: MIN_BLOCKS_BEFORE_LIQ,
      numOperators: 4n,
      ethFee: OP_ETH_FEE_RAW,
      networkFee: DEFAULT_NETWORK_FEE_RAW,
      effectiveVUnits: defaultVUnits(1n),
    });

    const burnPerBlock = calcClusterBurn({
      blockDiff: 1n,
      numOperators: 4n,
      ethFee: OP_ETH_FEE_RAW,
      networkFee: DEFAULT_NETWORK_FEE_RAW,
      effectiveVUnits: defaultVUnits(1n),
    });
    const deposit = threshold + burnPerBlock;

    await network.connect(clusterOwner).registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: deposit },
    );

    const cluster = await getCurrentClusterState(
      connection,
      network as any,
      clusterOwner.address,
      operatorIds,
    );

    const tx = await network.connect(clusterOwner).liquidate(
      clusterOwner.address,
      operatorIds,
      cluster,
    );
    await tx.wait();

    await expect(tx).to.emit(network, Events.CLUSTER_LIQUIDATED);
  });

  it("Third-party liquidation at threshold - 1 wei succeeds", async function () {
    const { network, operatorIds } =
      await networkHelpers.loadFixture(deployFixture);

    const threshold = calcLiquidationThreshold({
      minimumBlocksBeforeLiquidation: MIN_BLOCKS_BEFORE_LIQ,
      numOperators: 4n,
      ethFee: OP_ETH_FEE_RAW,
      networkFee: DEFAULT_NETWORK_FEE_RAW,
      effectiveVUnits: defaultVUnits(1n),
    });

    await network.connect(clusterOwner).registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: threshold },
    );

    const cluster = await getCurrentClusterState(
      connection,
      network as any,
      clusterOwner.address,
      operatorIds,
    );

    await mineBlocks(connection.ethers.provider, 1);

    const tx = await network.connect(thirdParty).liquidate(
      clusterOwner.address,
      operatorIds,
      cluster,
    );
    await tx.wait();

    await expect(tx).to.emit(network, Events.CLUSTER_LIQUIDATED);
  });
});

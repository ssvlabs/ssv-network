import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makePublicKey } from "../../common/helpers.ts";
import { EMPTY_CLUSTER } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";

type ClusterType = typeof EMPTY_CLUSTER;

const createSSVCluster = (overrides: Partial<ClusterType> = {}): ClusterType => ({
  ...EMPTY_CLUSTER,
  validatorCount: 1n,
  active: true,
  balance: 10_000_000_000_000_000_000n,
  ...overrides,
});

describe("SSVClusters function `liquidateSSV()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;
  let otherAccount: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [clusterOwner, otherAccount] = await connection.ethers.getSigners();
  });

  const deploySSVClustersFixture = async () => {
    const fixture = await ssvClustersHarnessFixture(connection);
    
    const mockToken = await connection.ethers.deployContract("MockToken", []);
    await mockToken.waitForDeployment();
    
    const { clusters } = fixture;
    
    const tokenAddress = await mockToken.getAddress();
    const harnessAddress = await clusters.getAddress();
    
    await mockToken.mint(harnessAddress, connection.ethers.parseEther("1000"));
    await clusters.mockSetToken(tokenAddress);
    
    return { ...fixture, mockToken };
  };

  it("Allows the cluster owner to liquidate SSV cluster and emits correct event", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersFixture);

    const publicKey = makePublicKey(1);
    const cluster = createSSVCluster();

    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, cluster);

    const liquidateTx = await clusters.liquidateSSV(clusterOwner.address, operatorIds, cluster);

    await expect(liquidateTx).to.emit(clusters, Events.CLUSTER_LIQUIDATED);
  });

  it("Allows a third party to liquidate SSV cluster when liquidatable", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersFixture);

    const publicKey = makePublicKey(1);
    const cluster = createSSVCluster({ balance: 1n });

    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, cluster);
    await clusters.mockMinimumLiquidationCollateralSSV(1000n);

    const liquidateTx = await clusters.connect(otherAccount).liquidateSSV(
      clusterOwner.address,
      operatorIds,
      cluster
    );

    await expect(liquidateTx).to.emit(clusters, Events.CLUSTER_LIQUIDATED);
  });

  it("Is reverted with 'ClusterNotLiquidatable' when a third party tries to liquidate a healthy SSV cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersFixture);

    const publicKey = makePublicKey(1);
    const cluster = createSSVCluster();

    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, cluster);

    await expect(clusters.connect(otherAccount).liquidateSSV(
      clusterOwner.address,
      operatorIds,
      cluster
    )).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_NOT_LIQUIDATABLE);
  });

  it("Is reverted with 'ClusterIsLiquidated' when liquidating an already liquidated SSV cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersFixture);

    const publicKey = makePublicKey(1);
    const cluster = createSSVCluster();

    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, cluster);

    await clusters.liquidateSSV(clusterOwner.address, operatorIds, cluster);

    const liquidatedCluster = { ...cluster, active: false, balance: 0n, index: 0n, networkFeeIndex: 0n };

    await expect(clusters.liquidateSSV(
      clusterOwner.address,
      operatorIds,
      liquidatedCluster
    )).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_IS_LIQUIDATED);
  });

  it("Is reverted with 'IncorrectClusterState' when provided cluster data is stale or mismatched", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersFixture);

    const publicKey = makePublicKey(1);
    const cluster = createSSVCluster();

    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, cluster);

    const mismatchedCluster = { ...cluster, balance: cluster.balance + 1n };

    await expect(clusters.liquidateSSV(
      clusterOwner.address,
      operatorIds,
      mismatchedCluster
    )).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_STATE);
  });

  it("Is reverted with 'ClusterDoesNotExists' when attempting to liquidate a missing SSV cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersFixture);

    await expect(clusters.liquidateSSV(
      clusterOwner.address,
      operatorIds,
      createSSVCluster()
    )).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_DOES_NOT_EXISTS);
  });
});


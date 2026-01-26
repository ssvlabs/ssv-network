import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { getClustersHarnessFixture, ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { createCluster, makePublicKey } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, EMPTY_CLUSTER, VUNITS_PRECISION } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";
import { ethers } from "ethers";

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
  let deployClustersWith7Operators!: ReturnType<typeof getClustersHarnessFixture>;
  let deployClustersWith10Operators!: ReturnType<typeof getClustersHarnessFixture>;
  let deployClustersWith13Operators!: ReturnType<typeof getClustersHarnessFixture>;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [clusterOwner, otherAccount] = await connection.ethers.getSigners();

    deployClustersWith7Operators = getClustersHarnessFixture(connection, 7);
    deployClustersWith10Operators = getClustersHarnessFixture(connection, 10);
    deployClustersWith13Operators = getClustersHarnessFixture(connection, 13);
  });

  const setupSSVClustersFixture = async (fixture: { clusters: any, operatorIds: bigint[] }) => {
    
    const mockToken = await connection.ethers.deployContract("MockToken", []);
    await mockToken.waitForDeployment();
    
    const { clusters } = fixture;
    
    const tokenAddress = await mockToken.getAddress();
    const harnessAddress = await clusters.getAddress();
    
    await mockToken.mint(harnessAddress, connection.ethers.parseEther("1000"));
    await clusters.mockSetToken(tokenAddress);

    await networkHelpers.setBalance(harnessAddress, connection.ethers.parseEther("1000"));
    
    return { ...fixture, mockToken };
  };

  const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
    return ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds])
    );
  };

  const deploySSVClustersFixture = async () => {
    const fixture = await ssvClustersHarnessFixture(connection);
    return setupSSVClustersFixture(fixture);
  };

  const deploySSVClustersWith7OperatorsFixture = async () => {
    const fixture = await deployClustersWith7Operators();
    return setupSSVClustersFixture(fixture);
  };

  const deploySSVClustersWith10OperatorsFixture = async () => {
    const fixture = await deployClustersWith10Operators();
    return setupSSVClustersFixture(fixture);
  };

  const deploySSVClustersWith13OperatorsFixture = async () => {
    const fixture = await deployClustersWith13Operators();
    return setupSSVClustersFixture(fixture);
  };

  const createSSVClusterWithTokenBalance = (balance: bigint, overrides: Partial<ClusterType> = {}): ClusterType => ({
    ...EMPTY_CLUSTER,
    validatorCount: 1n,
    active: true,
    balance,
    ...overrides,
  });

  it("Allows the cluster owner to liquidate SSV cluster and emits correct event", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersFixture);

    const publicKey = makePublicKey(1);
    const cluster = createSSVCluster({ networkFeeIndex: 1000n });

    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, cluster);
    await clusters.mockCurrentNetworkFeeIndex(100n);
    await clusters.mockCurrentNetworkFeeIndexSSV(2000n);

    const liquidateTx = await clusters.liquidateSSV(clusterOwner.address, operatorIds, cluster);
    const receipt = await liquidateTx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.LIQUIDATE_CLUSTER_SSV_4]);

    await expect(liquidateTx).to.emit(clusters, Events.CLUSTER_LIQUIDATED);
  });

  it("Transfers remaining SSV token balance in the cluster to the liquidator", async function () {
    const { clusters, operatorIds, mockToken } =
      await networkHelpers.loadFixture(deploySSVClustersFixture);

    const publicKey = makePublicKey(1);
    const clusterBalance = connection.ethers.parseEther("1");
    const currentNetworkFeeIndexSSV = 2000n;
    const cluster = createSSVClusterWithTokenBalance(clusterBalance, { networkFeeIndex: currentNetworkFeeIndexSSV });

    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, cluster);
    await clusters.mockCurrentNetworkFeeIndex(100n);
    await clusters.mockCurrentNetworkFeeIndexSSV(currentNetworkFeeIndexSSV);

    const minCollateral = clusterBalance / 10_000_000n + 1n;
    await clusters.mockMinimumLiquidationCollateralSSV(minCollateral);

    const liquidatorBalanceBefore = await mockToken.balanceOf(otherAccount.address);
    const harnessBalanceBefore = await mockToken.balanceOf(await clusters.getAddress());
    expect(harnessBalanceBefore).to.be.greaterThanOrEqual(clusterBalance);

    await clusters.connect(otherAccount).liquidateSSV(clusterOwner.address, operatorIds, cluster);

    const liquidatorBalanceAfter = await mockToken.balanceOf(otherAccount.address);
    const harnessBalanceAfter = await mockToken.balanceOf(await clusters.getAddress());

    expect(liquidatorBalanceAfter - liquidatorBalanceBefore).to.equal(clusterBalance);
    expect(harnessBalanceBefore - harnessBalanceAfter).to.equal(clusterBalance);
  });

  it("Does not change operatorEthVUnits or stored cluster EB snapshot when liquidating an SSV cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersFixture);

    // Seed operatorEthVUnits via an ETH registration on a DIFFERENT cluster id (different owner).
    await clusters.connect(otherAccount).registerValidator(
      makePublicKey(999),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    await clusters.mockSetClusterVUnits(clusterId, 7n * VUNITS_PRECISION);

    const beforeClusterVUnits = await clusters.getClusterVUnits(clusterId);
    const beforeOperatorVUnits = await Promise.all(operatorIds.map((id) => clusters.getOperatorEthVUnits(id)));

    const publicKey = makePublicKey(1);
    const cluster = createSSVCluster({ networkFeeIndex: 1000n });

    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, cluster);
    await clusters.mockCurrentNetworkFeeIndex(100n);
    await clusters.mockCurrentNetworkFeeIndexSSV(2000n);

    await clusters.liquidateSSV(clusterOwner.address, operatorIds, cluster);

    const afterClusterVUnits = await clusters.getClusterVUnits(clusterId);
    const afterOperatorVUnits = await Promise.all(operatorIds.map((id) => clusters.getOperatorEthVUnits(id)));

    expect(afterClusterVUnits).to.equal(beforeClusterVUnits);
    expect(afterOperatorVUnits).to.deep.equal(beforeOperatorVUnits);
  });

  it("Allows the cluster owner to liquidate SSV cluster with 7 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersWith7OperatorsFixture);

    const publicKey = makePublicKey(1);
    const cluster = createSSVCluster({ networkFeeIndex: 1000n });

    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, cluster);
    await clusters.mockCurrentNetworkFeeIndex(100n);
    await clusters.mockCurrentNetworkFeeIndexSSV(2000n);

    const liquidateTx = await clusters.liquidateSSV(clusterOwner.address, operatorIds, cluster);
    const receipt = await liquidateTx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.LIQUIDATE_CLUSTER_SSV_7]);

    await expect(liquidateTx).to.emit(clusters, Events.CLUSTER_LIQUIDATED);
  });

  it("Allows the cluster owner to liquidate SSV cluster with 10 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersWith10OperatorsFixture);

    const publicKey = makePublicKey(1);
    const cluster = createSSVCluster({ networkFeeIndex: 1000n });

    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, cluster);
    await clusters.mockCurrentNetworkFeeIndex(100n);
    await clusters.mockCurrentNetworkFeeIndexSSV(2000n);

    const liquidateTx = await clusters.liquidateSSV(clusterOwner.address, operatorIds, cluster);
    const receipt = await liquidateTx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.LIQUIDATE_CLUSTER_SSV_10]);

    await expect(liquidateTx).to.emit(clusters, Events.CLUSTER_LIQUIDATED);
  });

  it("Allows the cluster owner to liquidate SSV cluster with 13 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersWith13OperatorsFixture);

    const publicKey = makePublicKey(1);
    const cluster = createSSVCluster({ networkFeeIndex: 1000n });

    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, cluster);
    await clusters.mockCurrentNetworkFeeIndex(100n);
    await clusters.mockCurrentNetworkFeeIndexSSV(2000n);

    const liquidateTx = await clusters.liquidateSSV(clusterOwner.address, operatorIds, cluster);
    const receipt = await liquidateTx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.LIQUIDATE_CLUSTER_SSV_13]);

    await expect(liquidateTx).to.emit(clusters, Events.CLUSTER_LIQUIDATED);
  });

  it("Allows a third party to liquidate SSV cluster when liquidatable", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersFixture);

    const publicKey = makePublicKey(1);
    const cluster = createSSVCluster({ networkFeeIndex: 500000n, balance: 1n });

    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, cluster);
    await clusters.mockCurrentNetworkFeeIndex(1000n);
    await clusters.mockCurrentNetworkFeeIndexSSV(600000n);
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

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ethers } from "ethers";

import { getTestConnection } from "../../setup/connection.ts";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Errors } from "../../common/errors.ts";
import {
  CLUSTER_VERSION_ETH,
  CLUSTER_VERSION_SSV,
  DEDUCTED_DIGITS,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  ETH_DEDUCTED_DIGITS,
  EMPTY_CLUSTER,
} from "../../common/constants.ts";
import {
  generateMerkleForClusterEB,
  getCurrentClusterState,
  makePublicKey,
  parseClusterFromEvent,
  registerOperators,
  whitelistAddresses,
} from "../../common/helpers.ts";
import { Events } from "../../common/events.ts";

describe("SSVViews dedicated coverage", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [operatorOwner, clusterOwner] = await connection.ethers.getSigners();
  });

  const deployFullSSVNetworkFixture = async () => ssvNetworkFullFixture(connection);

  const registerEthCluster = async (network: any) => {
    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    await network.connect(clusterOwner).registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    const cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
    return { operatorIds, cluster };
  };

  const configureOracles = async (network: any) => {
    const oracles = (await connection.ethers.getSigners()).slice(10, 14);

    await network.replaceOracle(1, oracles[0].address);
    await network.replaceOracle(2, oracles[1].address);
    await network.replaceOracle(3, oracles[2].address);
    await network.replaceOracle(4, oracles[3].address);

    return oracles;
  };

  const deployViewsHarnessFixture = async () => {
    const mockCSSV = await connection.ethers.deployContract("MockCSSV");
    await mockCSSV.waitForDeployment();

    const viewsHarness = await connection.ethers.deployContract("SSVViewsHarness", [await mockCSSV.getAddress()]);
    await viewsHarness.waitForDeployment();

    return { viewsHarness };
  };

  it("getBalance and getEffectiveBalance return expected values for active ETH cluster", async function () {
    const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
    const { operatorIds, cluster } = await registerEthCluster(network);

    expect(await views.getBalance(clusterOwner.address, operatorIds, cluster)).to.equal(cluster.balance);
    expect(await views.getEffectiveBalance(clusterOwner.address, operatorIds, cluster)).to.equal(32);

    await connection.networkHelpers.mine(12);
    const balanceAfterBlocks = await views.getBalance(clusterOwner.address, operatorIds, cluster);
    expect(balanceAfterBlocks).to.be.lessThan(cluster.balance);
    expect(await views.getEffectiveBalance(clusterOwner.address, operatorIds, cluster)).to.equal(32);
  });

  it("liquidated clusters are reported as liquidated and balance/EB getters revert", async function () {
    const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
    const { operatorIds, cluster } = await registerEthCluster(network);

    await network.connect(clusterOwner).liquidate(clusterOwner.address, operatorIds, cluster);
    const liquidatedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

    expect(await views.isLiquidated(clusterOwner.address, operatorIds, liquidatedCluster)).to.equal(true);
    await expect(
      views.getBalance(clusterOwner.address, operatorIds, liquidatedCluster)
    ).to.be.revertedWithCustomError(network, Errors.CLUSTER_IS_LIQUIDATED);
    await expect(
      views.getEffectiveBalance(clusterOwner.address, operatorIds, liquidatedCluster)
    ).to.be.revertedWithCustomError(network, Errors.CLUSTER_IS_LIQUIDATED);
  });

  it("isLiquidatable respects exact minimum-collateral boundary", async function () {
    const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
    const { operatorIds, cluster } = await registerEthCluster(network);

    const currentBalance = await views.getBalance(clusterOwner.address, operatorIds, cluster);
    const currentBurnRate = await views.getBurnRate(clusterOwner.address, operatorIds, cluster);
    const rawBoundary = currentBalance > currentBurnRate ? currentBalance - currentBurnRate : 0n;
    const boundaryCollateral = (rawBoundary / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS;

    await network.updateMinimumLiquidationCollateral(boundaryCollateral);
    expect(await views.isLiquidatable(clusterOwner.address, operatorIds, cluster)).to.equal(false);

    await network.updateMinimumLiquidationCollateral(boundaryCollateral + ETH_DEDUCTED_DIGITS);
    expect(await views.isLiquidatable(clusterOwner.address, operatorIds, cluster)).to.equal(true);
  });

  it("getBurnRate scales with EB vUnits (64 ETH == 2x of implicit 32 ETH)", async function () {
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
    const { operatorIds, cluster } = await registerEthCluster(network);

    // commitRoot requires non-zero oracle weight, which exists once there is non-zero stake.
    const stakeAmount = ethers.parseEther("10");
    await ssvToken.mint(clusterOwner.address, stakeAmount);
    await ssvToken.connect(clusterOwner).approve(await network.getAddress(), ethers.MaxUint256);
    await network.connect(clusterOwner).stake(stakeAmount);

    const baseBurnRate = await views.getBurnRate(clusterOwner.address, operatorIds, cluster);
    const oracles = await configureOracles(network);

    const clusterId = ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [clusterOwner.address, operatorIds])
    );
    const merkleData = generateMerkleForClusterEB(connection, [{ clusterId, effectiveBalance: 64 }]);
    const currentBlock = await connection.ethers.provider.getBlockNumber();

    for (let i = 0; i < 3; i += 1) {
      await network.connect(oracles[i]).commitRoot(merkleData.root, currentBlock);
    }

    const tx = await network.updateClusterBalance(
      currentBlock,
      clusterOwner.address,
      operatorIds,
      cluster,
      64,
      merkleData.proofs[clusterId]
    );
    const receipt = await tx.wait();

    const updatedCluster = parseClusterFromEvent(network, receipt, Events.CLUSTER_BALANCE_UPDATED);
    const burnRateAfterEbUpdate = await views.getBurnRate(clusterOwner.address, operatorIds, updatedCluster);
    expect(burnRateAfterEbUpdate).to.equal(baseBurnRate * 2n);
  });

  it("getOperatorEarnings exposes ETH earnings while SSV earnings stay zero in ETH-only state", async function () {
    const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
    const { operatorIds } = await registerEthCluster(network);

    await connection.networkHelpers.mine(100);
    expect(await views.getOperatorEarnings(operatorIds[0])).to.be.greaterThan(0n);
    expect(await views.getOperatorEarningsSSV(operatorIds[0])).to.equal(0n);
  });

  it("ETH-only (post-migration-equivalent) views return ETH values and zero SSV values", async function () {
    const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
    const { operatorIds, cluster } = await registerEthCluster(network);

    expect(await views.getClusterAssetType(clusterOwner.address, operatorIds)).to.equal(CLUSTER_VERSION_ETH);
    expect(await views.getBalance(clusterOwner.address, operatorIds, cluster)).to.equal(cluster.balance);
    expect(await views.getBurnRate(clusterOwner.address, operatorIds, cluster)).to.be.greaterThan(0n);

    expect(await views.getBalanceSSV(clusterOwner.address, operatorIds, cluster)).to.equal(0n);
    expect(await views.getBurnRateSSV(clusterOwner.address, operatorIds, cluster)).to.equal(0n);
  });

  it("getOperatorEarnings returns both ETH and SSV earnings when both snapshots are funded", async function () {
    const { viewsHarness } = await networkHelpers.loadFixture(deployViewsHarnessFixture);

    const operatorId = 1n;
    const ethEarnings = 73n * ETH_DEDUCTED_DIGITS;
    const ssvEarnings = 19n * DEDUCTED_DIGITS;

    await viewsHarness.mockSetOperator(operatorId, operatorOwner.address, 0n, 0n, 1, 1);
    await viewsHarness.mockSetOperatorEarnings(operatorId, ethEarnings, ssvEarnings);

    expect(await viewsHarness.getOperatorEarnings(operatorId)).to.equal(ethEarnings);
    expect(await viewsHarness.getOperatorEarningsSSV(operatorId)).to.equal(ssvEarnings);
  });

  it("SSV-only clusters return positive SSV balance/burn rate while ETH getters return zero", async function () {
    const { viewsHarness } = await networkHelpers.loadFixture(deployViewsHarnessFixture);

    const operatorIds = [1n, 2n, 3n, 4n];
    const ssvFeePerOperator = DEDUCTED_DIGITS;
    const ssvNetworkFee = DEDUCTED_DIGITS;
    const ssvCluster = {
      validatorCount: 1n,
      networkFeeIndex: 0n,
      index: 0n,
      active: true,
      balance: 100n * DEDUCTED_DIGITS,
    };

    for (const operatorId of operatorIds) {
      await viewsHarness.mockSetOperator(operatorId, operatorOwner.address, 0n, ssvFeePerOperator, 0, 1);
    }
    await viewsHarness.mockSetNetworkFeeSSV(ssvNetworkFee);
    await viewsHarness.mockRegisterSSVCluster(clusterOwner.address, operatorIds, ssvCluster);

    expect(await viewsHarness.getClusterAssetType(clusterOwner.address, operatorIds)).to.equal(CLUSTER_VERSION_SSV);
    const ssvBalance = await viewsHarness.getBalanceSSV(clusterOwner.address, operatorIds, ssvCluster);
    expect(ssvBalance).to.be.greaterThan(0n);
    expect(ssvBalance).to.be.lessThan(ssvCluster.balance);
    expect(await viewsHarness.getBurnRateSSV(clusterOwner.address, operatorIds, ssvCluster)).to.equal(
      5n * DEDUCTED_DIGITS
    );

    expect(await viewsHarness.getBalance(clusterOwner.address, operatorIds, ssvCluster)).to.equal(0n);
    expect(await viewsHarness.getBurnRate(clusterOwner.address, operatorIds, ssvCluster)).to.equal(0n);
  });
});

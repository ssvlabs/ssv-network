import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture, ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  makePublicKey,
  registerOperators,
  whitelistAddresses,
  getCurrentClusterState,
  parseClusterFromEvent,
} from "../../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
  NETWORK_FEE,
  NETWORK_FEE_ETH,
  ETH_DEDUCTED_DIGITS,
} from "../../common/constants.ts";
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";
import {
  mineBlocks,
  calcClusterBurn,
  defaultVUnits,
  calcLiquidationThreshold,
} from "../helpers/index.ts";
import { ethers } from "ethers";

describe("ETH Cluster Edge Cases", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;
  let anotherOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner, anotherOwner] = await connection.ethers.getSigners();
  });

  const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
    return ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds]),
    );
  };

  describe("Withdraw From Empty Cluster (validatorCount == 0)", () => {
    const deployFixture = async () => {
      return ssvNetworkFullFixture(connection);
    };

    it("Allows full withdrawal from cluster with 0 validators, skipping liquidation check", async function () {
      const { network, views } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, clusterOwner, 4);
      await whitelistAddresses(network, clusterOwner, operatorIds, [clusterOwner.address]);

      const depositAmount = ethers.parseEther("5");
      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: depositAmount },
      );
      const regReceipt = await regTx.wait();
      const regBlock = regReceipt!.blockNumber;
      let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

      await mineBlocks(provider, 10);

      const removeTx = await network.connect(clusterOwner).removeValidator(
        makePublicKey(1),
        operatorIds,
        cluster,
      );
      const removeReceipt = await removeTx.wait();
      const removeBlock = removeReceipt!.blockNumber;
      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

      const ethFeePacked = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
      const networkFeePacked = NETWORK_FEE / ETH_DEDUCTED_DIGITS;
      const blockDiff = BigInt(removeBlock - regBlock);
      const feesDeducted = calcClusterBurn({
        blockDiff,
        numOperators: 4n,
        ethFee: ethFeePacked,
        networkFee: networkFeePacked,
        effectiveVUnits: defaultVUnits(1n),
      });
      const expectedBalance = depositAmount - feesDeducted;

      expect(BigInt(cluster.validatorCount)).to.equal(0n);
      expect(cluster.active).to.equal(true);
      expect(BigInt(cluster.balance)).to.equal(expectedBalance);

      const remainingBalance = BigInt(cluster.balance);
      const tx = await network.connect(clusterOwner).withdraw(
        operatorIds,
        remainingBalance,
        cluster,
      );
      await tx.wait();

      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(BigInt(cluster.balance)).to.equal(0n);
      expect(cluster.active).to.equal(true);
      expect(BigInt(cluster.validatorCount)).to.equal(0n);
    });
  });

  describe("Reactivation With Explicit EB — Deviation Properly Restored", () => {
    const deployFixture = async () => {
      const result = await ssvClustersHarnessFixture(connection, 4, MINIMAL_OPERATOR_ETH_FEE);
      const { clusters, operatorIds } = result;

      await clusters.mockEthNetworkFee(BigInt(NETWORK_FEE_ETH));
      await clusters.mockMinimumBlocksBeforeLiquidation(100n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      return { clusters, operatorIds };
    };

    it("Restores EB deviation to operators and DAO on reactivation", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      await clusters.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const cluster = await getCurrentClusterState(connection, clusters as any, clusterOwner.address, operatorIds);

      const clusterId = getClusterId(clusterOwner.address, operatorIds);

      await clusters.mockSetClusterVUnits(clusterId, 20_000n);

      for (const opId of operatorIds) {
        await clusters.mockSetOperatorEthVUnits(opId, 20_000n);
      }
      await clusters.mockSetDaoTotalEthVUnits(20_000n);

      await clusters.connect(clusterOwner).liquidate(
        clusterOwner.address,
        operatorIds,
        cluster,
      );

      const liquidatedCluster = await getCurrentClusterState(
        connection,
        clusters as any,
        clusterOwner.address,
        operatorIds,
      );
      expect(liquidatedCluster.active).to.equal(false);

      await mineBlocks(provider, 10);

      const reactivateAmount = ethers.parseEther("10");
      const tx = await clusters.connect(clusterOwner).reactivate(
        operatorIds,
        liquidatedCluster,
        { value: reactivateAmount },
      );
      await tx.wait();

      await expect(tx).to.emit(clusters, Events.CLUSTER_REACTIVATED);

      const clusterVUnits = await clusters.getClusterVUnits(clusterId);
      expect(clusterVUnits).to.equal(20_000n);
    });
  });

  describe("Withdraw — Operator Snapshots NOT Updated", () => {
    const deployFixture = async () => {
      const result = await ssvClustersHarnessFixture(connection, 4, MINIMAL_OPERATOR_ETH_FEE);
      const { clusters, operatorIds } = result;

      await clusters.mockEthNetworkFee(BigInt(NETWORK_FEE_ETH));
      await clusters.mockMinimumBlocksBeforeLiquidation(100n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      return { clusters, operatorIds };
    };

    it("Correctly computes fees over two withdrawals without updating operator snapshots", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const depositAmount = ethers.parseEther("10");
      const regTx = await clusters.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: depositAmount },
      );
      const regReceipt = await regTx.wait();
      const regBlock = regReceipt!.blockNumber;

      const regCluster = await getCurrentClusterState(
        connection,
        clusters as any,
        clusterOwner.address,
        operatorIds,
      );

      const opSnapshotsBefore: { index: bigint; block: bigint; balance: bigint }[] = [];
      for (const opId of operatorIds) {
        const [index, blockNumber, balance] = await clusters.getOperatorEthSnapshot(opId);
        opSnapshotsBefore.push({ index, block: BigInt(blockNumber), balance });
      }

      await mineBlocks(provider, 100);

      const withdrawTx1 = await clusters.connect(clusterOwner).withdraw(
        operatorIds,
        ethers.parseEther("1"),
        regCluster,
      );
      const receipt1 = await withdrawTx1.wait();

      const cluster1 = parseClusterFromEvent(clusters, receipt1, Events.CLUSTER_WITHDRAWN);

      for (let i = 0; i < operatorIds.length; i++) {
        const [index, blockNumber, balance] = await clusters.getOperatorEthSnapshot(operatorIds[i]);
        expect(index).to.equal(opSnapshotsBefore[i].index);
        expect(BigInt(blockNumber)).to.equal(opSnapshotsBefore[i].block);
        expect(balance).to.equal(opSnapshotsBefore[i].balance);
      }

      await mineBlocks(provider, 100);

      await clusters.connect(clusterOwner).withdraw(
        operatorIds,
        ethers.parseEther("1"),
        cluster1,
      );

      for (let i = 0; i < operatorIds.length; i++) {
        const [index, blockNumber, balance] = await clusters.getOperatorEthSnapshot(operatorIds[i]);
        expect(index).to.equal(opSnapshotsBefore[i].index);
      }
    });
  });

  describe("Packing Precision — ETH Values That Aren't Divisible By 100_000", () => {
    const deployFixture = async () => {
      return ssvNetworkFullFixture(connection);
    };

    it("Reverts when setting operator ETH fee not divisible by ETH_DEDUCTED_DIGITS", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, clusterOwner, 1);

      await expect(
        network.connect(clusterOwner).declareOperatorFee(BigInt(operatorIds[0]), MINIMAL_OPERATOR_ETH_FEE + 1n),
      ).to.be.revertedWithCustomError(network, Errors.MAX_PRECISION_EXCEEDED);

      await expect(
        network.connect(clusterOwner).declareOperatorFee(BigInt(operatorIds[0]), MINIMAL_OPERATOR_ETH_FEE + 50_000n),
      ).to.be.revertedWithCustomError(network, Errors.MAX_PRECISION_EXCEEDED);
    });

    it("Accepts operator ETH fee divisible by ETH_DEDUCTED_DIGITS", async function () {
      const { network, views } = await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, clusterOwner, 1);
      const validHigherFee = MINIMAL_OPERATOR_ETH_FEE + ETH_DEDUCTED_DIGITS;
      await network.connect(clusterOwner).declareOperatorFee(
        BigInt(operatorIds[0]),
        validHigherFee,
      );
      const { fee } = await views.getOperatorDeclaredFee(operatorIds[0]);
      expect(fee).to.be.equal(validHigherFee);
    });

    it("Allows deposit/withdraw of amounts not divisible by ETH_DEDUCTED_DIGITS", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, clusterOwner, 4);
      await whitelistAddresses(network, clusterOwner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );

      const oddAmount = 99_999n;
      await network.connect(clusterOwner).deposit(
        clusterOwner.address,
        operatorIds,
        cluster,
        { value: oddAmount },
      );
      cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );

      await network.connect(clusterOwner).withdraw(operatorIds, oddAmount, cluster);
    });
  });

  describe("Liquidation Bounty Exactly Equals Post-Settlement Balance", () => {
    const deployFixture = async () => {
      const result = await ssvClustersHarnessFixture(connection, 4, MINIMAL_OPERATOR_ETH_FEE);
      const { clusters, operatorIds } = result;

      await clusters.mockEthNetworkFee(BigInt(NETWORK_FEE_ETH));
      await clusters.mockMinimumBlocksBeforeLiquidation(10n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      return { clusters, operatorIds };
    };

    it("Bounty equals post-settlement balance, not original balance", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const ethFeePacked = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
      const networkFeePacked = BigInt(NETWORK_FEE_ETH);
      const threshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: 10n,
        numOperators: 4n,
        ethFee: ethFeePacked,
        networkFee: networkFeePacked,
        effectiveVUnits: defaultVUnits(1n),
      });

      await clusters.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: threshold },
      );

      const regCluster = await getCurrentClusterState(
        connection,
        clusters as any,
        clusterOwner.address,
        operatorIds,
      );

      await mineBlocks(provider, 20);

      const liquidatorBalanceBefore = await provider.getBalance(anotherOwner.address);

      const liqTx = await clusters.connect(anotherOwner).liquidate(
        clusterOwner.address,
        operatorIds,
        regCluster,
      );
      const liqReceipt = await liqTx.wait();
      const gasUsed = BigInt(liqReceipt!.gasUsed) * BigInt(liqReceipt!.gasPrice);

      const liquidatorBalanceAfter = await provider.getBalance(anotherOwner.address);
      const bounty = liquidatorBalanceAfter - liquidatorBalanceBefore + gasUsed;

      const liquidatedCluster = parseClusterFromEvent(
        clusters,
        liqReceipt,
        Events.CLUSTER_LIQUIDATED,
      );

      expect(BigInt(liquidatedCluster.balance)).to.equal(0n);
      expect(liquidatedCluster.active).to.equal(false);

      const burn = calcClusterBurn({
        blockDiff: 21n,
        numOperators: 4n,
        ethFee: ethFeePacked,
        networkFee: networkFeePacked,
        effectiveVUnits: defaultVUnits(1n),
      });
      const expectedBounty = burn >= threshold ? 0n : threshold - burn;
      expect(bounty).to.equal(expectedBounty);
    });
  });
});

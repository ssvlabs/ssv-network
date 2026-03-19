import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext, computeClusterId, computeEBRoot, createCluster, makePublicKey, parseClusterFromEvent, registerAndParseCluster } from "../../common/helpers.ts";
import { DEFAULT_SHARES, BPS_DENOMINATOR, ETH_DEDUCTED_DIGITS } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { ethers } from "ethers";
const OPERATOR_FEE = 10_000_000_000n;

describe("EB-aware fee settlement on registration and removal", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner] } = await setupTestContext());
  });

  const deployClustersWithFee = async () => {
    return ssvClustersHarnessFixture(connection, 4, OPERATOR_FEE);
  };



  it("Registration settles fees using EB-weighted vUnits, not flat validatorCount", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);
    const cluster1 = await registerAndParseCluster(clusters, operatorIds, 1, ethers.parseEther("100"));
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const ebBlockNum = 1;
    const effectiveBalance = 1000;
    const root = computeEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(ebBlockNum, root);

    const ebTx = await clusters.updateClusterBalance(
      ebBlockNum,
      clusterOwner.address,
      operatorIds,
      cluster1,
      effectiveBalance,
      []
    );
    const ebReceipt = await ebTx.wait();
    const clusterAfterEB = parseClusterFromEvent(clusters, ebReceipt, Events.CLUSTER_BALANCE_UPDATED);
    const clusterVUnits = await clusters.getClusterVUnits(clusterId);
    const expectedVUnits = ((BigInt(effectiveBalance) * BPS_DENOMINATOR) + 31n) / 32n;
    expect(clusterVUnits).to.equal(expectedVUnits);
    const balanceBeforeMine = clusterAfterEB.balance;
    const blockBeforeMine = await connection.ethers.provider.getBlockNumber();
    await networkHelpers.mine(100);
    const blockAfterMine = await connection.ethers.provider.getBlockNumber();
    const blocksMined = blockAfterMine - blockBeforeMine;
    const regTx2 = await clusters.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      clusterAfterEB,
      { value: 0n }
    );
    const receipt2 = await regTx2.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, receipt2, Events.VALIDATOR_ADDED);
    const balanceAfterReg = clusterAfterReg.balance;
    const feeDeducted = balanceBeforeMine - balanceAfterReg;
    const packedOpFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
    const vUnitsMultiplier = expectedVUnits / BPS_DENOMINATOR;
    const expectedEBFee = 4n * packedOpFee * BigInt(blocksMined + 1) * vUnitsMultiplier * ETH_DEDUCTED_DIGITS;
    const flatUsageExpanded = 4n * packedOpFee * BigInt(blocksMined + 1) * 1n * ETH_DEDUCTED_DIGITS;
    expect(feeDeducted).to.be.gt(0n, "Fee should have been deducted");
    expect(feeDeducted).to.be.approximately(
      expectedEBFee,
      expectedEBFee / 100n,
      "EB-weighted fee settlement should match expected calculation"
    );
    expect(feeDeducted).to.be.gt(
      flatUsageExpanded * 10n,
      "EB-weighted fee settlement should charge significantly more than flat validatorCount"
    );
  });

  it("Removal settles fees using EB-weighted vUnits", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);
    const cluster1 = await registerAndParseCluster(clusters, operatorIds, 1, ethers.parseEther("100"));

    const regTx2 = await clusters.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      cluster1,
      { value: 0n }
    );
    const receipt2 = await regTx2.wait();
    const cluster2 = parseClusterFromEvent(clusters, receipt2, Events.VALIDATOR_ADDED);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const ebBlockNum = 1;
    const effectiveBalance = 500;
    const root = computeEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(ebBlockNum, root);

    const ebTx = await clusters.updateClusterBalance(
      ebBlockNum,
      clusterOwner.address,
      operatorIds,
      cluster2,
      effectiveBalance,
      []
    );
    const ebReceipt = await ebTx.wait();
    const clusterAfterEB = parseClusterFromEvent(clusters, ebReceipt, Events.CLUSTER_BALANCE_UPDATED);

    const clusterVUnits = await clusters.getClusterVUnits(clusterId);
    const expectedVUnits = ((BigInt(effectiveBalance) * BPS_DENOMINATOR) + 31n) / 32n;
    expect(clusterVUnits).to.equal(expectedVUnits);

    const balanceBeforeMine = clusterAfterEB.balance;
    const blockBeforeMine = await connection.ethers.provider.getBlockNumber();
    await networkHelpers.mine(100);
    const blockAfterMine = await connection.ethers.provider.getBlockNumber();
    const blocksMined = blockAfterMine - blockBeforeMine;
    const removeTx = await clusters.removeValidator(
      makePublicKey(1),
      operatorIds,
      clusterAfterEB
    );
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);

    const feeDeducted = balanceBeforeMine - clusterAfterRemove.balance;
    expect(feeDeducted).to.be.gt(0n, "Fee should have been deducted on removal");
    const packedOpFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
    const vUnitsMultiplier = expectedVUnits / BPS_DENOMINATOR;
    const expectedEBFee = 4n * packedOpFee * BigInt(blocksMined + 1) * vUnitsMultiplier * ETH_DEDUCTED_DIGITS;
    const flatUsageExpanded = 4n * packedOpFee * BigInt(blocksMined + 1) * 2n * ETH_DEDUCTED_DIGITS;
    expect(feeDeducted).to.be.approximately(
      expectedEBFee,
      expectedEBFee / 10n,
      "EB-weighted fee settlement on removal should match expected calculation"
    );
    expect(feeDeducted).to.be.gt(
      flatUsageExpanded * 5n,
      "EB-weighted fee settlement on removal should charge more than flat validatorCount"
    );
  });

  describe("Edge Cases for EB Settlement", async () => {
    it("Uses baseline vUnits when EB = 0 (no EB set)", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);
      const cluster1 = await registerAndParseCluster(clusters, operatorIds, 1, ethers.parseEther("100"));

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const clusterVUnits = await clusters.getClusterVUnits(clusterId);
      expect(clusterVUnits).to.equal(0n, "vUnits should be 0 when EB is not set");

      const balanceBeforeMine = cluster1.balance;
      await networkHelpers.mine(50);
      
      const regTx2 = await clusters.registerValidator(
        makePublicKey(2),
        operatorIds,
        DEFAULT_SHARES,
        cluster1,
        { value: 0n }
      );
      const receipt2 = await regTx2.wait();
      const cluster2 = parseClusterFromEvent(clusters, receipt2, Events.VALIDATOR_ADDED);

      const feeDeducted = balanceBeforeMine - cluster2.balance;
      const packedOpFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
      const expectedBaselineFee = 4n * packedOpFee * 51n * 1n * ETH_DEDUCTED_DIGITS;
      
      expect(feeDeducted).to.be.approximately(
        expectedBaselineFee,
        expectedBaselineFee / 10n,
        "Should use baseline vUnits when EB = 0"
      );
    });

    it("Handles EB exactly at baseline (32 ETH)", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);
      const cluster1 = await registerAndParseCluster(clusters, operatorIds, 1, ethers.parseEther("100"));
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const ebBlockNum = 1;
      const effectiveBalance = 32;
      const root = computeEBRoot(clusterId, effectiveBalance);
      await clusters.mockSetEBRoot(ebBlockNum, root);

      const ebTx = await clusters.updateClusterBalance(
        ebBlockNum,
        clusterOwner.address,
        operatorIds,
        cluster1,
        effectiveBalance,
        []
      );
      const ebReceipt = await ebTx.wait();
      const clusterAfterEB = parseClusterFromEvent(clusters, ebReceipt, Events.CLUSTER_BALANCE_UPDATED);
      const clusterVUnits = await clusters.getClusterVUnits(clusterId);
      const expectedVUnits = 1n * BPS_DENOMINATOR;
      expect(clusterVUnits).to.equal(expectedVUnits);

      const balanceBeforeMine = clusterAfterEB.balance;
      await networkHelpers.mine(50);
      
      const regTx2 = await clusters.registerValidator(
        makePublicKey(2),
        operatorIds,
        DEFAULT_SHARES,
        clusterAfterEB,
        { value: 0n }
      );
      const receipt2 = await regTx2.wait();
      const cluster2 = parseClusterFromEvent(clusters, receipt2, Events.VALIDATOR_ADDED);

      const feeDeducted = balanceBeforeMine - cluster2.balance;
      const packedOpFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
      const expectedBaselineFee = 4n * packedOpFee * 51n * 1n * ETH_DEDUCTED_DIGITS;
      
      expect(feeDeducted).to.be.approximately(
        expectedBaselineFee,
        expectedBaselineFee / 100n,
        "EB at baseline should charge same as baseline calculation"
      );
    });

    it("Handles very high EB values (stress test)", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);
      const cluster1 = await registerAndParseCluster(clusters, operatorIds, 1, ethers.parseEther("1000"));
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const ebBlockNum = 1;
      const effectiveBalance = 1000;
      const root = computeEBRoot(clusterId, effectiveBalance);
      await clusters.mockSetEBRoot(ebBlockNum, root);

      const ebTx = await clusters.updateClusterBalance(
        ebBlockNum,
        clusterOwner.address,
        operatorIds,
        cluster1,
        effectiveBalance,
        []
      );
      const ebReceipt = await ebTx.wait();
      const clusterAfterEB = parseClusterFromEvent(clusters, ebReceipt, Events.CLUSTER_BALANCE_UPDATED);
      const clusterVUnits = await clusters.getClusterVUnits(clusterId);
      const expectedVUnits = ((BigInt(effectiveBalance) * BPS_DENOMINATOR) + 31n) / 32n;
      expect(clusterVUnits).to.equal(expectedVUnits);

      const balanceBeforeMine = clusterAfterEB.balance;
      await networkHelpers.mine(10);
      
      const regTx2 = await clusters.registerValidator(
        makePublicKey(2),
        operatorIds,
        DEFAULT_SHARES,
        clusterAfterEB,
        { value: 0n }
      );
      const receipt2 = await regTx2.wait();
      const cluster2 = parseClusterFromEvent(clusters, receipt2, Events.VALIDATOR_ADDED);

      const feeDeducted = balanceBeforeMine - cluster2.balance;
      const packedOpFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
      const vUnitsMultiplier = expectedVUnits / BPS_DENOMINATOR;
      
      expect(feeDeducted).to.be.gt(0n, "High EB should still deduct fees");
      const baselineFee = 4n * packedOpFee * 11n * 1n * ETH_DEDUCTED_DIGITS;
      expect(feeDeducted).to.be.gt(
        baselineFee * 10n,
        "High EB should result in proportionally higher fees"
      );
      expect(feeDeducted).to.be.lt(
        balanceBeforeMine,
        "Fees deducted should not exceed total balance"
      );
    });

    it("Handles zero validator count edge case", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const ebBlockNum = 1;
      const effectiveBalance = 1000;
      const root = computeEBRoot(clusterId, effectiveBalance);
      await clusters.mockSetEBRoot(ebBlockNum, root);
      const emptyCluster = createCluster();
      emptyCluster.validatorCount = 0;
      try {
        const ebTx = await clusters.updateClusterBalance(
          ebBlockNum,
          clusterOwner.address,
          operatorIds,
          emptyCluster,
          effectiveBalance,
          []
        );
        const ebReceipt = await ebTx.wait();
        const clusterVUnits = await clusters.getClusterVUnits(clusterId);
        expect(clusterVUnits).to.equal(0n, "Cluster with 0 validators should have 0 vUnits");
      } catch (error) {
        expect(error.message).to.include("revert", "Should handle 0 validator case gracefully");
      }
    });
  });
});
import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext, computeClusterId, computeEBRoot, createCluster, makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_SHARES, BPS_DENOMINATOR, ETH_DEDUCTED_DIGITS } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { ethers } from "ethers";

const OPERATOR_FEE = 10_000_000_000n;

describe("EB-weighted operator earnings (Consolidated)", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner1: HardhatEthersSigner;
  let clusterOwner2: HardhatEthersSigner;
  let clusterOwner3: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner1, clusterOwner2, clusterOwner3] } = await setupTestContext());
  });

  const deployClustersWithFee = async () => {
    return ssvClustersHarnessFixture(connection, 4, OPERATOR_FEE);
  };

  const deployClustersWithZeroFee = async () => {
    return ssvClustersHarnessFixture(connection, 4, 0n);
  };



  describe("Accumulation", async () => {
    it("operator earns proportionally from two clusters with EB=32 and EB=64", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);
      const packedFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
      const deposit = ethers.parseEther("100");

      const regTx1 = await clusters.connect(clusterOwner1).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(), { value: deposit }
      );
      const receipt1 = await regTx1.wait();
      const cluster1 = parseClusterFromEvent(clusters, receipt1, Events.VALIDATOR_ADDED);

      const regTx2 = await clusters.connect(clusterOwner2).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, createCluster(), { value: deposit }
      );
      const receipt2 = await regTx2.wait();
      const cluster2 = parseClusterFromEvent(clusters, receipt2, Events.VALIDATOR_ADDED);

      const clusterId1 = computeClusterId(clusterOwner1.address, operatorIds);
      const root1 = computeEBRoot(clusterId1, 32);
      await clusters.mockSetEBRoot(1, root1);
      const ebTx1 = await clusters.connect(clusterOwner1).updateClusterBalance(
        1, clusterOwner1.address, operatorIds, cluster1, 32, []
      );
      const ebReceipt1 = await ebTx1.wait();
      const clusterAfterEB1 = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);

      const clusterId2 = computeClusterId(clusterOwner2.address, operatorIds);
      const root2 = computeEBRoot(clusterId2, 64);
      await clusters.mockSetEBRoot(2, root2);
      await clusters.connect(clusterOwner2).updateClusterBalance(
        2, clusterOwner2.address, operatorIds, cluster2, 64, []
      );

      expect(await clusters.getEffectiveOperatorVUnits(operatorIds[0])).to.equal(30000n);

      // EB-097: Verify per-operator operatorEthVUnits (deviation) for all operators after both EB updates
      // Cluster 1: EB=32 → deviation=0, Cluster 2: EB=64 → deviation=+10000, net=10000 per operator
      const expectedDeviation = 10000n;
      for (const operatorId of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(expectedDeviation,
          `Operator ${operatorId} should have operatorEthVUnits == ${expectedDeviation} (net deviation from two clusters)`);
      }
      // EB-097: Verify daoTotalEthVUnits equals sum of effective vUnits from both clusters
      // Cluster 1: vUnits=10000, Cluster 2: vUnits=20000, total=30000
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(30000n,
        "daoTotalEthVUnits should equal sum of all cluster vUnits (10000 + 20000)");

      const [, , balanceBefore] = await clusters.getOperatorEthSnapshot(operatorIds[0]);

      const blockBeforeMine = await connection.ethers.provider.getBlockNumber();
      await networkHelpers.mine(100);
      const blocksMined = (await connection.ethers.provider.getBlockNumber()) - blockBeforeMine;

      await clusters.connect(clusterOwner1).removeValidator(makePublicKey(1), operatorIds, clusterAfterEB1);

      const [, , balanceAfter] = await clusters.getOperatorEthSnapshot(operatorIds[0]);
      const earned = balanceAfter - balanceBefore;

      const blocksDelta = BigInt(blocksMined + 1);
      const expected = packedFee * blocksDelta * 30000n / BPS_DENOMINATOR;
      expect(earned).to.equal(expected);

      const flatBaseline = packedFee * blocksDelta * 20000n / BPS_DENOMINATOR;
    });

    it("earnings split correctly at fee change boundary with EB-weighted vUnits", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);
      const packedFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
      const deposit = ethers.parseEther("100");

      const regTx = await clusters.connect(clusterOwner1).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(), { value: deposit }
      );
      const receipt = await regTx.wait();
      const clusterAfterReg = parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);

      const clusterId = computeClusterId(clusterOwner1.address, operatorIds);
      const root1 = computeEBRoot(clusterId, 64);
      await clusters.mockSetEBRoot(1, root1);
      const ebTx1 = await clusters.connect(clusterOwner1).updateClusterBalance(
        1, clusterOwner1.address, operatorIds, clusterAfterReg, 64, []
      );
      const ebReceipt1 = await ebTx1.wait();
      const clusterAfterEB1 = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);
      expect(await clusters.getEffectiveOperatorVUnits(operatorIds[0])).to.equal(20000n);

      const [, snapshotBlock1, balancePhase1Start] = await clusters.getOperatorEthSnapshot(operatorIds[0]);

      await networkHelpers.mine(50);

      const root2 = computeEBRoot(clusterId, 64);
      await clusters.mockSetEBRoot(2, root2);
      const ebTx2 = await clusters.connect(clusterOwner1).updateClusterBalance(
        2, clusterOwner1.address, operatorIds, clusterAfterEB1, 64, []
      );
      const ebReceipt2 = await ebTx2.wait();
      const clusterAfterEB2 = parseClusterFromEvent(clusters, ebReceipt2, Events.CLUSTER_BALANCE_UPDATED);

      const [, snapshotBlock2, balancePhase1End] = await clusters.getOperatorEthSnapshot(operatorIds[0]);

      const phase1Blocks = BigInt(snapshotBlock2) - BigInt(snapshotBlock1);
      const expectedPhase1Delta = packedFee * phase1Blocks * 20000n / BPS_DENOMINATOR;
      expect(balancePhase1End - balancePhase1Start).to.equal(expectedPhase1Delta);

      const NEW_OPERATOR_FEE = 5_000_000_000n;
      const newPackedFee = NEW_OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
      await clusters.mockSetOperatorFee(operatorIds[0], NEW_OPERATOR_FEE);

      await networkHelpers.mine(50);

      const root3 = computeEBRoot(clusterId, 64);
      await clusters.mockSetEBRoot(3, root3);
      await clusters.connect(clusterOwner1).updateClusterBalance(
        3, clusterOwner1.address, operatorIds, clusterAfterEB2, 64, []
      );

      const settledBlock3 = await connection.ethers.provider.getBlockNumber();
      const [, , balancePhase2End] = await clusters.getOperatorEthSnapshot(operatorIds[0]);

      const phase2Blocks = BigInt(settledBlock3) - BigInt(snapshotBlock2);
      const expectedPhase2Delta = newPackedFee * phase2Blocks * 20000n / BPS_DENOMINATOR;
      expect(balancePhase2End - balancePhase1End).to.equal(expectedPhase2Delta);

      // OE-023: Verify total earnings = sum of both segments (fee1 segment + fee2 segment)
      const totalEarnings = balancePhase2End - balancePhase1Start;
      const expectedTotal = expectedPhase1Delta + expectedPhase2Delta;
      expect(totalEarnings).to.equal(expectedTotal);
      // Ensure the two phases used different fee rates
      expect(packedFee).to.not.equal(newPackedFee);
      // Verify neither segment is zero (both contributed to earnings)
      expect(expectedPhase1Delta).to.be.greaterThan(0n);
      expect(expectedPhase2Delta).to.be.greaterThan(0n);
    });

    it("operator snapshot balance equals expected EB-weighted ETH after settlement", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);
      const packedFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
      const deposit = ethers.parseEther("100");

      const regTx = await clusters.connect(clusterOwner1).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(), { value: deposit }
      );
      const receipt = await regTx.wait();
      const clusterAfterReg = parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);

      const clusterId = computeClusterId(clusterOwner1.address, operatorIds);
      const root1 = computeEBRoot(clusterId, 64);
      await clusters.mockSetEBRoot(1, root1);
      const ebTx1 = await clusters.connect(clusterOwner1).updateClusterBalance(
        1, clusterOwner1.address, operatorIds, clusterAfterReg, 64, []
      );
      const ebReceipt1 = await ebTx1.wait();
      const clusterAfterEB1 = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);

      const [, snapshotBlock1, balanceAtSnapshot] = await clusters.getOperatorEthSnapshot(operatorIds[0]);

      await networkHelpers.mine(100);
      const root2 = computeEBRoot(clusterId, 64);
      await clusters.mockSetEBRoot(2, root2);
      await clusters.connect(clusterOwner1).updateClusterBalance(
        2, clusterOwner1.address, operatorIds, clusterAfterEB1, 64, []
      );

      const harnessAddress = await clusters.getAddress();
      const harnessEthBefore = await connection.ethers.provider.getBalance(harnessAddress);
      await clusters.connect(clusterOwner1).mockWithdrawAllEthEarnings(operatorIds[0]);
      const withdrawalBlock = await connection.ethers.provider.getBlockNumber();
      const harnessEthAfter = await connection.ethers.provider.getBalance(harnessAddress);

      const totalBlocksDelta = BigInt(withdrawalBlock) - BigInt(snapshotBlock1);
      const newEarningsPacked = packedFee * totalBlocksDelta * 20000n / BPS_DENOMINATOR;
      const expectedETH = (balanceAtSnapshot + newEarningsPacked) * ETH_DEDUCTED_DIGITS;
      expect(harnessEthBefore - harnessEthAfter).to.equal(expectedETH);

      const [, , balanceAfterWithdraw] = await clusters.getOperatorEthSnapshot(operatorIds[0]);
      expect(balanceAfterWithdraw).to.equal(0n);
    });
  });

  describe("Edge Cases", async () => {
    it("operator with zero fee earns nothing despite EB > 32", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithZeroFee);
      const deposit = ethers.parseEther("100");

      const regTx = await clusters.connect(clusterOwner1).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(), { value: deposit }
      );
      const receipt = await regTx.wait();
      const cluster = parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);

      const clusterId = computeClusterId(clusterOwner1.address, operatorIds);
      const root = computeEBRoot(clusterId, 64);
      await clusters.mockSetEBRoot(1, root);
      const ebTx1 = await clusters.connect(clusterOwner1).updateClusterBalance(
        1, clusterOwner1.address, operatorIds, cluster, 64, []
      );
      const ebReceipt1 = await ebTx1.wait();
      const clusterAfterEB = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);

      expect(await clusters.getEffectiveOperatorVUnits(operatorIds[0])).to.equal(20000n);

      const [, , balanceBefore] = await clusters.getOperatorEthSnapshot(operatorIds[0]);

      await networkHelpers.mine(100);

      const root2 = computeEBRoot(clusterId, 64);
      await clusters.mockSetEBRoot(2, root2);
      const ebTx2 = await clusters.connect(clusterOwner1).updateClusterBalance(
        2, clusterOwner1.address, operatorIds, clusterAfterEB, 64, []
      );
      await ebTx2.wait();

      const [, , balanceAfter] = await clusters.getOperatorEthSnapshot(operatorIds[0]);

      expect(balanceAfter).to.equal(balanceBefore);
      expect(balanceAfter).to.equal(0n);
    });

    it("operator earnings cap at maximum EB (2048 ETH per validator)", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);
      const packedFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
      const deposit = ethers.parseEther("100");

      const regTx = await clusters.connect(clusterOwner1).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(), { value: deposit }
      );
      const receipt = await regTx.wait();
      const cluster = parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);
      const clusterId = computeClusterId(clusterOwner1.address, operatorIds);
      const root = computeEBRoot(clusterId, 2048);
      await clusters.mockSetEBRoot(1, root);
      const ebTx = await clusters.connect(clusterOwner1).updateClusterBalance(
        1, clusterOwner1.address, operatorIds, cluster, 2048, []
      );
      const ebReceipt = await ebTx.wait();
      const clusterAfterEB = parseClusterFromEvent(clusters, ebReceipt, Events.CLUSTER_BALANCE_UPDATED);
      const maxVUnits = 640_000n;
      expect(await clusters.getEffectiveOperatorVUnits(operatorIds[0])).to.equal(maxVUnits);

      const [, snapshotBlock, balanceBefore] = await clusters.getOperatorEthSnapshot(operatorIds[0]);

      await networkHelpers.mine(50);

      await clusters.connect(clusterOwner1).removeValidator(makePublicKey(1), operatorIds, clusterAfterEB);
      const removeBlock = await connection.ethers.provider.getBlockNumber();

      const [, , balanceAfter] = await clusters.getOperatorEthSnapshot(operatorIds[0]);

      const blocksDelta = BigInt(removeBlock) - BigInt(snapshotBlock);
      const expectedEarnings = packedFee * blocksDelta * maxVUnits / BPS_DENOMINATOR;

      expect(balanceAfter - balanceBefore).to.equal(expectedEarnings);
      expect(balanceAfter - balanceBefore).to.equal(packedFee * blocksDelta * 64n);
    });

    it("operator earnings reflect multi-validator cluster with EB > 32", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);
      const packedFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
      const deposit = ethers.parseEther("100");
      const regTx1 = await clusters.connect(clusterOwner1).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(), { value: deposit }
      );
      const receipt1 = await regTx1.wait();
      const cluster1 = parseClusterFromEvent(clusters, receipt1, Events.VALIDATOR_ADDED);

      const regTx2 = await clusters.connect(clusterOwner1).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, cluster1, { value: deposit }
      );
      const receipt2 = await regTx2.wait();
      const cluster2 = parseClusterFromEvent(clusters, receipt2, Events.VALIDATOR_ADDED);

      const regTx3 = await clusters.connect(clusterOwner1).registerValidator(
        makePublicKey(3), operatorIds, DEFAULT_SHARES, cluster2, { value: deposit }
      );
      const receipt3 = await regTx3.wait();
      const cluster3 = parseClusterFromEvent(clusters, receipt3, Events.VALIDATOR_ADDED);

      expect(cluster3.validatorCount).to.equal(3);
      const clusterId = computeClusterId(clusterOwner1.address, operatorIds);
      const root = computeEBRoot(clusterId, 144);
      await clusters.mockSetEBRoot(1, root);
      const ebTx = await clusters.connect(clusterOwner1).updateClusterBalance(
        1, clusterOwner1.address, operatorIds, cluster3, 144, []
      );
      const ebReceipt = await ebTx.wait();
      const clusterAfterEB = parseClusterFromEvent(clusters, ebReceipt, Events.CLUSTER_BALANCE_UPDATED);

      const expectedVUnits = 45_000n;
      expect(await clusters.getEffectiveOperatorVUnits(operatorIds[0])).to.equal(expectedVUnits);

      const [, snapshotBlock, balanceBefore] = await clusters.getOperatorEthSnapshot(operatorIds[0]);

      await networkHelpers.mine(80);

      await clusters.connect(clusterOwner1).removeValidator(makePublicKey(1), operatorIds, clusterAfterEB);
      const removeBlock = await connection.ethers.provider.getBlockNumber();

      const [, , balanceAfter] = await clusters.getOperatorEthSnapshot(operatorIds[0]);

      const blocksDelta = BigInt(removeBlock) - BigInt(snapshotBlock);
      const expectedEarnings = packedFee * blocksDelta * expectedVUnits / BPS_DENOMINATOR;

      expect(balanceAfter - balanceBefore).to.equal(expectedEarnings);
    });

    it("operator earnings adjust correctly when EB decreases", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);
      const packedFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
      const deposit = ethers.parseEther("100");

      const regTx = await clusters.connect(clusterOwner1).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(), { value: deposit }
      );
      const receipt = await regTx.wait();
      const cluster = parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);
      const clusterId = computeClusterId(clusterOwner1.address, operatorIds);
      const root1 = computeEBRoot(clusterId, 64);
      await clusters.mockSetEBRoot(1, root1);
      const ebTx1 = await clusters.connect(clusterOwner1).updateClusterBalance(
        1, clusterOwner1.address, operatorIds, cluster, 64, []
      );
      const ebReceipt1 = await ebTx1.wait();
      const clusterAfterEB1 = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);

      expect(await clusters.getEffectiveOperatorVUnits(operatorIds[0])).to.equal(20000n);

      const [, snapshotBlock1, balancePhase1Start] = await clusters.getOperatorEthSnapshot(operatorIds[0]);

      await networkHelpers.mine(50);
      const root2 = computeEBRoot(clusterId, 32);
      await clusters.mockSetEBRoot(2, root2);
      const ebTx2 = await clusters.connect(clusterOwner1).updateClusterBalance(
        2, clusterOwner1.address, operatorIds, clusterAfterEB1, 32, []
      );
      const ebReceipt2 = await ebTx2.wait();
      const clusterAfterEB2 = parseClusterFromEvent(clusters, ebReceipt2, Events.CLUSTER_BALANCE_UPDATED);

      const [, snapshotBlock2, balancePhase1End] = await clusters.getOperatorEthSnapshot(operatorIds[0]);
      const phase1Blocks = BigInt(snapshotBlock2) - BigInt(snapshotBlock1);
      const expectedPhase1 = packedFee * phase1Blocks * 20000n / BPS_DENOMINATOR;
      expect(balancePhase1End - balancePhase1Start).to.equal(expectedPhase1);

      expect(await clusters.getEffectiveOperatorVUnits(operatorIds[0])).to.equal(10000n);

      await networkHelpers.mine(50);

      await clusters.connect(clusterOwner1).removeValidator(makePublicKey(1), operatorIds, clusterAfterEB2);
      const removeBlock = await connection.ethers.provider.getBlockNumber();

      const [, , balanceFinal] = await clusters.getOperatorEthSnapshot(operatorIds[0]);
      const phase2Blocks = BigInt(removeBlock) - BigInt(snapshotBlock2);
      const expectedPhase2 = packedFee * phase2Blocks * 10000n / BPS_DENOMINATOR;
      expect(balanceFinal - balancePhase1End).to.equal(expectedPhase2);
      expect(expectedPhase2).to.be.lessThan(expectedPhase1);
    });

    it("operator earns from mixed implicit and explicit EB clusters correctly", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);
      const packedFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
      const deposit = ethers.parseEther("100");
      const regTx1 = await clusters.connect(clusterOwner1).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(), { value: deposit }
      );
      const receipt1 = await regTx1.wait();
      const cluster1 = parseClusterFromEvent(clusters, receipt1, Events.VALIDATOR_ADDED);
      const regTx2 = await clusters.connect(clusterOwner2).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, createCluster(), { value: deposit }
      );
      const receipt2 = await regTx2.wait();
      const cluster2 = parseClusterFromEvent(clusters, receipt2, Events.VALIDATOR_ADDED);

      const clusterId2 = computeClusterId(clusterOwner2.address, operatorIds);
      const root2 = computeEBRoot(clusterId2, 64);
      await clusters.mockSetEBRoot(1, root2);
      await clusters.connect(clusterOwner2).updateClusterBalance(
        1, clusterOwner2.address, operatorIds, cluster2, 64, []
      );
      const regTx3 = await clusters.connect(clusterOwner3).registerValidator(
        makePublicKey(3), operatorIds, DEFAULT_SHARES, createCluster(), { value: deposit }
      );
      const receipt3 = await regTx3.wait();
      const cluster3 = parseClusterFromEvent(clusters, receipt3, Events.VALIDATOR_ADDED);

      const clusterId3 = computeClusterId(clusterOwner3.address, operatorIds);
      const root3 = computeEBRoot(clusterId3, 32);
      await clusters.mockSetEBRoot(2, root3);
      await clusters.connect(clusterOwner3).updateClusterBalance(
        2, clusterOwner3.address, operatorIds, cluster3, 32, []
      );
      const expectedTotalVUnits = 40_000n;
      expect(await clusters.getEffectiveOperatorVUnits(operatorIds[0])).to.equal(expectedTotalVUnits);

      const [, snapshotBlock, balanceBefore] = await clusters.getOperatorEthSnapshot(operatorIds[0]);

      await networkHelpers.mine(60);
      const removeTx = await clusters.connect(clusterOwner1).removeValidator(
        makePublicKey(1), operatorIds, cluster1
      );
      const removeReceipt = await removeTx.wait();
      const settleBlock = removeReceipt!.blockNumber;

      const [, , balanceAfter] = await clusters.getOperatorEthSnapshot(operatorIds[0]);

      const blocksDelta = BigInt(settleBlock) - BigInt(snapshotBlock);
      const expectedEarnings = packedFee * blocksDelta * expectedTotalVUnits / BPS_DENOMINATOR;

      expect(balanceAfter - balanceBefore).to.equal(expectedEarnings);
      expect(balanceAfter - balanceBefore).to.equal(packedFee * blocksDelta * 4n);

      // OE-026: Verify weighted accumulation per cluster
      // Cluster 1: implicit EB (32 ETH, 1 validator) => vUnits = 10_000
      // Cluster 2: explicit EB = 64 ETH (1 validator) => vUnits = 20_000
      // Cluster 3: explicit EB = 32 ETH (1 validator) => vUnits = 10_000
      // Total effective vUnits for operator = 40_000
      const cluster1VUnits = 10_000n; // implicit 32 ETH
      const cluster2VUnits = 20_000n; // explicit 64 ETH
      const cluster3VUnits = 10_000n; // explicit 32 ETH
      const perClusterEarnings1 = packedFee * blocksDelta * cluster1VUnits / BPS_DENOMINATOR;
      const perClusterEarnings2 = packedFee * blocksDelta * cluster2VUnits / BPS_DENOMINATOR;
      const perClusterEarnings3 = packedFee * blocksDelta * cluster3VUnits / BPS_DENOMINATOR;
      const sumOfPerCluster = perClusterEarnings1 + perClusterEarnings2 + perClusterEarnings3;
      expect(balanceAfter - balanceBefore).to.equal(sumOfPerCluster);
      // The 64 ETH cluster contributes exactly 2x what a 32 ETH cluster contributes
      expect(perClusterEarnings2).to.equal(perClusterEarnings1 * 2n);
      expect(perClusterEarnings2).to.equal(perClusterEarnings3 * 2n);
    });
  });
});

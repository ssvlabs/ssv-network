import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { createCluster, makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_SHARES, BPS_DENOMINATOR, ETH_DEDUCTED_DIGITS } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { ethers } from "ethers";

// Operator fee: 1e10 wei/block (packed = 1e10 / 1e5 = 1e5)
// Must be divisible by ETH_DEDUCTED_DIGITS
const OPERATOR_FEE = 10_000_000_000n; // 1e10 wei/block

describe("EB-aware fee settlement on registration and removal", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner] = await connection.ethers.getSigners();
  });

  const deployClustersWithFee = async () => {
    return ssvClustersHarnessFixture(connection, 4, OPERATOR_FEE);
  };

  const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
    return ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds])
    );
  };

  const getEBRoot = (clusterId: string, effectiveBalance: number): string => {
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const innerHash = ethers.keccak256(coder.encode(["bytes32", "uint32"], [clusterId, effectiveBalance]));
    return ethers.keccak256(ethers.solidityPacked(["bytes32"], [innerHash]));
  };

  it("Registration settles fees using EB-weighted vUnits, not flat validatorCount", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);

    // Step 1: Register first validator with large deposit
    const depositValue = ethers.parseEther("100");
    const regTx1 = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: depositValue }
    );
    const receipt1 = await regTx1.wait();
    const cluster1 = parseClusterFromEvent(clusters, receipt1, Events.VALIDATOR_ADDED);

    // Step 2: Update EB to 1000 ETH (31.25x baseline of 32 ETH)
    // vUnits per validator = ceil(1000 * 10000 / 32) = 312500
    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    const ebBlockNum = 1;
    const effectiveBalance = 1000;
    const root = getEBRoot(clusterId, effectiveBalance);
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

    // Verify vUnits are set
    const clusterVUnits = await clusters.getClusterVUnits(clusterId);
    const expectedVUnits = ((BigInt(effectiveBalance) * BPS_DENOMINATOR) + 31n) / 32n;
    expect(clusterVUnits).to.equal(expectedVUnits);

    // Record balance before advancing blocks
    const balanceBeforeMine = clusterAfterEB.balance;

    // Step 3: Mine 100 blocks to accrue fees
    const blockBeforeMine = await connection.ethers.provider.getBlockNumber();
    await networkHelpers.mine(100);
    const blockAfterMine = await connection.ethers.provider.getBlockNumber();
    const blocksMined = blockAfterMine - blockBeforeMine;

    // Step 4: Register a second validator — this triggers fee settlement
    const regTx2 = await clusters.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      clusterAfterEB,
      { value: 0n }
    );
    const receipt2 = await regTx2.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, receipt2, Events.VALIDATOR_ADDED);

    // Step 5: Verify fees were settled using EB-weighted calculation
    const balanceAfterReg = clusterAfterReg.balance;
    const feeDeducted = balanceBeforeMine - balanceAfterReg;

    // Calculate expected fees precisely
    const packedOpFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
    const vUnitsMultiplier = expectedVUnits / BPS_DENOMINATOR; // 31.25x for 1000 ETH
    
    // EB-weighted fee calculation: operators * packedOpFee * blocks * vUnitsMultiplier * ETH_DEDUCTED_DIGITS
    const expectedEBFee = 4n * packedOpFee * BigInt(blocksMined + 1) * vUnitsMultiplier * ETH_DEDUCTED_DIGITS;
    
    // Flat (non-EB) fee calculation for comparison
    const flatUsageExpanded = 4n * packedOpFee * BigInt(blocksMined + 1) * 1n * ETH_DEDUCTED_DIGITS;

    // Verify EB-weighted fees are charged correctly
    expect(feeDeducted).to.be.gt(0n, "Fee should have been deducted");
    expect(feeDeducted).to.be.approximately(
      expectedEBFee,
      expectedEBFee / 100n, // Allow 1% tolerance for rounding differences
      "EB-weighted fee settlement should match expected calculation"
    );
    
    // Verify EB-weighted is significantly higher than flat
    expect(feeDeducted).to.be.gt(
      flatUsageExpanded * 10n,
      "EB-weighted fee settlement should charge significantly more than flat validatorCount"
    );
  });

  it("Removal settles fees using EB-weighted vUnits", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);

    // Register 2 validators
    const depositValue = ethers.parseEther("100");
    const regTx1 = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: depositValue }
    );
    const receipt1 = await regTx1.wait();
    const cluster1 = parseClusterFromEvent(clusters, receipt1, Events.VALIDATOR_ADDED);

    const regTx2 = await clusters.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      cluster1,
      { value: 0n }
    );
    const receipt2 = await regTx2.wait();
    const cluster2 = parseClusterFromEvent(clusters, receipt2, Events.VALIDATOR_ADDED);

    // Update EB to 500 ETH total for cluster (250 ETH per validator)
    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    const ebBlockNum = 1;
    const effectiveBalance = 500;
    const root = getEBRoot(clusterId, effectiveBalance);
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

    // Mine 100 blocks
    const blockBeforeMine = await connection.ethers.provider.getBlockNumber();
    await networkHelpers.mine(100);
    const blockAfterMine = await connection.ethers.provider.getBlockNumber();
    const blocksMined = blockAfterMine - blockBeforeMine;

    // Remove a validator — triggers fee settlement
    const removeTx = await clusters.removeValidator(
      makePublicKey(1),
      operatorIds,
      clusterAfterEB
    );
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);

    const feeDeducted = balanceBeforeMine - clusterAfterRemove.balance;
    expect(feeDeducted).to.be.gt(0n, "Fee should have been deducted on removal");

    // Calculate expected fees precisely
    const packedOpFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
    const vUnitsMultiplier = expectedVUnits / BPS_DENOMINATOR; // 15.625x for 500 ETH
    
    // EB-weighted fee calculation: operators * packedOpFee * blocks * vUnitsMultiplier * ETH_DEDUCTED_DIGITS
    const expectedEBFee = 4n * packedOpFee * BigInt(blocksMined + 1) * vUnitsMultiplier * ETH_DEDUCTED_DIGITS;
    
    // Flat (non-EB) fee calculation for comparison
    const flatUsageExpanded = 4n * packedOpFee * BigInt(blocksMined + 1) * 2n * ETH_DEDUCTED_DIGITS;

    // Verify EB-weighted fees are charged correctly
    expect(feeDeducted).to.be.approximately(
      expectedEBFee,
      expectedEBFee / 10n, // Allow 10% tolerance for rounding differences
      "EB-weighted fee settlement on removal should match expected calculation"
    );

    // Verify EB-weighted is significantly higher than flat
    expect(feeDeducted).to.be.gt(
      flatUsageExpanded * 5n,
      "EB-weighted fee settlement on removal should charge more than flat validatorCount"
    );
  });

  describe("Edge Cases for EB Settlement", async () => {
    it("Uses baseline vUnits when EB = 0 (no EB set)", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);

      // Register validator without setting EB (EB remains 0)
      const depositValue = ethers.parseEther("100");
      const regTx = await clusters.registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        createCluster(),
        { value: depositValue }
      );
      const receipt = await regTx.wait();
      const cluster1 = parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);

      const clusterId = getClusterId(clusterOwner.address, operatorIds);
      
      // Verify vUnits are 0 when EB is not set (this is expected behavior)
      const clusterVUnits = await clusters.getClusterVUnits(clusterId);
      expect(clusterVUnits).to.equal(0n, "vUnits should be 0 when EB is not set");

      const balanceBeforeMine = cluster1.balance;

      // Mine blocks and register second validator
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
      
      // Should use baseline calculation (1x multiplier) even though vUnits storage is 0
      // The getVUnits() function returns baseline when storage is 0
      const packedOpFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
      const expectedBaselineFee = 4n * packedOpFee * 51n * 1n * ETH_DEDUCTED_DIGITS;
      
      expect(feeDeducted).to.be.approximately(
        expectedBaselineFee,
        expectedBaselineFee / 10n, // Allow 10% tolerance
        "Should use baseline vUnits when EB = 0"
      );
    });

    it("Handles EB exactly at baseline (32 ETH)", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);

      // Register first validator
      const depositValue = ethers.parseEther("100");
      const regTx1 = await clusters.registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        createCluster(),
        { value: depositValue }
      );
      const receipt1 = await regTx1.wait();
      const cluster1 = parseClusterFromEvent(clusters, receipt1, Events.VALIDATOR_ADDED);

      // Set EB to exactly 32 ETH (baseline)
      const clusterId = getClusterId(clusterOwner.address, operatorIds);
      const ebBlockNum = 1;
      const effectiveBalance = 32; // Exactly baseline
      const root = getEBRoot(clusterId, effectiveBalance);
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

      // Verify vUnits equal baseline
      const clusterVUnits = await clusters.getClusterVUnits(clusterId);
      const expectedVUnits = 1n * BPS_DENOMINATOR; // Should equal baseline
      expect(clusterVUnits).to.equal(expectedVUnits);

      const balanceBeforeMine = clusterAfterEB.balance;

      // Mine and register second validator
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
      
      // Should be same as baseline (1x multiplier)
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

      // Register validator
      const depositValue = ethers.parseEther("1000"); // Larger deposit for high EB
      const regTx = await clusters.registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        createCluster(),
        { value: depositValue }
      );
      const receipt = await regTx.wait();
      const cluster1 = parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);

      // Set high EB: 1000 ETH (31.25x baseline) - reasonable but still high
      const clusterId = getClusterId(clusterOwner.address, operatorIds);
      const ebBlockNum = 1;
      const effectiveBalance = 1000; // Same as first test but with larger deposit
      const root = getEBRoot(clusterId, effectiveBalance);
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

      // Verify vUnits calculation
      const clusterVUnits = await clusters.getClusterVUnits(clusterId);
      const expectedVUnits = ((BigInt(effectiveBalance) * BPS_DENOMINATOR) + 31n) / 32n;
      expect(clusterVUnits).to.equal(expectedVUnits);

      const balanceBeforeMine = clusterAfterEB.balance;

      // Mine fewer blocks to avoid excessive fees
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
      
      // Should be high due to 31.25x multiplier
      const packedOpFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
      const vUnitsMultiplier = expectedVUnits / BPS_DENOMINATOR; // ~31.25x
      
      expect(feeDeducted).to.be.gt(0n, "High EB should still deduct fees");
      
      // Verify it's significantly higher than baseline
      const baselineFee = 4n * packedOpFee * 11n * 1n * ETH_DEDUCTED_DIGITS;
      expect(feeDeducted).to.be.gt(
        baselineFee * 10n, // Should be at least 10x higher
        "High EB should result in proportionally higher fees"
      );
      
      // But shouldn't exceed total balance
      expect(feeDeducted).to.be.lt(
        balanceBeforeMine,
        "Fees deducted should not exceed total balance"
      );
    });

    it("Handles zero validator count edge case", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);

      // Set EB first
      const clusterId = getClusterId(clusterOwner.address, operatorIds);
      const ebBlockNum = 1;
      const effectiveBalance = 1000;
      const root = getEBRoot(clusterId, effectiveBalance);
      await clusters.mockSetEBRoot(ebBlockNum, root);

      // Try to update EB for non-existent cluster (0 validators)
      const emptyCluster = createCluster();
      emptyCluster.validatorCount = 0;
      
      // Should handle gracefully - either revert or process with 0 vUnits
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
        
        // If it succeeds, verify vUnits are 0
        const clusterVUnits = await clusters.getClusterVUnits(clusterId);
        expect(clusterVUnits).to.equal(0n, "Cluster with 0 validators should have 0 vUnits");
      } catch (error) {
        // If it reverts, that's also acceptable behavior
        expect(error.message).to.include("revert", "Should handle 0 validator case gracefully");
      }
    });
  });
});
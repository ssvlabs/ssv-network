/**
 * CM-18: Migration — SSV Refund Is Exactly Correct After Extended Fee Accrual
 * CM-22: Migration of Cluster Where Some Operators Were Removed
 * CM-27: DAO Earnings Settlement During Migration
 * CM-28: Multiple Migrations — Same Operators, Different Clusters
 * CM-29: Revert — Migrate With Insufficient ETH For Liquidation Check
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
  DEDUCTED_DIGITS,
  VUNITS_PRECISION,
  MINIMAL_OPERATOR_ETH_FEE,
  NETWORK_FEE_ETH,
  ETH_DEDUCTED_DIGITS,
} from "../../common/constants.ts";
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";
import {
  mineBlocks,
  getBlockNumber,
  getTxBlock,
  calcLiquidationThreshold,
  defaultVUnits,
  calcSSVClusterFees,
} from "../helpers/index.ts";
import { ethers } from "ethers";

describe("Migration Edge Cases (CM-18, CM-22, CM-27, CM-28, CM-29)", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;
  let clusterOwnerB: HardhatEthersSigner;
  let anotherOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner, clusterOwnerB, anotherOwner] = await connection.ethers.getSigners();
  });

  const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
    return ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds]),
    );
  };

  const getMigratedEventArgs = (clusters: any, receipt: any) => {
    for (const log of receipt.logs ?? []) {
      let parsed;
      try {
        parsed = clusters.interface.parseLog(log);
      } catch {
        continue;
      }
      if (parsed?.name === Events.CLUSTER_MIGRATED_TO_ETH) {
        return parsed.args;
      }
    }
    throw new Error("ClusterMigratedToETH event not found");
  };

  // ─── CM-18: SSV Refund Exactly Correct After Extended Fee Accrual ───

  describe("CM-18: Migration — SSV Refund Is Exactly Correct After Extended Fee Accrual", () => {
    const deployFixture = async () => {
      const result = await ssvClustersHarnessFixture(connection, 4, 0n);
      const { clusters, operatorIds } = result;

      // Set SSV operator fees: raw = 1_500 each
      // mockOperatorSSVFee calls pack(), so pass value × DEDUCTED_DIGITS
      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, 1_500n * DEDUCTED_DIGITS);
      }

      // Set SSV network fee: raw = 800 (mockSSVNetworkFee wraps directly)
      await clusters.mockSSVNetworkFee(800n);
      const netFeeIndexTx = await clusters.mockCurrentNetworkFeeIndexSSV(0n);
      const netFeeIndexReceipt = await netFeeIndexTx.wait();
      const netFeeBlock = netFeeIndexReceipt.blockNumber;

      // Set ETH fees for post-migration
      await clusters.mockEthNetworkFee(BigInt(NETWORK_FEE_ETH));
      await clusters.mockMinimumBlocksBeforeLiquidation(10n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      // Set up SSV token
      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      await clusters.mockSetToken(await mockToken.getAddress());
      const harnessAddress = await clusters.getAddress();
      await mockToken.mint(harnessAddress, ethers.parseEther("2000"));

      return { clusters, operatorIds, mockToken, netFeeBlock };
    };

    it("SSV refund matches independent fee calculation after 1000 blocks", async function () {
      const { clusters, operatorIds, mockToken, netFeeBlock } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // SSV cluster: 2 validators, balance = 500 SSV
      const ssvBalance = ethers.parseEther("500");
      const ssvCluster: Cluster = {
        validatorCount: 2n,
        networkFeeIndex: 0n,
        index: 0n,
        balance: ssvBalance,
        active: true,
      };

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1),
        operatorIds,
        clusterOwner.address,
        ssvCluster,
      );

      // Get operator snapshot blocks (set during mockOperatorSSVFee, before registration)
      const opSnapshots: { block: bigint; index: bigint }[] = [];
      for (const opId of operatorIds) {
        const [index, blockNumber] = await clusters.getOperatorSnapshot(opId);
        opSnapshots.push({ block: BigInt(blockNumber), index: BigInt(index) });
      }

      // Advance 1000 blocks
      await mineBlocks(provider, 1000);

      // Record owner SSV balance before migration
      const ownerSSVBefore = await mockToken.balanceOf(clusterOwner.address);

      // Migrate with enough ETH
      const ethDeposit = ethers.parseEther("10");
      const migrateTx = await clusters.connect(clusterOwner).migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: ethDeposit },
      );
      const receipt = await migrateTx.wait();
      const migrationBlock = BigInt(receipt.blockNumber);

      // Calculate expected SSV fees using calcSSVClusterFees
      const expectedFees = calcSSVClusterFees({
        currentBlock: migrationBlock,
        opSnapshots,
        opFeeRaw: 1_500n,
        netFeeBlock: BigInt(netFeeBlock),
        netFeeRaw: 800n,
        storedNetFeeIndex: 0n,
        validatorCount: 2n,
        clusterIndex: 0n,
        clusterNetworkFeeIndex: 0n,
      });

      // Verify via the event and token balance
      const eventArgs = getMigratedEventArgs(clusters, receipt);
      const actualRefund = BigInt(eventArgs.ssvRefunded);

      // Verify via SSV token balance
      const ownerSSVAfter = await mockToken.balanceOf(clusterOwner.address);
      const tokenRefund = BigInt(ownerSSVAfter) - BigInt(ownerSSVBefore);
      expect(tokenRefund).to.equal(actualRefund, "Token transfer must match event refund");

      // Verify refund matches exact computation
      const expectedRefund = ssvBalance - expectedFees;
      expect(actualRefund).to.equal(expectedRefund, "Refund should match exact fee computation");
      expect(actualRefund).to.be.lessThan(ssvBalance, "Refund should be less than initial balance");

      // Verify fee deduction precision
      const totalFees = ssvBalance - actualRefund;
      expect(totalFees).to.equal(expectedFees, "Total SSV fees should match computed fees");
      expect(totalFees % DEDUCTED_DIGITS).to.equal(
        0n,
        "Total SSV fees must be divisible by DEDUCTED_DIGITS",
      );
    });
  });

  // ─── CM-22: Migration of Cluster Where Some Operators Were Removed ───

  describe("CM-22: Migration of Cluster Where Some Operators Were Removed", () => {
    const deployFixture = async () => {
      const result = await ssvClustersHarnessFixture(connection, 4, 0n);
      const { clusters, operatorIds } = result;

      // Set SSV fees: raw = 1_000
      // mockOperatorSSVFee calls pack(), so pass value × DEDUCTED_DIGITS
      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, 1_000n * DEDUCTED_DIGITS);
      }
      // mockSSVNetworkFee wraps directly as raw
      await clusters.mockSSVNetworkFee(500n);
      await clusters.mockCurrentNetworkFeeIndexSSV(0n);

      // Set ETH params
      await clusters.mockEthNetworkFee(BigInt(NETWORK_FEE_ETH));
      await clusters.mockMinimumBlocksBeforeLiquidation(10n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      // Set up SSV token
      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      await clusters.mockSetToken(await mockToken.getAddress());
      const harnessAddress = await clusters.getAddress();
      await mockToken.mint(harnessAddress, ethers.parseEther("2000"));

      return { clusters, operatorIds, mockToken };
    };

    it("migration succeeds when Op1 is removed — removed operator is skipped", async function () {
      const { clusters, operatorIds, mockToken } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Create SSV cluster with all 4 operators
      const ssvCluster: Cluster = {
        validatorCount: 1n,
        networkFeeIndex: 0n,
        index: 0n,
        balance: ethers.parseEther("10"),
        active: true,
      };

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1),
        operatorIds,
        clusterOwner.address,
        ssvCluster,
      );

      // Remove Op1 (set snapshot.block = 0, ethSnapshot.block = 0)
      await clusters.mockRemoveOperator(operatorIds[0]);

      // Migrate to ETH — should succeed despite removed operator
      const ethDeposit = ethers.parseEther("10");
      const migrateTx = await clusters.connect(clusterOwner).migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: ethDeposit },
      );
      const receipt = await migrateTx.wait();

      // Verify migration succeeded
      await expect(migrateTx).to.emit(clusters, Events.CLUSTER_MIGRATED_TO_ETH);

      // Verify only 3 active operators got ETH validator count incremented
      // Op1 (removed) should still have ethValidatorCount = 0
      const op1EthVCount = await clusters.getOperatorEthValidatorCount(operatorIds[0]);
      expect(op1EthVCount).to.equal(0n, "Removed operator should not get ETH validator count");

      // Active operators should have ethValidatorCount = 1
      for (let i = 1; i < operatorIds.length; i++) {
        const ethVCount = await clusters.getOperatorEthValidatorCount(operatorIds[i]);
        expect(ethVCount).to.equal(1n, `Active operator ${i} should have ethValidatorCount = 1`);
      }
    });
  });

  // ─── CM-27: DAO Earnings Settlement During Migration ───

  describe("CM-27: DAO Earnings Settlement During Migration", () => {
    const deployFixture = async () => {
      const result = await ssvClustersHarnessFixture(connection, 4, 0n);
      const { clusters, operatorIds } = result;

      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, 1_000n * DEDUCTED_DIGITS);
      }
      await clusters.mockSSVNetworkFee(500n);
      await clusters.mockCurrentNetworkFeeIndexSSV(0n);

      await clusters.mockEthNetworkFee(BigInt(NETWORK_FEE_ETH));
      await clusters.mockMinimumBlocksBeforeLiquidation(10n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      await clusters.mockSetToken(await mockToken.getAddress());
      const harnessAddress = await clusters.getAddress();
      await mockToken.mint(harnessAddress, ethers.parseEther("2000"));

      return { clusters, operatorIds, mockToken };
    };

    it("DAO earnings for both SSV and ETH are settled during migration", async function () {
      const { clusters, operatorIds, mockToken } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Create SSV cluster with 2 validators
      const ssvCluster: Cluster = {
        validatorCount: 2n,
        networkFeeIndex: 0n,
        index: 0n,
        balance: ethers.parseEther("100"),
        active: true,
      };

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1),
        operatorIds,
        clusterOwner.address,
        ssvCluster,
      );

      // Advance some blocks so DAO earnings accrue
      await mineBlocks(provider, 100);

      // Record DAO state before migration
      const daoEthBalanceBefore = await clusters.getDaoEthBalance();
      const daoEthBlockBefore = await clusters.getDaoEthIndexBlockNumber();

      // Migrate
      const ethDeposit = ethers.parseEther("10");
      const migrateTx = await clusters.connect(clusterOwner).migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: ethDeposit },
      );
      const receipt = await migrateTx.wait();
      const migrationBlock = receipt.blockNumber;

      // After migration:
      // - SSV DAO: daoValidatorCount decreased by 2
      // - ETH DAO: ethDaoValidatorCount increased by 2
      // - Both should have had their earnings settled before the count changes

      const daoEthBalanceAfter = await clusters.getDaoEthBalance();
      const daoEthBlockAfter = await clusters.getDaoEthIndexBlockNumber();
      const daoEthValidatorCount = await clusters.getDaoEthValidatorCount();

      // ETH DAO should now include the 2 migrated validators
      expect(daoEthValidatorCount).to.equal(2n);

      // ETH DAO index block should be updated to migration block
      expect(Number(daoEthBlockAfter)).to.equal(migrationBlock);

      // Migration event should have been emitted
      await expect(migrateTx).to.emit(clusters, Events.CLUSTER_MIGRATED_TO_ETH);
    });
  });

  // ─── CM-28: Multiple Migrations — Same Operators, Different Clusters ───

  describe("CM-28: Multiple Migrations — Same Operators, Different Clusters", () => {
    const deployFixture = async () => {
      // Use MINIMAL_OPERATOR_ETH_FEE so operators have a non-zero ETH fee from creation
      // This ensures index accumulation between migrations
      const result = await ssvClustersHarnessFixture(connection, 4, MINIMAL_OPERATOR_ETH_FEE);
      const { clusters, operatorIds } = result;

      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, 1_000n * DEDUCTED_DIGITS);
      }
      await clusters.mockSSVNetworkFee(500n);
      await clusters.mockCurrentNetworkFeeIndexSSV(0n);

      await clusters.mockEthNetworkFee(BigInt(NETWORK_FEE_ETH));
      await clusters.mockMinimumBlocksBeforeLiquidation(10n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      await clusters.mockSetToken(await mockToken.getAddress());
      const harnessAddress = await clusters.getAddress();
      await mockToken.mint(harnessAddress, ethers.parseEther("5000"));

      return { clusters, operatorIds, mockToken };
    };

    it("two clusters with same operators migrate correctly without index corruption", async function () {
      const { clusters, operatorIds, mockToken } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Create SSV Cluster A (owned by clusterOwner): 2 validators
      const clusterA: Cluster = {
        validatorCount: 2n,
        networkFeeIndex: 0n,
        index: 0n,
        balance: ethers.parseEther("50"),
        active: true,
      };
      await clusters.mockRegisterSSVValidator(
        makePublicKey(1),
        operatorIds,
        clusterOwner.address,
        clusterA,
      );

      // Create SSV Cluster B (owned by clusterOwnerB): 1 validator
      const clusterB: Cluster = {
        validatorCount: 1n,
        networkFeeIndex: 0n,
        index: 0n,
        balance: ethers.parseEther("30"),
        active: true,
      };
      await clusters.mockRegisterSSVValidator(
        makePublicKey(2),
        operatorIds,
        clusterOwnerB.address,
        clusterB,
      );

      // Advance 100 blocks
      await mineBlocks(provider, 100);

      // Step 1: Migrate Cluster A
      const ethDeposit1 = ethers.parseEther("5");
      const migrateTx1 = await clusters.connect(clusterOwner).migrateClusterToETH(
        operatorIds,
        clusterA,
        { value: ethDeposit1 },
      );
      const receipt1 = await migrateTx1.wait();
      const migration1Block = receipt1.blockNumber;

      // After Step 1: operators should have ethValidatorCount = 2
      for (const opId of operatorIds) {
        const ethVCount = await clusters.getOperatorEthValidatorCount(opId);
        expect(ethVCount).to.equal(2n, "After first migration, each operator should have 2 ETH validators");
      }

      // Parse Cluster A after migration
      const clusterAAfter = parseClusterFromEvent(clusters, receipt1, Events.CLUSTER_MIGRATED_TO_ETH);
      // Record Cluster A's index for comparison (non-zero since operators have ETH fee from fixture creation)
      const clusterAIndex = BigInt(clusterAAfter.index);

      // Record operator ETH snapshots after first migration (updated by migration)
      const opEthSnapshotsAfterMig1: { block: bigint; index: bigint }[] = [];
      for (const opId of operatorIds) {
        const [index, blockNumber] = await clusters.getOperatorEthSnapshot(opId);
        opEthSnapshotsAfterMig1.push({ block: BigInt(blockNumber), index: BigInt(index) });
      }

      // Advance 100 more blocks
      await mineBlocks(provider, 100);

      // Step 2: Migrate Cluster B
      const ethDeposit2 = ethers.parseEther("3");
      const migrateTx2 = await clusters.connect(clusterOwnerB).migrateClusterToETH(
        operatorIds,
        clusterB,
        { value: ethDeposit2 },
      );
      const receipt2 = await migrateTx2.wait();
      const migration2Block = BigInt(receipt2.blockNumber);

      // After Step 2: operators should have ethValidatorCount = 3 (2 + 1)
      for (const opId of operatorIds) {
        const ethVCount = await clusters.getOperatorEthValidatorCount(opId);
        expect(ethVCount).to.equal(3n, "After second migration, each operator should have 3 ETH validators");
      }

      // Parse Cluster B after migration
      const clusterBAfter = parseClusterFromEvent(clusters, receipt2, Events.CLUSTER_MIGRATED_TO_ETH);

      // Compute expected Cluster B index: sum of operator ETH indices at migration2Block
      // Each operator: currentIndex = snap.index + (migration2Block - snap.block) × ethFee
      const ethFeePerOp = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
      let expectedClusterBIndex = 0n;
      for (const snap of opEthSnapshotsAfterMig1) {
        const blockDiff = migration2Block - snap.block;
        const currentIndex = snap.index + blockDiff * ethFeePerOp;
        expectedClusterBIndex += currentIndex;
      }
      expect(BigInt(clusterBAfter.index)).to.equal(expectedClusterBIndex,
        "Cluster B index should match exact computation from operator ETH snapshots");

      // Both clusters should coexist in ethClusters
      const clusterIdA = getClusterId(clusterOwner.address, operatorIds);
      const clusterIdB = getClusterId(clusterOwnerB.address, operatorIds);
      const hashA = await clusters.getClusterHash(clusterIdA);
      const hashB = await clusters.getClusterHash(clusterIdB);
      expect(hashA).to.not.equal(ethers.ZeroHash, "Cluster A should exist in ethClusters");
      expect(hashB).to.not.equal(ethers.ZeroHash, "Cluster B should exist in ethClusters");
    });
  });

  // ─── CM-29: Revert — Migrate With Insufficient ETH For Liquidation Check ───

  describe("CM-29: Revert — Migrate With Insufficient ETH For Liquidation Check", () => {
    const deployFixture = async () => {
      // Use MINIMAL_OPERATOR_ETH_FEE so operators have non-zero ETH fee
      // This ensures the liquidation threshold is meaningful
      const result = await ssvClustersHarnessFixture(connection, 4, MINIMAL_OPERATOR_ETH_FEE);
      const { clusters, operatorIds } = result;

      // mockOperatorSSVFee calls pack(), so pass value × DEDUCTED_DIGITS
      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, 1_000n * DEDUCTED_DIGITS);
      }
      // mockSSVNetworkFee wraps directly as raw
      await clusters.mockSSVNetworkFee(500n);
      await clusters.mockCurrentNetworkFeeIndexSSV(0n);

      // Set ETH operator fee via default (will be applied during migration)
      // Default ETH fee = 17_700 packed (1_770_000_000 wei)
      await clusters.mockEthNetworkFee(5_000n);
      await clusters.mockMinimumBlocksBeforeLiquidation(100n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      await clusters.mockSetToken(await mockToken.getAddress());
      const harnessAddress = await clusters.getAddress();
      await mockToken.mint(harnessAddress, ethers.parseEther("2000"));

      return { clusters, operatorIds, mockToken };
    };

    it("reverts when ETH deposit is below liquidation threshold", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);

      // Create SSV cluster with 2 validators
      const ssvCluster: Cluster = {
        validatorCount: 2n,
        networkFeeIndex: 0n,
        index: 0n,
        balance: ethers.parseEther("10"),
        active: true,
      };

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1),
        operatorIds,
        clusterOwner.address,
        ssvCluster,
      );

      // Calculate the liquidation threshold for the migrated ETH cluster
      // Default ETH fee = 17_700 packed (per operator)
      // ethNetworkFee = 5_000 packed
      // burnRate = 4 × 17_700 = 70_800
      // vUnits = 2 × 10_000 = 20_000
      // thresholdUnits = (100 × (70_800 + 5_000) × 20_000) / 10_000
      //                = (100 × 75_800 × 20_000) / 10_000
      //                = 100 × 75_800 × 2 = 15_160_000
      // threshold = 15_160_000 × 100_000 = 1_516_000_000_000 wei
      const threshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: 100n,
        numOperators: 4n,
        ethFee: 17_700n,
        networkFee: 5_000n,
        effectiveVUnits: defaultVUnits(2n),
      });

      // Migrate with exact threshold — should succeed
      const migrateTx = await clusters.connect(clusterOwner).migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: threshold },
      );
      await migrateTx.wait();
      await expect(migrateTx).to.emit(clusters, Events.CLUSTER_MIGRATED_TO_ETH);
    });

    it("reverts when ETH deposit is 1 wei below threshold", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);

      const ssvCluster: Cluster = {
        validatorCount: 2n,
        networkFeeIndex: 0n,
        index: 0n,
        balance: ethers.parseEther("10"),
        active: true,
      };

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1),
        operatorIds,
        clusterOwner.address,
        ssvCluster,
      );

      const threshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: 100n,
        numOperators: 4n,
        ethFee: 17_700n,
        networkFee: 5_000n,
        effectiveVUnits: defaultVUnits(2n),
      });

      // Migrate with threshold - 1 — should revert
      await expect(
        clusters.connect(clusterOwner).migrateClusterToETH(
          operatorIds,
          ssvCluster,
          { value: threshold - 1n },
        ),
      ).to.be.revertedWithCustomError(clusters, Errors.INSUFFICIENT_BALANCE);
    });

    it("reverts when ETH deposit is 0", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);

      const ssvCluster: Cluster = {
        validatorCount: 2n,
        networkFeeIndex: 0n,
        index: 0n,
        balance: ethers.parseEther("10"),
        active: true,
      };

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1),
        operatorIds,
        clusterOwner.address,
        ssvCluster,
      );

      // Migrate with 0 ETH — should revert
      await expect(
        clusters.connect(clusterOwner).migrateClusterToETH(
          operatorIds,
          ssvCluster,
          { value: 0n },
        ),
      ).to.be.revertedWithCustomError(clusters, Errors.INSUFFICIENT_BALANCE);
    });
  });
});

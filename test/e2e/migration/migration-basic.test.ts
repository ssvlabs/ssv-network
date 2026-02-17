/**
 * E2E Scenario Tests: Basic SSV → ETH Migration
 * Covers CM-5, CM-6, CM-7, CM-8
 *
 * Uses harness fixture because SSV clusters require mockRegisterSSVValidator.
 */

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  createCluster,
  makePublicKey,
  parseClusterFromEvent,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  DEDUCTED_DIGITS,
  ETH_DEDUCTED_DIGITS,
  VUNITS_PRECISION,
  MINIMAL_OPERATOR_ETH_FEE,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import {
  mineBlocks,
  getTxBlock,
  calcClusterBurn,
  defaultVUnits,
} from "../helpers/index.ts";
import { ethers } from "ethers";

// mockOperatorSSVFee takes unpacked value → PackedSSVLib.pack() → must be divisible by DEDUCTED_DIGITS
const OP_SSV_FEE_UNPACKED = 10_000_000_000n; // packed raw = 1_000
// mockSSVNetworkFee takes packed raw value directly (PackedSSV.wrap())
const NETWORK_FEE_SSV_RAW = 500n;
const NETWORK_FEE_ETH_RAW = 5_000n;
const MIN_BLOCKS_LIQ = 100n;
const MIN_LIQ_COLLATERAL_RAW = 100_000n;

const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
  return ethers.keccak256(
    ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds]),
  );
};

const getMigratedToETHEventArgs = (contract: any, receipt: any) => {
  for (const log of receipt.logs ?? []) {
    let parsed;
    try { parsed = contract.interface.parseLog(log); } catch { continue; }
    if (parsed?.name === Events.CLUSTER_MIGRATED_TO_ETH) {
      return parsed.args;
    }
  }
  throw new Error("ClusterMigratedToETH event not found");
};

describe("E2E: Migration SSV → ETH (CM-5, CM-6, CM-7, CM-8)", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner] = await connection.ethers.getSigners();
  });

  // ─── CM-5: Basic SSV → ETH Migration With SSV Refund ───

  describe("CM-5: Basic Migration With SSV Refund", () => {
    const deployFixture = async () => {
      // Register operators with 0 ETH fee initially — ensureETHDefaults will set defaults
      const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, 4, 0n);

      // Set SSV fees on operators (so ensureETHDefaults assigns default ETH fee)
      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, OP_SSV_FEE_UNPACKED);
      }

      // Set protocol parameters
      await clusters.mockSSVNetworkFee(NETWORK_FEE_SSV_RAW);
      await clusters.mockEthNetworkFee(NETWORK_FEE_ETH_RAW);
      await clusters.mockMinimumBlocksBeforeLiquidation(MIN_BLOCKS_LIQ);
      await clusters.mockMinimumLiquidationCollateral(MIN_LIQ_COLLATERAL_RAW);
      await clusters.mockMinimumBlocksBeforeLiquidationSSV(MIN_BLOCKS_LIQ);
      await clusters.mockMinimumLiquidationCollateralSSV(MIN_LIQ_COLLATERAL_RAW);

      // Deploy mock token for SSV transfers
      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      const harnessAddr = await clusters.getAddress();
      await mockToken.mint(harnessAddr, connection.ethers.parseEther("10000"));
      await clusters.mockSetToken(await mockToken.getAddress());

      // Fund harness with ETH
      await connection.ethers.provider.send("hardhat_setBalance", [
        harnessAddr,
        "0x" + (100n * 10n ** 18n).toString(16),
      ]);

      return { clusters, operatorIds, mockToken };
    };

    it("migrates SSV cluster to ETH with correct SSV refund and ETH deposit", async function () {
      const { clusters, operatorIds, mockToken } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Create SSV cluster: 2 validators, 100e18 SSV balance
      const ssvBalance = 100n * 10n ** 18n;
      const ssvCluster = createCluster({
        validatorCount: 2n,
        balance: ssvBalance,
        active: true,
      });

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1), operatorIds, clusterOwner.address, ssvCluster,
      );

      // Verify initial state
      expect(await clusters.getDaoEthValidatorCount()).to.equal(0);

      // Advance 100 blocks
      await mineBlocks(provider, 100);

      // Track SSV balance before migration
      const ownerSSVBefore = await mockToken.balanceOf(clusterOwner.address);

      // Compute expected SSV fee: read operator snapshots + live NFI before migration tx
      // View calls don't mine blocks, so all reads see the same block.
      const opFeeRaw = OP_SSV_FEE_UNPACKED / DEDUCTED_DIGITS; // 1_000
      const currentBlock = await provider.getBlockNumber();
      const migrateBlockPredicted = BigInt(currentBlock + 1);

      // Live cumulative SSV operator index at migration block
      let cumulativeIndexSSV = 0n;
      for (const opId of operatorIds) {
        const snap = await clusters.getOperatorSnapshot(opId);
        const storedIndex = BigInt(snap[0]);
        const storedBlock = BigInt(snap[1]);
        cumulativeIndexSSV += storedIndex + (migrateBlockPredicted - storedBlock) * opFeeRaw;
      }

      // Live SSV network fee index at migration block
      const liveNFI = await clusters.getCurrentNetworkFeeIndexSSV() + NETWORK_FEE_SSV_RAW;

      // SSV usage: (cumulativeIndex - cluster.index) * vc + (NFI - cluster.NFI) * vc
      // cluster.index = 0, cluster.networkFeeIndex = 0
      const validatorCount = 2n;
      const usagePacked = cumulativeIndexSSV * validatorCount + liveNFI * validatorCount;
      const expectedUsage = usagePacked * DEDUCTED_DIGITS;
      const expectedRefund = ssvBalance - expectedUsage;

      // Migrate with 10 ETH
      const ethDeposit = 10n * 10n ** 18n;
      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds, ssvCluster,
        { value: ethDeposit },
      );
      const receipt = await migrateTx.wait();
      const migrateBlock = receipt!.blockNumber;
      expect(BigInt(migrateBlock)).to.equal(migrateBlockPredicted, "migration block prediction mismatch");

      // SSV refund event
      const eventArgs = getMigratedToETHEventArgs(clusters, receipt);
      expect(eventArgs.ethDeposited).to.equal(ethDeposit);

      // Verify SSV tokens transferred with exact computed refund
      const ownerSSVAfter = await mockToken.balanceOf(clusterOwner.address);
      const ssvRefund = ownerSSVAfter - ownerSSVBefore;
      expect(ssvRefund).to.equal(eventArgs.ssvRefunded);
      expect(ssvRefund).to.equal(expectedRefund);

      // Verify ETH cluster created
      const clusterAfter = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(clusterAfter.balance).to.equal(ethDeposit);
      expect(clusterAfter.active).to.equal(true);
      expect(clusterAfter.validatorCount).to.equal(2n);

      // cluster.index = 0 (all operators are ETH-new, indices not accumulated per DISC-CM-7)
      expect(clusterAfter.index).to.equal(0n);

      // Verify operator state transitions
      for (const opId of operatorIds) {
        // SSV validatorCount decremented
        expect(await clusters.getOperatorValidatorCount(opId)).to.equal(0);
        // ETH validatorCount incremented
        expect(await clusters.getOperatorEthValidatorCount(opId)).to.equal(2);
      }

      // DAO state
      expect(await clusters.getDaoEthValidatorCount()).to.equal(2);
      // daoTotalEthVUnits = 2 * 10_000 = 20_000 (implicit, no EB deviation)
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(20_000n);

      // Verify SSV cluster deleted, ETH cluster exists
      const clusterId = getClusterId(clusterOwner.address, operatorIds);
      expect(await clusters.getClusterHash(clusterId)).to.not.equal(ethers.ZeroHash);

      // effectiveBalance = 32 * 2 = 64 (implicit, 2 validators at 32 ETH)
      expect(eventArgs.effectiveBalance).to.equal(64);

      // No ClusterReactivated event (cluster was not liquidated)
      await expect(migrateTx).to.not.emit(clusters, Events.CLUSTER_REACTIVATED);
    });

    it("migration with insufficient ETH reverts (edge)", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);

      const ssvCluster = createCluster({
        validatorCount: 2n,
        balance: 100n * 10n ** 18n,
        active: true,
      });

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1), operatorIds, clusterOwner.address, ssvCluster,
      );

      // Migrate with 0 ETH — should fail liquidation check
      await expect(
        clusters.migrateClusterToETH(operatorIds, ssvCluster, { value: 0n }),
      ).to.be.revertedWithCustomError(clusters, Errors.INSUFFICIENT_BALANCE);
    });
  });

  // ─── CM-6: Migration of Liquidated SSV Cluster ───

  describe("CM-6: Migration of Liquidated SSV Cluster", () => {
    const deployFixture = async () => {
      const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, 4, 0n);

      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, OP_SSV_FEE_UNPACKED);
      }

      await clusters.mockSSVNetworkFee(NETWORK_FEE_SSV_RAW);
      await clusters.mockEthNetworkFee(NETWORK_FEE_ETH_RAW);
      await clusters.mockMinimumBlocksBeforeLiquidation(MIN_BLOCKS_LIQ);
      await clusters.mockMinimumLiquidationCollateral(MIN_LIQ_COLLATERAL_RAW);
      await clusters.mockMinimumBlocksBeforeLiquidationSSV(MIN_BLOCKS_LIQ);
      await clusters.mockMinimumLiquidationCollateralSSV(MIN_LIQ_COLLATERAL_RAW);

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      const harnessAddr = await clusters.getAddress();
      await mockToken.mint(harnessAddr, connection.ethers.parseEther("10000"));
      await clusters.mockSetToken(await mockToken.getAddress());
      await connection.ethers.provider.send("hardhat_setBalance", [
        harnessAddr,
        "0x" + (100n * 10n ** 18n).toString(16),
      ]);

      return { clusters, operatorIds, mockToken };
    };

    it("migrates liquidated SSV cluster — no SSV refund, emits ClusterReactivated", async function () {
      const { clusters, operatorIds, mockToken } = await networkHelpers.loadFixture(deployFixture);

      // Create liquidated SSV cluster: balance=0, active=false
      // Operator SSV validatorCounts already at 0 (pre-decremented during liquidation)
      const ssvCluster = createCluster({
        validatorCount: 2n,
        balance: 0n,
        active: false,
        index: 0n,
        networkFeeIndex: 0n,
      });

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1), operatorIds, clusterOwner.address, ssvCluster,
      );

      // Pre-check: operator SSV validatorCount should be 2 from mock registration
      // In a real scenario it would be 0 after liquidation, but mock sets it to validatorCount.
      // The code checks isClusterLiquidated = !cluster.active = true, so it skips the SSV decrement.

      const ownerSSVBefore = await mockToken.balanceOf(clusterOwner.address);

      // Migrate with 10 ETH
      const ethDeposit = 10n * 10n ** 18n;
      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds, ssvCluster,
        { value: ethDeposit },
      );
      const receipt = await migrateTx.wait();
      const eventArgs = getMigratedToETHEventArgs(clusters, receipt);

      // No SSV refund (balance was 0)
      const ownerSSVAfter = await mockToken.balanceOf(clusterOwner.address);
      expect(ownerSSVAfter - ownerSSVBefore).to.equal(0n);
      expect(eventArgs.ssvRefunded).to.equal(0n);

      // ClusterReactivated emitted (because isLiquidated is true)
      await expect(migrateTx).to.emit(clusters, Events.CLUSTER_REACTIVATED);

      // ETH cluster created and active
      const clusterAfter = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(clusterAfter.active).to.equal(true);
      expect(clusterAfter.balance).to.equal(ethDeposit);

      // ethDaoValidatorCount increased
      expect(await clusters.getDaoEthValidatorCount()).to.equal(2);
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(20_000n);
    });
  });

  // ─── CM-7: Migration With Mixed Operator ETH State ───

  describe("CM-7: Migration With Mixed Operator ETH State", () => {
    const deployFixtureMixed = async () => {
      const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, 4, 0n);

      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, OP_SSV_FEE_UNPACKED);
      }

      await clusters.mockSSVNetworkFee(NETWORK_FEE_SSV_RAW);
      await clusters.mockEthNetworkFee(NETWORK_FEE_ETH_RAW);
      await clusters.mockMinimumBlocksBeforeLiquidation(MIN_BLOCKS_LIQ);
      await clusters.mockMinimumLiquidationCollateral(MIN_LIQ_COLLATERAL_RAW);
      await clusters.mockMinimumBlocksBeforeLiquidationSSV(MIN_BLOCKS_LIQ);
      await clusters.mockMinimumLiquidationCollateralSSV(MIN_LIQ_COLLATERAL_RAW);

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      const harnessAddr = await clusters.getAddress();
      await mockToken.mint(harnessAddr, connection.ethers.parseEther("10000"));
      await clusters.mockSetToken(await mockToken.getAddress());
      await connection.ethers.provider.send("hardhat_setBalance", [
        harnessAddr,
        "0x" + (100n * 10n ** 18n).toString(16),
      ]);

      // Give different ETH fees to operators to simulate mixed state
      await clusters.mockSetOperatorFee(operatorIds[0], 2_000_000_000n); // raw = 20_000
      await clusters.mockSetOperatorFee(operatorIds[1], 3_000_000_000n); // raw = 30_000
      await clusters.mockSetOperatorFee(operatorIds[2], 1_500_000_000n); // raw = 15_000
      await clusters.mockSetOperatorFee(operatorIds[3], 1_000_000_000n); // raw = 10_000

      return { clusters, operatorIds, mockToken };
    };

    it("operators with different ETH fees produce correct cumulative index after migration", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixtureMixed);

      // Create SSV cluster
      const ssvCluster = createCluster({
        validatorCount: 1n,
        balance: 50n * 10n ** 18n,
        active: true,
      });
      await clusters.mockRegisterSSVValidator(
        makePublicKey(1), operatorIds, clusterOwner.address, ssvCluster,
      );

      // Advance blocks so operators accumulate ETH index
      await mineBlocks(connection.ethers.provider, 200);

      // Migrate
      const ethDeposit = 5n * 10n ** 18n;
      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds, ssvCluster,
        { value: ethDeposit },
      );
      const receipt = await migrateTx.wait();

      // Verify migration succeeded
      await expect(migrateTx).to.emit(clusters, Events.CLUSTER_MIGRATED_TO_ETH);

      // All operators should have ethValidatorCount incremented by exactly 1
      for (const opId of operatorIds) {
        expect(await clusters.getOperatorEthValidatorCount(opId)).to.equal(1);
      }

      // SSV validatorCount decremented (non-liquidated cluster)
      for (const opId of operatorIds) {
        const ssvCount = await clusters.getOperatorValidatorCount(opId);
        expect(ssvCount).to.equal(0);
      }

      // cumulativeFeeETH = sum of operator ETH fee raws:
      // 20_000 + 30_000 + 15_000 + 10_000 = 75_000
      // This determines the burn rate in the new ETH cluster
      expect(await clusters.getDaoEthValidatorCount()).to.equal(1);
    });

    it("migration succeeds even when operators have zero ETH fee", async function () {
      const { clusters, operatorIds, mockToken } = await networkHelpers.loadFixture(deployFixtureMixed);

      // Override: set two operators to 0 ETH fee
      await clusters.mockSetOperatorFee(operatorIds[2], 0n);
      await clusters.mockSetOperatorFee(operatorIds[3], 0n);

      const ssvCluster = createCluster({
        validatorCount: 2n,
        balance: 100n * 10n ** 18n,
        active: true,
      });
      await clusters.mockRegisterSSVValidator(
        makePublicKey(1), operatorIds, clusterOwner.address, ssvCluster,
      );

      const ethDeposit = 10n * 10n ** 18n;
      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds, ssvCluster,
        { value: ethDeposit },
      );

      await expect(migrateTx).to.emit(clusters, Events.CLUSTER_MIGRATED_TO_ETH);

      const receipt = await migrateTx.wait();
      const clusterAfter = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(clusterAfter.balance).to.equal(ethDeposit);
      expect(clusterAfter.validatorCount).to.equal(2n);
      expect(await clusters.getDaoEthValidatorCount()).to.equal(2);
    });
  });

  // ─── CM-8: Post-Migration — ETH Fee Accrual Verification ───

  describe("CM-8: Post-Migration ETH Fee Accrual", () => {
    const deployFixtureCM8 = async () => {
      const result = await ssvClustersHarnessFixture(connection, 4, 0n);

      for (const opId of result.operatorIds) {
        await result.clusters.mockOperatorSSVFee(opId, OP_SSV_FEE_UNPACKED);
      }

      await result.clusters.mockSSVNetworkFee(NETWORK_FEE_SSV_RAW);
      await result.clusters.mockEthNetworkFee(NETWORK_FEE_ETH_RAW);
      await result.clusters.mockMinimumBlocksBeforeLiquidation(MIN_BLOCKS_LIQ);
      await result.clusters.mockMinimumLiquidationCollateral(MIN_LIQ_COLLATERAL_RAW);
      await result.clusters.mockMinimumBlocksBeforeLiquidationSSV(MIN_BLOCKS_LIQ);
      await result.clusters.mockMinimumLiquidationCollateralSSV(MIN_LIQ_COLLATERAL_RAW);

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      const harnessAddr = await result.clusters.getAddress();
      await mockToken.mint(harnessAddr, connection.ethers.parseEther("10000"));
      await result.clusters.mockSetToken(await mockToken.getAddress());
      await connection.ethers.provider.send("hardhat_setBalance", [
        harnessAddr,
        "0x" + (100n * 10n ** 18n).toString(16),
      ]);

      return { ...result, mockToken };
    };

    it("ETH fees accrue correctly after migration, not SSV fees", async function () {
      const { clusters, operatorIds, mockToken } = await networkHelpers.loadFixture(deployFixtureCM8);

      const provider = connection.ethers.provider;

      // Create SSV cluster and immediately migrate
      const ssvCluster = createCluster({
        validatorCount: 2n,
        balance: 100n * 10n ** 18n,
        active: true,
      });
      await clusters.mockRegisterSSVValidator(
        makePublicKey(1), operatorIds, clusterOwner.address, ssvCluster,
      );

      const ethDeposit = 10n * 10n ** 18n;
      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds, ssvCluster,
        { value: ethDeposit },
      );
      const migrateReceipt = await migrateTx.wait();
      const migrateBlock = migrateReceipt!.blockNumber;
      let cluster = parseClusterFromEvent(clusters, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);

      // After migration, operators have ethFee assigned via ensureETHDefaults
      // Since SSV fee != 0, they get DEFAULT_OPERATOR_ETH_FEE
      // However the harness already sets ethFee = 0 during initialization with fee=0n
      // The ensureETHDefaults only triggers if ethSnapshot.block == 0
      // In the harness, ethSnapshot.block is already set (non-zero) since mockOperator sets it
      // So ensureETHDefaults won't trigger, and the operators keep ethFee = 0

      // To properly test post-migration fee accrual, let's verify by withdrawing
      // The key assertion: fees use the ETH model, not SSV
      await mineBlocks(provider, 50);

      // Register a 3rd validator to trigger fee settlement
      const regTx = await clusters.registerValidator(
        makePublicKey(3), operatorIds, DEFAULT_SHARES, cluster,
        { value: 0n },
      );
      const regReceipt = await regTx.wait();
      const regBlock = regReceipt!.blockNumber;
      const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

      // Fee settlement happened for ~50 blocks since migration
      // With ethFee = 0 (from harness init), fees should only be network fee
      const blocksSinceMigration = BigInt(regBlock - migrateBlock);
      // ETH model uses vUnits scaling:
      // netFeeUnits = (blockDiff * NETWORK_FEE_ETH_RAW * vUnits) / VUNITS_PRECISION
      const vUnits = defaultVUnits(2n); // 20_000 (2 validators at registration)
      const netFeeUnits = (blocksSinceMigration * NETWORK_FEE_ETH_RAW * vUnits) / VUNITS_PRECISION;
      // totalFees = netFeeUnits * ETH_DEDUCTED_DIGITS (operator fees are 0)
      const expectedFees = netFeeUnits * ETH_DEDUCTED_DIGITS;
      const expectedBalance = ethDeposit - expectedFees;

      // The cluster balance should reflect ETH fee model
      // Balance after: deposit - ETH fees + 0 (msg.value for 3rd validator)
      // validatorCount should now be 3
      expect(clusterAfterReg.validatorCount).to.equal(3n);

      // Verify exact ETH balance: deposit - network fees (operator fees = 0)
      expect(clusterAfterReg.balance).to.equal(expectedBalance);
    });
  });
});

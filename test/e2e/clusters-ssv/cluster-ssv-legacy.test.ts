/**
 * E2E Scenario Tests: SSV Cluster Legacy Operations
 * Covers CM-4, CM-11
 *
 * Uses harness fixture because SSV clusters cannot be created through
 * the current registerValidator (which only creates ETH clusters).
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
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import {
  mineBlocks,
  getBlockNumber,
  getTxBlock,
} from "../helpers/index.ts";
import { ethers } from "ethers";

const OP_ETH_FEE_UNPACKED = 1_000_000_000n;
// mockOperatorSSVFee takes unpacked value → PackedSSVLib.pack() → must be divisible by DEDUCTED_DIGITS
const OP_SSV_FEE_UNPACKED = 10_000_000_000n; // packed raw = 1_000
// mockSSVNetworkFee takes packed raw value directly (PackedSSV.wrap())
const NETWORK_FEE_SSV_RAW = 500n;
const NETWORK_FEE_ETH_RAW = 5_000n;
const MIN_BLOCKS_LIQ_SSV = 100n;
const MIN_LIQ_COLLATERAL_SSV_RAW = 100_000n;

describe("E2E: SSV Cluster Legacy Operations (CM-4, CM-11)", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;
  let otherAccount: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner, otherAccount] = await connection.ethers.getSigners();
  });

  const deployFixture = async () => {
    const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, 4, OP_ETH_FEE_UNPACKED);

    // Set SSV protocol parameters
    await clusters.mockSSVNetworkFee(NETWORK_FEE_SSV_RAW);
    await clusters.mockMinimumBlocksBeforeLiquidationSSV(MIN_BLOCKS_LIQ_SSV);
    await clusters.mockMinimumLiquidationCollateralSSV(MIN_LIQ_COLLATERAL_SSV_RAW);

    // Set ETH protocol parameters
    await clusters.mockEthNetworkFee(NETWORK_FEE_ETH_RAW);
    await clusters.mockMinimumBlocksBeforeLiquidation(100n);
    await clusters.mockMinimumLiquidationCollateral(100_000n);

    // Set SSV fees on operators
    for (const opId of operatorIds) {
      await clusters.mockOperatorSSVFee(opId, OP_SSV_FEE_UNPACKED);
    }

    // Deploy mock token for SSV transfers
    const mockToken = await connection.ethers.deployContract("MockToken", []);
    await mockToken.waitForDeployment();
    const harnessAddr = await clusters.getAddress();
    await mockToken.mint(harnessAddr, connection.ethers.parseEther("1000"));
    await clusters.mockSetToken(await mockToken.getAddress());

    // Fund harness with ETH
    await connection.ethers.provider.send("hardhat_setBalance", [
      harnessAddr,
      "0x" + (100n * 10n ** 18n).toString(16),
    ]);

    return { clusters, operatorIds, mockToken };
  };

  // ─── CM-4: SSV Cluster Self-Liquidation — Verify SSV Balance Return ───

  describe("CM-4: SSV Cluster Self-Liquidation", () => {
    it("self-liquidation returns correct SSV balance after fee deduction", async function () {
      const { clusters, operatorIds, mockToken } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Create SSV cluster: 2 validators, balance = 100e18 SSV
      // Set cluster indices to match current operator state so fees only count from registration
      const ssvBalance = 100n * 10n ** 18n;

      // Compute live operator and network-fee indices at the registration block.
      // View calls don't mine blocks, so all reads below see the same block.
      // The registration tx will be mined at currentBlock + 1.
      const opFeeRaw = OP_SSV_FEE_UNPACKED / DEDUCTED_DIGITS; // 1_000
      const currentBlock = await provider.getBlockNumber();
      const regBlock = BigInt(currentBlock + 1);

      // Cumulative live operator index at regBlock
      let cumulativeIndex = 0n;
      for (const opId of operatorIds) {
        const snap = await clusters.getOperatorSnapshot(opId);
        const storedIndex = BigInt(snap[0]);
        const storedBlock = BigInt(snap[1]);
        cumulativeIndex += storedIndex + (regBlock - storedBlock) * opFeeRaw;
      }

      // Live network-fee index at regBlock (getCurrentNetworkFeeIndexSSV reads
      // at currentBlock; add 1 block for the registration tx)
      const liveNFI = await clusters.getCurrentNetworkFeeIndexSSV() + NETWORK_FEE_SSV_RAW;

      const ssvCluster = createCluster({
        validatorCount: 2n,
        balance: ssvBalance,
        active: true,
        index: cumulativeIndex,
        networkFeeIndex: liveNFI,
      });

      const publicKey = makePublicKey(1);
      const regTx = await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);
      const regReceipt = await regTx.wait();
      // Verify our prediction was correct (view calls don't mine blocks)
      const actualRegBlock = BigInt(regReceipt!.blockNumber);
      expect(actualRegBlock).to.equal(regBlock, "registration block prediction mismatch");

      // Advance 50 blocks
      await mineBlocks(provider, 50);

      // Track owner SSV balance before liquidation
      const ownerSSVBefore = await mockToken.balanceOf(clusterOwner.address);

      // Self-liquidate (1 more block for the tx itself)
      const liqTx = await clusters.liquidateSSV(
        clusterOwner.address, operatorIds, ssvCluster,
      );
      const liqReceipt = await liqTx.wait();
      await expect(liqTx).to.emit(clusters, Events.CLUSTER_LIQUIDATED);

      // Compute expected SSV fee from registration to liquidation
      const liqBlock = BigInt(liqReceipt!.blockNumber);
      const blockDiff = liqBlock - regBlock;
      // Each operator accumulates blockDiff * opFeeRaw; 4 operators total
      const opIndexDelta = blockDiff * opFeeRaw * 4n;
      const nfIndexDelta = blockDiff * NETWORK_FEE_SSV_RAW;
      // usage = (opIndexDelta + nfIndexDelta) * validatorCount
      const usagePacked = (opIndexDelta + nfIndexDelta) * 2n; // validatorCount = 2
      const expectedUsage = usagePacked * DEDUCTED_DIGITS;
      const expectedRefund = ssvBalance - expectedUsage;

      // Verify SSV refund
      const ownerSSVAfter = await mockToken.balanceOf(clusterOwner.address);
      expect(ownerSSVAfter - ownerSSVBefore).to.equal(expectedRefund);

      // Verify cluster state
      const clusterAfter = parseClusterFromEvent(clusters, liqReceipt, Events.CLUSTER_LIQUIDATED);
      expect(clusterAfter.active).to.equal(false);
      expect(clusterAfter.balance).to.equal(0n);
      expect(clusterAfter.index).to.equal(0n);
      expect(clusterAfter.networkFeeIndex).to.equal(0n);

      // Verify operator SSV validatorCount decremented
      for (const opId of operatorIds) {
        expect(await clusters.getOperatorValidatorCount(opId)).to.equal(0);
      }
    });

    it("SSV cluster with 0 balance — self-liquidation succeeds, no SSV transfer (edge)", async function () {
      const { clusters, operatorIds, mockToken } = await networkHelpers.loadFixture(deployFixture);

      const ssvCluster = createCluster({
        validatorCount: 1n,
        balance: 0n,
        active: true,
      });

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1), operatorIds, clusterOwner.address, ssvCluster,
      );

      const ownerSSVBefore = await mockToken.balanceOf(clusterOwner.address);

      await clusters.liquidateSSV(clusterOwner.address, operatorIds, ssvCluster);

      const ownerSSVAfter = await mockToken.balanceOf(clusterOwner.address);
      expect(ownerSSVAfter - ownerSSVBefore).to.equal(0n);
    });

    it("already liquidated SSV cluster reverts (edge)", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);

      const ssvCluster = createCluster({
        validatorCount: 1n,
        balance: 0n,
        active: false, // already liquidated
      });

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1), operatorIds, clusterOwner.address, ssvCluster,
      );

      await expect(
        clusters.liquidateSSV(clusterOwner.address, operatorIds, ssvCluster),
      ).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_IS_LIQUIDATED);
    });
  });

  // ─── CM-11: SSV Blocked Operations Verification ───

  describe("CM-11: SSV Blocked Operations", () => {
    it("ETH operations revert with IncorrectClusterVersion on SSV cluster", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);

      // Create active SSV cluster
      const ssvCluster = createCluster({
        validatorCount: 1n,
        balance: 10n * 10n ** 18n,
        active: true,
      });

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1), operatorIds, clusterOwner.address, ssvCluster,
      );

      // Step 1: registerValidator on SSV cluster → IncorrectClusterVersion
      await expect(
        clusters.registerValidator(
          makePublicKey(2), operatorIds, DEFAULT_SHARES, ssvCluster,
          { value: 10n * 10n ** 18n },
        ),
      ).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_VERSION);

      // Step 2: deposit() on SSV cluster → IncorrectClusterVersion
      await expect(
        clusters.deposit(clusterOwner.address, operatorIds, ssvCluster, { value: 1n * 10n ** 18n }),
      ).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_VERSION);

      // Step 3: reactivate() on SSV cluster → IncorrectClusterVersion
      await expect(
        clusters.reactivate(operatorIds, ssvCluster, { value: 1n * 10n ** 18n }),
      ).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_VERSION);

      // Step 4: withdraw() from SSV cluster → IncorrectClusterVersion
      await expect(
        clusters.withdraw(operatorIds, 1n, ssvCluster),
      ).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_VERSION);

      // Step 5: liquidate() (ETH) on SSV cluster → IncorrectClusterVersion
      await expect(
        clusters.liquidate(clusterOwner.address, operatorIds, ssvCluster),
      ).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_VERSION);

      // Step 6: removeValidator from SSV cluster → IncorrectClusterVersion
      await expect(
        clusters.removeValidator(makePublicKey(1), operatorIds, ssvCluster),
      ).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_VERSION);
    });

    it("allowed SSV operations succeed on SSV cluster", async function () {
      const { clusters, operatorIds, mockToken } = await networkHelpers.loadFixture(deployFixture);

      const ssvCluster = createCluster({
        validatorCount: 1n,
        balance: 10n * 10n ** 18n,
        active: true,
      });

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1), operatorIds, clusterOwner.address, ssvCluster,
      );

      // Step 7: liquidateSSV() succeeds
      await expect(
        clusters.liquidateSSV(clusterOwner.address, operatorIds, ssvCluster),
      ).to.emit(clusters, Events.CLUSTER_LIQUIDATED);

      // For exitValidator and migrateClusterToETH, we need fresh clusters
    });

    it("migrateClusterToETH succeeds on SSV cluster", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);

      const ssvCluster = createCluster({
        validatorCount: 1n,
        balance: 0n,
        active: true,
      });

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1), operatorIds, clusterOwner.address, ssvCluster,
      );

      // Step 9: migrateClusterToETH() succeeds
      await expect(
        clusters.migrateClusterToETH(operatorIds, ssvCluster, { value: 10n * 10n ** 18n }),
      ).to.emit(clusters, Events.CLUSTER_MIGRATED_TO_ETH);
    });
  });
});

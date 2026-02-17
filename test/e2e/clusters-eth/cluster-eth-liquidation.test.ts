/**
 * E2E Scenario Tests: ETH Cluster Liquidation
 * Covers CM-3 (extended), CM-14, CM-15
 *
 * CM-14 and CM-15 use the harness fixture because they require direct
 * EB root setup (mockSetEBRoot) which bypasses the oracle quorum flow.
 */

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import type { Cluster } from "../../common/types.ts";
import {
  createCluster,
  makePublicKey,
  parseClusterFromEvent,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  VUNITS_PRECISION,
  ETH_DEDUCTED_DIGITS,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import {
  mineBlocks,
  getBlockNumber,
  getTxBlock,
  calcClusterBurn,
  calcLiquidationThreshold,
  defaultVUnits,
  calcVUnits,
} from "../helpers/index.ts";
import { ethers } from "ethers";

/**
 * Harness scenario constants:
 * - 4 operators with ethFee packed raw = 10_000 → unpacked = 1_000_000_000
 * - Network fee packed raw = 5_000 → unpacked = 500_000_000
 * - minimumBlocksBeforeLiquidation = 100
 * - minimumLiquidationCollateral packed raw = 100_000
 */
const OP_FEE_RAW = 10_000n;
const OP_FEE_UNPACKED = OP_FEE_RAW * ETH_DEDUCTED_DIGITS; // 1_000_000_000
const NETWORK_FEE_RAW = 5_000n;
const NETWORK_FEE_UNPACKED = NETWORK_FEE_RAW * ETH_DEDUCTED_DIGITS;
const MIN_BLOCKS_LIQ = 100n;
const MIN_LIQ_COLLATERAL_RAW = 100_000n; // packed raw
const NUM_OPERATORS = 4n;

const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
  return ethers.keccak256(
    ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds]),
  );
};

const getEBRoot = (clusterId: string, effectiveBalance: number): string => {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const innerHash = ethers.keccak256(coder.encode(["bytes32", "uint32"], [clusterId, effectiveBalance]));
  return ethers.keccak256(ethers.solidityPacked(["bytes32"], [innerHash]));
};

describe("E2E: ETH Cluster Liquidation (CM-3 ext, CM-14, CM-15)", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;
  let liquidator: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner, liquidator] = await connection.ethers.getSigners();
  });

  const deployFixture = async () => {
    const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, 4, OP_FEE_UNPACKED);

    // Set protocol parameters
    await clusters.mockEthNetworkFee(NETWORK_FEE_RAW);
    await clusters.mockMinimumBlocksBeforeLiquidation(MIN_BLOCKS_LIQ);
    await clusters.mockMinimumLiquidationCollateral(MIN_LIQ_COLLATERAL_RAW);

    // Fund the harness contract to pay bounties
    const harnessAddr = await clusters.getAddress();
    await connection.ethers.provider.send("hardhat_setBalance", [
      harnessAddr,
      "0x" + (100n * 10n ** 18n).toString(16),
    ]);

    return { clusters, operatorIds };
  };

  // ─── CM-3 (extended): Liquidation at exact threshold boundary ───

  describe("CM-3: Cluster at exact threshold is NOT liquidatable by third party", () => {
    it("balance == threshold is NOT liquidatable, balance < threshold IS", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const deposit = 10n * 10n ** 18n;
      const regTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: deposit },
      );
      const regReceipt = await regTx.wait();
      const regBlock = regReceipt!.blockNumber;
      let cluster = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

      const vUnits = defaultVUnits(1n);
      const perBlockBurn = calcClusterBurn({
        blockDiff: 1n,
        numOperators: NUM_OPERATORS,
        ethFee: OP_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_LIQ,
        numOperators: NUM_OPERATORS,
        ethFee: OP_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      // Withdraw at B0+10, leaving balance = threshold + 1 block of burn
      // so that at B0+11 (the NOT-liquidatable check), balance == threshold exactly
      await mineBlocks(provider, 9);

      const feesAt10 = calcClusterBurn({
        blockDiff: 10n,
        numOperators: NUM_OPERATORS,
        ethFee: OP_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const balAfterFees = deposit - feesAt10;
      // Leave threshold + 1 block burn so at the next block it's at exact threshold
      const maxWithdraw = balAfterFees - liqThreshold - perBlockBurn;

      const wTx = await clusters.withdraw(operatorIds, maxWithdraw, cluster);
      const wReceipt = await wTx.wait();
      cluster = parseClusterFromEvent(clusters, wReceipt, Events.CLUSTER_WITHDRAWN);

      // balance after withdraw = threshold + perBlockBurn
      expect(cluster.balance).to.equal(liqThreshold + perBlockBurn);

      // At B0+11: fees for 1 more block deducted → balance = threshold exactly
      // isLiquidatableWithEB uses `balance < threshold` → false → NOT liquidatable
      await expect(
        clusters.connect(liquidator).liquidate(clusterOwner.address, operatorIds, cluster),
      ).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_NOT_LIQUIDATABLE);

      // Mine 1 more block → at B0+12: balance < threshold → liquidatable
      await mineBlocks(provider, 1);
      const liqTx = await clusters.connect(liquidator).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      await expect(liqTx).to.emit(clusters, Events.CLUSTER_LIQUIDATED);
    });
  });

  // ─── CM-14: Liquidation With Explicit EB — Deviation Cleanup ───

  describe("CM-14: Liquidation With Explicit EB — Deviation Cleanup", () => {
    it("liquidation reverses EB deviation from operators and DAO", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Create cluster with 2 validators with enough balance to survive EB update
      // At vUnits=30_000, threshold = (100 * 45_000 * 30_000 / 10_000) * 100_000 = 1_350_000_000_000
      // Need deposit > threshold + fees before EB update
      const deposit = 2_000_000_000_000n; // 2e12

      // Register two validators via two registerValidator calls
      const regTx1 = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: deposit / 2n },
      );
      let cluster = parseClusterFromEvent(clusters, await regTx1.wait(), Events.VALIDATOR_ADDED);

      const regTx2 = await clusters.registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, cluster,
        { value: deposit / 2n },
      );
      cluster = parseClusterFromEvent(clusters, await regTx2.wait(), Events.VALIDATOR_ADDED);
      expect(cluster.validatorCount).to.equal(2n);

      const clusterId = getClusterId(clusterOwner.address, operatorIds);

      // Set explicit EB: 96 ETH for 2 validators → vUnits = ceil(96 * 10_000 / 32) = 30_000
      const ebBlockNum = 1;
      const effectiveBalance = 96;
      const root = getEBRoot(clusterId, effectiveBalance);
      await clusters.mockSetEBRoot(ebBlockNum, root);

      const updateTx = await clusters.updateClusterBalance(
        ebBlockNum, clusterOwner.address, operatorIds, cluster,
        effectiveBalance, [],
      );
      const updateReceipt = await updateTx.wait();
      cluster = parseClusterFromEvent(clusters, updateReceipt, Events.CLUSTER_BALANCE_UPDATED);

      // Verify deviation set
      const newVUnits = 30_000n;
      const baseline = 2n * VUNITS_PRECISION; // 20_000
      const deviation = newVUnits - baseline; // 10_000

      expect(await clusters.getClusterVUnits(clusterId)).to.equal(newVUnits);
      const daoVUnitsBefore = await clusters.getDaoTotalEthVUnits();

      for (const opId of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(deviation);
      }

      // Advance until liquidatable with explicit EB vUnits (30_000)
      // per block burn at 30_000 vUnits:
      // (4 * 10_000 + 5_000) * 30_000 / 10_000 * 100_000 = 45_000 * 3 * 100_000 = 13_500_000_000
      // With ~2e12 balance, blocks to drain: (2e12 - 1.35e12) / 13.5e9 ≈ 48 blocks
      // Add extra margin for fees accrued during reg/update
      await mineBlocks(provider, 60);

      // Liquidate
      const liqTx = await clusters.connect(liquidator).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      const liqReceipt = await liqTx.wait();
      const liqCluster = parseClusterFromEvent(clusters, liqReceipt, Events.CLUSTER_LIQUIDATED);

      // Verify cluster liquidated
      expect(liqCluster.active).to.equal(false);
      expect(liqCluster.balance).to.equal(0n);

      // Verify deviation reversed from operators
      for (const opId of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(0n);
      }

      // Verify DAO vUnits decreased by full cluster vUnits (baseline + deviation)
      // updateDAO(false, 2) removes baseline (2 * 10_000 = 20_000)
      // _executeLiquidation removes deviation (10_000)
      // Total removed = 30_000
      const daoVUnitsAfter = await clusters.getDaoTotalEthVUnits();
      expect(daoVUnitsBefore - daoVUnitsAfter).to.equal(newVUnits);

      // ethDaoValidatorCount decreased by 2
      expect(await clusters.getDaoEthValidatorCount()).to.equal(0);

      // Operator ethValidatorCount decreased
      for (const opId of operatorIds) {
        expect(await clusters.getOperatorEthValidatorCount(opId)).to.equal(0);
      }
    });
  });

  // ─── CM-15: Auto-Liquidation via updateClusterBalance ───

  describe("CM-15: Auto-Liquidation via updateClusterBalance", () => {
    it("EB increase triggers auto-liquidation, bounty goes to updater", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Create cluster with 1 validator, balance just above threshold at implicit vUnits
      // At implicit vUnits (10_000), threshold = 450_000_000_000
      // Set balance to 500 gwei (above threshold)
      const deposit = 500_000_000_000n; // 500 gwei
      const regTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: deposit },
      );
      const regReceipt = await regTx.wait();
      let cluster = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

      const clusterId = getClusterId(clusterOwner.address, operatorIds);

      // Verify NOT liquidatable at implicit vUnits
      const implicitThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_LIQ,
        numOperators: NUM_OPERATORS,
        ethFee: OP_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: defaultVUnits(1n),
      });
      expect(deposit).to.be.greaterThan(implicitThreshold);

      // Set EB root: effectiveBalance = 64 ETH (1 validator) → vUnits = ceil(64 * 10_000 / 32) = 20_000
      const ebBlockNum = 1;
      const effectiveBalance = 64; // doubles the vUnits
      const root = getEBRoot(clusterId, effectiveBalance);
      await clusters.mockSetEBRoot(ebBlockNum, root);

      // After EB update, threshold doubles (vUnits 10_000 → 20_000)
      // New threshold = 900_000_000_000 (900 gwei)
      // Balance ~= 500 gwei (minus fees) < 900 gwei → auto-liquidation!

      const updaterBalBefore = await provider.getBalance(liquidator.address);

      const updateTx = await clusters.connect(liquidator).updateClusterBalance(
        ebBlockNum, clusterOwner.address, operatorIds, cluster,
        effectiveBalance, [],
      );
      const updateReceipt = await updateTx.wait();

      // Both ClusterBalanceUpdated and ClusterLiquidated events should be emitted
      await expect(updateTx).to.emit(clusters, Events.CLUSTER_BALANCE_UPDATED);
      await expect(updateTx).to.emit(clusters, Events.CLUSTER_LIQUIDATED);

      // Compute exact bounty: fees settled at OLD implicit vUnits (10_000) before EB update
      const regBlock = regReceipt!.blockNumber;
      const updateBlock = updateReceipt!.blockNumber;
      const blockDiff = BigInt(updateBlock - regBlock);
      const oldVUnits = defaultVUnits(1n); // 10_000 (implicit)
      const feesAtOldVUnits = calcClusterBurn({
        blockDiff,
        numOperators: NUM_OPERATORS,
        ethFee: OP_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: oldVUnits,
      });
      const expectedBounty = deposit - feesAtOldVUnits;

      // Verify bounty goes to the updater (msg.sender)
      const gasUsed = updateReceipt!.gasUsed * updateReceipt!.gasPrice;
      const updaterBalAfter = await provider.getBalance(liquidator.address);
      const bountyReceived = updaterBalAfter - updaterBalBefore + gasUsed;
      expect(bountyReceived).to.equal(expectedBounty);

      // Verify operator deviation was added then removed during liquidation
      for (const opId of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(0n);
      }

      // Verify DAO state cleaned up
      expect(await clusters.getDaoEthValidatorCount()).to.equal(0);
    });
  });
});

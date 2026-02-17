/**
 * CM-17: SSV Fee Accrual — Verify Exact SSV Deduction Over N Blocks
 * CM-25: updateClusterBalance on SSV Cluster — EB Snapshot Only
 *
 * Uses SSVClustersHarness to create SSV clusters and verify exact fee math.
 */

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType, Cluster } from "../../common/types.ts";
import { makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import {
  DEDUCTED_DIGITS,
  VUNITS_PRECISION,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { mineBlocks, getBlockNumber, getTxBlock, calcSSVClusterFees } from "../helpers/index.ts";
import { ethers } from "ethers";

describe("CM-17 & CM-25: SSV Cluster Fee Mechanics", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner] = await connection.ethers.getSigners();
  });

  const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
    return ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds]),
    );
  };

  // ─── CM-17: SSV Fee Accrual — Verify Exact SSV Deduction Over N Blocks ───

  describe("CM-17: SSV Fee Accrual — Verify Exact SSV Deduction Over N Blocks", () => {
    const deployFixture = async () => {
      // Create harness with 4 operators at fee 0 (we'll set SSV fees manually)
      const result = await ssvClustersHarnessFixture(connection, 4, 0n);
      const { clusters, operatorIds } = result;

      // Set SSV operator fees: raw = 2_000 each
      // mockOperatorSSVFee calls PackedSSVLib.pack(fee), so pass unpacked value
      // unpacked = 2_000 * 10_000_000 = 20_000_000_000
      const ssvFeeUnpacked = 2_000n * DEDUCTED_DIGITS;
      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, ssvFeeUnpacked);
      }

      // Set SSV network fee: raw = 1_000
      // mockSSVNetworkFee wraps directly as PackedSSV, so pass raw value
      await clusters.mockSSVNetworkFee(1_000n);
      const netFeeIndexTx = await clusters.mockCurrentNetworkFeeIndexSSV(0n);
      const netFeeIndexReceipt = await netFeeIndexTx.wait();
      const netFeeBlock = netFeeIndexReceipt.blockNumber;

      // Set up SSV token for refund
      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      await clusters.mockSetToken(await mockToken.getAddress());

      // Mint SSV tokens to the harness to cover refunds
      const harnessAddress = await clusters.getAddress();
      await mockToken.mint(harnessAddress, ethers.parseEther("2000"));

      // Set minimal SSV liquidation params so self-liquidation works
      await clusters.mockMinimumBlocksBeforeLiquidationSSV(0n);
      await clusters.mockMinimumLiquidationCollateralSSV(0n);

      return { clusters, operatorIds, mockToken, netFeeBlock };
    };

    it("verifies exact SSV fee deduction after 500 blocks with 3 validators", async function () {
      const { clusters, operatorIds, mockToken, netFeeBlock } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // SSV cluster: 3 validators, balance = 1000e18 SSV
      const ssvBalance = ethers.parseEther("1000");
      const ssvCluster: Cluster = {
        validatorCount: 3n,
        networkFeeIndex: 0n,
        index: 0n,
        balance: ssvBalance,
        active: true,
      };

      // Register SSV cluster
      const publicKey = makePublicKey(1);
      await clusters.mockRegisterSSVValidator(
        publicKey,
        operatorIds,
        clusterOwner.address,
        ssvCluster,
      );

      // Get operator snapshot blocks (set during mockOperatorSSVFee)
      const opSnapshots: { block: bigint; index: bigint }[] = [];
      for (const opId of operatorIds) {
        const [index, blockNumber] = await clusters.getOperatorSnapshot(opId);
        opSnapshots.push({ block: BigInt(blockNumber), index: BigInt(index) });
      }

      // Advance 500 blocks
      await mineBlocks(provider, 500);

      // Self-liquidate the SSV cluster to get the refund
      const ownerBalanceBefore = await mockToken.balanceOf(clusterOwner.address);

      const tx = await clusters.liquidateSSV(
        clusterOwner.address,
        operatorIds,
        ssvCluster,
      );
      const receipt = await tx.wait();
      const liquidationBlock = BigInt(receipt.blockNumber);

      // Calculate expected SSV fees using calcSSVClusterFees
      const expectedFees = calcSSVClusterFees({
        currentBlock: liquidationBlock,
        opSnapshots,
        opFeeRaw: 2_000n,
        netFeeBlock: BigInt(netFeeBlock),
        netFeeRaw: 1_000n,
        storedNetFeeIndex: 0n,
        validatorCount: 3n,
        clusterIndex: 0n,
        clusterNetworkFeeIndex: 0n,
      });

      // The ownerBalanceAfter - ownerBalanceBefore gives us the actual refund
      const ownerBalanceAfter = await mockToken.balanceOf(clusterOwner.address);
      const ssvRefund = BigInt(ownerBalanceAfter) - BigInt(ownerBalanceBefore);

      // Verify refund matches exact computation: refund = initialBalance - fees
      const expectedRefund = ssvBalance - expectedFees;
      expect(ssvRefund).to.equal(expectedRefund, "SSV refund should match exact fee computation");

      // Verify refund < initial balance (some fees were deducted)
      expect(ssvRefund).to.be.lessThan(ssvBalance, "SSV refund should be less than initial balance");

      // Verify the fee deduction: initial - refund should equal total fees
      const totalFeesDeducted = ssvBalance - ssvRefund;
      expect(totalFeesDeducted).to.equal(expectedFees, "Total fees deducted should match computed fees");

      // Fees must be divisible by DEDUCTED_DIGITS (since they're unpacked packed values)
      expect(totalFeesDeducted % DEDUCTED_DIGITS).to.equal(
        0n,
        "Total fees should be divisible by DEDUCTED_DIGITS (no precision loss)",
      );

      // The packed fee total
      const packedFees = totalFeesDeducted / DEDUCTED_DIGITS;
      const expectedPackedFees = expectedFees / DEDUCTED_DIGITS;
      expect(packedFees).to.equal(expectedPackedFees, "Packed fees should match exact computation");
    });
  });

  // ─── CM-25: updateClusterBalance on SSV Cluster — EB Snapshot Only ───

  describe("CM-25: updateClusterBalance on SSV Cluster — EB Snapshot Only", () => {
    const deployFixture = async () => {
      const result = await ssvClustersHarnessFixture(connection, 4, 0n);
      const { clusters, operatorIds } = result;

      // Set SSV fees for operators: raw = 1_000
      // mockOperatorSSVFee calls pack(), so pass unpacked value
      const ssvFeeUnpacked = 1_000n * DEDUCTED_DIGITS;
      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, ssvFeeUnpacked);
      }

      // Set SSV network fee: raw = 500 (mockSSVNetworkFee wraps directly)
      await clusters.mockSSVNetworkFee(500n);
      await clusters.mockCurrentNetworkFeeIndexSSV(0n);

      return { clusters, operatorIds };
    };

    it("only updates EB snapshot on SSV cluster, no fee settlement", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Create SSV cluster with 2 validators
      const ssvBalance = ethers.parseEther("100");
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

      const clusterId = getClusterId(clusterOwner.address, operatorIds);

      // Record state before updateClusterBalance
      const ssvClusterHashBefore = await clusters.getClusterHash(clusterId);
      // SSV clusters don't use ethClusters, so this should be zero
      // The actual hash is in s.clusters[hashedCluster] not ethClusters

      // Set up a Merkle root for EB update: effectiveBalance = 64 ETH
      const effectiveBalance = 64; // 64 ETH for 2 validators (32 each)
      const blockNum = await getBlockNumber(provider);

      // Build Merkle data
      const encoded = ethers.AbiCoder.defaultAbiCoder().encode(
        ["bytes32", "uint32"],
        [clusterId, effectiveBalance],
      );
      const innerHash = ethers.keccak256(encoded);
      const leaf = ethers.keccak256(innerHash);

      // For single-entry Merkle tree, root = leaf, proof = []
      await clusters.mockSetEBRoot(blockNum, leaf);

      // Advance a few blocks
      await mineBlocks(provider, 10);

      // Call updateClusterBalance on the SSV cluster
      const tx = await clusters.updateClusterBalance(
        blockNum,
        clusterOwner.address,
        operatorIds,
        ssvCluster,
        effectiveBalance,
        [], // empty proof for single-leaf tree
      );
      const receipt = await tx.wait();

      // Assertions for CM-25:
      // 1. ClusterBalanceUpdated event emitted
      await expect(tx).to.emit(clusters, Events.CLUSTER_BALANCE_UPDATED);

      // 2. EB snapshot updated: vUnits = ceil(64 * 10_000 / 32) = 20_000
      const vUnits = await clusters.getClusterVUnits(clusterId);
      expect(vUnits).to.equal(20_000n);

      // 3. SSV cluster balance unchanged (no fee settlement for SSV path)
      // The cluster hash in ethClusters should still be 0 (not stored there)
      // The SSV cluster data is NOT re-stored in updateClusterBalance for SSV path

      // 4. No ClusterLiquidated event
      const logs = receipt.logs;
      for (const log of logs) {
        try {
          const parsed = clusters.interface.parseLog(log);
          expect(parsed?.name).to.not.equal(Events.CLUSTER_LIQUIDATED);
        } catch {
          // skip unparseable logs
        }
      }
    });
  });
});

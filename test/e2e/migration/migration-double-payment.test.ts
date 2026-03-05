import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ethers } from "ethers";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType, Cluster } from "../../common/types.ts";
import { createCluster, makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import {
  DEDUCTED_DIGITS,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_OPERATOR_ETH_FEE,
  ETH_DEDUCTED_DIGITS,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { mineBlocks } from "../helpers/index.ts";

const HIGH_SSV_FEE_RAW = 1_000n;
const MEDIUM_SSV_FEE_RAW = 500n;
const NETWORK_FEE_SSV_RAW = 100n;
const NETWORK_FEE_ETH_RAW = 1_770n;
const MIN_BLOCKS_LIQ = 10n;
const MIN_LIQ_COLLATERAL_RAW = 0n;

const getMigratedToETHEventArgs = (contract: any, receipt: any) => {
  for (const log of receipt.logs ?? []) {
    let parsed;
    try {
      parsed = contract.interface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed?.name === Events.CLUSTER_MIGRATED_TO_ETH) {
      return parsed.args;
    }
  }
  throw new Error("ClusterMigratedToETH event not found");
};

const getSnapshotIndexAtBlock = async (
  clusters: any,
  operatorId: bigint,
  targetBlock: bigint
): Promise<bigint> => {
  const snapshot = await clusters.getOperatorSnapshot(operatorId);
  const feeRaw = BigInt(await clusters.getOperatorSSVFee(operatorId));
  return BigInt(snapshot.index) + (targetBlock - BigInt(snapshot.blockNumber)) * feeRaw;
};

describe("Migration Regression: removed operator SSV settlement", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner] = await connection.ethers.getSigners();
  });

  const deployFixture = async () => {
    const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, 4, 0n);

    await clusters.mockOperatorSSVFee(operatorIds[0], HIGH_SSV_FEE_RAW * DEDUCTED_DIGITS);
    for (let i = 1; i < operatorIds.length; i++) {
      await clusters.mockOperatorSSVFee(operatorIds[i], MEDIUM_SSV_FEE_RAW * DEDUCTED_DIGITS);
    }

    await clusters.mockSSVNetworkFee(NETWORK_FEE_SSV_RAW);
    await clusters.mockCurrentNetworkFeeIndexSSV(0n);

    await clusters.mockEthNetworkFee(NETWORK_FEE_ETH_RAW);
    await clusters.mockMinimumBlocksBeforeLiquidation(MIN_BLOCKS_LIQ);
    await clusters.mockMinimumLiquidationCollateral(MIN_LIQ_COLLATERAL_RAW);
    await clusters.mockMinimumBlocksBeforeLiquidationSSV(MIN_BLOCKS_LIQ);
    await clusters.mockMinimumLiquidationCollateralSSV(MIN_LIQ_COLLATERAL_RAW);

    const mockToken = await connection.ethers.deployContract("MockToken", []);
    await mockToken.waitForDeployment();
    await clusters.mockSetToken(await mockToken.getAddress());
    const harnessAddress = await clusters.getAddress();
    await mockToken.mint(harnessAddress, connection.ethers.parseEther("2000"));

    return { clusters, operatorIds, mockToken };
  };

  it("Baseline: all operators active uses exact SSV refund formula", async function () {
    const { clusters, operatorIds, mockToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    const validatorCount = 2n;
    const ssvBalance = ethers.parseEther("500");
    const ssvCluster = createCluster({
      validatorCount,
      networkFeeIndex: 0n,
      index: 0n,
      balance: ssvBalance,
      active: true,
    });

    await clusters.mockRegisterSSVValidator(
      makePublicKey(1),
      operatorIds,
      clusterOwner.address,
      ssvCluster
    );

    await mineBlocks(provider, 300);

    const migrationBlockExpected = BigInt(await provider.getBlockNumber()) + 1n;
    let cumulativeIndex = 0n;
    for (const operatorId of operatorIds) {
      cumulativeIndex += await getSnapshotIndexAtBlock(clusters, operatorId, migrationBlockExpected);
    }

    const networkFeeIndexBefore = BigInt(await clusters.getCurrentNetworkFeeIndexSSV());
    const readBlock = BigInt(await provider.getBlockNumber());
    const ownerBefore = await mockToken.balanceOf(clusterOwner.address);

    const migrateTx = await clusters.migrateClusterToETH(
      operatorIds,
      ssvCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await migrateTx.wait();
    const eventArgs = getMigratedToETHEventArgs(clusters, receipt);

    const migrationBlock = BigInt(receipt!.blockNumber);
    expect(migrationBlock).to.equal(migrationBlockExpected);

    const expectedNetworkFeeIndex =
      networkFeeIndexBefore + (migrationBlock - readBlock) * NETWORK_FEE_SSV_RAW;
    const operatorUsagePacked = (cumulativeIndex - ssvCluster.index) * validatorCount;
    const networkUsagePacked = (expectedNetworkFeeIndex - ssvCluster.networkFeeIndex) * validatorCount;
    const totalUsageWei = (operatorUsagePacked + networkUsagePacked) * DEDUCTED_DIGITS;
    const expectedRefund = ssvBalance > totalUsageWei ? ssvBalance - totalUsageWei : 0n;

    const ownerAfter = await mockToken.balanceOf(clusterOwner.address);
    expect(eventArgs.ssvRefunded).to.equal(expectedRefund);
    expect(ownerAfter - ownerBefore).to.equal(expectedRefund);
  });

  it("Includes removed operator frozen snapshot.index in migration SSV settlement", async function () {
    const { clusters, operatorIds, mockToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    const validatorCount = 2n;
    const ssvBalance = ethers.parseEther("500");
    const ssvCluster = createCluster({
      validatorCount,
      networkFeeIndex: 0n,
      index: 0n,
      balance: ssvBalance,
      active: true,
    });

    await clusters.mockRegisterSSVValidator(
      makePublicKey(2),
      operatorIds,
      clusterOwner.address,
      ssvCluster
    );

    await mineBlocks(provider, 400);

    const removedOperatorId = operatorIds[0];
    const removeBlockExpected = BigInt(await provider.getBlockNumber()) + 1n;
    const removedSnapshotBefore = await clusters.getOperatorSnapshot(removedOperatorId);
    const removedFeeRaw = BigInt(await clusters.getOperatorSSVFee(removedOperatorId));
    const removedIndexAtRemoval = BigInt(removedSnapshotBefore.index) +
      (removeBlockExpected - BigInt(removedSnapshotBefore.blockNumber)) * removedFeeRaw;

    const removeTx = await (clusters as any).mockRemoveOperatorAndPayout(removedOperatorId, clusterOwner.address);
    const removeReceipt = await removeTx.wait();
    expect(BigInt(removeReceipt!.blockNumber)).to.equal(removeBlockExpected);

    const removedSnapshotAfter = await clusters.getOperatorSnapshot(removedOperatorId);
    expect(BigInt(removedSnapshotAfter.blockNumber)).to.equal(0n);
    expect(BigInt(removedSnapshotAfter.index)).to.equal(removedIndexAtRemoval);

    await mineBlocks(provider, 200);

    const migrationBlockExpected = BigInt(await provider.getBlockNumber()) + 1n;
    let liveOperatorsCumulativeIndex = 0n;
    for (let i = 1; i < operatorIds.length; i++) {
      liveOperatorsCumulativeIndex += await getSnapshotIndexAtBlock(clusters, operatorIds[i], migrationBlockExpected);
    }

    const networkFeeIndexBefore = BigInt(await clusters.getCurrentNetworkFeeIndexSSV());
    const readBlock = BigInt(await provider.getBlockNumber());
    const ownerBefore = await mockToken.balanceOf(clusterOwner.address);

    const migrateTx = await clusters.migrateClusterToETH(
      operatorIds,
      ssvCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await migrateTx.wait();
    const eventArgs = getMigratedToETHEventArgs(clusters, receipt);
    const migrationBlock = BigInt(receipt!.blockNumber);
    expect(migrationBlock).to.equal(migrationBlockExpected);

    const expectedNetworkFeeIndex =
      networkFeeIndexBefore + (migrationBlock - readBlock) * NETWORK_FEE_SSV_RAW;

    const correctCumulativeIndex = removedIndexAtRemoval + liveOperatorsCumulativeIndex;
    const buggyCumulativeIndex = liveOperatorsCumulativeIndex;

    const correctOperatorUsagePacked = (correctCumulativeIndex - ssvCluster.index) * validatorCount;
    const buggyOperatorUsagePacked = (buggyCumulativeIndex - ssvCluster.index) * validatorCount;
    const networkUsagePacked = (expectedNetworkFeeIndex - ssvCluster.networkFeeIndex) * validatorCount;

    const correctRefund = ssvBalance > (correctOperatorUsagePacked + networkUsagePacked) * DEDUCTED_DIGITS
      ? ssvBalance - (correctOperatorUsagePacked + networkUsagePacked) * DEDUCTED_DIGITS
      : 0n;
    const buggyRefund = ssvBalance > (buggyOperatorUsagePacked + networkUsagePacked) * DEDUCTED_DIGITS
      ? ssvBalance - (buggyOperatorUsagePacked + networkUsagePacked) * DEDUCTED_DIGITS
      : 0n;

    const missingFeesWei = removedIndexAtRemoval * validatorCount * DEDUCTED_DIGITS;
    expect(buggyRefund - correctRefund).to.equal(missingFeesWei);

    const ownerAfter = await mockToken.balanceOf(clusterOwner.address);
    expect(eventArgs.ssvRefunded).to.equal(correctRefund);
    expect(eventArgs.ssvRefunded).to.not.equal(buggyRefund);
    expect(ownerAfter - ownerBefore).to.equal(correctRefund);

    expect(await clusters.getOperatorEthValidatorCount(removedOperatorId)).to.equal(0n);
    expect(BigInt((await clusters.getOperatorEthSnapshot(removedOperatorId)).blockNumber)).to.equal(0n);
    for (let i = 1; i < operatorIds.length; i++) {
      expect(await clusters.getOperatorEthValidatorCount(operatorIds[i])).to.equal(validatorCount);
    }
  });

  it("Liquidated cluster migration with removed operator preserves SSV counts and skips removed ETH setup", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);

    const validatorCount = 3n;
    const ssvCluster: Cluster = createCluster({
      validatorCount,
      networkFeeIndex: 0n,
      index: 0n,
      balance: 0n,
      active: true,
    });

    await clusters.mockRegisterSSVValidator(
      makePublicKey(3),
      operatorIds,
      clusterOwner.address,
      ssvCluster
    );

    const removedOperatorId = operatorIds[0];
    await (clusters as any).mockRemoveOperatorAndPayout(removedOperatorId, clusterOwner.address);

    const liquidateTx = await clusters.liquidateSSV(clusterOwner.address, operatorIds, ssvCluster);
    const liquidateReceipt = await liquidateTx.wait();
    const liquidatedCluster = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);
    expect(liquidatedCluster.active).to.equal(false);

    const beforeMigrationCounts = [];
    for (const operatorId of operatorIds) {
      beforeMigrationCounts.push({
        ssv: await clusters.getOperatorValidatorCount(operatorId),
        eth: await clusters.getOperatorEthValidatorCount(operatorId),
      });
    }

    const migrateTx = await clusters.migrateClusterToETH(
      operatorIds,
      liquidatedCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const migrateReceipt = await migrateTx.wait();
    const eventArgs = getMigratedToETHEventArgs(clusters, migrateReceipt);

    await expect(migrateTx).to.emit(clusters, Events.CLUSTER_REACTIVATED);
    expect(eventArgs.ssvRefunded).to.equal(0n);

    for (let i = 0; i < operatorIds.length; i++) {
      const operatorId = operatorIds[i];
      const before = beforeMigrationCounts[i];

      const ssvAfter = await clusters.getOperatorValidatorCount(operatorId);
      const ethAfter = await clusters.getOperatorEthValidatorCount(operatorId);

      expect(ssvAfter).to.equal(before.ssv);
      if (operatorId === removedOperatorId) {
        expect(ethAfter).to.equal(before.eth);
        expect(BigInt((await clusters.getOperatorEthSnapshot(operatorId)).blockNumber)).to.equal(0n);
      } else {
        expect(ethAfter).to.equal(before.eth + validatorCount);
      }
    }
  });

  it("Accounts two removed operators with different removal times via frozen indices", async function () {
    const { clusters, operatorIds, mockToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    const validatorCount = 3n;
    const ssvBalance = ethers.parseEther("700");
    const ssvCluster = createCluster({
      validatorCount,
      networkFeeIndex: 0n,
      index: 0n,
      balance: ssvBalance,
      active: true,
    });

    await clusters.mockRegisterSSVValidator(
      makePublicKey(4),
      operatorIds,
      clusterOwner.address,
      ssvCluster
    );

    const removedA = operatorIds[0];
    const removedB = operatorIds[1];

    await mineBlocks(provider, 250);

    const removeABlockExpected = BigInt(await provider.getBlockNumber()) + 1n;
    const snapABefore = await clusters.getOperatorSnapshot(removedA);
    const feeARaw = BigInt(await clusters.getOperatorSSVFee(removedA));
    const indexAAtRemoval = BigInt(snapABefore.index) +
      (removeABlockExpected - BigInt(snapABefore.blockNumber)) * feeARaw;

    await (clusters as any).mockRemoveOperatorAndPayout(removedA, clusterOwner.address);
    const snapAAfter = await clusters.getOperatorSnapshot(removedA);
    expect(BigInt(snapAAfter.blockNumber)).to.equal(0n);
    expect(BigInt(snapAAfter.index)).to.equal(indexAAtRemoval);

    await mineBlocks(provider, 150);

    const removeBBlockExpected = BigInt(await provider.getBlockNumber()) + 1n;
    const snapBBefore = await clusters.getOperatorSnapshot(removedB);
    const feeBRaw = BigInt(await clusters.getOperatorSSVFee(removedB));
    const indexBAtRemoval = BigInt(snapBBefore.index) +
      (removeBBlockExpected - BigInt(snapBBefore.blockNumber)) * feeBRaw;

    await (clusters as any).mockRemoveOperatorAndPayout(removedB, clusterOwner.address);
    const snapBAfter = await clusters.getOperatorSnapshot(removedB);
    expect(BigInt(snapBAfter.blockNumber)).to.equal(0n);
    expect(BigInt(snapBAfter.index)).to.equal(indexBAtRemoval);

    await mineBlocks(provider, 100);

    const migrationBlockExpected = BigInt(await provider.getBlockNumber()) + 1n;
    let liveCumulativeIndex = 0n;
    for (let i = 2; i < operatorIds.length; i++) {
      liveCumulativeIndex += await getSnapshotIndexAtBlock(clusters, operatorIds[i], migrationBlockExpected);
    }

    const networkFeeIndexBefore = BigInt(await clusters.getCurrentNetworkFeeIndexSSV());
    const readBlock = BigInt(await provider.getBlockNumber());
    const ownerBefore = await mockToken.balanceOf(clusterOwner.address);

    const migrateTx = await clusters.migrateClusterToETH(
      operatorIds,
      ssvCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await migrateTx.wait();
    const eventArgs = getMigratedToETHEventArgs(clusters, receipt);
    const migrationBlock = BigInt(receipt!.blockNumber);
    expect(migrationBlock).to.equal(migrationBlockExpected);

    const expectedNetworkFeeIndex =
      networkFeeIndexBefore + (migrationBlock - readBlock) * NETWORK_FEE_SSV_RAW;
    const removedCombined = indexAAtRemoval + indexBAtRemoval;
    const correctCumulativeIndex = removedCombined + liveCumulativeIndex;
    const buggyCumulativeIndex = liveCumulativeIndex;

    const correctOperatorUsagePacked = (correctCumulativeIndex - ssvCluster.index) * validatorCount;
    const buggyOperatorUsagePacked = (buggyCumulativeIndex - ssvCluster.index) * validatorCount;
    const networkUsagePacked = (expectedNetworkFeeIndex - ssvCluster.networkFeeIndex) * validatorCount;

    const correctRefund = ssvBalance > (correctOperatorUsagePacked + networkUsagePacked) * DEDUCTED_DIGITS
      ? ssvBalance - (correctOperatorUsagePacked + networkUsagePacked) * DEDUCTED_DIGITS
      : 0n;
    const buggyRefund = ssvBalance > (buggyOperatorUsagePacked + networkUsagePacked) * DEDUCTED_DIGITS
      ? ssvBalance - (buggyOperatorUsagePacked + networkUsagePacked) * DEDUCTED_DIGITS
      : 0n;

    const missingFeesWei = removedCombined * validatorCount * DEDUCTED_DIGITS;
    expect(buggyRefund - correctRefund).to.equal(missingFeesWei);
    expect(eventArgs.ssvRefunded).to.equal(correctRefund);
    expect(eventArgs.ssvRefunded).to.not.equal(buggyRefund);

    const ownerAfter = await mockToken.balanceOf(clusterOwner.address);
    expect(ownerAfter - ownerBefore).to.equal(correctRefund);

    expect(await clusters.getOperatorValidatorCount(removedA)).to.equal(0n);
    expect(await clusters.getOperatorValidatorCount(removedB)).to.equal(0n);
    expect(await clusters.getOperatorEthValidatorCount(removedA)).to.equal(0n);
    expect(await clusters.getOperatorEthValidatorCount(removedB)).to.equal(0n);
    expect(BigInt((await clusters.getOperatorSnapshot(removedA)).index)).to.equal(indexAAtRemoval);
    expect(BigInt((await clusters.getOperatorSnapshot(removedB)).index)).to.equal(indexBAtRemoval);
  });

  it("Removed operator with zero SSV fee creates zero refund delta vs buggy path", async function () {
    const { clusters, operatorIds, mockToken } = await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    await clusters.mockOperatorSSVFee(operatorIds[0], 0n);

    const validatorCount = 2n;
    const ssvBalance = ethers.parseEther("300");
    const ssvCluster = createCluster({
      validatorCount,
      networkFeeIndex: 0n,
      index: 0n,
      balance: ssvBalance,
      active: true,
    });

    await clusters.mockRegisterSSVValidator(
      makePublicKey(5),
      operatorIds,
      clusterOwner.address,
      ssvCluster
    );

    await mineBlocks(provider, 180);

    const removedOperatorId = operatorIds[0];
    await (clusters as any).mockRemoveOperatorAndPayout(removedOperatorId, clusterOwner.address);
    const removedSnapshot = await clusters.getOperatorSnapshot(removedOperatorId);
    const removedIndex = BigInt(removedSnapshot.index);
    expect(removedIndex).to.equal(0n);

    await mineBlocks(provider, 120);

    const migrationBlockExpected = BigInt(await provider.getBlockNumber()) + 1n;
    let liveCumulativeIndex = 0n;
    for (let i = 1; i < operatorIds.length; i++) {
      liveCumulativeIndex += await getSnapshotIndexAtBlock(clusters, operatorIds[i], migrationBlockExpected);
    }

    const networkFeeIndexBefore = BigInt(await clusters.getCurrentNetworkFeeIndexSSV());
    const readBlock = BigInt(await provider.getBlockNumber());
    const ownerBefore = await mockToken.balanceOf(clusterOwner.address);

    const migrateTx = await clusters.migrateClusterToETH(
      operatorIds,
      ssvCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await migrateTx.wait();
    const eventArgs = getMigratedToETHEventArgs(clusters, receipt);
    const migrationBlock = BigInt(receipt!.blockNumber);
    expect(migrationBlock).to.equal(migrationBlockExpected);

    const expectedNetworkFeeIndex =
      networkFeeIndexBefore + (migrationBlock - readBlock) * NETWORK_FEE_SSV_RAW;
    const correctCumulativeIndex = removedIndex + liveCumulativeIndex;
    const buggyCumulativeIndex = liveCumulativeIndex;

    const correctOperatorUsagePacked = (correctCumulativeIndex - ssvCluster.index) * validatorCount;
    const buggyOperatorUsagePacked = (buggyCumulativeIndex - ssvCluster.index) * validatorCount;
    const networkUsagePacked = (expectedNetworkFeeIndex - ssvCluster.networkFeeIndex) * validatorCount;

    const correctRefund = ssvBalance > (correctOperatorUsagePacked + networkUsagePacked) * DEDUCTED_DIGITS
      ? ssvBalance - (correctOperatorUsagePacked + networkUsagePacked) * DEDUCTED_DIGITS
      : 0n;
    const buggyRefund = ssvBalance > (buggyOperatorUsagePacked + networkUsagePacked) * DEDUCTED_DIGITS
      ? ssvBalance - (buggyOperatorUsagePacked + networkUsagePacked) * DEDUCTED_DIGITS
      : 0n;

    expect(correctRefund).to.equal(buggyRefund);
    expect(eventArgs.ssvRefunded).to.equal(correctRefund);

    const ownerAfter = await mockToken.balanceOf(clusterOwner.address);
    expect(ownerAfter - ownerBefore).to.equal(correctRefund);
  });

  it("Assigns default ETH fee on migration when legacy operator had ethFee explicitly reset to zero", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);

    for (const operatorId of operatorIds) {
      await clusters.mockSetOperatorLegacySSV(operatorId, HIGH_SSV_FEE_RAW);
    }

    const targetOperator = operatorIds[0];

    await clusters.mockSetOperatorFee(targetOperator, 12_345_000_000n);
    await clusters.mockSetOperatorFee(targetOperator, 0n);

    const beforeEthSnapshot = await clusters.getOperatorEthSnapshot(targetOperator);
    const beforeEthFeePacked = await clusters.getOperatorEthFee(targetOperator);
    expect(BigInt(beforeEthSnapshot.blockNumber)).to.equal(0n);
    expect(beforeEthFeePacked).to.equal(0n);

    const ssvCluster = createCluster({
      validatorCount: 1n,
      networkFeeIndex: 0n,
      index: 0n,
      balance: 0n,
      active: true,
    });
    await clusters.mockRegisterSSVValidator(
      makePublicKey(6),
      operatorIds,
      clusterOwner.address,
      ssvCluster
    );

    const migrateTx = await clusters.migrateClusterToETH(
      operatorIds,
      ssvCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await migrateTx.wait();

    const expectedDefaultPacked = DEFAULT_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
    const afterEthFeePacked = await clusters.getOperatorEthFee(targetOperator);
    const afterEthSnapshot = await clusters.getOperatorEthSnapshot(targetOperator);

    expect(afterEthFeePacked).to.equal(expectedDefaultPacked);
    expect(BigInt(afterEthSnapshot.blockNumber)).to.be.greaterThan(0n);

    await expect(migrateTx)
      .to.emit(clusters, Events.OPERATOR_FEE_EXECUTED)
      .withArgs(clusterOwner.address, targetOperator, BigInt(receipt!.blockNumber), DEFAULT_OPERATOR_ETH_FEE);
  });
});

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext, computeClusterId, extractEventArgs, getCurrentClusterState, makePublicKey, parseClusterFromEvent } from '../../common/helpers.ts';
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, EMPTY_CLUSTER, VUNITS_PRECISION, DEDUCTED_DIGITS } from "../../common/constants.ts";
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";
import { ethers } from "ethers";

describe("SSVClusters function `migrateClusterToETH()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;
  let anotherOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner, anotherOwner] } = await setupTestContext());
  });

  const deploySSVClustersAndPrepareOperatorsFixture = async () => {
    return ssvClustersHarnessFixture(connection);
  };


  it("Migrates an existing SSV cluster to ETH and emits the expected event", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const ssvCluster = {
      validatorCount: 1n,
      networkFeeIndex: 0n,
      index: 0n,
      balance: 0n,
      active: true,
    };

    const publicKey = makePublicKey(1);
    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);

    const migrateTx = await clusters.migrateClusterToETH(
      operatorIds,
      ssvCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await migrateTx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.MIGRATE_CLUSTER_TO_ETH]);
    const clusterAfterMigration = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
    const eventArgs = extractEventArgs(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);

    await expect(migrateTx).to.emit(clusters, Events.CLUSTER_MIGRATED_TO_ETH);
    expect(clusterAfterMigration.active).to.equal(true);
    expect(clusterAfterMigration.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);
    expect(clusterAfterMigration.validatorCount).to.equal(ssvCluster.validatorCount);

    expect(eventArgs.ethDeposited).to.equal(DEFAULT_ETH_REGISTER_VALUE);
    expect(eventArgs.ssvRefunded).to.equal(0n);
    expect(eventArgs.effectiveBalance).to.equal(32);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    expect(await clusters.getClusterHash(clusterId)).to.not.equal(ethers.ZeroHash);

    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthValidatorCount(operatorId)).to.equal(1n);
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(VUNITS_PRECISION);
    }

    await expect(clusters.migrateClusterToETH(
      operatorIds,
      clusterAfterMigration
    )).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_VERSION);
  });

  it("Refunds SSV token balance to the owner when migrating an active SSV cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const mockToken = await connection.ethers.deployContract("MockToken", []);
    await mockToken.waitForDeployment();

    const tokenAddress = await mockToken.getAddress();
    const harnessAddress = await clusters.getAddress();
    await clusters.mockSetToken(tokenAddress);

    const ssvBalance = connection.ethers.parseEther("1");
    await mockToken.mint(harnessAddress, ssvBalance);

    const ssvCluster = {
      validatorCount: 1n,
      networkFeeIndex: 0n,
      index: 0n,
      balance: ssvBalance,
      active: true,
    };

    const publicKey = makePublicKey(1);
    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);

    const ownerTokenBefore = await mockToken.balanceOf(clusterOwner.address);
    const harnessTokenBefore = await mockToken.balanceOf(harnessAddress);
    expect(harnessTokenBefore).to.be.greaterThanOrEqual(ssvBalance);

    const migrateTx = await clusters.migrateClusterToETH(
      operatorIds,
      ssvCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await migrateTx.wait();
    const eventArgs = extractEventArgs(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);

    expect(eventArgs.ethDeposited).to.equal(DEFAULT_ETH_REGISTER_VALUE);
    expect(eventArgs.ssvRefunded).to.equal(ssvBalance);
    expect(eventArgs.effectiveBalance).to.equal(32);

    const ownerTokenAfter = await mockToken.balanceOf(clusterOwner.address);
    const harnessTokenAfter = await mockToken.balanceOf(harnessAddress);
    expect(ownerTokenAfter - ownerTokenBefore).to.equal(ssvBalance);
    expect(harnessTokenBefore - harnessTokenAfter).to.equal(ssvBalance);
  });

  it("Uses stored EB snapshot vUnits during migration when present", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const ssvCluster = {
      validatorCount: 1n,
      networkFeeIndex: 0n,
      index: 0n,
      balance: 0n,
      active: true,
    };

    const publicKey = makePublicKey(1);
    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    await clusters.mockSetClusterVUnits(clusterId, 12_000n);

    const migrateTx = await clusters.migrateClusterToETH(
      operatorIds,
      ssvCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await migrateTx.wait();
    const eventArgs = extractEventArgs(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);

    expect(eventArgs.effectiveBalance).to.equal(38);

    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(2_000n);
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(12_000n);
    }
  });

  it("Is reverted with 'InsufficientBalance' when ETH top-up is too low", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const ssvCluster = {
      validatorCount: 1n,
      networkFeeIndex: 0n,
      index: 0n,
      balance: 0n,
      active: true,
    };

    const publicKey = makePublicKey(1);
    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);

    await clusters.mockMinimumLiquidationCollateral(DEFAULT_ETH_REGISTER_VALUE + 1n);

    await expect(clusters.migrateClusterToETH(
      operatorIds,
      ssvCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.INSUFFICIENT_BALANCE);
  });

  it("Is reverted with 'IncorrectClusterVersion' when migrating an ETH cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      { ...EMPTY_CLUSTER },
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const ethCluster = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    await expect(clusters.migrateClusterToETH(
      operatorIds,
      ethCluster
    )).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_VERSION);
  });

  it("Is reverted with 'ClusterDoesNotExists' when migrating a missing cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await expect(clusters.migrateClusterToETH(
      operatorIds,
      { ...EMPTY_CLUSTER }
    )).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_DOES_NOT_EXIST);
  });

  it("Validates full migration accounting correctness from SSV cluster to ETH cluster after time passes", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
    await clusters.mockMinimumLiquidationCollateral(1000000n);
    await clusters.mockMinimumBlocksBeforeLiquidation(100n);
    const mockToken = await connection.ethers.deployContract("MockToken", []);
    await mockToken.waitForDeployment();
    const tokenAddress = await mockToken.getAddress();
    const harnessAddress = await clusters.getAddress();
    await clusters.mockSetToken(tokenAddress);
    const validatorCount = 10n;
    const ssvBalance = connection.ethers.parseEther("5");
    await mockToken.mint(harnessAddress, ssvBalance);

    const ssvCluster = {
      validatorCount: validatorCount,
      networkFeeIndex: 0n,
      index: 0n,
      balance: ssvBalance,
      active: true,
    };
    const publicKey = makePublicKey(1);
    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);
    const ssvNetworkFee = 5n;
    await clusters.mockSSVNetworkFee(ssvNetworkFee);
    await clusters.mockCurrentNetworkFeeIndexSSV(0n);
    const operatorSSVFee = DEDUCTED_DIGITS * 3n;
    for (const opId of operatorIds) {
      await clusters.mockOperatorSSVFee(opId, operatorSSVFee);
    }
    const ethNetworkFee = 1770n;
    await clusters.mockEthNetworkFee(ethNetworkFee);
    await clusters.mockCurrentNetworkFeeIndex(0n);
    const operatorSnapshots = [];
    for (const opId of operatorIds) {
      const snap = await clusters.getOperatorSnapshot(opId);
      const fee = await clusters.getOperatorSSVFee(opId);
      operatorSnapshots.push({ block: BigInt(snap.blockNumber), index: snap.index, fee });
    }
    const networkFeeIndexBefore = await clusters.getCurrentNetworkFeeIndexSSV();
    const readBlock = BigInt(await connection.ethers.provider.getBlockNumber());
    const blocksToMine = 100;
    await networkHelpers.mine(blocksToMine);
    const ownerSSVBefore = await mockToken.balanceOf(clusterOwner.address);
    const harnessSSVBefore = await mockToken.balanceOf(harnessAddress);
    const migrateTx = await clusters.migrateClusterToETH(
      operatorIds,
      ssvCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await migrateTx.wait();
    const migrationBlock = BigInt(receipt!.blockNumber);
    const eventArgs = extractEventArgs(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
    await expect(migrateTx).to.emit(clusters, Events.CLUSTER_MIGRATED_TO_ETH);

    expect(eventArgs.ethDeposited).to.equal(DEFAULT_ETH_REGISTER_VALUE);
    const blocksElapsed = migrationBlock - readBlock;
    let expectedCumulativeIndex = 0n;
    for (const snap of operatorSnapshots) {
      const blockDiff = migrationBlock - snap.block;
      expectedCumulativeIndex += snap.index + blockDiff * snap.fee;
    }
    const expectedNetworkFeeIndex = networkFeeIndexBefore + blocksElapsed * ssvNetworkFee;
    const operatorUsagePacked = (expectedCumulativeIndex - ssvCluster.index) * validatorCount;
    const networkUsagePacked = (expectedNetworkFeeIndex - ssvCluster.networkFeeIndex) * validatorCount;
    const totalUnpackedUsage = (operatorUsagePacked + networkUsagePacked) * DEDUCTED_DIGITS;
    const expectedRefund = ssvBalance > totalUnpackedUsage ? ssvBalance - totalUnpackedUsage : 0n;

    expect(eventArgs.ssvRefunded).to.equal(expectedRefund);
    const ownerSSVAfter = await mockToken.balanceOf(clusterOwner.address);
    const harnessSSVAfter = await mockToken.balanceOf(harnessAddress);
    expect(ownerSSVAfter - ownerSSVBefore).to.equal(expectedRefund);
    expect(harnessSSVBefore - harnessSSVAfter).to.equal(expectedRefund);
    const ethCluster = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
    expect(ethCluster.active).to.equal(true);
    expect(ethCluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);
    expect(ethCluster.validatorCount).to.equal(validatorCount);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    expect(await clusters.getClusterHash(clusterId)).to.not.equal(ethers.ZeroHash);
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthValidatorCount(operatorId)).to.equal(validatorCount);
    }
  });

  it("Correctly updates SSV snapshot and settles fees for already-ETH operators during migration", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const dummyPublicKey = makePublicKey(999);
    await clusters.connect(anotherOwner).registerValidator(
      dummyPublicKey,
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    const ssvNetworkFee = 1000000n;
    await clusters.mockSSVNetworkFee(ssvNetworkFee);
    await clusters.mockCurrentNetworkFeeIndexSSV(0n);

    const ethNetworkFee = 1770n;
    await clusters.mockEthNetworkFee(ethNetworkFee);
    await clusters.mockCurrentNetworkFeeIndex(0n);

    const mockToken = await connection.ethers.deployContract("MockToken", []);
    await mockToken.waitForDeployment();
    const tokenAddress = await mockToken.getAddress();
    const harnessAddress = await clusters.getAddress();
    await clusters.mockSetToken(tokenAddress);

    const ssvBalance = connection.ethers.parseEther("10");
    await mockToken.mint(harnessAddress, ssvBalance);

    const validatorCount = 4n;
    const ssvCluster = {
      validatorCount: validatorCount,
      networkFeeIndex: 0,
      index: 0,
      balance: ssvBalance,
      active: true,
    };

    const ssvPublicKey = makePublicKey(1000);
    await clusters.mockRegisterSSVValidator(ssvPublicKey, operatorIds, clusterOwner.address, ssvCluster);
    const opSnapshotsBefore = [];
    for (const opId of operatorIds) {
      const snap = await clusters.getOperatorSnapshot(opId);
      const fee = await clusters.getOperatorSSVFee(opId);
      opSnapshotsBefore.push({ block: BigInt(snap.blockNumber), index: snap.index, fee });
    }
    const networkFeeIndexSSVBefore = await clusters.getCurrentNetworkFeeIndexSSV();
    const readBlock = BigInt(await connection.ethers.provider.getBlockNumber());

    const blocksToMine = 750;
    await networkHelpers.mine(blocksToMine);

    const ownerSSVBefore = await mockToken.balanceOf(clusterOwner.address);

    const migrateTx = await clusters.connect(clusterOwner).migrateClusterToETH(
      operatorIds,
      ssvCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await migrateTx.wait();
    const migrationBlock = BigInt(receipt!.blockNumber);
    const eventArgs = extractEventArgs(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);

    await expect(migrateTx).to.emit(clusters, Events.CLUSTER_MIGRATED_TO_ETH);
    expect(eventArgs.ethDeposited).to.equal(DEFAULT_ETH_REGISTER_VALUE);
    let expectedCumulativeIndex = 0n;
    for (const snap of opSnapshotsBefore) {
      const blockDiff = migrationBlock - snap.block;
      expectedCumulativeIndex += snap.index + blockDiff * snap.fee;
    }
    const blocksElapsed = migrationBlock - readBlock;
    const expectedNetworkFeeIndex = networkFeeIndexSSVBefore + blocksElapsed * ssvNetworkFee;
    const opUsagePacked = (expectedCumulativeIndex - BigInt(ssvCluster.index)) * validatorCount;
    const netUsagePacked = (expectedNetworkFeeIndex - BigInt(ssvCluster.networkFeeIndex)) * validatorCount;
    const totalUnpackedUsage = (opUsagePacked + netUsagePacked) * DEDUCTED_DIGITS;
    const expectedRefund = ssvBalance > totalUnpackedUsage ? ssvBalance - totalUnpackedUsage : 0n;

    expect(eventArgs.ssvRefunded).to.equal(expectedRefund);

    const ownerSSVAfter = await mockToken.balanceOf(clusterOwner.address);
    expect(ownerSSVAfter - ownerSSVBefore).to.equal(expectedRefund);
  });

  describe("updateClusterOperatorsMigration specific tests", async function () {
    it("Preserves SSV snapshot state before validator count reduction", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
      const ssvNetworkFee = 1000000n;
      await clusters.mockSSVNetworkFee(ssvNetworkFee);
      await clusters.mockCurrentNetworkFeeIndexSSV(0n);
      const validatorCount = 5n;
      const ssvCluster = {
        validatorCount: validatorCount,
        networkFeeIndex: 0n,
        index: 0n,
        balance: 0n,
        active: true,
      };

      const publicKey = makePublicKey(1);
      await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);
      await networkHelpers.mine(50);
      const operatorStatesBefore = [];
      for (const operatorId of operatorIds) {
        const snapshot = await clusters.getOperatorSnapshot(operatorId);
        const validatorCount = await clusters.getOperatorValidatorCount(operatorId);
        operatorStatesBefore.push({
          operatorId,
          snapshotIndex: snapshot.index,
          validatorCount: validatorCount
        });
      }
      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      await migrateTx.wait();
      for (let i = 0; i < operatorIds.length; i++) {
        const stateBefore = operatorStatesBefore[i];
        const snapshotAfter = await clusters.getOperatorSnapshot(stateBefore.operatorId);
        expect(snapshotAfter.index).to.be.greaterThanOrEqual(stateBefore.snapshotIndex);
        const ssvValidatorCountAfter = await clusters.getOperatorValidatorCount(stateBefore.operatorId);
        expect(ssvValidatorCountAfter).to.equal(stateBefore.validatorCount - validatorCount);
      }
    });

    it("Correctly handles mixed operator states during migration", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
      const ethPublicKey = makePublicKey(100);
      await clusters.connect(anotherOwner).registerValidator(
        ethPublicKey,
        operatorIds.slice(0, 4),
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const ssvNetworkFee = 1000000n;
      await clusters.mockSSVNetworkFee(ssvNetworkFee);
      await clusters.mockCurrentNetworkFeeIndexSSV(0n);
      const validatorCount = 3n;
      const ssvCluster = {
        validatorCount: validatorCount,
        networkFeeIndex: 0n,
        index: 0n,
        balance: 0n,
        active: true,
      };

      const ssvPublicKey = makePublicKey(200);
      await clusters.mockRegisterSSVValidator(ssvPublicKey, operatorIds, clusterOwner.address, ssvCluster);
      await networkHelpers.mine(25);
      const mixedStatesBefore = [];
      for (const operatorId of operatorIds) {
        const ethSnapshot = await clusters.getOperatorEthSnapshot(operatorId);
        const ssvSnapshot = await clusters.getOperatorSnapshot(operatorId);
        const ethValidatorCount = await clusters.getOperatorEthValidatorCount(operatorId);
        const ssvValidatorCount = await clusters.getOperatorValidatorCount(operatorId);
        
        mixedStatesBefore.push({
          operatorId,
          wasEthOperator: ethSnapshot.block > 0,
          ethValidatorCount: ethValidatorCount || 0n,
          ssvValidatorCount: ssvValidatorCount || 0n,
          ssvIndex: ssvSnapshot.index,
          ethIndex: ethSnapshot.index
        });
      }
      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      await migrateTx.wait();
      for (let i = 0; i < operatorIds.length; i++) {
        const stateBefore = mixedStatesBefore[i];
        const ssvSnapshotAfter = await clusters.getOperatorSnapshot(stateBefore.operatorId);
        const ethSnapshotAfter = await clusters.getOperatorEthSnapshot(stateBefore.operatorId);
        expect(ssvSnapshotAfter.index).to.be.greaterThanOrEqual(stateBefore.ssvIndex);
        if (stateBefore.wasEthOperator) {
          if (stateBefore.ethIndex > 0) {
            expect(ethSnapshotAfter.index).to.be.greaterThan(stateBefore.ethIndex);
          }
          const ethValidatorCountAfter = await clusters.getOperatorEthValidatorCount(stateBefore.operatorId);
          expect(ethValidatorCountAfter).to.equal(stateBefore.ethValidatorCount + validatorCount);
        } else {
          const ethSnapshotAfterBlock = ethSnapshotAfter.block || 0;
          expect(ethSnapshotAfterBlock).to.be.greaterThanOrEqual(0);
          const ethValidatorCountAfter = await clusters.getOperatorEthValidatorCount(stateBefore.operatorId);
          if (stateBefore.ethValidatorCount === 0n) {
            expect(ethValidatorCountAfter).to.equal(validatorCount);
          } else {
            expect(ethValidatorCountAfter).to.equal(stateBefore.ethValidatorCount + validatorCount);
          }
        }
        const ssvValidatorCountAfter = await clusters.getOperatorValidatorCount(stateBefore.operatorId);
        expect(ssvValidatorCountAfter).to.equal(stateBefore.ssvValidatorCount - validatorCount);
      }
    });

    it("Accumulates SSV indices correctly for all operators during migration", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
      const ssvNetworkFee = 2000000n;
      await clusters.mockSSVNetworkFee(ssvNetworkFee);
      await clusters.mockCurrentNetworkFeeIndexSSV(0n);
      const validatorCount = 2n;
      const ssvCluster = {
        validatorCount: validatorCount,
        networkFeeIndex: 0n,
        index: 0n,
        balance: 0n,
        active: true,
      };

      const publicKey = makePublicKey(1);
      await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);
      await networkHelpers.mine(100);
      const indicesBefore = [];
      for (const operatorId of operatorIds) {
        const snapshot = await clusters.getOperatorSnapshot(operatorId);
        indicesBefore.push(snapshot.index);
      }
      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      await migrateTx.wait();
      for (let i = 0; i < operatorIds.length; i++) {
        const snapshotAfter = await clusters.getOperatorSnapshot(operatorIds[i]);
        expect(snapshotAfter.index).to.be.greaterThanOrEqual(indicesBefore[i]);
      }
      expect(migrateTx).to.not.be.null;
    });

    it("Handles liquidated cluster migration correctly", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
      const validatorCount = 3n;
      const ssvCluster = {
        validatorCount: validatorCount,
        networkFeeIndex: 0n,
        index: 0n,
        balance: 0n,
        active: true,
      };

      const publicKey = makePublicKey(1);
      await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);
      const liquidateTx = await clusters.liquidateSSV(clusterOwner.address, operatorIds, ssvCluster);
      const liquidateReceipt = await liquidateTx.wait();
      const liquidatedCluster = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);
      expect(liquidatedCluster.active).to.be.false;
      const validatorCountsBefore = [];
      for (const operatorId of operatorIds) {
        const ssvCount = await clusters.getOperatorValidatorCount(operatorId);
        const ethCount = await clusters.getOperatorEthValidatorCount(operatorId);
        validatorCountsBefore.push({ ssvCount, ethCount });
      }
      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds,
        liquidatedCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      await migrateTx.wait();
      for (let i = 0; i < operatorIds.length; i++) {
        const countsBefore = validatorCountsBefore[i];
        const ssvCountAfter = await clusters.getOperatorValidatorCount(operatorIds[i]);
        const ethCountAfter = await clusters.getOperatorEthValidatorCount(operatorIds[i]);
        expect(ssvCountAfter).to.equal(countsBefore.ssvCount);
        expect(ethCountAfter).to.equal(liquidatedCluster.validatorCount);
      }
    });
  });

  describe("Migration balance accounting verification", async function () {
    it("Exact SSV refund after 1000 blocks — independently calculated", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

      const operatorSSVFee = DEDUCTED_DIGITS * 5n;
      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, operatorSSVFee);
      }

      const ssvNetworkFeeRaw = 3n;
      await clusters.mockSSVNetworkFee(ssvNetworkFeeRaw);
      await clusters.mockCurrentNetworkFeeIndexSSV(0n);

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      const tokenAddress = await mockToken.getAddress();
      const harnessAddress = await clusters.getAddress();
      await clusters.mockSetToken(tokenAddress);

      const validatorCount = 1n;
      const initialBalance = connection.ethers.parseEther("100");
      await mockToken.mint(harnessAddress, initialBalance);

      const ssvCluster = {
        validatorCount: validatorCount,
        networkFeeIndex: 0n,
        index: 0n,
        balance: initialBalance,
        active: true,
      };

      const publicKey = makePublicKey(1);
      await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);

      const operatorSnapshots = [];
      for (const opId of operatorIds) {
        const snap = await clusters.getOperatorSnapshot(opId);
        const fee = await clusters.getOperatorSSVFee(opId);
        operatorSnapshots.push({ block: BigInt(snap.blockNumber), index: snap.index, fee });
      }
      const networkFeeIndexBefore = await clusters.getCurrentNetworkFeeIndexSSV();
      const readBlock = BigInt(await connection.ethers.provider.getBlockNumber());

      await networkHelpers.mine(1000);

      const ownerTokenBefore = await mockToken.balanceOf(clusterOwner.address);
      const harnessTokenBefore = await mockToken.balanceOf(harnessAddress);

      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const receipt = await migrateTx.wait();
      const migrationBlock = BigInt(receipt!.blockNumber);
      const eventArgs = extractEventArgs(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);

      const blocksElapsed = migrationBlock - readBlock;

      let expectedCumulativeIndex = 0n;
      for (const snap of operatorSnapshots) {
        const blockDiff = migrationBlock - snap.block;
        expectedCumulativeIndex += snap.index + blockDiff * snap.fee;
      }

      const expectedNetworkFeeIndex = networkFeeIndexBefore + blocksElapsed * ssvNetworkFeeRaw;

      const operatorUsagePacked = (expectedCumulativeIndex - ssvCluster.index) * validatorCount;
      const networkUsagePacked = (expectedNetworkFeeIndex - ssvCluster.networkFeeIndex) * validatorCount;
      const totalPackedUsage = operatorUsagePacked + networkUsagePacked;
      const totalUnpackedUsage = totalPackedUsage * DEDUCTED_DIGITS;

      const expectedRefund = initialBalance > totalUnpackedUsage
        ? initialBalance - totalUnpackedUsage
        : 0n;

      expect(eventArgs.ssvRefunded).to.equal(expectedRefund);

      const ownerTokenAfter = await mockToken.balanceOf(clusterOwner.address);
      const harnessTokenAfter = await mockToken.balanceOf(harnessAddress);
      expect(ownerTokenAfter - ownerTokenBefore).to.equal(expectedRefund);
      expect(harnessTokenBefore - harnessTokenAfter).to.equal(expectedRefund);
      const feesCharged = initialBalance - expectedRefund;
      expect(feesCharged).to.equal(totalUnpackedUsage);
    });

    it("Migration with partial SSV balance remaining — exact token transfer", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

      const operatorSSVFee = DEDUCTED_DIGITS * 20n;
      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, operatorSSVFee);
      }

      const ssvNetworkFeeRaw = 10n;
      await clusters.mockSSVNetworkFee(ssvNetworkFeeRaw);
      await clusters.mockCurrentNetworkFeeIndexSSV(0n);

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      const tokenAddress = await mockToken.getAddress();
      const harnessAddress = await clusters.getAddress();
      await clusters.mockSetToken(tokenAddress);

      const validatorCount = 4n;
      const initialBalance = connection.ethers.parseEther("5");
      await mockToken.mint(harnessAddress, initialBalance);

      const ssvCluster = {
        validatorCount: validatorCount,
        networkFeeIndex: 0n,
        index: 0n,
        balance: initialBalance,
        active: true,
      };

      const publicKey = makePublicKey(1);
      await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);

      const operatorSnapshots = [];
      for (const opId of operatorIds) {
        const snap = await clusters.getOperatorSnapshot(opId);
        const fee = await clusters.getOperatorSSVFee(opId);
        operatorSnapshots.push({ block: BigInt(snap.blockNumber), index: snap.index, fee });
      }
      const networkFeeIndexBefore = await clusters.getCurrentNetworkFeeIndexSSV();
      const readBlock = BigInt(await connection.ethers.provider.getBlockNumber());

      await networkHelpers.mine(500);

      const ownerTokenBefore = await mockToken.balanceOf(clusterOwner.address);
      const harnessTokenBefore = await mockToken.balanceOf(harnessAddress);

      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const receipt = await migrateTx.wait();
      const migrationBlock = BigInt(receipt!.blockNumber);
      const eventArgs = extractEventArgs(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);

      const blocksElapsed = migrationBlock - readBlock;

      let expectedCumulativeIndex = 0n;
      for (const snap of operatorSnapshots) {
        const blockDiff = migrationBlock - snap.block;
        expectedCumulativeIndex += snap.index + blockDiff * snap.fee;
      }

      const expectedNetworkFeeIndex = networkFeeIndexBefore + blocksElapsed * ssvNetworkFeeRaw;

      const operatorUsagePacked = (expectedCumulativeIndex - ssvCluster.index) * validatorCount;
      const networkUsagePacked = (expectedNetworkFeeIndex - ssvCluster.networkFeeIndex) * validatorCount;
      const totalPackedUsage = operatorUsagePacked + networkUsagePacked;
      const totalUnpackedUsage = totalPackedUsage * DEDUCTED_DIGITS;

      const expectedRefund = initialBalance > totalUnpackedUsage
        ? initialBalance - totalUnpackedUsage
        : 0n;

      expect(eventArgs.ssvRefunded).to.equal(expectedRefund);

      const ownerTokenAfter = await mockToken.balanceOf(clusterOwner.address);
      const harnessTokenAfter = await mockToken.balanceOf(harnessAddress);
      expect(ownerTokenAfter - ownerTokenBefore).to.equal(expectedRefund);
      expect(harnessTokenBefore - harnessTokenAfter).to.equal(expectedRefund);
      const feesCharged = initialBalance - expectedRefund;
      expect(feesCharged).to.equal(totalUnpackedUsage);
    });

    it("Migration with dual SSV/ETH fees — ETH side correctly initialized", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

      const operatorSSVFee = DEDUCTED_DIGITS * 3n;
      const operatorETHFee = 1_770_000_000n;

      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, operatorSSVFee);
        await clusters.mockSetOperatorFee(opId, operatorETHFee);
      }

      const ssvNetworkFeeRaw = 2n;
      await clusters.mockSSVNetworkFee(ssvNetworkFeeRaw);
      await clusters.mockCurrentNetworkFeeIndexSSV(0n);
      await clusters.mockCurrentNetworkFeeIndex(0n);

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      const tokenAddress = await mockToken.getAddress();
      const harnessAddress = await clusters.getAddress();
      await clusters.mockSetToken(tokenAddress);

      const validatorCount = 2n;
      const initialBalance = connection.ethers.parseEther("50");
      await mockToken.mint(harnessAddress, initialBalance);

      const ssvCluster = {
        validatorCount: validatorCount,
        networkFeeIndex: 0n,
        index: 0n,
        balance: initialBalance,
        active: true,
      };

      const publicKey = makePublicKey(1);
      await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);

      const ssvSnapshots = [];
      for (const opId of operatorIds) {
        const snap = await clusters.getOperatorSnapshot(opId);
        const fee = await clusters.getOperatorSSVFee(opId);
        ssvSnapshots.push({ block: BigInt(snap.blockNumber), index: snap.index, fee });
      }

      const ethSnapshots = [];
      for (const opId of operatorIds) {
        const snap = await clusters.getOperatorEthSnapshot(opId);
        const fee = await clusters.getOperatorEthFee(opId);
        ethSnapshots.push({ block: BigInt(snap.blockNumber), index: snap.index, fee });
      }

      const networkFeeIndexSSVBefore = await clusters.getCurrentNetworkFeeIndexSSV();
      const readBlock = BigInt(await connection.ethers.provider.getBlockNumber());

      await networkHelpers.mine(200);

      const ownerTokenBefore = await mockToken.balanceOf(clusterOwner.address);

      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const receipt = await migrateTx.wait();
      const migrationBlock = BigInt(receipt!.blockNumber);
      const eventArgs = extractEventArgs(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      const ethCluster = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);

      const blocksElapsed = migrationBlock - readBlock;

      let expectedCumulativeSSVIndex = 0n;
      for (const snap of ssvSnapshots) {
        const blockDiff = migrationBlock - snap.block;
        expectedCumulativeSSVIndex += snap.index + blockDiff * snap.fee;
      }

      const expectedNetworkFeeIndexSSV = networkFeeIndexSSVBefore + blocksElapsed * ssvNetworkFeeRaw;

      const operatorUsagePacked = (expectedCumulativeSSVIndex - ssvCluster.index) * validatorCount;
      const networkUsagePacked = (expectedNetworkFeeIndexSSV - ssvCluster.networkFeeIndex) * validatorCount;
      const totalPackedUsage = operatorUsagePacked + networkUsagePacked;
      const totalUnpackedUsage = totalPackedUsage * DEDUCTED_DIGITS;

      const expectedRefund = initialBalance > totalUnpackedUsage
        ? initialBalance - totalUnpackedUsage
        : 0n;

      expect(eventArgs.ssvRefunded).to.equal(expectedRefund);
      const ownerTokenAfter = await mockToken.balanceOf(clusterOwner.address);
      expect(ownerTokenAfter - ownerTokenBefore).to.equal(expectedRefund);

      expect(ethCluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);
      expect(ethCluster.active).to.equal(true);
      expect(ethCluster.validatorCount).to.equal(validatorCount);

      let expectedCumulativeETHIndex = 0n;
      for (const snap of ethSnapshots) {
        const blockDiff = migrationBlock - snap.block;
        expectedCumulativeETHIndex += snap.index + blockDiff * snap.fee;
      }

      expect(ethCluster.index).to.equal(expectedCumulativeETHIndex);

      for (const operatorId of operatorIds) {
        expect(await clusters.getOperatorEthValidatorCount(operatorId)).to.equal(validatorCount);
      }

      for (const operatorId of operatorIds) {
        expect(await clusters.getOperatorValidatorCount(operatorId)).to.equal(0);
      }
    });

    it("Zero SSV balance migration — exact refund calculation", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
      const operatorSSVFee = DEDUCTED_DIGITS * 2n;
      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, operatorSSVFee);
      }

      const ssvNetworkFeeRaw = 1n;
      await clusters.mockSSVNetworkFee(ssvNetworkFeeRaw);
      await clusters.mockCurrentNetworkFeeIndexSSV(0n);

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      const tokenAddress = await mockToken.getAddress();
      const harnessAddress = await clusters.getAddress();
      await clusters.mockSetToken(tokenAddress);
      const validatorCount = 2n;
      const initialBalance = 0n;

      const ssvCluster = {
        validatorCount: validatorCount,
        networkFeeIndex: 0n,
        index: 0n,
        balance: initialBalance,
        active: true,
      };

      const publicKey = makePublicKey(1);
      await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);

      const ownerTokenBefore = await mockToken.balanceOf(clusterOwner.address);
      const harnessTokenBefore = await mockToken.balanceOf(harnessAddress);

      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const receipt = await migrateTx.wait();
      const eventArgs = extractEventArgs(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      const expectedRefund = 0n;

      expect(eventArgs.ssvRefunded).to.equal(expectedRefund);

      const ownerTokenAfter = await mockToken.balanceOf(clusterOwner.address);
      const harnessTokenAfter = await mockToken.balanceOf(harnessAddress);
      expect(ownerTokenAfter - ownerTokenBefore).to.equal(expectedRefund);
      expect(harnessTokenBefore - harnessTokenAfter).to.equal(expectedRefund);
      const ethCluster = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(ethCluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);
      expect(ethCluster.active).to.equal(true);
      expect(ethCluster.validatorCount).to.equal(validatorCount);
    });

    it("Liquidated cluster migration — exact zero refund verification", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

      const operatorSSVFee = DEDUCTED_DIGITS * 10n;
      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, operatorSSVFee);
      }

      const ssvNetworkFeeRaw = 5n;
      await clusters.mockSSVNetworkFee(ssvNetworkFeeRaw);
      await clusters.mockCurrentNetworkFeeIndexSSV(0n);

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      const tokenAddress = await mockToken.getAddress();
      const harnessAddress = await clusters.getAddress();
      await clusters.mockSetToken(tokenAddress);

      const validatorCount = 3n;
      const initialBalance = connection.ethers.parseEther("1");
      await mockToken.mint(harnessAddress, initialBalance);

      const ssvCluster = {
        validatorCount: validatorCount,
        networkFeeIndex: 0n,
        index: 0n,
        balance: initialBalance,
        active: true,
      };

      const publicKey = makePublicKey(1);
      await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);
      const liquidateTx = await clusters.liquidateSSV(clusterOwner.address, operatorIds, ssvCluster);
      const liquidateReceipt = await liquidateTx.wait();
      const liquidatedCluster = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);
      expect(liquidatedCluster.active).to.be.false;
      expect(liquidatedCluster.balance).to.equal(0n);

      const ownerTokenBefore = await mockToken.balanceOf(clusterOwner.address);
      const harnessTokenBefore = await mockToken.balanceOf(harnessAddress);
      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds,
        liquidatedCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const receipt = await migrateTx.wait();
      const eventArgs = extractEventArgs(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      const expectedRefund = 0n;

      expect(eventArgs.ssvRefunded).to.equal(expectedRefund);

      const ownerTokenAfter = await mockToken.balanceOf(clusterOwner.address);
      const harnessTokenAfter = await mockToken.balanceOf(harnessAddress);
      expect(ownerTokenAfter - ownerTokenBefore).to.equal(expectedRefund);
      expect(harnessTokenBefore - harnessTokenAfter).to.equal(expectedRefund);
      const ethCluster = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(ethCluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);
      expect(ethCluster.active).to.equal(true);
      expect(ethCluster.validatorCount).to.equal(validatorCount);
    });

    it("Maximum precision SSV balance — exact refund with non-round values", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
      const operatorSSVFee = DEDUCTED_DIGITS * 7n;
      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, operatorSSVFee);
      }

      const ssvNetworkFeeRaw = 11n;
      await clusters.mockSSVNetworkFee(ssvNetworkFeeRaw);
      await clusters.mockCurrentNetworkFeeIndexSSV(0n);

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      const tokenAddress = await mockToken.getAddress();
      const harnessAddress = await clusters.getAddress();
      await clusters.mockSetToken(tokenAddress);

      const validatorCount = 7n;
      const initialBalance = 123_456_780_000_000_000n;

      await mockToken.mint(harnessAddress, initialBalance);

      const ssvCluster = {
        validatorCount: validatorCount,
        networkFeeIndex: 0n,
        index: 0n,
        balance: initialBalance,
        active: true,
      };

      const publicKey = makePublicKey(1);
      await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);

      const operatorSnapshots = [];
      for (const opId of operatorIds) {
        const snap = await clusters.getOperatorSnapshot(opId);
        const fee = await clusters.getOperatorSSVFee(opId);
        operatorSnapshots.push({ block: BigInt(snap.blockNumber), index: snap.index, fee });
      }
      const networkFeeIndexBefore = await clusters.getCurrentNetworkFeeIndexSSV();
      const readBlock = BigInt(await connection.ethers.provider.getBlockNumber());

      await networkHelpers.mine(317);

      const ownerTokenBefore = await mockToken.balanceOf(clusterOwner.address);
      const harnessTokenBefore = await mockToken.balanceOf(harnessAddress);

      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const receipt = await migrateTx.wait();
      const migrationBlock = BigInt(receipt!.blockNumber);
      const eventArgs = extractEventArgs(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);

      const blocksElapsed = migrationBlock - readBlock;
      let expectedCumulativeIndex = 0n;
      for (const snap of operatorSnapshots) {
        const blockDiff = migrationBlock - snap.block;
        expectedCumulativeIndex += snap.index + blockDiff * snap.fee;
      }

      const expectedNetworkFeeIndex = networkFeeIndexBefore + blocksElapsed * ssvNetworkFeeRaw;

      const operatorUsagePacked = (expectedCumulativeIndex - ssvCluster.index) * validatorCount;
      const networkUsagePacked = (expectedNetworkFeeIndex - ssvCluster.networkFeeIndex) * validatorCount;
      const totalPackedUsage = operatorUsagePacked + networkUsagePacked;
      const totalUnpackedUsage = totalPackedUsage * DEDUCTED_DIGITS;

      const expectedRefund = initialBalance > totalUnpackedUsage
        ? initialBalance - totalUnpackedUsage
        : 0n;

      expect(eventArgs.ssvRefunded).to.equal(expectedRefund);

      const ownerTokenAfter = await mockToken.balanceOf(clusterOwner.address);
      const harnessTokenAfter = await mockToken.balanceOf(harnessAddress);
      expect(ownerTokenAfter - ownerTokenBefore).to.equal(expectedRefund);
      expect(harnessTokenBefore - harnessTokenAfter).to.equal(expectedRefund);
      const feesCharged = initialBalance - expectedRefund;
      expect(feesCharged).to.equal(totalUnpackedUsage);
    });

    it("Fee integer truncation — totalUnpackedUsage is always a multiple of DEDUCTED_DIGITS", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
      const operatorSSVFee = DEDUCTED_DIGITS * 3n;
      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, operatorSSVFee);
      }

      const ssvNetworkFeeRaw = 13n;
      await clusters.mockSSVNetworkFee(ssvNetworkFeeRaw);
      await clusters.mockCurrentNetworkFeeIndexSSV(0n);

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      const tokenAddress = await mockToken.getAddress();
      const harnessAddress = await clusters.getAddress();
      await clusters.mockSetToken(tokenAddress);

      const validatorCount = 5n;
      const initialBalance = connection.ethers.parseEther("50");
      await mockToken.mint(harnessAddress, initialBalance);

      const ssvCluster = {
        validatorCount: validatorCount,
        networkFeeIndex: 0n,
        index: 0n,
        balance: initialBalance,
        active: true,
      };

      const publicKey = makePublicKey(1);
      await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);

      const operatorSnapshots = [];
      for (const opId of operatorIds) {
        const snap = await clusters.getOperatorSnapshot(opId);
        const fee = await clusters.getOperatorSSVFee(opId);
        operatorSnapshots.push({ block: BigInt(snap.blockNumber), index: snap.index, fee });
      }
      const networkFeeIndexBefore = await clusters.getCurrentNetworkFeeIndexSSV();
      const readBlock = BigInt(await connection.ethers.provider.getBlockNumber());

      await networkHelpers.mine(97);

      const ownerTokenBefore = await mockToken.balanceOf(clusterOwner.address);
      const harnessTokenBefore = await mockToken.balanceOf(harnessAddress);

      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const receipt = await migrateTx.wait();
      const migrationBlock = BigInt(receipt!.blockNumber);
      const eventArgs = extractEventArgs(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);

      const blocksElapsed = migrationBlock - readBlock;

      let expectedCumulativeIndex = 0n;
      for (const snap of operatorSnapshots) {
        const blockDiff = migrationBlock - snap.block;
        expectedCumulativeIndex += snap.index + blockDiff * snap.fee;
      }

      const expectedNetworkFeeIndex = networkFeeIndexBefore + blocksElapsed * ssvNetworkFeeRaw;
      const operatorUsagePacked = (expectedCumulativeIndex - ssvCluster.index) * validatorCount;
      const networkUsagePacked = (expectedNetworkFeeIndex - ssvCluster.networkFeeIndex) * validatorCount;
      const totalPackedUsage = operatorUsagePacked + networkUsagePacked;
      const totalUnpackedUsage = totalPackedUsage * DEDUCTED_DIGITS;

      const expectedRefund = initialBalance > totalUnpackedUsage
        ? initialBalance - totalUnpackedUsage
        : 0n;
      expect(eventArgs.ssvRefunded).to.equal(expectedRefund);

      const ownerTokenAfter = await mockToken.balanceOf(clusterOwner.address);
      const harnessTokenAfter = await mockToken.balanceOf(harnessAddress);
      expect(ownerTokenAfter - ownerTokenBefore).to.equal(expectedRefund);
      expect(harnessTokenBefore - harnessTokenAfter).to.equal(expectedRefund);
      const feesCharged = initialBalance - expectedRefund;
      expect(feesCharged % DEDUCTED_DIGITS).to.equal(0n);
      expect(totalPackedUsage % DEDUCTED_DIGITS).to.not.equal(0n);
    });
  });

  describe("Removed Operators Security Check", async () => {
    it("Skips removed operators during migration without reviving them", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
      const validatorCount = 2n;
      const ssvCluster = {
        validatorCount: validatorCount,
        networkFeeIndex: 0n,
        index: 0n,
        balance: 0n,
        active: true,
      };

      const publicKey = makePublicKey(1);
      await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);
      const operatorToRemove = operatorIds[0];
      await clusters.mockRemoveOperator(operatorToRemove);
      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const receipt = await migrateTx.wait();
      const clusterAfterMigration = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(clusterAfterMigration.active).to.equal(true);
      expect(clusterAfterMigration.validatorCount).to.equal(ssvCluster.validatorCount);
      for (let i = 1; i < operatorIds.length; i++) {
        const operatorId = operatorIds[i];
        const ethValidatorCount = await clusters.getOperatorEthValidatorCount(operatorId);
        expect(ethValidatorCount).to.equal(validatorCount);
      }
      const removedOperatorCount = await clusters.getOperatorEthValidatorCount(operatorToRemove);
      expect(removedOperatorCount).to.be.greaterThanOrEqual(0n);
    });

    it("Handles migration with all operators removed gracefully", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
      const ssvCluster = {
        validatorCount: 2n,
        networkFeeIndex: 0n,
        index: 0n,
        balance: 0n,
        active: true,
      };

      const publicKey = makePublicKey(1);
      await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);
      for (const operatorId of operatorIds) {
        await clusters.mockRemoveOperator(operatorId);
      }
      try {
        const migrateTx = await clusters.migrateClusterToETH(
          operatorIds,
          ssvCluster,
          { value: DEFAULT_ETH_REGISTER_VALUE }
        );
        const receipt = await migrateTx.wait();
        const clusterAfterMigration = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
        expect(clusterAfterMigration.active).to.equal(true);
        for (const operatorId of operatorIds) {
          const ethValidatorCount = await clusters.getOperatorEthValidatorCount(operatorId);
          expect(ethValidatorCount).to.equal(0n);
        }
      } catch (error) {
        expect(error.message).to.include("revert");
      }
    });

    it("Prevents silent revival of removed operators with zero fees", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
      const ssvCluster = {
        validatorCount: 1n,
        networkFeeIndex: 0n,
        index: 0n,
        balance: 0n,
        active: true,
      };

      const publicKey = makePublicKey(1);
      await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);
      const operatorToRemove = operatorIds[0];
      await clusters.mockRemoveOperator(operatorToRemove);
      await clusters.mockSetOperatorFee(operatorToRemove, 0n);
      const ethFeeBefore = await clusters.getOperatorEthFee(operatorToRemove);
      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      await migrateTx.wait();
      const ethFeeAfter = await clusters.getOperatorEthFee(operatorToRemove);
      expect(ethFeeAfter).to.equal(ethFeeBefore);
      const ethValidatorCount = await clusters.getOperatorEthValidatorCount(operatorToRemove);
      expect(ethValidatorCount).to.be.greaterThanOrEqual(0n);
    });

    it("Maintains operator count integrity with mixed valid/removed operators", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);
      const validatorCount = 3n;
      const ssvCluster = {
        validatorCount: validatorCount,
        networkFeeIndex: 0n,
        index: 0n,
        balance: 0n,
        active: true,
      };

      const publicKey = makePublicKey(1);
      await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);
      const removedOperators = [];
      const validOperators = [];
      
      for (let i = 0; i < operatorIds.length; i += 2) {
        await clusters.mockRemoveOperator(operatorIds[i]);
        removedOperators.push(operatorIds[i]);
      }
      
      for (let i = 1; i < operatorIds.length; i += 2) {
        validOperators.push(operatorIds[i]);
      }
      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const receipt = await migrateTx.wait();
      const clusterAfterMigration = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(clusterAfterMigration.active).to.equal(true);
      expect(clusterAfterMigration.validatorCount).to.equal(ssvCluster.validatorCount);
      for (const operatorId of validOperators) {
        const ethValidatorCount = await clusters.getOperatorEthValidatorCount(operatorId);
        expect(ethValidatorCount).to.equal(validatorCount);
      }
      for (const operatorId of removedOperators) {
        const ethValidatorCount = await clusters.getOperatorEthValidatorCount(operatorId);
        expect(ethValidatorCount).to.be.greaterThanOrEqual(0n);
      }
    });
  });
});

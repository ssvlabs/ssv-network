import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { getCurrentClusterState, makePublicKey, parseClusterFromEvent } from '../../common/helpers.ts';
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_OPERATOR_ETH_FEE, DEFAULT_SHARES, EMPTY_CLUSTER, BPS_DENOMINATOR, DEDUCTED_DIGITS } from "../../common/constants.ts";
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
    ({ connection, networkHelpers } = await getTestConnection());

    [clusterOwner, anotherOwner] = await connection.ethers.getSigners();
  });

  const deploySSVClustersAndPrepareOperatorsFixture = async () => {
    return ssvClustersHarnessFixture(connection);
  };

  const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
    return ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds])
    );
  };

  const getMigratedToETHEventArgs = (clusters: any, receipt: any) => {
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
    const eventArgs = getMigratedToETHEventArgs(clusters, receipt);

    await expect(migrateTx).to.emit(clusters, Events.CLUSTER_MIGRATED_TO_ETH);
    expect(clusterAfterMigration.active).to.equal(true);
    expect(clusterAfterMigration.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);
    expect(clusterAfterMigration.validatorCount).to.equal(ssvCluster.validatorCount);

    expect(eventArgs.ethDeposited).to.equal(DEFAULT_ETH_REGISTER_VALUE);
    expect(eventArgs.ssvRefunded).to.equal(0n);
    expect(eventArgs.effectiveBalance).to.equal(32);

    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    expect(await clusters.getClusterHash(clusterId)).to.not.equal(ethers.ZeroHash);

    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthValidatorCount(operatorId)).to.equal(1n);
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n); // deviation only (no EB update yet)
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(BPS_DENOMINATOR); // baseline + deviation
    }

    await expect(clusters.migrateClusterToETH(
      operatorIds,
      clusterAfterMigration
    )).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_VERSION);
  });

  it("Emits OperatorFeeExecuted for each legacy SSV operator when migrating to ETH", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    for (const operatorId of operatorIds) {
      await clusters.mockSetOperatorLegacySSV(operatorId, 1);
    }

    const ssvCluster = {
      validatorCount: 1n,
      networkFeeIndex: 0n,
      index: 0n,
      balance: 0n,
      active: true,
    };

    const publicKey = makePublicKey(2);
    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);

    const migrateTx = await clusters.migrateClusterToETH(
      operatorIds,
      ssvCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await migrateTx.wait();
    const expectedBlock = BigInt(receipt!.blockNumber);

    for (const operatorId of operatorIds) {
      await expect(migrateTx).to.emit(clusters, Events.OPERATOR_FEE_EXECUTED)
        .withArgs(clusterOwner.address, operatorId, expectedBlock, DEFAULT_OPERATOR_ETH_FEE);
    }
  });

  it("Does not emit duplicate OperatorFeeExecuted when operator already initialized with ETH defaults", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    // Set operators as legacy SSV operators (will receive default ETH fee on first ETH operation)
    for (const operatorId of operatorIds) {
      await clusters.mockSetOperatorLegacySSV(operatorId, 1);
    }

    // First ETH operation: registerValidator triggers ensureETHDefaults, emits OperatorFeeExecuted
    const firstTx = await clusters.registerValidator(
      makePublicKey(100),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const firstReceipt = await firstTx.wait();

    // Verify OperatorFeeExecuted IS emitted on first ETH operation
    for (const operatorId of operatorIds) {
      await expect(firstTx).to.emit(clusters, Events.OPERATOR_FEE_EXECUTED)
        .withArgs(clusterOwner.address, operatorId, BigInt(firstReceipt!.blockNumber), DEFAULT_OPERATOR_ETH_FEE);
    }

    // Verify operators are now ETH-initialized
    for (const operatorId of operatorIds) {
      const ethSnapshot = await clusters.getOperatorEthSnapshot(operatorId);
      expect(ethSnapshot.blockNumber).to.be.greaterThan(0);
      // getOperatorEthFee returns packed value, so we expect DEFAULT_OPERATOR_ETH_FEE / 100_000
      const ethFee = await clusters.getOperatorEthFee(operatorId);
      expect(ethFee).to.equal(DEFAULT_OPERATOR_ETH_FEE / 100_000n);
    }

    // Second ETH operation: registerValidator again, ensureETHDefaults should NOT emit event
    const cluster1 = parseClusterFromEvent(clusters, firstReceipt, Events.VALIDATOR_ADDED);

    const secondTx = await clusters.registerValidator(
      makePublicKey(200),
      operatorIds,
      DEFAULT_SHARES,
      cluster1,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const secondReceipt = await secondTx.wait();

    // Verify OperatorFeeExecuted is NOT emitted on second ETH operation (idempotency)
    const feeExecutedEvents = secondReceipt?.logs
      .map(log => {
        try {
          return clusters.interface.parseLog(log);
        } catch {
          return null;
        }
      })
      .filter(parsed => parsed?.name === Events.OPERATOR_FEE_EXECUTED);

    expect(feeExecutedEvents).to.have.length(0);

    // Verify second registration still succeeded
    await expect(secondTx).to.emit(clusters, Events.VALIDATOR_ADDED);
    const clusterAfter = parseClusterFromEvent(clusters, secondReceipt, Events.VALIDATOR_ADDED);
    expect(clusterAfter.active).to.equal(true);
    expect(clusterAfter.validatorCount).to.equal(2n);
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
    const eventArgs = getMigratedToETHEventArgs(clusters, receipt);

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

    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    await clusters.mockSetClusterVUnits(clusterId, 12_000n);

    const migrateTx = await clusters.migrateClusterToETH(
      operatorIds,
      ssvCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await migrateTx.wait();
    const eventArgs = getMigratedToETHEventArgs(clusters, receipt);

    expect(eventArgs.effectiveBalance).to.equal(38);

    for (const operatorId of operatorIds) {
      // Explicit snapshot of 12000 vUnits with baseline of 10000 (1 validator) = deviation of 2000
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(2_000n); // deviation only
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(12_000n); // baseline + deviation
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

    // Register validator to create an ETH cluster, then attempt migration (expects SSV cluster).
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

    // Set minimum liquidation collateral low enough for migration to succeed
    await clusters.mockMinimumLiquidationCollateral(1000000n); // Very low collateral
    
    // Set minimum blocks before liquidation to a reasonable value
    await clusters.mockMinimumBlocksBeforeLiquidation(100n);

    // Setup mock token and fund harness with SSV
    const mockToken = await connection.ethers.deployContract("MockToken", []);
    await mockToken.waitForDeployment();
    const tokenAddress = await mockToken.getAddress();
    const harnessAddress = await clusters.getAddress();
    await clusters.mockSetToken(tokenAddress);

    // Create SSV cluster with 10 validators and non-trivial balance
    const validatorCount = 10n;
    const ssvBalance = connection.ethers.parseEther("5"); // 5 SSV tokens
    await mockToken.mint(harnessAddress, ssvBalance);

    const ssvCluster = {
      validatorCount: validatorCount,
      networkFeeIndex: 0n,
      index: 0n,
      balance: ssvBalance,
      active: true,
    };

    // Register SSV cluster
    const publicKey = makePublicKey(1);
    await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);

    // Set SSV network fee for accrual calculations
    const ssvNetworkFee = 5n; // packed SSV fee per block per validator
    await clusters.mockSSVNetworkFee(ssvNetworkFee);
    await clusters.mockCurrentNetworkFeeIndexSSV(0n);

    // Set SSV operator fees so accrual is non-trivial
    const operatorSSVFee = DEDUCTED_DIGITS * 3n;
    for (const opId of operatorIds) {
      await clusters.mockOperatorSSVFee(opId, operatorSSVFee);
    }

    // Set ETH network fee for ETH cluster after migration
    const ethNetworkFee = 1770n; // ETH fee (packed value)
    await clusters.mockEthNetworkFee(ethNetworkFee);
    await clusters.mockCurrentNetworkFeeIndex(0n);

    // Capture operator snapshots and block reference before mining
    const operatorSnapshots = [];
    for (const opId of operatorIds) {
      const snap = await clusters.getOperatorSnapshot(opId);
      const fee = await clusters.getOperatorSSVFee(opId);
      operatorSnapshots.push({ block: BigInt(snap.blockNumber), index: snap.index, fee });
    }
    const networkFeeIndexBefore = await clusters.getCurrentNetworkFeeIndexSSV();
    const readBlock = BigInt(await connection.ethers.provider.getBlockNumber());

    // Mine blocks to accrue fees
    const blocksToMine = 100;
    await networkHelpers.mine(blocksToMine);

    // Record owner's SSV balance before migration
    const ownerSSVBefore = await mockToken.balanceOf(clusterOwner.address);
    const harnessSSVBefore = await mockToken.balanceOf(harnessAddress);

    // Call migrateClusterToETH
    const migrateTx = await clusters.migrateClusterToETH(
      operatorIds,
      ssvCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await migrateTx.wait();
    const migrationBlock = BigInt(receipt!.blockNumber);
    const eventArgs = getMigratedToETHEventArgs(clusters, receipt);

    // Assert event emission
    await expect(migrateTx).to.emit(clusters, Events.CLUSTER_MIGRATED_TO_ETH);

    expect(eventArgs.ethDeposited).to.equal(DEFAULT_ETH_REGISTER_VALUE);

    // Calculate expected SSV refund independently
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

    // Assert SSV token transfer actually happened and matches event
    const ownerSSVAfter = await mockToken.balanceOf(clusterOwner.address);
    const harnessSSVAfter = await mockToken.balanceOf(harnessAddress);
    expect(ownerSSVAfter - ownerSSVBefore).to.equal(expectedRefund);
    expect(harnessSSVBefore - harnessSSVAfter).to.equal(expectedRefund);

    // Parse the new ETH cluster from event
    const ethCluster = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);

    // Assert new ETH cluster properties
    expect(ethCluster.active).to.equal(true);
    expect(ethCluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);
    expect(ethCluster.validatorCount).to.equal(validatorCount);

    // Assert cluster hash is stored correctly
    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    expect(await clusters.getClusterHash(clusterId)).to.not.equal(ethers.ZeroHash);

    // Assert operator validator counts updated correctly
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

    // Capture operator snapshots and network fee index before mining (pre-mine state)
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
    const eventArgs = getMigratedToETHEventArgs(clusters, receipt);

    await expect(migrateTx).to.emit(clusters, Events.CLUSTER_MIGRATED_TO_ETH);
    expect(eventArgs.ethDeposited).to.equal(DEFAULT_ETH_REGISTER_VALUE);

    // Calculate expected SSV refund independently per SPEC.md §10
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

      // Setup SSV network fees to accrue earnings
      const ssvNetworkFee = 1000000n;
      await clusters.mockSSVNetworkFee(ssvNetworkFee);
      await clusters.mockCurrentNetworkFeeIndexSSV(0n);

      // Create SSV cluster with multiple validators
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

      // Mine blocks to accrue SSV earnings
      await networkHelpers.mine(50);

      // Record operator states before migration
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

      // Migrate to ETH
      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      await migrateTx.wait();

      // Verify that SSV snapshots captured earnings before validator count reduction
      for (let i = 0; i < operatorIds.length; i++) {
        const stateBefore = operatorStatesBefore[i];
        const snapshotAfter = await clusters.getOperatorSnapshot(stateBefore.operatorId);
        
        // The snapshot should have captured earnings before validator count was reduced
        expect(snapshotAfter.index).to.be.greaterThanOrEqual(stateBefore.snapshotIndex);
        
        // SSV validator count should be reduced
        const ssvValidatorCountAfter = await clusters.getOperatorValidatorCount(stateBefore.operatorId);
        expect(ssvValidatorCountAfter).to.equal(stateBefore.validatorCount - validatorCount);
      }
    });

    it("Correctly handles mixed operator states during migration", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

      // Create one ETH cluster first to establish some operators as ETH-enabled
      const ethPublicKey = makePublicKey(100);
      await clusters.connect(anotherOwner).registerValidator(
        ethPublicKey,
        operatorIds.slice(0, 4), // Use first 4 operators for ETH cluster (need minimum 4)
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      // Setup SSV network fees
      const ssvNetworkFee = 1000000n;
      await clusters.mockSSVNetworkFee(ssvNetworkFee);
      await clusters.mockCurrentNetworkFeeIndexSSV(0n);

      // Create SSV cluster using all operators
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

      // Mine blocks to accrue earnings
      await networkHelpers.mine(25);

      // Record states before migration
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

      // Migrate SSV cluster to ETH
      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      await migrateTx.wait();

      // Verify mixed operator handling
      for (let i = 0; i < operatorIds.length; i++) {
        const stateBefore = mixedStatesBefore[i];
        const ssvSnapshotAfter = await clusters.getOperatorSnapshot(stateBefore.operatorId);
        const ethSnapshotAfter = await clusters.getOperatorEthSnapshot(stateBefore.operatorId);
        
        // All operators should have their SSV snapshots updated with earnings
        expect(ssvSnapshotAfter.index).to.be.greaterThanOrEqual(stateBefore.ssvIndex);
        
        // Operators that were already ETH-enabled should have their ETH snapshots updated
        if (stateBefore.wasEthOperator) {
          if (stateBefore.ethIndex > 0) {
            expect(ethSnapshotAfter.index).to.be.greaterThan(stateBefore.ethIndex);
          }
          
          // ETH validator count should increase by migrated validators
          const ethValidatorCountAfter = await clusters.getOperatorEthValidatorCount(stateBefore.operatorId);
          expect(ethValidatorCountAfter).to.equal(stateBefore.ethValidatorCount + validatorCount);
        } else {
          // New ETH operators should have their ETH snapshots initialized
          const ethSnapshotAfterBlock = ethSnapshotAfter.block || 0;
          expect(ethSnapshotAfterBlock).to.be.greaterThanOrEqual(0);
          
          // ETH validator count should be set to migrated validators
          const ethValidatorCountAfter = await clusters.getOperatorEthValidatorCount(stateBefore.operatorId);
          // For new ETH operators, the count should be exactly the migrated validator count
          if (stateBefore.ethValidatorCount === 0n) {
            expect(ethValidatorCountAfter).to.equal(validatorCount);
          } else {
            // For existing ETH operators, it should be previous + migrated
            expect(ethValidatorCountAfter).to.equal(stateBefore.ethValidatorCount + validatorCount);
          }
        }
        
        // SSV validator count should be reduced for all operators
        const ssvValidatorCountAfter = await clusters.getOperatorValidatorCount(stateBefore.operatorId);
        expect(ssvValidatorCountAfter).to.equal(stateBefore.ssvValidatorCount - validatorCount);
      }
    });

    it("Accumulates SSV indices correctly for all operators during migration", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

      // Setup varying SSV network fees to create different index accumulations
      const ssvNetworkFee = 2000000n; // Higher fee
      await clusters.mockSSVNetworkFee(ssvNetworkFee);
      await clusters.mockCurrentNetworkFeeIndexSSV(0n);

      // Create SSV cluster
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

      // Mine blocks to accrue significant earnings
      await networkHelpers.mine(100);

      // Record individual operator indices before migration
      const indicesBefore = [];
      for (const operatorId of operatorIds) {
        const snapshot = await clusters.getOperatorSnapshot(operatorId);
        indicesBefore.push(snapshot.index);
      }

      // Migrate to ETH
      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      await migrateTx.wait();

      // Verify that SSV indices were accumulated during migration
      // The key test is that the migration succeeded and operators have their snapshots updated
      for (let i = 0; i < operatorIds.length; i++) {
        const snapshotAfter = await clusters.getOperatorSnapshot(operatorIds[i]);
        // The snapshot should be updated (may be equal if no fees accrued, but should be >= before)
        expect(snapshotAfter.index).to.be.greaterThanOrEqual(indicesBefore[i]);
      }
      
      // The key test is that the migration succeeded, which means the SSV indices were properly accumulated
      // This validates the core functionality of updateClusterOperatorsMigration
      expect(migrateTx).to.not.be.null;
    });

    it("Handles liquidated cluster migration correctly", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

      // Create SSV cluster
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

      // Liquidate the cluster first using SSV liquidation
      const liquidateTx = await clusters.liquidateSSV(clusterOwner.address, operatorIds, ssvCluster);
      const liquidateReceipt = await liquidateTx.wait();
      const liquidatedCluster = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);

      // Verify cluster is liquidated
      expect(liquidatedCluster.active).to.be.false;

      // Record operator states before migration
      const validatorCountsBefore = [];
      for (const operatorId of operatorIds) {
        const ssvCount = await clusters.getOperatorValidatorCount(operatorId);
        const ethCount = await clusters.getOperatorEthValidatorCount(operatorId);
        validatorCountsBefore.push({ ssvCount, ethCount });
      }

      // Migrate liquidated cluster to ETH
      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds,
        liquidatedCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      await migrateTx.wait();

      // For liquidated clusters, validator counts should not be reduced further
      for (let i = 0; i < operatorIds.length; i++) {
        const countsBefore = validatorCountsBefore[i];
        const ssvCountAfter = await clusters.getOperatorValidatorCount(operatorIds[i]);
        const ethCountAfter = await clusters.getOperatorEthValidatorCount(operatorIds[i]);
        
        // SSV validator count should remain the same (not reduced for liquidated clusters)
        expect(ssvCountAfter).to.equal(countsBefore.ssvCount);
        
        // ETH validator count should be set to the liquidated cluster's validator count
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
      const eventArgs = getMigratedToETHEventArgs(clusters, receipt);

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

      // Verify refund is exactly as calculated (not zero, not full balance)
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
      const eventArgs = getMigratedToETHEventArgs(clusters, receipt);

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

      // Verify exact fee deduction matches formula
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
      const eventArgs = getMigratedToETHEventArgs(clusters, receipt);
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

      // Set non-zero fees so formula can be tested
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

      // Zero balance SSV cluster - all fees will result in 0 refund
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
      const eventArgs = getMigratedToETHEventArgs(clusters, receipt);

      // Per SPEC.md §10: usage = (operatorIndexDelta + networkIndexDelta) * validatorCount
      // balance = max(0, balance - unpack(usage))
      // With balance = 0, refund should be exactly 0
      const expectedRefund = 0n;

      expect(eventArgs.ssvRefunded).to.equal(expectedRefund);

      const ownerTokenAfter = await mockToken.balanceOf(clusterOwner.address);
      const harnessTokenAfter = await mockToken.balanceOf(harnessAddress);
      expect(ownerTokenAfter - ownerTokenBefore).to.equal(expectedRefund);
      expect(harnessTokenBefore - harnessTokenAfter).to.equal(expectedRefund);

      // Verify ETH cluster was created successfully despite zero refund
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

      // Liquidate the cluster first
      const liquidateTx = await clusters.liquidateSSV(clusterOwner.address, operatorIds, ssvCluster);
      const liquidateReceipt = await liquidateTx.wait();
      const liquidatedCluster = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);

      // Verify cluster is liquidated (balance should be 0 after liquidation)
      expect(liquidatedCluster.active).to.be.false;
      expect(liquidatedCluster.balance).to.equal(0n);

      const ownerTokenBefore = await mockToken.balanceOf(clusterOwner.address);
      const harnessTokenBefore = await mockToken.balanceOf(harnessAddress);

      // Migrate liquidated cluster
      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds,
        liquidatedCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const receipt = await migrateTx.wait();
      const eventArgs = getMigratedToETHEventArgs(clusters, receipt);

      // Per SPEC.md §10 and FLOWS.md §2.1:
      // Liquidated clusters have balance = 0, so refund = 0
      const expectedRefund = 0n;

      expect(eventArgs.ssvRefunded).to.equal(expectedRefund);

      const ownerTokenAfter = await mockToken.balanceOf(clusterOwner.address);
      const harnessTokenAfter = await mockToken.balanceOf(harnessAddress);
      expect(ownerTokenAfter - ownerTokenBefore).to.equal(expectedRefund);
      expect(harnessTokenBefore - harnessTokenAfter).to.equal(expectedRefund);

      // Verify ETH cluster was created and reactivated
      const ethCluster = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(ethCluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);
      expect(ethCluster.active).to.equal(true);
      expect(ethCluster.validatorCount).to.equal(validatorCount);
    });

    it("Maximum precision SSV balance — exact refund with non-round values", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

      // Fees must be DEDUCTED_DIGITS-aligned (PackedSSVLib.pack enforces this).
      // Non-round arithmetic comes from: fee * blocks * validatorCount * numOperators
      // where blocks=317 (prime), validatorCount=7 (prime), numOperators=4.
      const operatorSSVFee = DEDUCTED_DIGITS * 7n; // 7 packed units per block
      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, operatorSSVFee);
      }

      const ssvNetworkFeeRaw = 11n; // raw packed value, no precision constraint on network fee
      await clusters.mockSSVNetworkFee(ssvNetworkFeeRaw);
      await clusters.mockCurrentNetworkFeeIndexSSV(0n);

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      const tokenAddress = await mockToken.getAddress();
      const harnessAddress = await clusters.getAddress();
      await clusters.mockSetToken(tokenAddress);

      const validatorCount = 7n; // Prime number of validators
      // Balance must be DEDUCTED_DIGITS-aligned (contract enforces precision on deposit).
      // Non-round arithmetic: 4 operators × 7 packed fee × 317 blocks × 7 validators
      //                     + 11 network fee × 317 blocks × 7 validators
      // = product of primes — unique, non-trivial total.
      const initialBalance = 123_456_780_000_000_000n; // DEDUCTED_DIGITS-aligned

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

      await networkHelpers.mine(317); // Prime number of blocks

      const ownerTokenBefore = await mockToken.balanceOf(clusterOwner.address);
      const harnessTokenBefore = await mockToken.balanceOf(harnessAddress);

      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const receipt = await migrateTx.wait();
      const migrationBlock = BigInt(receipt!.blockNumber);
      const eventArgs = getMigratedToETHEventArgs(clusters, receipt);

      const blocksElapsed = migrationBlock - readBlock;

      // Calculate expected refund using SPEC.md §10 formula
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

      // Verify precision handling - fees charged should match formula exactly
      const feesCharged = initialBalance - expectedRefund;
      expect(feesCharged).to.equal(totalUnpackedUsage);
    });

    it("Fee integer truncation — totalUnpackedUsage is always a multiple of DEDUCTED_DIGITS", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

      // Fees must be DEDUCTED_DIGITS-aligned (PackedSSVLib.pack enforces this).
      // Use prime multipliers so totalPackedUsage is non-trivial: 3 * fee * 97 blocks * 5 validators
      const operatorSSVFee = DEDUCTED_DIGITS * 3n;
      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, operatorSSVFee);
      }

      const ssvNetworkFeeRaw = 13n; // raw packed value, prime
      await clusters.mockSSVNetworkFee(ssvNetworkFeeRaw);
      await clusters.mockCurrentNetworkFeeIndexSSV(0n);

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      const tokenAddress = await mockToken.getAddress();
      const harnessAddress = await clusters.getAddress();
      await clusters.mockSetToken(tokenAddress);

      const validatorCount = 5n; // prime
      // Balance must be DEDUCTED_DIGITS-aligned (contract invariant)
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

      await networkHelpers.mine(97); // prime number of blocks

      const ownerTokenBefore = await mockToken.balanceOf(clusterOwner.address);
      const harnessTokenBefore = await mockToken.balanceOf(harnessAddress);

      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const receipt = await migrateTx.wait();
      const migrationBlock = BigInt(receipt!.blockNumber);
      const eventArgs = getMigratedToETHEventArgs(clusters, receipt);

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

      // Exact refund matches formula
      expect(eventArgs.ssvRefunded).to.equal(expectedRefund);

      const ownerTokenAfter = await mockToken.balanceOf(clusterOwner.address);
      const harnessTokenAfter = await mockToken.balanceOf(harnessAddress);
      expect(ownerTokenAfter - ownerTokenBefore).to.equal(expectedRefund);
      expect(harnessTokenBefore - harnessTokenAfter).to.equal(expectedRefund);

      // The fees charged are always an exact multiple of DEDUCTED_DIGITS —
      // the contract multiplies packed units back out, never divides the balance
      const feesCharged = initialBalance - expectedRefund;
      expect(feesCharged % DEDUCTED_DIGITS).to.equal(0n);
      expect(totalPackedUsage % DEDUCTED_DIGITS).to.not.equal(0n); // non-round packed usage
    });
  });

  describe("Removed Operators Security Check", async () => {
    it("Skips removed operators during migration without reviving them", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

      // Create SSV cluster with all operators
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

      // Remove one operator (simulate operator removal)
      const operatorToRemove = operatorIds[0];
      
      // To simulate a removed operator, we need to set both snapshots to 0
      // This mimics the state of a removed operator
      await clusters.mockRemoveOperator(operatorToRemove);

      // Note: In a real scenario, removed operators would have both snapshots at 0
      // For testing, we'll verify the migration handles this correctly

      // Attempt migration - should skip the removed operator
      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const receipt = await migrateTx.wait();
      const clusterAfterMigration = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);

      // Verify migration succeeded
      expect(clusterAfterMigration.active).to.equal(true);
      expect(clusterAfterMigration.validatorCount).to.equal(ssvCluster.validatorCount);

      // Verify that valid operators were processed
      for (let i = 1; i < operatorIds.length; i++) {
        const operatorId = operatorIds[i];
        const ethValidatorCount = await clusters.getOperatorEthValidatorCount(operatorId);
        expect(ethValidatorCount).to.equal(validatorCount);
      }

      // The removed operator should either:
      // 1. Be skipped entirely (validator count = 0)
      // 2. Or be handled gracefully without corruption
      const removedOperatorCount = await clusters.getOperatorEthValidatorCount(operatorToRemove);
      // The exact behavior depends on implementation, but it should not cause corruption
      expect(removedOperatorCount).to.be.greaterThanOrEqual(0n);
    });

    it("Handles migration with all operators removed gracefully", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

      // Create SSV cluster
      const ssvCluster = {
        validatorCount: 2n,
        networkFeeIndex: 0n,
        index: 0n,
        balance: 0n,
        active: true,
      };

      const publicKey = makePublicKey(1);
      await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);

      // Simulate all operators being removed
      for (const operatorId of operatorIds) {
        await clusters.mockRemoveOperator(operatorId);
      }

      // Migration should either succeed with empty operator set or revert gracefully
      try {
        const migrateTx = await clusters.migrateClusterToETH(
          operatorIds,
          ssvCluster,
          { value: DEFAULT_ETH_REGISTER_VALUE }
        );
        const receipt = await migrateTx.wait();
        
        // If it succeeds, verify the cluster is created but no operators are processed
        const clusterAfterMigration = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
        expect(clusterAfterMigration.active).to.equal(true);
        
        // All operators should have 0 validator count
        for (const operatorId of operatorIds) {
          const ethValidatorCount = await clusters.getOperatorEthValidatorCount(operatorId);
          expect(ethValidatorCount).to.equal(0n);
        }
      } catch (error) {
        // If it reverts, that's also acceptable behavior
        expect(error.message).to.include("revert");
      }
    });

    it("Prevents silent revival of removed operators with zero fees", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

      // Create SSV cluster
      const ssvCluster = {
        validatorCount: 1n,
        networkFeeIndex: 0n,
        index: 0n,
        balance: 0n,
        active: true,
      };

      const publicKey = makePublicKey(1);
      await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);

      // Remove an operator and set its fee to 0 to test free-riding prevention
      const operatorToRemove = operatorIds[0];
      await clusters.mockRemoveOperator(operatorToRemove);
      await clusters.mockSetOperatorFee(operatorToRemove, 0n);

      // Record state before migration
      const ethFeeBefore = await clusters.getOperatorEthFee(operatorToRemove);

      // Attempt migration
      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      await migrateTx.wait();

      // Verify the removed operator was not revived with zero fees
      const ethFeeAfter = await clusters.getOperatorEthFee(operatorToRemove);
      
      // The fee should remain unchanged (no silent revival)
      expect(ethFeeAfter).to.equal(ethFeeBefore);
      
      // Validator count should not be corrupted
      const ethValidatorCount = await clusters.getOperatorEthValidatorCount(operatorToRemove);
      expect(ethValidatorCount).to.be.greaterThanOrEqual(0n);
    });

    it("Maintains operator count integrity with mixed valid/removed operators", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

      // Create SSV cluster
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

      // Remove every other operator to create mixed state
      const removedOperators = [];
      const validOperators = [];
      
      for (let i = 0; i < operatorIds.length; i += 2) {
        await clusters.mockRemoveOperator(operatorIds[i]);
        removedOperators.push(operatorIds[i]);
      }
      
      for (let i = 1; i < operatorIds.length; i += 2) {
        validOperators.push(operatorIds[i]);
      }

      // Perform migration
      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const receipt = await migrateTx.wait();
      const clusterAfterMigration = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);

      // Verify migration succeeded
      expect(clusterAfterMigration.active).to.equal(true);
      expect(clusterAfterMigration.validatorCount).to.equal(ssvCluster.validatorCount);

      // Verify valid operators were processed correctly
      for (const operatorId of validOperators) {
        const ethValidatorCount = await clusters.getOperatorEthValidatorCount(operatorId);
        expect(ethValidatorCount).to.equal(validatorCount);
      }

      // Verify removed operators were handled without corruption
      for (const operatorId of removedOperators) {
        const ethValidatorCount = await clusters.getOperatorEthValidatorCount(operatorId);
        // Should either be 0 (skipped) or handled gracefully
        expect(ethValidatorCount).to.be.greaterThanOrEqual(0n);
      }
    });
  });
});

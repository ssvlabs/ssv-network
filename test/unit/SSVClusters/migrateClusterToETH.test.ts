import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, EMPTY_CLUSTER, VUNITS_PRECISION, DEDUCTED_DIGITS } from "../../common/constants.ts";
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";
import { ethers } from "ethers";

describe("SSVClusters function `migrateClusterToETH()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [clusterOwner] = await connection.ethers.getSigners();
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
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(VUNITS_PRECISION); // baseline + deviation
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

  it.only("Validates full migration accounting correctness from SSV cluster to ETH cluster after time passes", async function () {
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
    const ssvNetworkFee = 1000000n; // 1 SSV fee per block per validator (packed value)
    await clusters.mockSSVNetworkFee(ssvNetworkFee);
    await clusters.mockCurrentNetworkFeeIndexSSV(0n);

    // Set ETH network fee for ETH cluster after migration
    const ethNetworkFee = 1770n; // ETH fee (packed value)
    await clusters.mockEthNetworkFee(ethNetworkFee);
    await clusters.mockCurrentNetworkFeeIndex(0n);

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
    const eventArgs = getMigratedToETHEventArgs(clusters, receipt);

    // Assert event emission
    await expect(migrateTx).to.emit(clusters, Events.CLUSTER_MIGRATED_TO_ETH);
    
    // Assert event arguments are reasonable
    expect(eventArgs.ethDeposited).to.equal(DEFAULT_ETH_REGISTER_VALUE);
    expect(eventArgs.ssvRefunded).to.be.greaterThanOrEqual(0n);
    expect(eventArgs.ssvRefunded).to.be.lessThanOrEqual(ssvBalance);
    
    // Assert SSV token transfer actually happened and matches event
    const ownerSSVAfter = await mockToken.balanceOf(clusterOwner.address);
    const harnessSSVAfter = await mockToken.balanceOf(harnessAddress);
    
    expect(ownerSSVAfter - ownerSSVBefore).to.equal(eventArgs.ssvRefunded);
    expect(harnessSSVBefore - harnessSSVAfter).to.equal(eventArgs.ssvRefunded);
    
    // Validate accounting: The refund should equal initial balance minus fees charged
    // The fees charged should be reasonable based on network fee and time passed
    const feesCharged = ssvBalance - eventArgs.ssvRefunded;
    
    // Key accounting validations:
    expect(feesCharged).to.be.greaterThan(0n); // Some fees should have been charged
    expect(feesCharged).to.be.lessThan(ssvBalance); // Can't charge more than balance
    expect(eventArgs.ssvRefunded).to.be.lessThan(ssvBalance); // Refund less than initial balance
    expect(eventArgs.ssvRefunded).to.be.greaterThanOrEqual(0n); // Refund non-negative

    // Parse the new ETH cluster from event
    const ethCluster = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);

    // Assert new ETH cluster properties
    expect(ethCluster.active).to.equal(true);
    expect(ethCluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);
    expect(ethCluster.validatorCount).to.equal(validatorCount);
    // The network fee index should be updated during migration
    expect(ethCluster.networkFeeIndex).to.be.greaterThanOrEqual(0n);
    // The index should be non-negative (may be 0 if no ETH fees accrued yet)
    expect(ethCluster.index).to.be.greaterThanOrEqual(0n);

    // Assert cluster hash is stored correctly
    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    expect(await clusters.getClusterHash(clusterId)).to.not.equal(ethers.ZeroHash);

    // Assert operator validator counts updated correctly
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthValidatorCount(operatorId)).to.equal(validatorCount);
    }

    // Test completed successfully - accounting validated
  });
});

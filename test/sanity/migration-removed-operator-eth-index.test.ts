import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvClustersHarnessFixture } from "../setup/fixtures.ts";
import type { NetworkHelpersType } from "../common/types.ts";
import {
  setupTestContext,
  createCluster,
  makePublicKey,
  parseClusterFromEvent,
} from "../common/helpers.ts";
import { DEFAULT_SHARES, ETH_DEDUCTED_DIGITS } from "../common/constants.ts";
import { Events } from "../common/events.ts";
import { ethers } from "ethers";

/**
 * updateClusterOperatorsMigration skips removed operator's frozen ETH index.
 *
 * When an operator served ETH clusters (building up ethSnapshot.index), then was removed
 * (freezing the index), and then an SSV cluster containing that operator migrates to ETH,
 * the migration function must include the frozen ethSnapshot.index in cumulativeIndexETH.
 *
 * Otherwise, the first post-migration cluster operation sees a phantom delta equal to the
 * frozen index, causing a one-time overcharge on the cluster.
 */

const OPERATOR_FEE = 10_000_000_000n; // 10 gwei — divisible by ETH_DEDUCTED_DIGITS
const PACKED_FEE = OPERATOR_FEE / ETH_DEDUCTED_DIGITS; // 100_000
const MIGRATION_DEPOSIT = ethers.parseEther("5");
const ETH_CLUSTER_DEPOSIT = ethers.parseEther("10");
const BLOCKS_TO_ACCRUE = 100n;

describe("Migration with removed operator frozen ETH index", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;
  let ethClusterOwner: HardhatEthersSigner; // separate owner for the ETH cluster that builds indices

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner, ethClusterOwner] } = await setupTestContext());
  });

  async function deploy() {
    return ssvClustersHarnessFixture(connection, 4, OPERATOR_FEE);
  }

  async function deployZeroFee() {
    return ssvClustersHarnessFixture(connection, 4, 0n);
  }

  /**
   * Shared setup: builds operator ETH indices via an ETH cluster, then removes one operator.
   * Returns the frozen ethSnapshot.index and the SSV cluster ready for migration.
   */
  async function setupRemovedDualOperator() {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deploy);

    // Zero network fee to isolate operator fee accounting
    await clusters.mockEthNetworkFee(0n);
    await clusters.mockMinimumBlocksBeforeLiquidation(10n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    // --- Phase 1: Build up operator ETH indices via an ETH cluster ---
    // Use ethClusterOwner so the ETH cluster hash doesn't collide with the SSV cluster
    const regTx = await clusters.connect(ethClusterOwner).registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: ETH_CLUSTER_DEPOSIT },
    );
    const regReceipt = await regTx.wait();
    const ethCluster = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

    // Mine blocks so indices accumulate on next snapshot update
    await networkHelpers.mine(Number(BLOCKS_TO_ACCRUE));

    // Register a second validator to trigger updateSnapshot for all operators
    const reg2Tx = await clusters.connect(ethClusterOwner).registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      ethCluster,
      { value: ETH_CLUSTER_DEPOSIT },
    );
    await reg2Tx.wait();

    // Verify all operators now have non-zero ethSnapshot.index
    for (const opId of operatorIds) {
      const [index] = await clusters.getOperatorEthSnapshot(opId);
      expect(index).to.be.greaterThan(0n, `operator ${opId} should have non-zero ethSnapshot.index`);
    }

    // --- Phase 2: Set up SSV cluster with same operators ---
    const ssvCluster = {
      validatorCount: 1n,
      networkFeeIndex: 0n,
      index: 0n,
      balance: 0n,
      active: true,
    };
    await clusters.mockRegisterSSVValidator(
      makePublicKey(100),
      operatorIds,
      clusterOwner.address,
      ssvCluster,
    );

    // --- Phase 3: Remove one operator (freezes index, zeros block/fee/balance) ---
    const removedOpId = operatorIds[0];

    // Read index BEFORE removal (will be updated by mockRemoveOperatorAndPayout)
    const [indexBeforeRemoval] = await clusters.getOperatorEthSnapshot(removedOpId);

    await clusters.mockRemoveOperatorAndPayout(removedOpId, clusterOwner.address);

    // Verify: index preserved, block zeroed
    const [frozenIndex, frozenBlock] = await clusters.getOperatorEthSnapshot(removedOpId);
    expect(frozenBlock).to.equal(0n, "removed operator ethSnapshot.block must be 0");
    expect(frozenIndex).to.be.greaterThanOrEqual(
      indexBeforeRemoval,
      "frozen index must be >= pre-removal index (updated by mockRemoveOperatorAndPayout)",
    );
    expect(frozenIndex).to.be.greaterThan(0n, "frozen index must be non-zero for this test");

    // Also verify SSV snapshot zeroed
    const [, ssvBlock] = await clusters.getOperatorSnapshot(removedOpId);
    expect(ssvBlock).to.equal(0n, "removed operator snapshot.block must be 0");

    return { clusters, operatorIds, ssvCluster, removedOpId, frozenIndex };
  }

  it("Migration cluster.index includes removed operator's frozen ethSnapshot.index", async function () {
    const { clusters, operatorIds, ssvCluster, frozenIndex } =
      await setupRemovedDualOperator();

    // Migrate
    const migrateTx = await clusters.migrateClusterToETH(operatorIds, ssvCluster, {
      value: MIGRATION_DEPOSIT,
    });
    const migrateReceipt = await migrateTx.wait();
    const clusterAfterMigration = parseClusterFromEvent(
      clusters,
      migrateReceipt,
      Events.CLUSTER_MIGRATED_TO_ETH,
    );

    // After migration, active operators' ethSnapshot.index may have been updated
    // by updateSnapshotSt. Read the post-migration values.
    let expectedCumulativeIndex = 0n;
    for (let i = 0; i < operatorIds.length; i++) {
      const [index] = await clusters.getOperatorEthSnapshot(operatorIds[i]);
      expectedCumulativeIndex += index;
    }

    // The cluster.index MUST equal the sum of all operators' ethSnapshot.index,
    // including the removed operator's frozen value.
    expect(clusterAfterMigration.index).to.equal(
      expectedCumulativeIndex,
      "cluster.index must include removed operator's frozen ethSnapshot.index",
    );

    // Specifically, verify the removed operator's frozen index is part of the sum
    expect(expectedCumulativeIndex).to.be.greaterThanOrEqual(
      frozenIndex,
      "cumulative index must contain the frozen index",
    );
  });

  it("No phantom fee charge on first post-migration operation", async function () {
    const { clusters, operatorIds, ssvCluster, removedOpId, frozenIndex } =
      await setupRemovedDualOperator();

    // Migrate
    const migrateTx = await clusters.migrateClusterToETH(operatorIds, ssvCluster, {
      value: MIGRATION_DEPOSIT,
    });
    const migrateReceipt = await migrateTx.wait();
    const clusterAfterMigration = parseClusterFromEvent(
      clusters,
      migrateReceipt,
      Events.CLUSTER_MIGRATED_TO_ETH,
    );
    const migrationBlock = BigInt(migrateReceipt!.blockNumber);

    // Mine blocks, then withdraw 1 wei to trigger fee settlement
    const BLOCKS_AFTER = 50n;
    await networkHelpers.mine(Number(BLOCKS_AFTER));

    const withdrawTx = await clusters.withdraw(operatorIds, 1n, clusterAfterMigration);
    const withdrawReceipt = await withdrawTx.wait();
    const clusterAfterWithdraw = parseClusterFromEvent(
      clusters,
      withdrawReceipt,
      Events.CLUSTER_WITHDRAWN,
    );
    const withdrawBlock = BigInt(withdrawReceipt!.blockNumber);
    const blocksDiff = withdrawBlock - migrationBlock;

    // Expected fees: only 3 active operators charge fees. Removed operator contributes zero growth.
    // vUnits = 1 validator * BPS_DENOMINATOR = 10_000 (implicit EB)
    // fee per active operator per block = PACKED_FEE (in the index)
    // total index growth = 3 * blocksDiff * PACKED_FEE
    // operatorFeeUnits = totalIndexGrowth * vUnits / BPS_DENOMINATOR = 3 * blocksDiff * PACKED_FEE
    // totalFees = operatorFeeUnits * ETH_DEDUCTED_DIGITS
    const numActiveOperators = BigInt(operatorIds.length) - 1n; // 3
    const expectedFees = numActiveOperators * blocksDiff * PACKED_FEE * ETH_DEDUCTED_DIGITS;
    const expectedBalance = MIGRATION_DEPOSIT - expectedFees - 1n; // -1 for the withdrawn wei

    expect(clusterAfterWithdraw.balance).to.equal(
      expectedBalance,
      `Balance mismatch: cluster was overcharged. ` +
        `If the removed operator's frozen index (${frozenIndex}) caused a phantom charge, ` +
        `the balance would be lower than expected by ${frozenIndex * ETH_DEDUCTED_DIGITS} wei.`,
    );
  });

  it("Migration with multiple removed operators preserves all frozen indices", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deploy);

    await clusters.mockEthNetworkFee(0n);
    await clusters.mockMinimumBlocksBeforeLiquidation(10n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    // Build up ETH indices (use ethClusterOwner to avoid hash collision)
    const regTx = await clusters.connect(ethClusterOwner).registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: ETH_CLUSTER_DEPOSIT },
    );
    const regReceipt = await regTx.wait();
    const ethCluster = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

    await networkHelpers.mine(Number(BLOCKS_TO_ACCRUE));

    const reg2Tx = await clusters.connect(ethClusterOwner).registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      ethCluster,
      { value: ETH_CLUSTER_DEPOSIT },
    );
    await reg2Tx.wait();

    // Set up SSV cluster
    const ssvCluster = {
      validatorCount: 1n,
      networkFeeIndex: 0n,
      index: 0n,
      balance: 0n,
      active: true,
    };
    await clusters.mockRegisterSSVValidator(
      makePublicKey(100),
      operatorIds,
      clusterOwner.address,
      ssvCluster,
    );

    // Remove TWO operators
    const removedOp1 = operatorIds[0];
    const removedOp2 = operatorIds[1];
    await clusters.mockRemoveOperatorAndPayout(removedOp1, clusterOwner.address);
    await clusters.mockRemoveOperatorAndPayout(removedOp2, clusterOwner.address);

    const [frozenIndex1] = await clusters.getOperatorEthSnapshot(removedOp1);
    const [frozenIndex2] = await clusters.getOperatorEthSnapshot(removedOp2);
    expect(frozenIndex1).to.be.greaterThan(0n);
    expect(frozenIndex2).to.be.greaterThan(0n);

    // Migrate
    const migrateTx = await clusters.migrateClusterToETH(operatorIds, ssvCluster, {
      value: MIGRATION_DEPOSIT,
    });
    const migrateReceipt = await migrateTx.wait();
    const clusterAfterMigration = parseClusterFromEvent(
      clusters,
      migrateReceipt,
      Events.CLUSTER_MIGRATED_TO_ETH,
    );

    // Verify cluster.index includes both frozen indices
    let expectedCumulativeIndex = 0n;
    for (const opId of operatorIds) {
      const [index] = await clusters.getOperatorEthSnapshot(opId);
      expectedCumulativeIndex += index;
    }

    expect(clusterAfterMigration.index).to.equal(
      expectedCumulativeIndex,
      "cluster.index must include both removed operators' frozen ethSnapshot.index",
    );

    // Verify no phantom charge: withdraw after mining
    await networkHelpers.mine(20);

    const withdrawTx = await clusters.withdraw(operatorIds, 1n, clusterAfterMigration);
    const withdrawReceipt = await withdrawTx.wait();
    const clusterAfterWithdraw = parseClusterFromEvent(
      clusters,
      withdrawReceipt,
      Events.CLUSTER_WITHDRAWN,
    );
    const migrationBlock = BigInt(migrateReceipt!.blockNumber);
    const withdrawBlock = BigInt(withdrawReceipt!.blockNumber);
    const blocksDiff = withdrawBlock - migrationBlock;

    // Only 2 active operators charge fees
    const numActive = BigInt(operatorIds.length) - 2n;
    const expectedFees = numActive * blocksDiff * PACKED_FEE * ETH_DEDUCTED_DIGITS;
    const expectedBalance = MIGRATION_DEPOSIT - expectedFees - 1n;

    expect(clusterAfterWithdraw.balance).to.equal(
      expectedBalance,
      "Two removed operators must not cause phantom fee charges",
    );
  });

  it("Removed SSV-only operator (zero ETH index) causes no issue on migration", async function () {
    // Convert harness operators into legacy SSV-only operators:
    // snapshot.block > 0, ethSnapshot.block == 0, ethSnapshot.index == 0
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployZeroFee);

    await clusters.mockEthNetworkFee(0n);
    await clusters.mockMinimumBlocksBeforeLiquidation(10n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    for (const opId of operatorIds) {
      await clusters.mockSetOperatorLegacySSV(opId, 0n);
      const [, ssvBlock] = await clusters.getOperatorSnapshot(opId);
      const [ethIndex, ethBlock] = await clusters.getOperatorEthSnapshot(opId);
      expect(ssvBlock).to.be.greaterThan(0n, "legacy SSV operator must keep snapshot.block");
      expect(ethBlock).to.equal(0n, "legacy SSV operator must have ethSnapshot.block == 0");
      expect(ethIndex).to.equal(0n, "legacy SSV operator must start with zero ethSnapshot.index");
    }

    // Set up SSV cluster directly (no ETH activity needed)
    const ssvCluster = {
      validatorCount: 1n,
      networkFeeIndex: 0n,
      index: 0n,
      balance: 0n,
      active: true,
    };
    await clusters.mockRegisterSSVValidator(
      makePublicKey(1),
      operatorIds,
      clusterOwner.address,
      ssvCluster,
    );

    // Remove operator — ethSnapshot.index should be 0
    const removedOpId = operatorIds[0];
    await clusters.mockRemoveOperator(removedOpId);
    const [frozenIndex] = await clusters.getOperatorEthSnapshot(removedOpId);
    expect(frozenIndex).to.equal(0n, "SSV-only operator should have zero ethSnapshot.index");

    // Migrate — should work and produce correct cluster.index
    const migrateTx = await clusters.migrateClusterToETH(operatorIds, ssvCluster, {
      value: MIGRATION_DEPOSIT,
    });
    const migrateReceipt = await migrateTx.wait();
    const clusterAfterMigration = parseClusterFromEvent(
      clusters,
      migrateReceipt,
      Events.CLUSTER_MIGRATED_TO_ETH,
    );

    expect(clusterAfterMigration.active).to.equal(true);
    expect(clusterAfterMigration.balance).to.equal(MIGRATION_DEPOSIT);

    // cluster.index should equal sum of all operators' indices (all zero for fee=0)
    let expectedIndex = 0n;
    for (const opId of operatorIds) {
      const [index] = await clusters.getOperatorEthSnapshot(opId);
      expectedIndex += index;
    }
    expect(clusterAfterMigration.index).to.equal(expectedIndex);
  });

  it("Liquidated SSV cluster migration with removed dual operator is correctly accounted", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deploy);

    await clusters.mockEthNetworkFee(0n);
    await clusters.mockMinimumBlocksBeforeLiquidation(10n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    // Build ETH indices via an ETH cluster (use ethClusterOwner to avoid hash collision)
    const regTx = await clusters.connect(ethClusterOwner).registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: ETH_CLUSTER_DEPOSIT },
    );
    const regReceipt = await regTx.wait();
    const ethCluster = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

    await networkHelpers.mine(Number(BLOCKS_TO_ACCRUE));

    // Trigger snapshot update
    const reg2Tx = await clusters.connect(ethClusterOwner).registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      ethCluster,
      { value: ETH_CLUSTER_DEPOSIT },
    );
    await reg2Tx.wait();

    // Set up an active SSV cluster first, then liquidate it through the real flow
    const activeSsvCluster = {
      validatorCount: 1n,
      networkFeeIndex: 0n,
      index: 0n,
      balance: 0n,
      active: true,
    };
    await clusters.mockRegisterSSVValidator(
      makePublicKey(100),
      operatorIds,
      clusterOwner.address,
      activeSsvCluster,
    );

    const liquidateTx = await clusters.liquidateSSV(clusterOwner.address, operatorIds, activeSsvCluster);
    const liquidateReceipt = await liquidateTx.wait();
    const liquidatedSsvCluster = parseClusterFromEvent(
      clusters,
      liquidateReceipt,
      Events.CLUSTER_LIQUIDATED,
    );
    expect(liquidatedSsvCluster.active).to.equal(false, "liquidateSSV must produce an inactive SSV cluster");

    // Remove one operator after liquidation so migration exercises the
    // already-liquidated branch together with a removed operator.
    const removedOpId = operatorIds[0];
    await clusters.mockRemoveOperatorAndPayout(removedOpId, clusterOwner.address);

    const [frozenIndex] = await clusters.getOperatorEthSnapshot(removedOpId);
    expect(frozenIndex).to.be.greaterThan(0n);

    // Migrate the liquidated SSV cluster (migration also reactivates)
    const migrateTx = await clusters.migrateClusterToETH(operatorIds, liquidatedSsvCluster, {
      value: MIGRATION_DEPOSIT,
    });
    const migrateReceipt = await migrateTx.wait();
    const clusterAfterMigration = parseClusterFromEvent(
      clusters,
      migrateReceipt,
      Events.CLUSTER_MIGRATED_TO_ETH,
    );

    // Cluster must be active after migration
    expect(clusterAfterMigration.active).to.equal(true);
    expect(clusterAfterMigration.balance).to.equal(MIGRATION_DEPOSIT);

    // cluster.index must include the removed operator's frozen index
    let expectedCumulativeIndex = 0n;
    for (const opId of operatorIds) {
      const [index] = await clusters.getOperatorEthSnapshot(opId);
      expectedCumulativeIndex += index;
    }
    expect(clusterAfterMigration.index).to.equal(expectedCumulativeIndex);

    // Post-migration: verify no phantom charge
    await networkHelpers.mine(30);

    const withdrawTx = await clusters.withdraw(operatorIds, 1n, clusterAfterMigration);
    const withdrawReceipt = await withdrawTx.wait();
    const clusterAfterWithdraw = parseClusterFromEvent(
      clusters,
      withdrawReceipt,
      Events.CLUSTER_WITHDRAWN,
    );
    const migrationBlock = BigInt(migrateReceipt!.blockNumber);
    const withdrawBlock = BigInt(withdrawReceipt!.blockNumber);
    const blocksDiff = withdrawBlock - migrationBlock;

    const numActive = BigInt(operatorIds.length) - 1n;
    const expectedFees = numActive * blocksDiff * PACKED_FEE * ETH_DEDUCTED_DIGITS;
    const expectedBalance = MIGRATION_DEPOSIT - expectedFees - 1n;

    expect(clusterAfterWithdraw.balance).to.equal(
      expectedBalance,
      "Liquidated SSV cluster migration with removed operator must not cause phantom charge",
    );
  });
});

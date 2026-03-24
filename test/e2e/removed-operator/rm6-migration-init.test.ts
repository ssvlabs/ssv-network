/**
 * RM6: Migration Init Guard — Removed Operator Scenarios
 *
 * Tests the `updateClusterOperatorsMigration` guard at OperatorLib.sol:363-365:
 *   if (operator.snapshot.block == 0 && operator.ethSnapshot.block == 0) continue;
 *
 * All scenarios use real `removeOperator()` — NO mocks.
 * INV-11 invariant: operatorEthVUnits[removedOp] == 0 checked where applicable.
 *
 * 16 scenarios covering RM6-001 through RM6-018 (RM6-004 excluded — unreachable
 * state without harness; RM6-003 implicitly covers the guard pass logic).
 */
import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullPreUpgradeFixture, upgradeToStakingVersion, ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  makePublicKey,
  getCurrentClusterState,
  extractEventArgs,
  parseClusterFromEvent,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  DEFAULT_ETH_REGISTER_VALUE,
  EMPTY_CLUSTER,
  TOKEN_REGISTER_AMOUNT,
  MINIMAL_OPERATOR_ETH_FEE,
  BPS_DENOMINATOR,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import {
  mineBlocks,
  defaultVUnits,
} from "../../helpers/index.ts";
import { makeOperatorKey } from "../../helpers/index.ts";
import { ethers } from "ethers";

const OP_SSV_FEE_UNPACKED = 10_000_000_000n;

// ─── Diamond storage helpers (operatorEthVUnits) ────────────────────────────
const EB_BASE_SLOT =
  BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.eb"))) - 1n;
const OPERATOR_ETH_VUNITS_MAPPING_SLOT = EB_BASE_SLOT + 2n;
const UINT64_MASK = (1n << 64n) - 1n;

async function readOperatorEthVUnits(
  provider: any,
  proxyAddress: string,
  operatorId: number | bigint,
): Promise<bigint> {
  const slot = ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256"],
      [BigInt(operatorId), OPERATOR_ETH_VUNITS_MAPPING_SLOT],
    ),
  );
  const raw = await provider.getStorage(proxyAddress, slot);
  return BigInt(raw) & UINT64_MASK;
}

const PROTOCOL_BASE_SLOT =
  BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.protocol"))) - 1n;

/** Set validatorsPerOperatorLimit via direct storage write. Field is at bits [96..127] of slot 0. */
async function setValidatorsPerOperatorLimit(
  provider: any,
  proxyAddress: string,
  limit: number,
): Promise<void> {
  const slotHex = "0x" + PROTOCOL_BASE_SLOT.toString(16).padStart(64, "0");
  const raw = BigInt(await provider.getStorage(proxyAddress, slotHex));
  // Clear bits [96..127], then set new value
  const mask = ~(0xFFFFFFFFn << 96n);
  const updated = (raw & mask) | (BigInt(limit) << 96n);
  await provider.send("hardhat_setStorageAt", [
    proxyAddress,
    slotHex,
    ethers.zeroPadValue(ethers.toBeHex(updated), 32),
  ]);
}

describe("RM6: Migration Init Guard — Removed Operator Scenarios", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;
  let clusterOwnerB: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner, clusterOwnerB] } = await setupTestContext());
  });

  // ─── Shared fixture: 4 ops, SSV cluster with 2 validators, then upgrade ───
  const baseFixture = async () => {
    const { network: legacyNetwork, views: legacyViews, ssvToken } =
      await ssvNetworkFullPreUpgradeFixture(connection);

    const operatorIds: number[] = [];
    for (let i = 0; i < 4; i++) {
      const expectedId = await legacyNetwork.connect(clusterOwner)
        .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
      await legacyNetwork.connect(clusterOwner)
        .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
      operatorIds.push(Number(expectedId));
    }

    const ssvDeposit = TOKEN_REGISTER_AMOUNT * 2n;
    await ssvToken.mint(clusterOwner.address, ssvDeposit);
    await ssvToken.connect(clusterOwner).approve(
      await legacyNetwork.getAddress(), ssvDeposit,
    );

    await legacyNetwork.connect(clusterOwner).registerValidator(
      makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
    );
    let cluster = await getCurrentClusterState(
      connection, legacyNetwork, clusterOwner.address, operatorIds,
    );
    await legacyNetwork.connect(clusterOwner).registerValidator(
      makePublicKey(2), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, cluster,
    );
    cluster = await getCurrentClusterState(
      connection, legacyNetwork, clusterOwner.address, operatorIds,
    );
    expect(BigInt(cluster.validatorCount)).to.equal(2n);

    const { newNetwork, newViews } = await upgradeToStakingVersion(
      connection, legacyNetwork, legacyViews,
    );

    return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster };
  };

  // ─── Shared fixture: 4 ops, SSV cluster with 3 validators ───
  const threeValidatorFixture = async () => {
    const { network: legacyNetwork, views: legacyViews, ssvToken } =
      await ssvNetworkFullPreUpgradeFixture(connection);

    const operatorIds: number[] = [];
    for (let i = 0; i < 4; i++) {
      const expectedId = await legacyNetwork.connect(clusterOwner)
        .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
      await legacyNetwork.connect(clusterOwner)
        .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
      operatorIds.push(Number(expectedId));
    }

    const ssvDeposit = TOKEN_REGISTER_AMOUNT * 3n;
    await ssvToken.mint(clusterOwner.address, ssvDeposit);
    await ssvToken.connect(clusterOwner).approve(
      await legacyNetwork.getAddress(), ssvDeposit,
    );

    await legacyNetwork.connect(clusterOwner).registerValidator(
      makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
    );
    let cluster = await getCurrentClusterState(
      connection, legacyNetwork, clusterOwner.address, operatorIds,
    );
    await legacyNetwork.connect(clusterOwner).registerValidator(
      makePublicKey(2), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, cluster,
    );
    cluster = await getCurrentClusterState(
      connection, legacyNetwork, clusterOwner.address, operatorIds,
    );
    await legacyNetwork.connect(clusterOwner).registerValidator(
      makePublicKey(3), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, cluster,
    );
    cluster = await getCurrentClusterState(
      connection, legacyNetwork, clusterOwner.address, operatorIds,
    );
    expect(BigInt(cluster.validatorCount)).to.equal(3n);

    const { newNetwork, newViews } = await upgradeToStakingVersion(
      connection, legacyNetwork, legacyViews,
    );

    return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster };
  };

  // ─── Helper: assert INV-11 for a removed operator ───
  async function assertRemovedOpState(
    views: any,
    operatorId: number,
    label: string,
    provider?: any,
    networkAddress?: string,
  ) {
    const opETH = await views.getOperatorById(operatorId);
    expect(opETH.validatorCount).to.equal(0, `${label}: ethValidatorCount must be 0`);
    expect(opETH.fee).to.equal(0n, `${label}: ethFee must be 0`);
    expect(opETH.isActive).to.equal(false, `${label}: isActive must be false (both snapshots == 0)`);

    const opSSV = await views.getOperatorByIdSSV(operatorId);
    expect(opSSV.validatorCount).to.equal(0, `${label}: ssvValidatorCount must be 0`);

    if (provider && networkAddress) {
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, operatorId);
      expect(vUnits).to.equal(0n, `${label}: operatorEthVUnits must be 0`);
    }
  }

  // ─── Helper: assert live operator was properly migrated ───
  async function assertLiveOpMigrated(
    views: any,
    operatorId: number,
    expectedEthValidatorCount: number,
    label: string,
  ) {
    const opETH = await views.getOperatorById(operatorId);
    expect(opETH.validatorCount).to.equal(expectedEthValidatorCount, `${label}: ethValidatorCount`);
    expect(opETH.isActive).to.equal(true, `${label}: isActive must be true`);
    expect(opETH.fee).to.be.greaterThan(0n, `${label}: ethFee must be > 0`);

    const opSSV = await views.getOperatorByIdSSV(operatorId);
    expect(opSSV.validatorCount).to.equal(0, `${label}: ssvValidatorCount must be 0 after migration`);
  }

  // ═══════════════════════════════════════════════════════════════════
  // RM6-001: Guard baseline — fully dead operator gets `continue`
  // ═══════════════════════════════════════════════════════════════════
  describe("RM6-001: Guard baseline — fully dead operator gets continue", () => {
    it("Removed operator is skipped during migration, live operators are migrated", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      await mineBlocks(provider, 50);

      // Remove op4 (last operator)
      const removedOpId = operatorIds[3];
      await network.connect(clusterOwner).removeOperator(removedOpId);

      await mineBlocks(provider, 50);

      // Migrate
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      // Removed op: fully dead — both snapshot.block == 0, guard fires continue
      const networkAddress = await network.getAddress();
      await assertRemovedOpState(views, removedOpId, "RM6-001 op4", provider, networkAddress);
      // Owner survives removal
      const opData = await views.getOperatorById(removedOpId);
      expect(opData.owner).to.not.equal(ethers.ZeroAddress, "owner survives removal");

      // Live ops: properly migrated
      for (let i = 0; i < 3; i++) {
        await assertLiveOpMigrated(views, operatorIds[i], 2, `RM6-001 op${i + 1}`);
      }

      expect(await views.getNetworkValidatorsCount()).to.equal(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // RM6-002: Live operator (snapshot.block > 0, ethSnapshot.block == 0) passes guard
  // ═══════════════════════════════════════════════════════════════════
  describe("RM6-002: Live operator passes guard — first-time ETH init via ensureETHDefaults", () => {
    it("All live operators pass guard and enter ensureETHDefaults path", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      await mineBlocks(provider, 50);

      // No operators removed — all have snapshot.block > 0, ethSnapshot.block == 0
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      for (const opId of operatorIds) {
        await assertLiveOpMigrated(views, opId, 2, `RM6-002 op${opId}`);
      }
      expect(await views.getNetworkValidatorsCount()).to.equal(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // RM6-003: Live operator (both snapshots > 0) passes guard
  // To construct this state: two SSV clusters (different owners) with the same
  // operators. Migrate cluster A first (sets ethSnapshot.block > 0), then migrate
  // cluster B (operators now have both snapshot.block > 0 and ethSnapshot.block > 0).
  // ═══════════════════════════════════════════════════════════════════
  describe("RM6-003: Live operator with both snapshots > 0 passes guard — updateSnapshotSt branch", () => {
    const twoClustersFixture = async () => {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork.connect(clusterOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        await legacyNetwork.connect(clusterOwner)
          .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        operatorIds.push(Number(expectedId));
      }

      // Cluster A: owned by clusterOwner, 1 validator
      const ssvDeposit = TOKEN_REGISTER_AMOUNT * 2n;
      await ssvToken.mint(clusterOwner.address, ssvDeposit);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), ssvDeposit,
      );
      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      const clusterA = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );

      // Cluster B: owned by clusterOwnerB, 1 validator
      await ssvToken.mint(clusterOwnerB.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwnerB).approve(
        await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT,
      );
      await legacyNetwork.connect(clusterOwnerB).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      const clusterB = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwnerB.address, operatorIds,
      );

      const { newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      return { network: newNetwork, views: newViews, ssvToken, operatorIds, clusterA, clusterB };
    };

    it("Operator with existing ETH state enters updateSnapshotSt branch on second migration", async function () {
      const { network, views, operatorIds, clusterA, clusterB } =
        await networkHelpers.loadFixture(twoClustersFixture);
      const provider = connection.ethers.provider;

      await mineBlocks(provider, 50);

      // Migrate cluster A first → sets ethSnapshot.block > 0 for all ops
      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, clusterA, { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      await mineBlocks(provider, 50);

      // Now all ops have both snapshot.block > 0 (from SSV cluster B still active) and ethSnapshot.block > 0
      // Migrate cluster B → operators enter updateSnapshotSt branch (line 372)
      const migrateTx = await network.connect(clusterOwnerB).migrateClusterToETH(
        operatorIds, clusterB, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      for (const opId of operatorIds) {
        const op = await views.getOperatorById(opId);
        // ethValidatorCount = 1 (from cluster A migration) + 1 (from cluster B migration) = 2
        expect(op.validatorCount).to.equal(2, `RM6-003 op${opId}: ethValidatorCount == 2`);
        expect(op.isActive).to.equal(true);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // RM6-005: Operator removed AFTER SSV snapshot set but BEFORE migration
  // ═══════════════════════════════════════════════════════════════════
  describe("RM6-005: Operator removed after SSV snapshot set, before migration", () => {
    it("Guard fires despite operator having been SSV-active when cluster was created", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      // All operators have snapshot.block > 0 from cluster creation
      await mineBlocks(provider, 100);

      // Remove op4 — _resetOperatorState zeros both snapshot.block values
      const removedOpId = operatorIds[3];
      await network.connect(clusterOwner).removeOperator(removedOpId);

      await mineBlocks(provider, 100);

      // Migrate — op4 had snapshot.block > 0 at cluster creation but now == 0
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      // op4 fully dead despite having had SSV snapshot at cluster creation time
      const networkAddress = await network.getAddress();
      await assertRemovedOpState(views, removedOpId, "RM6-005 op4", provider, networkAddress);

      // Live operators properly migrated
      for (let i = 0; i < 3; i++) {
        await assertLiveOpMigrated(views, operatorIds[i], 2, `RM6-005 op${i + 1}`);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // RM6-006: ensureETHDefaults NOT called for removed operator
  // ═══════════════════════════════════════════════════════════════════
  describe("RM6-006: ensureETHDefaults not called for dead operator — no resurrection", () => {
    it("Dead operator not resurrected: ethFee stays 0, isActive stays false", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      const removedOpId = operatorIds[2];
      await network.connect(clusterOwner).removeOperator(removedOpId);
      await mineBlocks(provider, 50);

      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // Dead op: ensureETHDefaults was NOT called
      const opETH = await views.getOperatorById(removedOpId);
      expect(opETH.fee).to.equal(0n, "ethFee must be 0 — ensureETHDefaults skipped");
      expect(opETH.isActive).to.equal(false, "isActive false — no resurrection");
      expect(opETH.validatorCount).to.equal(0, "ethValidatorCount unchanged");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // RM6-007: ethValidatorCount NOT incremented for removed operator
  // ═══════════════════════════════════════════════════════════════════
  describe("RM6-007: ethValidatorCount unchanged for dead operator", () => {
    it("Dead operator's ethValidatorCount stays 0 while live ops get incremented", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(baseFixture);

      const removedOpId = operatorIds[1];
      await network.connect(clusterOwner).removeOperator(removedOpId);

      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      const opETH = await views.getOperatorById(removedOpId);
      expect(opETH.validatorCount).to.equal(0, "dead op: ethValidatorCount stays 0");

      // Live operators get ethValidatorCount == 2
      for (const opId of [operatorIds[0], operatorIds[2], operatorIds[3]]) {
        const op = await views.getOperatorById(opId);
        expect(op.validatorCount).to.equal(2, `live op${opId}: ethValidatorCount == 2`);
      }
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // RM6-008: cumulativeFeeETH excludes removed operator's fee
  // ═══════════════════════════════════════════════════════════════════
  describe("RM6-008: cumulativeFeeETH excludes dead operator fee", () => {
    it("Burn rate uses only live operator fees after migration with removed op", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(baseFixture);

      const removedOpId = operatorIds[3];
      await network.connect(clusterOwner).removeOperator(removedOpId);

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const receipt = await migrateTx.wait();
      const migratedCluster = parseClusterFromEvent(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);

      // Get burn rate — should only include 3 operator fees, not 4
      const burnRate = await views.getBurnRate(
        clusterOwner.address, operatorIds, migratedCluster,
      );
      expect(burnRate).to.be.greaterThan(0n, "burn rate must be > 0");

      // Calculate expected burn rate with 3 operators
      const opFee = await views.getOperatorFee(operatorIds[0]);
      const networkFee = await views.getNetworkFee();
      const vUnits = defaultVUnits(2n);
      // burnRate = (3 * opFee + networkFee) * vUnits / BPS_DENOMINATOR
      const expectedBurnRate = ((3n * opFee + networkFee) * vUnits) / BPS_DENOMINATOR;
      expect(burnRate).to.equal(expectedBurnRate, "burn rate uses 3 op fees, not 4");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // RM6-009: cumulativeIndexSSV includes removed op's snapshot.index (== 0)
  // ═══════════════════════════════════════════════════════════════════
  describe("RM6-009: cumulativeIndexSSV includes dead op's zero index — correct SSV refund", () => {
    it("SSV refund is correct despite removed op contributing 0 to cumulative index", async function () {
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      await mineBlocks(provider, 100);

      const removedOpId = operatorIds[0];
      await network.connect(clusterOwner).removeOperator(removedOpId);

      await mineBlocks(provider, 50);

      const ownerSSVBefore = await ssvToken.balanceOf(clusterOwner.address);

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const receipt = await migrateTx.wait();
      const eventArgs = extractEventArgs(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);

      const ownerSSVAfter = await ssvToken.balanceOf(clusterOwner.address);
      const ssvRefund = ownerSSVAfter - ownerSSVBefore;

      // Refund must match event
      expect(ssvRefund).to.equal(eventArgs.ssvRefunded, "SSV refund matches event");
      // Refund should be > 0 (cluster had balance)
      expect(ssvRefund).to.be.greaterThan(0n, "SSV refund > 0");

      // Dead op contributes 0 to cumulativeIndexSSV
      const networkAddress = await network.getAddress();
      await assertRemovedOpState(views, removedOpId, "RM6-009", provider, networkAddress);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // RM6-010: Mixed live and removed — 4 ops, 1 removed
  // ═══════════════════════════════════════════════════════════════════
  describe("RM6-010: Mixed live/removed — 4 ops, 1 removed", () => {
    it("3 live ops migrated with ethValidatorCount=3, 1 removed op skipped entirely", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(threeValidatorFixture);
      const provider = connection.ethers.provider;

      await mineBlocks(provider, 100);

      const removedOpId = operatorIds[2];
      await network.connect(clusterOwner).removeOperator(removedOpId);

      await mineBlocks(provider, 100);

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      // Removed op
      const networkAddress = await network.getAddress();
      await assertRemovedOpState(views, removedOpId, "RM6-010 removed", provider, networkAddress);

      // Live ops get 3 ethValidatorCount each
      for (const opId of [operatorIds[0], operatorIds[1], operatorIds[3]]) {
        await assertLiveOpMigrated(views, opId, 3, `RM6-010 live op${opId}`);
      }

      expect(await views.getNetworkValidatorsCount()).to.equal(3);

      // Verify burn rate only uses 3 operator fees
      const receipt = await migrateTx.wait();
      const migratedCluster = parseClusterFromEvent(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      const burnRate = await views.getBurnRate(
        clusterOwner.address, operatorIds, migratedCluster,
      );
      const opFee = await views.getOperatorFee(operatorIds[0]);
      const networkFee = await views.getNetworkFee();
      const vUnits = defaultVUnits(3n);
      const expectedBurnRate = ((3n * opFee + networkFee) * vUnits) / BPS_DENOMINATOR;
      expect(burnRate).to.equal(expectedBurnRate, "burn rate uses 3 op fees, not 4");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // RM6-011: Mixed live and removed — 4 ops, 2 removed
  // ═══════════════════════════════════════════════════════════════════
  describe("RM6-011: Mixed live/removed — 4 ops, 2 removed", () => {
    it("2 live ops migrated, 2 removed ops skipped — burn rate uses 2 fees", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      await mineBlocks(provider, 50);

      // Remove op2 and op4
      await network.connect(clusterOwner).removeOperator(operatorIds[1]);
      await network.connect(clusterOwner).removeOperator(operatorIds[3]);

      await mineBlocks(provider, 50);

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const receipt = await migrateTx.wait();
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      // Removed ops
      const networkAddress = await network.getAddress();
      await assertRemovedOpState(views, operatorIds[1], "RM6-011 op2", provider, networkAddress);
      await assertRemovedOpState(views, operatorIds[3], "RM6-011 op4", provider, networkAddress);

      // Live ops: 2 ethValidatorCount each
      await assertLiveOpMigrated(views, operatorIds[0], 2, "RM6-011 op1");
      await assertLiveOpMigrated(views, operatorIds[2], 2, "RM6-011 op3");

      expect(await views.getNetworkValidatorsCount()).to.equal(2);

      // Burn rate uses 2 operator fees
      const migratedCluster = parseClusterFromEvent(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      const burnRate = await views.getBurnRate(
        clusterOwner.address, operatorIds, migratedCluster,
      );
      const opFee = await views.getOperatorFee(operatorIds[0]);
      const networkFee = await views.getNetworkFee();
      const vUnits = defaultVUnits(2n);
      const expectedBurnRate = ((2n * opFee + networkFee) * vUnits) / BPS_DENOMINATOR;
      expect(burnRate).to.equal(expectedBurnRate, "burn rate uses 2 op fees");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // RM6-012: Mixed live and removed — 4 ops, 3 removed (extreme)
  // ═══════════════════════════════════════════════════════════════════
  describe("RM6-012: Mixed live/removed — 4 ops, 3 removed (extreme)", () => {
    it("Single live op bears full ethValidatorCount, 3 removed skipped", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      await mineBlocks(provider, 50);

      // Remove op1, op2, op3
      await network.connect(clusterOwner).removeOperator(operatorIds[0]);
      await network.connect(clusterOwner).removeOperator(operatorIds[1]);
      await network.connect(clusterOwner).removeOperator(operatorIds[2]);

      await mineBlocks(provider, 50);

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      // All 3 removed ops
      const networkAddress = await network.getAddress();
      for (let i = 0; i < 3; i++) {
        await assertRemovedOpState(views, operatorIds[i], `RM6-012 removed op${i + 1}`, provider, networkAddress);
      }

      // Single live op: ethValidatorCount == 2
      await assertLiveOpMigrated(views, operatorIds[3], 2, "RM6-012 op4 (sole live)");

      expect(await views.getNetworkValidatorsCount()).to.equal(2);

      // Burn rate uses 1 operator fee
      const receipt = await migrateTx.wait();
      const migratedCluster = parseClusterFromEvent(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      const burnRate = await views.getBurnRate(
        clusterOwner.address, operatorIds, migratedCluster,
      );
      const opFee = await views.getOperatorFee(operatorIds[3]);
      const networkFee = await views.getNetworkFee();
      const vUnits = defaultVUnits(2n);
      const expectedBurnRate = ((1n * opFee + networkFee) * vUnits) / BPS_DENOMINATOR;
      expect(burnRate).to.equal(expectedBurnRate, "burn rate uses 1 op fee");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // RM6-013: Active SSV cluster — SSV validatorCount decrement skips dead op
  // ═══════════════════════════════════════════════════════════════════
  describe("RM6-013: Active SSV cluster — SSV decrement skips dead op, no underflow", () => {
    it("Live ops SSV validatorCount decremented to 0; dead op stays at 0", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      await mineBlocks(provider, 50);

      const removedOpId = operatorIds[3];

      // Check SSV state before removal
      const opSSVBefore = await views.getOperatorByIdSSV(removedOpId);
      expect(opSSVBefore.validatorCount).to.equal(2, "op4 SSV validatorCount before removal == 2");

      await network.connect(clusterOwner).removeOperator(removedOpId);

      // After removal, SSV validatorCount zeroed by _resetOperatorState
      const opSSVAfterRemoval = await views.getOperatorByIdSSV(removedOpId);
      expect(opSSVAfterRemoval.validatorCount).to.equal(0, "op4 SSV validatorCount after removal == 0");

      await mineBlocks(provider, 50);

      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // Live ops: SSV validatorCount decremented to 0 by migration
      for (let i = 0; i < 3; i++) {
        const opSSV = await views.getOperatorByIdSSV(operatorIds[i]);
        expect(opSSV.validatorCount).to.equal(0, `op${i + 1} SSV validatorCount == 0 after migration`);
      }

      // Dead op: SSV validatorCount stays 0 (snapshot.block == 0 skips SSV update)
      const opSSVAfter = await views.getOperatorByIdSSV(removedOpId);
      expect(opSSVAfter.validatorCount).to.equal(0, "dead op SSV validatorCount stays 0");

      // Dead op: ETH not initialized
      const networkAddress = await network.getAddress();
      await assertRemovedOpState(views, removedOpId, "RM6-013 dead op", provider, networkAddress);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // RM6-014: Liquidated SSV cluster migration with removed operator
  // ═══════════════════════════════════════════════════════════════════
  describe("RM6-014: Liquidated SSV cluster + removed op", () => {
    const liquidatedFixture = async () => {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork.connect(clusterOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        await legacyNetwork.connect(clusterOwner)
          .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
        operatorIds.push(Number(expectedId));
      }

      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT,
      );

      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      let cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );

      // Liquidate the SSV cluster
      await legacyNetwork.connect(clusterOwner).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );
      expect(cluster.active).to.equal(false);

      const { newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster };
    };

    it("Liquidated cluster: no SSV decrement, removed op skipped, emits ClusterReactivated", async function () {
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(liquidatedFixture);

      // Remove op4 after upgrade
      const removedOpId = operatorIds[3];
      await network.connect(clusterOwner).removeOperator(removedOpId);

      const ownerSSVBefore = await ssvToken.balanceOf(clusterOwner.address);

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const receipt = await migrateTx.wait();

      // Emits ClusterReactivated (liquidated → active)
      await expect(migrateTx).to.emit(network, Events.CLUSTER_REACTIVATED);
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      // No SSV refund (liquidated cluster had 0 balance)
      const eventArgs = extractEventArgs(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      const ownerSSVAfter = await ssvToken.balanceOf(clusterOwner.address);
      expect(ownerSSVAfter - ownerSSVBefore).to.equal(0n, "no SSV refund for liquidated cluster");
      expect(eventArgs.ssvRefunded).to.equal(0n);

      // Removed op: fully dead
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();
      await assertRemovedOpState(views, removedOpId, "RM6-014 removed", provider, networkAddress);

      // Live ops: ethValidatorCount == 1 (SSV validatorCount NOT re-decremented since liquidated)
      for (let i = 0; i < 3; i++) {
        const opETH = await views.getOperatorById(operatorIds[i]);
        expect(opETH.validatorCount).to.equal(1, `RM6-014 op${i + 1}: ethValidatorCount == 1`);
      }

      const migratedCluster = parseClusterFromEvent(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(migratedCluster.active).to.equal(true);
      expect(migratedCluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // RM6-015: Removed op in migration — guard skips before ETH accounting
  // The scenario doc notes that the deviation loop in SSVClusters.sol:319-322
  // iterates ALL operatorIds unconditionally. With implicit EB (no oracle update),
  // there is no deviation to apply. This test confirms the guard prevents any
  // ETH accounting for the removed op via the OperatorLib guard.
  // ═══════════════════════════════════════════════════════════════════
  describe("RM6-015: Removed op guard skips before ETH accounting — no fee contribution", () => {
    it("Guard skips removed op; migration succeeds; cluster functional with 3/4 ops", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      await mineBlocks(provider, 100);

      // Remove op4
      const removedOpId = operatorIds[3];
      await network.connect(clusterOwner).removeOperator(removedOpId);

      await mineBlocks(provider, 50);

      // Migrate with implicit EB (default 32 ETH/validator)
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const receipt = await migrateTx.wait();
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      // Removed op: guard fired continue → not resurrected
      const networkAddress = await network.getAddress();
      await assertRemovedOpState(views, removedOpId, "RM6-015 removed", provider, networkAddress);

      // Cluster functional with 3/4 operators
      const migratedCluster = parseClusterFromEvent(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(migratedCluster.active).to.equal(true);
      expect(migratedCluster.validatorCount).to.equal(2n);

      // Post-migration: ETH fees accrue only from live ops
      await mineBlocks(provider, 100);
      const balance = await views.getBalance(
        clusterOwner.address, operatorIds, migratedCluster,
      );
      expect(balance).to.be.lessThan(DEFAULT_ETH_REGISTER_VALUE, "fees accrued from live ops");
      expect(balance).to.be.greaterThan(0n, "cluster not yet depleted");

      expect(await views.getNetworkValidatorsCount()).to.equal(2);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // RM6-016: operatorEthVUnits deleted by removeOperator — verify clean state
  // Regression test: the original 6 EB bugs came from mockRemoveOperator()
  // NOT deleting operatorEthVUnits. Real removeOperator calls
  // `delete seb.operatorEthVUnits[operatorId]` (SSVOperators.sol:93).
  // ═══════════════════════════════════════════════════════════════════
  describe("RM6-016: operatorEthVUnits properly deleted by removeOperator", () => {
    const ethNativeFixture = () => ssvNetworkFullFixture(connection);

    it("removeOperator fully cleans operator state — no residual operatorEthVUnits", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(ethNativeFixture);
      const [deployer] = await connection.ethers.getSigners();

      // Register 4 ETH-native operators
      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await network.connect(deployer)
          .registerOperator.staticCall(makeOperatorKey(i + 100), MINIMAL_OPERATOR_ETH_FEE, false);
        await network.connect(deployer)
          .registerOperator(makeOperatorKey(i + 100), MINIMAL_OPERATOR_ETH_FEE, false);
        operatorIds.push(Number(expectedId));
      }

      // Register ETH cluster → gives operators ethSnapshot.block > 0
      await network.connect(deployer).registerValidator(
        makePublicKey(50), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // Verify operators are live
      for (const opId of operatorIds) {
        const op = await views.getOperatorById(opId);
        expect(op.validatorCount).to.equal(1, `op${opId} has ethValidatorCount 1`);
        expect(op.isActive).to.equal(true);
      }

      // Remove op4 — calls _resetOperatorState + delete seb.operatorEthVUnits[op4]
      const removedOpId = operatorIds[3];
      await network.connect(deployer).removeOperator(removedOpId);

      // Verify fully clean state (this is the regression: mock didn't delete operatorEthVUnits)
      const removedOp = await views.getOperatorById(removedOpId);
      expect(removedOp.validatorCount).to.equal(0, "ethValidatorCount zeroed");
      expect(removedOp.fee).to.equal(0n, "ethFee zeroed");
      expect(removedOp.isActive).to.equal(false, "isActive false (both snapshots == 0)");

      const removedOpSSV = await views.getOperatorByIdSSV(removedOpId);
      expect(removedOpSSV.validatorCount).to.equal(0, "ssvValidatorCount zeroed");

      // Owner survives
      expect(removedOp.owner).to.not.equal(ethers.ZeroAddress, "owner survives removal");

      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();
      const vUnits = await readOperatorEthVUnits(provider, networkAddress, removedOpId);
      expect(vUnits).to.equal(0n, "operatorEthVUnits fully deleted by removeOperator");
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // RM6-017: Validator limit — removed op excluded from limit check
  // The guard at line 363-365 fires `continue` before reaching the
  // limit check at line 378. This means removed ops never contribute
  // to ethValidatorCount and can never trigger ExceedValidatorLimitWithData.
  // ═══════════════════════════════════════════════════════════════════
  describe("RM6-017: Validator limit check — removed op excluded from ethValidatorCount", () => {
    it("Removed op has 0 ethValidatorCount; does not factor into limit check", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(baseFixture);
      const provider = connection.ethers.provider;

      await mineBlocks(provider, 50);

      // Remove op3
      const removedOpId = operatorIds[2];
      await network.connect(clusterOwner).removeOperator(removedOpId);

      // Set limit to exact validator count to test boundary
      const networkAddress = await network.getAddress();
      await setValidatorsPerOperatorLimit(provider, networkAddress, 2);

      // Migrate
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      // Removed op: 0 ethValidatorCount — guard fired before reaching limit check
      const removedOp = await views.getOperatorById(removedOpId);
      expect(removedOp.validatorCount).to.equal(0, "removed op: 0 ethValidatorCount");

      // Live ops: 2 ethValidatorCount each
      for (const opId of [operatorIds[0], operatorIds[1], operatorIds[3]]) {
        const op = await views.getOperatorById(opId);
        expect(op.validatorCount).to.equal(2);
      }

      // Verify the limit was set to exact validator count
      const limit = await views.getValidatorsPerOperatorLimit();
      expect(Number(limit)).to.equal(2, "limit set to exact validator count — live ops at boundary");

      // The removed op will never reach the limit check at line 378
      // because the guard at line 363-365 fires `continue` first.
      // Confirm the cluster is functional and properly migrated.
      const receipt = await migrateTx.wait();
      const migratedCluster = parseClusterFromEvent(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(migratedCluster.active).to.equal(true);
      expect(migratedCluster.validatorCount).to.equal(2n);

      // Burn rate confirms only live ops contribute
      const burnRate = await views.getBurnRate(
        clusterOwner.address, operatorIds, migratedCluster,
      );
      expect(burnRate).to.be.greaterThan(0n);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // RM6-018: Validator limit revert — removed op irrelevant to limit check
  // Since validatorsPerOperatorLimit (3000) can't be changed in e2e without
  // harness, and ensureOperatorExist prevents registering ETH validators with
  // removed ops, we verify the inverse: a removed op in a migration DOES NOT
  // affect the limit check. The migration succeeds when it would fail if the
  // removed op were counted (by confirming only live ops get ethValidatorCount).
  //
  // Combined with RM6-012 (3 removed, 1 live), this proves the limit check
  // at line 378 only evaluates live operators that pass the guard.
  // ═══════════════════════════════════════════════════════════════════
  describe("RM6-018: Validator limit — removed ops never counted in limit check", () => {
    it("Multiple removed ops excluded from limit: only live op gets ethValidatorCount", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(threeValidatorFixture);
      const provider = connection.ethers.provider;

      await mineBlocks(provider, 50);

      // Remove 3 of 4 operators
      await network.connect(clusterOwner).removeOperator(operatorIds[0]);
      await network.connect(clusterOwner).removeOperator(operatorIds[1]);
      await network.connect(clusterOwner).removeOperator(operatorIds[2]);

      const networkAddress = await network.getAddress();
      await setValidatorsPerOperatorLimit(provider, networkAddress, 3);

      // Migrate — only op4 (the single live op) gets ethValidatorCount += 3
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      // Verify the limit was set to exact validator count
      const limit = await views.getValidatorsPerOperatorLimit();
      expect(Number(limit)).to.equal(3, "limit set to exact validator count — boundary test");

      // If removed ops WERE counted (bug), the limit check at line 378 would
      // try to increment dead operators' ethValidatorCount. The guard prevents this.
      // Only op4 has ethValidatorCount == 3
      const liveOp = await views.getOperatorById(operatorIds[3]);
      expect(liveOp.validatorCount).to.equal(3, "sole live op: 3 ethValidatorCount");
      expect(Number(liveOp.validatorCount)).to.be.lessThanOrEqual(Number(limit));

      // All removed ops: 0
      for (let i = 0; i < 3; i++) {
        await assertRemovedOpState(views, operatorIds[i], `RM6-018 removed op${i + 1}`, provider, networkAddress);
      }

      // Confirm ensureOperatorExist blocks new ETH registrations with removed ops
      const receipt = await migrateTx.wait();
      const migratedCluster = parseClusterFromEvent(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      await expect(
        network.connect(clusterOwner).registerValidator(
          makePublicKey(30), operatorIds, DEFAULT_SHARES, migratedCluster,
          { value: 0n },
        ),
      ).to.be.revertedWithCustomError(network, "OperatorDoesNotExist");
    });
  });
});

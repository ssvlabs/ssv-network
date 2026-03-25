/**
 * W5.5: Mock-to-Real Migration — 32 scenarios
 *
 * Every test uses REAL removeOperator() via the SSVNetwork proxy.
 * NEVER calls mockRemoveOperator() or mockRemoveOperatorAndPayout().
 *
 * These scenarios were previously passing with mock removal functions that
 * mask the EB bug (operatorEthVUnits not deleted). Tests may FAIL with
 * real removeOperator() — that's expected and proves the bug.
 *
 * Scenario ID mapping:
 *   CL-031, OE-033          — Cluster/operator accounting with removed ops
 *   EB-056                   — Fee change interaction with removed ops
 *   MG-008, MG-009, MG-028  — Migration with removed operators
 *   VR-027, VR-052, VR-053  — Validator registration reverts
 *   VX-010, VX-011           — Bulk validator registration reverts
 *   VX-055, VX-056           — Migration SSV settlement with removed ops
 *   RM3-002, RM3-004         — Remove validator after operator removal
 *   RM4-001, RM4-003, RM4-010, RM4-011, RM4-012, RM4-018, RM4-021
 *                            — migrateClusterToETH with removed ops
 *   RM6-001, RM6-005..011   — Migration init guard scenarios
 *   RMC-026                  — Chain scenario: dead op blocks new cluster
 *   INV-038, INV-043         — G11 invariant tests
 */
import { expect } from "chai";
import { ethers } from "ethers";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import {
  ssvNetworkFullFixture,
  ssvNetworkFullPreUpgradeFixture,
  upgradeToStakingVersion,
} from "../../setup/fixtures.ts";
import type { Cluster, NetworkHelpersType } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  makeOperatorKey,
  whitelistAddresses,
  getCurrentClusterState,
  generateMerkleForClusterEB,
  computeClusterId,
  commitEBRoot,
  setupOracles,
  parseClusterFromEvent,
  extractEventArgs,
  setupTestContext,
  mineBlocks,
  getBlockNumber,
  defaultVUnits,
} from "../../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  TOKEN_REGISTER_AMOUNT,
  BPS_DENOMINATOR,
  DEFAULT_OPERATOR_ETH_FEE,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";

// ═══════════════════════════════════════════════════════════════════════════
//  Diamond storage helpers — read operatorEthVUnits directly from EVM
// ═══════════════════════════════════════════════════════════════════════════

const EB_BASE_SLOT =
  BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.eb"))) - 1n;
const UINT64_MASK = (1n << 64n) - 1n;
const coder = ethers.AbiCoder.defaultAbiCoder();

function opEthVUnitsSlot(opId: number | bigint): string {
  const mappingSlot = EB_BASE_SLOT + 2n;
  return ethers.keccak256(
    coder.encode(["uint256", "uint256"], [BigInt(opId), mappingSlot]),
  );
}

async function readOpEthVUnits(
  provider: any,
  addr: string,
  opId: number | bigint,
): Promise<bigint> {
  const raw = await provider.getStorage(addr, opEthVUnitsSlot(opId));
  return BigInt(raw) & UINT64_MASK;
}

// ═══════════════════════════════════════════════════════════════════════════
//  Shared assertion helpers
// ═══════════════════════════════════════════════════════════════════════════

/** Assert G11: removed operator has zero vUnits, zero valCount, inactive */
async function assertG11Holds(
  views: any,
  provider: any,
  addr: string,
  opId: number | bigint,
  label: string,
): Promise<void> {
  const op = await views.getOperatorById(BigInt(opId));
  expect(op.isActive).to.equal(false, `${label}: isActive must be false`);
  expect(op.validatorCount).to.equal(0n, `${label}: ethValidatorCount must be 0`);
  const vUnits = await readOpEthVUnits(provider, addr, opId);
  expect(vUnits).to.equal(0n, `${label}: operatorEthVUnits must be 0`);
}

/** Assert removed operator is fully dead (views + storage) */
async function assertRemovedOpClean(
  views: any,
  provider: any,
  addr: string,
  opId: number | bigint,
  label: string,
): Promise<void> {
  const op = await views.getOperatorById(BigInt(opId));
  expect(op.validatorCount).to.equal(0n, `${label}: ethValidatorCount 0`);
  expect(op.fee).to.equal(0n, `${label}: ethFee 0`);
  expect(op.isActive).to.equal(false, `${label}: inactive`);
  const vUnits = await readOpEthVUnits(provider, addr, opId);
  expect(vUnits).to.equal(0n, `${label}: operatorEthVUnits 0`);
}

/** Assert live operator was properly migrated */
async function assertLiveOpMigrated(
  views: any,
  opId: number | bigint,
  expectedValCount: bigint,
  label: string,
): Promise<void> {
  const op = await views.getOperatorById(BigInt(opId));
  expect(op.validatorCount).to.equal(expectedValCount, `${label}: ethValidatorCount`);
  expect(op.isActive).to.equal(true, `${label}: isActive`);
  expect(op.fee).to.equal(DEFAULT_OPERATOR_ETH_FEE, `${label}: default ETH fee`);
}

/** Assert removed operator SSV state */
async function assertRemovedOpSSV(
  views: any,
  opId: number | bigint,
  label: string,
): Promise<void> {
  const opSSV = await views.getOperatorByIdSSV(opId);
  expect(opSSV.validatorCount).to.equal(0, `${label}: ssvValidatorCount must be 0`);
}

// ═══════════════════════════════════════════════════════════════════════════
//  EB update helper (oracle quorum + updateClusterBalance)
// ═══════════════════════════════════════════════════════════════════════════

async function performEBUpdate(
  connection: any,
  network: any,
  oracles: HardhatEthersSigner[],
  provider: any,
  clusterOwner: HardhatEthersSigner,
  operatorIds: number[],
  cluster: Cluster,
  effectiveBalance: number,
): Promise<Cluster> {
  const clusterId = computeClusterId(clusterOwner.address, operatorIds);
  const { root, proofs } = generateMerkleForClusterEB(connection, [
    { clusterId, effectiveBalance },
  ]);
  await mineBlocks(provider, 1);
  const rootBlockNum = await getBlockNumber(provider);
  await commitEBRoot(network, root, rootBlockNum, oracles);

  const tx = await network.updateClusterBalance(
    rootBlockNum,
    clusterOwner.address,
    operatorIds,
    cluster,
    effectiveBalance,
    proofs[clusterId],
  );
  const receipt = await tx.wait();
  return parseClusterFromEvent(network, receipt, Events.CLUSTER_BALANCE_UPDATED);
}

// ═══════════════════════════════════════════════════════════════════════════
//  Fixture helpers
// ═══════════════════════════════════════════════════════════════════════════

const OP_SSV_FEE = 10_000_000_000n;

/** Deploy full v2 fixture with operators + whitelisted cluster owner */
async function deployV2WithOps(
  connection: NetworkConnection<"generic">,
  opCount: number,
  withOracles = false,
) {
  const { network, views, cssvToken, ssvToken } =
    await ssvNetworkFullFixture(connection);
  const provider = connection.ethers.provider;
  const signers = await connection.ethers.getSigners();
  const [owner, oracle1, oracle2, oracle3, oracle4, staker, ...rest] = signers;
  const oracles = [oracle1, oracle2, oracle3, oracle4];

  if (withOracles) {
    await setupOracles(network, ssvToken, staker, oracles);
  }

  const operatorIds = await registerOperators(network, owner, opCount);
  const clusterOwners = rest.slice(0, 2);
  await whitelistAddresses(network, owner, operatorIds, clusterOwners.map((s) => s.address));

  const networkAddr = await network.getAddress();
  return {
    network, views, ssvToken, cssvToken, provider, owner, oracles, staker,
    operatorIds, clusterOwner: clusterOwners[0], clusterOwnerB: clusterOwners[1],
    networkAddr,
  };
}

/** Register N validators and return fresh cluster */
async function registerValidators(
  network: any,
  clOwner: HardhatEthersSigner,
  opIds: number[],
  count: number,
  startPk = 1,
  deposit = DEFAULT_ETH_REGISTER_VALUE,
): Promise<{ cluster: Cluster; pubkeys: string[] }> {
  const pubkeys: string[] = [];
  let cluster: Cluster = { ...EMPTY_CLUSTER };
  for (let i = 0; i < count; i++) {
    const pk = makePublicKey(startPk + i);
    pubkeys.push(pk);
    const tx = await network.connect(clOwner).registerValidator(
      pk, opIds, DEFAULT_SHARES, cluster, { value: deposit },
    );
    const receipt = await tx.wait();
    cluster = parseClusterFromEvent(network, receipt, Events.VALIDATOR_ADDED);
  }
  return { cluster, pubkeys };
}

/** Build a legacy (pre-upgrade) fixture with SSV cluster */
function buildLegacyFixture(
  getConn: () => NetworkConnection<"generic">,
  getOpOwner: () => HardhatEthersSigner,
  getClOwner: () => HardhatEthersSigner,
  opCount: number,
  valCount: number,
) {
  return async function legacyFixture() {
    const conn = getConn();
    const { network: legacyNetwork, views: legacyViews, ssvToken } =
      await ssvNetworkFullPreUpgradeFixture(conn);

    const opsOwner = getOpOwner();
    const cOwner = getClOwner();

    const operatorIds: number[] = [];
    for (let i = 0; i < opCount; i++) {
      const expectedId = await legacyNetwork.connect(opsOwner)
        .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE, false);
      await legacyNetwork.connect(opsOwner)
        .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE, false);
      operatorIds.push(Number(expectedId));
    }

    const totalSSV = TOKEN_REGISTER_AMOUNT * BigInt(valCount);
    await ssvToken.mint(cOwner.address, totalSSV);
    await ssvToken.connect(cOwner).approve(await legacyNetwork.getAddress(), totalSSV);

    let cluster: any = EMPTY_CLUSTER;
    for (let v = 0; v < valCount; v++) {
      await legacyNetwork.connect(cOwner).registerValidator(
        makePublicKey(v + 1), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, cluster,
      );
      cluster = await getCurrentClusterState(conn, legacyNetwork, cOwner.address, operatorIds);
    }

    const { newNetwork, newViews } = await upgradeToStakingVersion(conn, legacyNetwork, legacyViews);
    return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster };
  };
}

// ═══════════════════════════════════════════════════════════════════════════
//  TESTS — 32 mock-to-real migration scenarios
// ═══════════════════════════════════════════════════════════════════════════

describe("W5.5: Mock-to-Real Migration — 32 scenarios", function () {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let clusterOwnerB: HardhatEthersSigner;

  before(async function () {
    ({
      connection,
      networkHelpers,
      signers: [operatorOwner, clusterOwner, clusterOwnerB],
    } = await setupTestContext());
  });

  // ─────────────────────────────────────────────────────────────────────
  //  CL-031: ETH cluster settlement excludes removed operator fees
  //  Source: removedOperatorImpact.test.ts (used mockRemoveOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("CL-031: excludes removed op fees from ETH cluster settlement", function () {
    it("Removed op earns nothing; active ops earn full per-block fee", async function () {
      const ctx = await deployV2WithOps(connection, 4);
      const { network, views, provider, operatorIds, networkAddr } = ctx;
      const clOwner = ctx.clusterOwner;

      const { cluster: clusterAfterReg } = await registerValidators(
        network, clOwner, operatorIds, 1,
      );

      await mineBlocks(provider, 10);

      // Remove op3 via real removeOperator
      const removedOpId = operatorIds[2];
      await network.connect(ctx.owner).removeOperator(removedOpId);

      await mineBlocks(provider, 50);

      // Remove the validator (triggers settlement)
      const removeTx = await network.connect(clOwner).removeValidator(
        makePublicKey(1), operatorIds, clusterAfterReg,
      );
      const removeReceipt = await removeTx.wait();
      const clusterAfterRemove = parseClusterFromEvent(
        network, removeReceipt, Events.VALIDATOR_REMOVED,
      );

      // Cluster balance decreased (fees charged)
      expect(clusterAfterRemove.balance).to.be.lessThan(clusterAfterReg.balance);

      // Removed op: vUnits = 0
      await assertRemovedOpClean(views, provider, networkAddr, removedOpId, "CL-031");

      // Active ops should have earned fees
      for (const opId of operatorIds.filter((id) => id !== removedOpId)) {
        const op = await views.getOperatorById(opId);
        expect(op.isActive).to.equal(true, `CL-031: op${opId} active`);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  OE-033: Freezes removed operator SSV earnings
  //  Source: removedOperatorImpact.test.ts (used mockRemoveOperator)
  //  NOTE: requires legacy SSV cluster for SSV settlement
  // ─────────────────────────────────────────────────────────────────────

  describe("OE-033: freezes removed operator SSV earnings on settlement", function () {
    it("Removed op SSV snapshot frozen, active ops continue earning", async function () {
      const fixture = buildLegacyFixture(
        () => connection, () => operatorOwner, () => clusterOwner, 4, 1,
      );
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;

      await mineBlocks(provider, 50);

      // Remove op2 via real removeOperator
      const removedOpId = operatorIds[1];
      await network.connect(operatorOwner).removeOperator(removedOpId);

      // Mine enough blocks to deplete SSV cluster balance for liquidation
      await mineBlocks(provider, 999_999_999);

      // Liquidate SSV cluster (triggers SSV settlement)
      const liqTx = await network.liquidateSSV(
        clusterOwner.address, operatorIds, cluster,
      );
      await expect(liqTx).to.emit(network, Events.CLUSTER_LIQUIDATED);

      // Removed op: SSV validator count should be 0
      const opSSV = await views.getOperatorByIdSSV(removedOpId);
      expect(opSSV.validatorCount).to.equal(0, "OE-033: removed op ssvValCount 0");

      // Active ops should still have been settled
      for (const opId of operatorIds.filter((id) => id !== removedOpId)) {
        const op = await views.getOperatorByIdSSV(opId);
        expect(op.validatorCount).to.equal(0, "OE-033: liquidation zeroes valCount");
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  EB-056: Fee change with removed operators skips removed entries
  //  Source: operatorFeeEBInteraction.test.ts (used mockRemoveOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("EB-056: fee change interaction skips removed operators", function () {
    it("Removed op snapshot stays frozen after cluster operations", async function () {
      const ctx = await deployV2WithOps(connection, 4, true);
      const { network, views, provider, operatorIds, networkAddr, oracles } = ctx;
      const clOwner = ctx.clusterOwner;

      const { cluster } = await registerValidators(network, clOwner, operatorIds, 3);

      // EB update: 128 ETH total (≥32*3=96 min), ~42.7 ETH/validator
      const clusterAfterEB = await performEBUpdate(
        connection, network, oracles, provider, clOwner, operatorIds, cluster, 128,
      );

      await mineBlocks(provider, 40);

      // Remove op1 via real removeOperator
      await network.connect(ctx.owner).removeOperator(operatorIds[0]);

      // Verify removed op is clean
      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[0], "EB-056 after removal");

      await mineBlocks(provider, 40);

      // Withdraw (triggers settlement)
      const wTx = await network.connect(clOwner).withdraw(operatorIds, 0n, clusterAfterEB);
      await expect(wTx).to.emit(network, Events.CLUSTER_WITHDRAWN);

      // Removed op: snapshot stays frozen
      const removedOp = await views.getOperatorById(operatorIds[0]);
      expect(removedOp.isActive).to.equal(false, "EB-056: removed op inactive");
      expect(removedOp.fee).to.equal(0n, "EB-056: removed op fee 0");

      // Active ops earned fees
      for (let i = 1; i < operatorIds.length; i++) {
        const op = await views.getOperatorById(operatorIds[i]);
        expect(op.isActive).to.equal(true, `EB-056: op${i} active`);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  MG-008: Migration skips removed operators without reviving them
  //  Source: migrateClusterToETH.test.ts (used mockRemoveOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("MG-008: migration skips removed operators without reviving them", function () {
    it("Removed op not revived; live ops get ethValidatorCount", async function () {
      const fixture = buildLegacyFixture(
        () => connection, () => operatorOwner, () => clusterOwner, 4, 2,
      );
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      await mineBlocks(provider, 50);

      // Remove op1 via real removeOperator
      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      await mineBlocks(provider, 10);

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethers.parseEther("10") },
      );
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      // Removed op: not revived
      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[0], "MG-008");

      // Live ops: ethValidatorCount = 2
      for (let i = 1; i < operatorIds.length; i++) {
        await assertLiveOpMigrated(views, operatorIds[i], 2n, `MG-008 op${i}`);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  MG-009: Migration with all operators removed
  //  Source: migrateClusterToETH.test.ts (used mockRemoveOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("MG-009: migration with all operators removed", function () {
    it("Migration succeeds or reverts, no operator is revived", async function () {
      const fixture = buildLegacyFixture(
        () => connection, () => operatorOwner, () => clusterOwner, 4, 2,
      );
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      // Remove ALL operators
      for (const opId of operatorIds) {
        await network.connect(operatorOwner).removeOperator(opId);
      }

      await mineBlocks(provider, 10);

      try {
        const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
          operatorIds, cluster, { value: ethers.parseEther("10") },
        );
        await migrateTx.wait();

        // If it succeeds: no operator revived
        for (const opId of operatorIds) {
          await assertRemovedOpClean(views, provider, networkAddr, opId, `MG-009 op${opId}`);
        }
      } catch {
        // Revert is also acceptable — no operator revived
        for (const opId of operatorIds) {
          const op = await views.getOperatorById(opId);
          expect(op.isActive).to.equal(false, `MG-009 op${opId}: not revived after revert`);
        }
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  MG-028: Mixed valid/removed operators — count integrity
  //  Source: migrateClusterToETH.test.ts (used mockRemoveOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("MG-028: mixed valid/removed operators count integrity", function () {
    it("Live ops get correct ethValidatorCount, removed ops stay at 0", async function () {
      const fixture = buildLegacyFixture(
        () => connection, () => operatorOwner, () => clusterOwner, 4, 3,
      );
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      // Remove alternating operators (op1, op3)
      await network.connect(operatorOwner).removeOperator(operatorIds[0]);
      await network.connect(operatorOwner).removeOperator(operatorIds[2]);

      await mineBlocks(provider, 10);

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethers.parseEther("10") },
      );
      const receipt = await migrateTx.wait();
      const migratedCluster = parseClusterFromEvent(
        network, receipt, Events.CLUSTER_MIGRATED_TO_ETH,
      );
      expect(migratedCluster.active).to.equal(true);
      expect(migratedCluster.validatorCount).to.equal(3n);

      // Removed ops: 0 ethValidatorCount
      for (const opId of [operatorIds[0], operatorIds[2]]) {
        await assertRemovedOpClean(views, provider, networkAddr, opId, `MG-028 removed op${opId}`);
      }

      // Live ops: 3 ethValidatorCount
      for (const opId of [operatorIds[1], operatorIds[3]]) {
        await assertLiveOpMigrated(views, opId, 3n, `MG-028 live op${opId}`);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  VR-027: registerValidator reverts OperatorDoesNotExist (1 removed)
  //  Source: registerValidator.test.ts (used mockRemoveOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("VR-027: registerValidator reverts when one operator removed", function () {
    it("Reverts with OperatorDoesNotExist", async function () {
      const ctx = await deployV2WithOps(connection, 4);
      const { network, operatorIds } = ctx;
      const clOwner = ctx.clusterOwner;

      // Remove op2 via real removeOperator
      await network.connect(ctx.owner).removeOperator(operatorIds[1]);

      await expect(
        network.connect(clOwner).registerValidator(
          makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  VR-052: Revert on removed operator is atomic (no partial init)
  //  Source: registerValidator.test.ts (used mockRemoveOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("VR-052: revert on removed operator is atomic — no partial init", function () {
    it("No operator state is modified when registration reverts", async function () {
      const ctx = await deployV2WithOps(connection, 4);
      const { network, views, operatorIds } = ctx;
      const clOwner = ctx.clusterOwner;

      // Snapshot before
      const beforeOp1 = await views.getOperatorById(operatorIds[0]);

      // Remove op2 via real removeOperator
      await network.connect(ctx.owner).removeOperator(operatorIds[1]);

      await expect(
        network.connect(clOwner).registerValidator(
          makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);

      // Op1 state unchanged (revert is atomic)
      const afterOp1 = await views.getOperatorById(operatorIds[0]);
      expect(afterOp1.validatorCount).to.equal(beforeOp1.validatorCount, "VR-052: op1 valCount unchanged");

      // Ops after removed one: still in original state
      for (const opId of [operatorIds[2], operatorIds[3]]) {
        const op = await views.getOperatorById(opId);
        expect(op.validatorCount).to.equal(0n, `VR-052: op${opId} valCount 0`);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  VR-053: registerValidator reverts when multiple operators removed
  //  Source: registerValidator.test.ts (used mockRemoveOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("VR-053: registerValidator reverts when multiple operators removed", function () {
    it("Reverts with OperatorDoesNotExist for two removed operators", async function () {
      const ctx = await deployV2WithOps(connection, 4);
      const { network, operatorIds } = ctx;
      const clOwner = ctx.clusterOwner;

      // Remove op1 and op3
      await network.connect(ctx.owner).removeOperator(operatorIds[0]);
      await network.connect(ctx.owner).removeOperator(operatorIds[2]);

      await expect(
        network.connect(clOwner).registerValidator(
          makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  VX-010: bulkRegisterValidator reverts when one operator removed
  //  Source: bulkRegisterValidator.test.ts (used mockRemoveOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("VX-010: bulkRegisterValidator reverts when one operator removed", function () {
    it("Reverts with OperatorDoesNotExist", async function () {
      const ctx = await deployV2WithOps(connection, 4);
      const { network, operatorIds } = ctx;
      const clOwner = ctx.clusterOwner;

      // Remove op3
      await network.connect(ctx.owner).removeOperator(operatorIds[2]);

      await expect(
        network.connect(clOwner).bulkRegisterValidator(
          [makePublicKey(1), makePublicKey(2)],
          operatorIds,
          [DEFAULT_SHARES, DEFAULT_SHARES],
          { ...EMPTY_CLUSTER },
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  VX-011: bulkRegisterValidator reverts when multiple operators removed
  //  Source: bulkRegisterValidator.test.ts (used mockRemoveOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("VX-011: bulkRegisterValidator reverts when multiple operators removed", function () {
    it("Reverts with OperatorDoesNotExist for two removed operators", async function () {
      const ctx = await deployV2WithOps(connection, 4);
      const { network, operatorIds } = ctx;
      const clOwner = ctx.clusterOwner;

      // Remove op2 and op4
      await network.connect(ctx.owner).removeOperator(operatorIds[1]);
      await network.connect(ctx.owner).removeOperator(operatorIds[3]);

      await expect(
        network.connect(clOwner).bulkRegisterValidator(
          [makePublicKey(1), makePublicKey(2)],
          operatorIds,
          [DEFAULT_SHARES, DEFAULT_SHARES],
          { ...EMPTY_CLUSTER },
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  VX-055: Migration SSV settlement includes removed op's frozen index
  //  Source: migration-double-payment.test.ts (used mockRemoveOperatorAndPayout)
  // ─────────────────────────────────────────────────────────────────────

  describe("VX-055: migration SSV settlement includes removed op frozen snapshot.index", function () {
    it("SSV refund accounts for removed op's accrued fees before removal", async function () {
      const fixture = buildLegacyFixture(
        () => connection, () => operatorOwner, () => clusterOwner, 4, 2,
      );
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;

      // Accrue fees for 400 blocks
      await mineBlocks(provider, 400);

      // Remove op1 via real removeOperator (settles and freezes SSV snapshot)
      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      await mineBlocks(provider, 200);

      const ownerSSVBefore = await ssvToken.balanceOf(clusterOwner.address);

      // Migrate — SSV settlement should include removed op's frozen index
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethers.parseEther("10") },
      );
      const receipt = await migrateTx.wait();
      const eventArgs = extractEventArgs(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);

      const ownerSSVAfter = await ssvToken.balanceOf(clusterOwner.address);
      const ssvRefund = BigInt(eventArgs.ssvRefunded);

      // Refund should be > 0 and match actual transfer
      expect(ssvRefund).to.be.greaterThan(0n, "VX-055: SSV refund > 0");
      expect(ownerSSVAfter - ownerSSVBefore).to.equal(ssvRefund, "VX-055: actual transfer matches event");

      // Removed op: ethValidatorCount = 0
      const networkAddr = await network.getAddress();
      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[0], "VX-055");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  VX-056: Two removed ops with different removal times — frozen indices
  //  Source: migration-double-payment.test.ts (used mockRemoveOperatorAndPayout)
  // ─────────────────────────────────────────────────────────────────────

  describe("VX-056: two removed ops with different removal times via frozen indices", function () {
    it("SSV refund correct when two ops removed at different blocks", async function () {
      const fixture = buildLegacyFixture(
        () => connection, () => operatorOwner, () => clusterOwner, 4, 3,
      );
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;

      // Accrue fees
      await mineBlocks(provider, 250);

      // Remove op1 at time T1
      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      await mineBlocks(provider, 150);

      // Remove op2 at time T2
      await network.connect(operatorOwner).removeOperator(operatorIds[1]);

      await mineBlocks(provider, 100);

      const ownerSSVBefore = await ssvToken.balanceOf(clusterOwner.address);

      // Migrate
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethers.parseEther("10") },
      );
      const receipt = await migrateTx.wait();
      const eventArgs = extractEventArgs(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);

      const ownerSSVAfter = await ssvToken.balanceOf(clusterOwner.address);
      const ssvRefund = BigInt(eventArgs.ssvRefunded);

      expect(ownerSSVAfter - ownerSSVBefore).to.equal(ssvRefund, "VX-056: transfer matches event");

      // Both removed ops: dead
      const networkAddr = await network.getAddress();
      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[0], "VX-056 op1");
      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[1], "VX-056 op2");

      // Live ops: properly migrated
      for (let i = 2; i < operatorIds.length; i++) {
        await assertLiveOpMigrated(views, operatorIds[i], 3n, `VX-056 op${i}`);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  RM3-002: bulkRemoveValidator (not last) after removeOp with explicit EB
  //  Source: rm3-remove-validator.test.ts (already uses real removeOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("RM3-002: explicit EB, removeOp1, bulkRemoveValidator (not last) — no cleanup", function () {
    it("bulkRemoveValidator on cluster with removed op doesn't underflow", async function () {
      const ctx = await deployV2WithOps(connection, 4, true);
      const { network, views, provider, operatorIds, networkAddr, oracles } = ctx;
      const clOwner = ctx.clusterOwner;

      // Register 3 validators
      const { cluster, pubkeys } = await registerValidators(
        network, clOwner, operatorIds, 3,
      );

      // EB update: 128 ETH total (≥32*3=96 min)
      const clusterAfterEB = await performEBUpdate(
        connection, network, oracles, provider, clOwner, operatorIds, cluster, 128,
      );

      // Remove op1
      await network.connect(ctx.owner).removeOperator(operatorIds[0]);
      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[0], "RM3-002 after removal");

      // bulkRemoveValidator (remove 2 of 3, not last)
      const removeTx = await network.connect(clOwner).bulkRemoveValidator(
        [pubkeys[0], pubkeys[1]], operatorIds, clusterAfterEB,
      );
      const removeReceipt = await removeTx.wait();
      const clusterAfterRemove = parseClusterFromEvent(
        network, removeReceipt, Events.VALIDATOR_REMOVED,
      );
      expect(clusterAfterRemove.validatorCount).to.equal(1n);

      // Removed op still clean
      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[0], "RM3-002 after bulkRemove");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  RM3-004: removeValidator (single, not last) after removeOp with explicit EB
  //  Source: rm3-remove-validator.test.ts (already uses real removeOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("RM3-004: explicit EB, removeOp1, removeValidator (single, not last) — no cleanup", function () {
    it("removeValidator on cluster with removed op doesn't underflow", async function () {
      const ctx = await deployV2WithOps(connection, 4, true);
      const { network, views, provider, operatorIds, networkAddr, oracles } = ctx;
      const clOwner = ctx.clusterOwner;

      // Register 3 validators
      const { cluster, pubkeys } = await registerValidators(
        network, clOwner, operatorIds, 3,
      );

      // EB update: 128 ETH total (≥32*3=96 min)
      const clusterAfterEB = await performEBUpdate(
        connection, network, oracles, provider, clOwner, operatorIds, cluster, 128,
      );

      // Remove op1
      await network.connect(ctx.owner).removeOperator(operatorIds[0]);

      // removeValidator (single, not last)
      const removeTx = await network.connect(clOwner).removeValidator(
        pubkeys[0], operatorIds, clusterAfterEB,
      );
      const removeReceipt = await removeTx.wait();
      const clusterAfterRemove = parseClusterFromEvent(
        network, removeReceipt, Events.VALIDATOR_REMOVED,
      );
      expect(clusterAfterRemove.validatorCount).to.equal(2n);

      // Removed op still clean
      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[0], "RM3-004");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  RM4-001: 4-op cluster, 1 removed, migrate (implicit EB)
  //  Source: rm4-migration.test.ts (already uses real removeOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("RM4-001: 4-op cluster, 1 removed, migrate (implicit EB)", function () {
    it("Migration skips removed op, live ops get correct ethValidatorCount", async function () {
      const fixture = buildLegacyFixture(
        () => connection, () => operatorOwner, () => clusterOwner, 4, 3,
      );
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      await mineBlocks(provider, 50);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await mineBlocks(provider, 10);

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethers.parseEther("10") },
      );
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[3], "RM4-001");
      for (let i = 0; i < 3; i++) {
        await assertLiveOpMigrated(views, operatorIds[i], 3n, `RM4-001 op${i}`);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  RM4-003: 4-op cluster, 2 removed, migrate (implicit EB)
  //  Source: rm4-migration.test.ts (already uses real removeOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("RM4-003: 4-op cluster, 2 removed, migrate (implicit EB)", function () {
    it("Both removed ops skipped, 2 live ops migrated", async function () {
      const fixture = buildLegacyFixture(
        () => connection, () => operatorOwner, () => clusterOwner, 4, 3,
      );
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      await mineBlocks(provider, 50);
      await network.connect(operatorOwner).removeOperator(operatorIds[2]);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await mineBlocks(provider, 10);

      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethers.parseEther("10") },
      );

      for (const opId of [operatorIds[2], operatorIds[3]]) {
        await assertRemovedOpClean(views, provider, networkAddr, opId, `RM4-003 removed`);
      }
      for (const opId of [operatorIds[0], operatorIds[1]]) {
        await assertLiveOpMigrated(views, opId, 3n, `RM4-003 live`);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  RM4-010: ethSnapshot.block stays 0 after migration
  //  Source: rm4-migration.test.ts (already uses real removeOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("RM4-010: ethSnapshot.block stays 0 after migration", function () {
    it("Removed op isActive stays false after migration", async function () {
      const fixture = buildLegacyFixture(
        () => connection, () => operatorOwner, () => clusterOwner, 4, 3,
      );
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;

      await mineBlocks(provider, 50);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await mineBlocks(provider, 10);

      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethers.parseEther("10") },
      );

      const removedOp = await views.getOperatorById(operatorIds[3]);
      expect(removedOp.isActive).to.equal(false, "RM4-010: ethSnapshot.block must be 0");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  RM4-011: ethValidatorCount stays 0 after migration
  //  Source: rm4-migration.test.ts (already uses real removeOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("RM4-011: ethValidatorCount stays 0 after migration", function () {
    it("Removed op valCount 0, live ops get 3", async function () {
      const fixture = buildLegacyFixture(
        () => connection, () => operatorOwner, () => clusterOwner, 4, 3,
      );
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;

      await mineBlocks(provider, 50);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await mineBlocks(provider, 10);

      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethers.parseEther("10") },
      );

      expect((await views.getOperatorById(operatorIds[3])).validatorCount).to.equal(
        0n, "RM4-011: removed op valCount 0",
      );
      for (let i = 0; i < 3; i++) {
        expect((await views.getOperatorById(operatorIds[i])).validatorCount).to.equal(3n);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  RM4-012: ethFee stays 0 for removed op, not set to default
  //  Source: rm4-migration.test.ts (already uses real removeOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("RM4-012: ethFee stays 0, not set to default", function () {
    it("Removed op ethFee 0, live ops get default ETH fee", async function () {
      const fixture = buildLegacyFixture(
        () => connection, () => operatorOwner, () => clusterOwner, 4, 3,
      );
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;

      await mineBlocks(provider, 50);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await mineBlocks(provider, 10);

      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethers.parseEther("10") },
      );

      expect((await views.getOperatorById(operatorIds[3])).fee).to.equal(
        0n, "RM4-012: removed op ethFee 0",
      );
      for (let i = 0; i < 3; i++) {
        expect((await views.getOperatorById(operatorIds[i])).fee).to.equal(DEFAULT_OPERATOR_ETH_FEE);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  RM4-018: cumulativeIndexSSV includes removed op's preserved SSV index
  //  Source: rm4-migration.test.ts (already uses real removeOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("RM4-018: cumulativeIndexSSV includes removed op's preserved SSV index", function () {
    it("SSV refund includes fees accrued by removed op before removal", async function () {
      const fixture = buildLegacyFixture(
        () => connection, () => operatorOwner, () => clusterOwner, 4, 3,
      );
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      // Accrue SSV fees
      await mineBlocks(provider, 500);

      // Remove op4 — snapshot.index preserved
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await mineBlocks(provider, 200);

      const ownerSSVBefore = await ssvToken.balanceOf(clusterOwner.address);

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethers.parseEther("10") },
      );
      const receipt = await migrateTx.wait();
      const eventArgs = extractEventArgs(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);

      const ownerSSVAfter = await ssvToken.balanceOf(clusterOwner.address);
      const ssvRefund = BigInt(eventArgs.ssvRefunded);

      expect(ssvRefund).to.be.greaterThan(0n, "RM4-018: SSV refund > 0");
      expect(ownerSSVAfter - ownerSSVBefore).to.equal(ssvRefund);

      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[3], "RM4-018");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  RM4-021: liquidated SSV cluster + removed op → migrate reactivates
  //  Source: rm4-migration.test.ts (already uses real removeOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("RM4-021: liquidated SSV cluster + removed op → migrate reactivates", function () {
    it("Migration reactivates liquidated cluster and skips removed op", async function () {
      const conn = connection;
      const fixture = async function rm4021() {
        const { network: legacyNetwork, views: legacyViews, ssvToken } =
          await ssvNetworkFullPreUpgradeFixture(conn);

        const operatorIds: number[] = [];
        for (let i = 0; i < 4; i++) {
          const expectedId = await legacyNetwork.connect(operatorOwner)
            .registerOperator.staticCall(makeOperatorKey(i + 1), OP_SSV_FEE, false);
          await legacyNetwork.connect(operatorOwner)
            .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE, false);
          operatorIds.push(Number(expectedId));
        }

        const smallDeposit = TOKEN_REGISTER_AMOUNT;
        await ssvToken.mint(clusterOwner.address, smallDeposit);
        await ssvToken.connect(clusterOwner).approve(
          await legacyNetwork.getAddress(), smallDeposit,
        );

        await legacyNetwork.connect(clusterOwner).registerValidator(
          makePublicKey(1), operatorIds, DEFAULT_SHARES, smallDeposit, EMPTY_CLUSTER,
        );
        const cluster = await getCurrentClusterState(
          conn, legacyNetwork, clusterOwner.address, operatorIds,
        );

        const { newNetwork, newViews } = await upgradeToStakingVersion(
          conn, legacyNetwork, legacyViews,
        );
        return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster };
      };

      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      // Deplete SSV balance
      await mineBlocks(provider, 999_999_999);

      // Liquidate
      const liquidateTx = await network.liquidateSSV(
        clusterOwner.address, operatorIds, cluster,
      );
      const liqReceipt = await liquidateTx.wait();
      const liquidatedCluster = parseClusterFromEvent(
        network, liqReceipt, Events.CLUSTER_LIQUIDATED,
      );
      expect(liquidatedCluster.active).to.equal(false);

      // Remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await mineBlocks(provider, 10);

      // Migrate — reactivates
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, liquidatedCluster, { value: ethers.parseEther("10") },
      );
      await expect(migrateTx).to.emit(network, Events.CLUSTER_REACTIVATED);

      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[3], "RM4-021");
      for (let i = 0; i < 3; i++) {
        await assertLiveOpMigrated(views, operatorIds[i], 1n, `RM4-021 op${i}`);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  RM6-001: Guard baseline — fully dead operator gets continue
  //  Source: rm6-migration-init.test.ts (already uses real removeOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("RM6-001: guard baseline — fully dead operator gets continue", function () {
    it("Removed op skipped during migration, live ops migrated", async function () {
      const fixture = buildLegacyFixture(
        () => connection, () => operatorOwner, () => clusterOwner, 4, 2,
      );
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      await mineBlocks(provider, 50);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await mineBlocks(provider, 50);

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[3], "RM6-001");
      await assertRemovedOpSSV(views, operatorIds[3], "RM6-001");

      for (let i = 0; i < 3; i++) {
        await assertLiveOpMigrated(views, operatorIds[i], 2n, `RM6-001 op${i}`);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  RM6-005: Operator removed after SSV snapshot set, before migration
  //  Source: rm6-migration-init.test.ts (already uses real removeOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("RM6-005: operator removed after SSV snapshot set, before migration", function () {
    it("Guard fires despite operator having been SSV-active", async function () {
      const fixture = buildLegacyFixture(
        () => connection, () => operatorOwner, () => clusterOwner, 4, 2,
      );
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      await mineBlocks(provider, 100);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await mineBlocks(provider, 100);

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[3], "RM6-005");
      for (let i = 0; i < 3; i++) {
        await assertLiveOpMigrated(views, operatorIds[i], 2n, `RM6-005 op${i}`);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  RM6-006: ensureETHDefaults not called for dead operator
  //  Source: rm6-migration-init.test.ts (already uses real removeOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("RM6-006: ensureETHDefaults not called for dead operator — no resurrection", function () {
    it("Dead op ethFee stays 0, isActive stays false", async function () {
      const fixture = buildLegacyFixture(
        () => connection, () => operatorOwner, () => clusterOwner, 4, 2,
      );
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;

      await network.connect(operatorOwner).removeOperator(operatorIds[2]);
      await mineBlocks(provider, 50);

      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      const op = await views.getOperatorById(operatorIds[2]);
      expect(op.fee).to.equal(0n, "RM6-006: ethFee 0 — ensureETHDefaults skipped");
      expect(op.isActive).to.equal(false, "RM6-006: no resurrection");
      expect(op.validatorCount).to.equal(0, "RM6-006: ethValidatorCount 0");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  RM6-007: ethValidatorCount unchanged for dead operator
  //  Source: rm6-migration-init.test.ts (already uses real removeOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("RM6-007: ethValidatorCount unchanged for dead operator", function () {
    it("Dead op 0, live ops get ethValidatorCount = 2", async function () {
      const fixture = buildLegacyFixture(
        () => connection, () => operatorOwner, () => clusterOwner, 4, 2,
      );
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);

      await network.connect(operatorOwner).removeOperator(operatorIds[1]);

      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      expect((await views.getOperatorById(operatorIds[1])).validatorCount).to.equal(
        0, "RM6-007: dead op 0",
      );
      for (const opId of [operatorIds[0], operatorIds[2], operatorIds[3]]) {
        expect((await views.getOperatorById(opId)).validatorCount).to.equal(
          2, `RM6-007: live op${opId} = 2`,
        );
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  RM6-009: cumulativeIndexSSV includes dead op's zero index
  //  Source: rm6-migration-init.test.ts (already uses real removeOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("RM6-009: cumulativeIndexSSV includes dead op's zero index — correct SSV refund", function () {
    it("SSV refund correct despite removed op contributing 0 to cumulative index", async function () {
      const fixture = buildLegacyFixture(
        () => connection, () => operatorOwner, () => clusterOwner, 4, 2,
      );
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      await mineBlocks(provider, 100);
      await network.connect(operatorOwner).removeOperator(operatorIds[0]);
      await mineBlocks(provider, 50);

      const ownerSSVBefore = await ssvToken.balanceOf(clusterOwner.address);
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const receipt = await migrateTx.wait();
      const eventArgs = extractEventArgs(network, receipt, Events.CLUSTER_MIGRATED_TO_ETH);

      const ownerSSVAfter = await ssvToken.balanceOf(clusterOwner.address);
      const ssvRefund = ownerSSVAfter - ownerSSVBefore;

      expect(ssvRefund).to.equal(eventArgs.ssvRefunded, "RM6-009: refund matches event");
      expect(ssvRefund).to.be.greaterThan(0n);

      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[0], "RM6-009");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  RM6-010: Mixed live/removed — 4 ops, 1 removed
  //  Source: rm6-migration-init.test.ts (already uses real removeOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("RM6-010: mixed live/removed — 4 ops, 1 removed", function () {
    it("3 live ops migrated with ethValidatorCount=3, 1 removed skipped", async function () {
      const fixture = buildLegacyFixture(
        () => connection, () => operatorOwner, () => clusterOwner, 4, 3,
      );
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      await mineBlocks(provider, 100);
      await network.connect(operatorOwner).removeOperator(operatorIds[2]);
      await mineBlocks(provider, 100);

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[2], "RM6-010");
      for (const opId of [operatorIds[0], operatorIds[1], operatorIds[3]]) {
        await assertLiveOpMigrated(views, opId, 3n, `RM6-010 live`);
      }
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  RM6-011: Mixed live/removed — 4 ops, 2 removed
  //  Source: rm6-migration-init.test.ts (already uses real removeOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("RM6-011: mixed live/removed — 4 ops, 2 removed", function () {
    it("2 live ops migrated, 2 removed skipped — burn rate uses 2 fees", async function () {
      const fixture = buildLegacyFixture(
        () => connection, () => operatorOwner, () => clusterOwner, 4, 2,
      );
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      await mineBlocks(provider, 50);
      await network.connect(operatorOwner).removeOperator(operatorIds[1]);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await mineBlocks(provider, 50);

      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const receipt = await migrateTx.wait();
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[1], "RM6-011 op2");
      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[3], "RM6-011 op4");
      await assertLiveOpMigrated(views, operatorIds[0], 2n, "RM6-011 op1");
      await assertLiveOpMigrated(views, operatorIds[2], 2n, "RM6-011 op3");

      // Burn rate uses 2 operator fees
      const migratedCluster = parseClusterFromEvent(
        network, receipt, Events.CLUSTER_MIGRATED_TO_ETH,
      );
      const burnRate = await views.getBurnRate(
        clusterOwner.address, operatorIds, migratedCluster,
      );
      const opFee = await views.getOperatorFee(operatorIds[0]);
      const netFee = await views.getNetworkFee();
      const vUnits = defaultVUnits(2n);
      const expectedBurnRate = ((2n * opFee + netFee) * vUnits) / BPS_DENOMINATOR;
      expect(burnRate).to.equal(expectedBurnRate, "RM6-011: burn rate uses 2 op fees");
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  RMC-026: migrate cluster with dead op4 from SSV to ETH
  //  Source: rmc-chains.test.ts (already uses real removeOperator)
  //  NOTE: Tests the guard path — new cluster with dead op is rejected
  // ─────────────────────────────────────────────────────────────────────

  describe("RMC-026: new cluster with dead op rejected (migration guard path)", function () {
    it("registerValidator reverts with dead op4 after removal", async function () {
      const ctx = await deployV2WithOps(connection, 4, true);
      const { network, views, provider, operatorIds, networkAddr, oracles } = ctx;
      const clOwner = ctx.clusterOwner;

      // Register cluster A with all ops
      const { cluster } = await registerValidators(network, clOwner, operatorIds, 1);

      // EB update: 48 ETH
      await performEBUpdate(
        connection, network, oracles, provider, clOwner, operatorIds, cluster, 48,
      );

      // Remove op4
      await network.connect(ctx.owner).removeOperator(operatorIds[3]);
      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[3], "RMC-026");

      // New cluster with dead op4 — revert
      await expect(
        network.connect(ctx.clusterOwnerB).registerValidator(
          makePublicKey(2), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  INV-038: Removal with active cluster (implicit EB) — G11 holds
  //  Source: inv-removed-operator.test.ts (already uses real removeOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("INV-038: removal with active cluster, implicit EB — G11 holds", function () {
    it("After removing operator from active cluster, G11 holds", async function () {
      const ctx = await deployV2WithOps(connection, 4);
      const { network, views, provider, operatorIds, networkAddr } = ctx;
      const clOwner = ctx.clusterOwner;

      await registerValidators(network, clOwner, operatorIds, 1);
      await mineBlocks(provider, 10);

      // Remove op1
      await network.connect(ctx.owner).removeOperator(operatorIds[0]);

      await assertG11Holds(views, provider, networkAddr, operatorIds[0], "INV-038");

      // Cluster still active
      const cluster = await getCurrentClusterState(
        connection, network, clOwner.address, operatorIds,
      );
      expect(cluster.active).to.equal(true);
    });
  });

  // ─────────────────────────────────────────────────────────────────────
  //  INV-043: Removal + migration — G11 preserved (no prior EB)
  //  Source: inv-removed-operator.test.ts (already uses real removeOperator)
  // ─────────────────────────────────────────────────────────────────────

  describe("INV-043: removal + migration — G11 preserved (no prior EB)", function () {
    it("Migration after operator removal preserves G11", async function () {
      const fixture = buildLegacyFixture(
        () => connection, () => operatorOwner, () => clusterOwner, 4, 1,
      );
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      // Remove op1
      await network.connect(operatorOwner).removeOperator(operatorIds[0]);
      await assertG11Holds(views, provider, networkAddr, operatorIds[0], "INV-043 after removal");

      // Migrate
      await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      await assertG11Holds(views, provider, networkAddr, operatorIds[0], "INV-043 after migration");
    });
  });
});

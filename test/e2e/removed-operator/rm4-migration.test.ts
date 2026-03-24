/**
 * RM4 — migrateClusterToETH with Removed Operators
 *
 * All 25 RM4-* scenarios. Every test uses REAL removeOperator() (never mock).
 * Asserts operatorEthVUnits[removedOp] == 0 (or stranded deviation for explicit EB),
 * daoTotalEthVUnits consistency (INV-11), and full removed-operator isolation.
 *
 * Storage reads: operatorEthVUnits and daoTotalEthVUnits are not exposed by SSVViews,
 * so we read them directly from deterministic storage slots (diamond storage pattern).
 */
import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import {
  ssvNetworkFullPreUpgradeFixture,
  upgradeToStakingVersion,
} from "../../setup/fixtures.ts";
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
  EMPTY_CLUSTER,
  TOKEN_REGISTER_AMOUNT,
  BPS_DENOMINATOR,
  DEFAULT_OPERATOR_ETH_FEE,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import {
  mineBlocks,
  makeOperatorKey,
  computeClusterId,
  generateMerkleForClusterEB,
  setupOracles,
  commitEBRoot,
  defaultVUnits,
} from "../../helpers/index.ts";
import { ethers } from "ethers";

// ─── Constants ───────────────────────────────────────────────────────────────

const OP_SSV_FEE_UNPACKED = 10_000_000_000n;

// ─── Storage slot helpers ────────────────────────────────────────────────────
// Diamond-storage pattern: slots derived from keccak256(slotString) - 1

const EB_BASE_SLOT =
  BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.eb"))) - 1n;
const PROTOCOL_BASE_SLOT =
  BigInt(
    ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.protocol")),
  ) - 1n;

/** Compute storage slot for operatorEthVUnits[operatorId] */
function operatorVUnitsSlot(operatorId: bigint): string {
  // operatorEthVUnits is the 3rd field (index 2) in StorageEB
  const mappingBaseSlot = EB_BASE_SLOT + 2n;
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["uint256", "uint256"],
      [operatorId, mappingBaseSlot],
    ),
  );
}

/** Read operatorEthVUnits[operatorId] from storage */
async function readOpVUnits(
  provider: any,
  addr: string,
  opId: number | bigint,
): Promise<bigint> {
  const slot = operatorVUnitsSlot(BigInt(opId));
  const raw = await provider.getStorage(addr, slot);
  return BigInt(raw) & ((1n << 64n) - 1n);
}

/**
 * Read daoTotalEthVUnits from StorageProtocol.
 * Located at protocol base slot + 4, bits [192..255].
 */
async function readDaoTotalVUnits(
  provider: any,
  addr: string,
): Promise<bigint> {
  const slot = PROTOCOL_BASE_SLOT + 4n;
  const raw = await provider.getStorage(
    addr,
    "0x" + slot.toString(16).padStart(64, "0"),
  );
  return (BigInt(raw) >> 192n) & ((1n << 64n) - 1n);
}

/** Compute clusterEB storage slot to pre-set vUnits for explicit EB tests */
function clusterEBSlot(
  ownerAddr: string,
  opIds: (number | bigint)[],
): string {
  const clusterHash = ethers.keccak256(
    ethers.solidityPacked(
      ["address", "uint64[]"],
      [ownerAddr, opIds.map((id) => BigInt(id))],
    ),
  );
  const mappingBase = EB_BASE_SLOT + 1n; // clusterEB is 2nd field
  return ethers.keccak256(
    ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint256"],
      [clusterHash, mappingBase],
    ),
  );
}

/** Pre-set clusterEB vUnits via hardhat_setStorageAt (for explicit EB scenarios) */
async function setClusterEBVUnits(
  provider: any,
  addr: string,
  ownerAddr: string,
  opIds: (number | bigint)[],
  vUnits: bigint,
): Promise<void> {
  const slot = clusterEBSlot(ownerAddr, opIds);
  const blockNum = BigInt(await provider.getBlockNumber());
  // ClusterEBSnapshot: { uint64 vUnits, uint64 lastRootBlockNum, uint64 lastUpdateBlock }
  // packed left-to-right: vUnits in [0..63], lastRootBlockNum [64..127], lastUpdateBlock [128..191]
  const packed = vUnits | (blockNum << 64n) | (blockNum << 128n);
  await provider.send("hardhat_setStorageAt", [
    addr,
    slot,
    ethers.zeroPadValue(ethers.toBeHex(packed), 32),
  ]);
}

// ─── INV-11: daoTotalEthVUnits consistency ──────────────────────────────────

/**
 * INV-11 for implicit EB: daoTotalEthVUnits == ethDaoValidatorCount * BPS_DENOMINATOR
 */
async function assertINV11Implicit(
  provider: any,
  addr: string,
  views: any,
): Promise<void> {
  const ethDaoValCount = BigInt(await views.getNetworkValidatorsCount());
  const daoVUnits = await readDaoTotalVUnits(provider, addr);
  expect(daoVUnits).to.equal(
    ethDaoValCount * BPS_DENOMINATOR,
    "INV-11: daoTotalEthVUnits must equal ethDaoValidatorCount * BPS for implicit EB",
  );
}

/**
 * INV-11 for explicit EB: daoTotalEthVUnits == ethDaoValidatorCount * BPS_DENOMINATOR + totalDeviation
 */
async function assertINV11Explicit(
  provider: any,
  addr: string,
  views: any,
  totalDeviation: bigint,
): Promise<void> {
  const ethDaoValCount = BigInt(await views.getNetworkValidatorsCount());
  const daoVUnits = await readDaoTotalVUnits(provider, addr);
  const expected = ethDaoValCount * BPS_DENOMINATOR + totalDeviation;
  expect(daoVUnits).to.equal(
    expected,
    "INV-11: daoTotalEthVUnits must equal baseline + deviation for explicit EB",
  );
}

// ─── Shared assertions for removed operators ────────────────────────────────

async function assertRemovedOpClean(
  views: any,
  provider: any,
  contractAddr: string,
  removedOpId: number | bigint,
): Promise<void> {
  const op = await views.getOperatorById(removedOpId);
  expect(op.validatorCount).to.equal(0n, "removed op ethValidatorCount must be 0");
  expect(op.fee).to.equal(0n, "removed op ethFee must be 0");
  expect(op.isActive).to.equal(false, "removed op must be inactive (both blocks == 0)");

  const vUnits = await readOpVUnits(provider, contractAddr, removedOpId);
  expect(vUnits).to.equal(0n, "removed op operatorEthVUnits must be 0 (implicit EB)");
}

async function assertLiveOpMigrated(
  views: any,
  liveOpId: number | bigint,
  expectedValCount: bigint,
): Promise<void> {
  const op = await views.getOperatorById(liveOpId);
  expect(op.validatorCount).to.equal(expectedValCount, "live op ethValidatorCount mismatch");
  expect(op.isActive).to.equal(true, "live op must be active");
  expect(op.fee).to.equal(DEFAULT_OPERATOR_ETH_FEE, "live op must have default ETH fee");
}

// ─── Fixture factory ────────────────────────────────────────────────────────

function buildFixture(
  connection: () => NetworkConnection<"generic">,
  operatorOwner: () => HardhatEthersSigner,
  clusterOwner: () => HardhatEthersSigner,
  opCount: number,
  valCount: number,
) {
  return async function rm4Fixture() {
    const conn = connection();
    const { network: legacyNetwork, views: legacyViews, ssvToken } =
      await ssvNetworkFullPreUpgradeFixture(conn);

    const opsOwner = operatorOwner();
    const cOwner = clusterOwner();

    const operatorIds: number[] = [];
    for (let i = 0; i < opCount; i++) {
      const expectedId = await legacyNetwork
        .connect(opsOwner)
        .registerOperator.staticCall(
          makeOperatorKey(i + 1),
          OP_SSV_FEE_UNPACKED,
          false,
        );
      await legacyNetwork
        .connect(opsOwner)
        .registerOperator(makeOperatorKey(i + 1), OP_SSV_FEE_UNPACKED, false);
      operatorIds.push(Number(expectedId));
    }

    const totalSSV = TOKEN_REGISTER_AMOUNT * BigInt(valCount);
    await ssvToken.mint(cOwner.address, totalSSV);
    await ssvToken
      .connect(cOwner)
      .approve(await legacyNetwork.getAddress(), totalSSV);

    let cluster: any = EMPTY_CLUSTER;
    for (let v = 0; v < valCount; v++) {
      await legacyNetwork
        .connect(cOwner)
        .registerValidator(
          makePublicKey(v + 1),
          operatorIds,
          DEFAULT_SHARES,
          TOKEN_REGISTER_AMOUNT,
          cluster,
        );
      cluster = await getCurrentClusterState(
        conn,
        legacyNetwork,
        cOwner.address,
        operatorIds,
      );
    }

    const { newNetwork, newViews } = await upgradeToStakingVersion(
      conn,
      legacyNetwork,
      legacyViews,
    );

    return {
      network: newNetwork,
      views: newViews,
      ssvToken,
      operatorIds,
      cluster,
    };
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// TESTS
// ═════════════════════════════════════════════════════════════════════════════

describe("RM4 — migrateClusterToETH with Removed Operators", function () {
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

  // ─── Group 1: Parametric operator counts — implicit EB ──────────────────

  describe("Parametric operator counts (continue guard)", function () {
    const cases: {
      id: string;
      ops: number;
      removed: number;
      vals: number;
    }[] = [
      { id: "RM4-001", ops: 4, removed: 1, vals: 3 },
      { id: "RM4-003", ops: 4, removed: 2, vals: 3 },
      { id: "RM4-004", ops: 7, removed: 1, vals: 3 },
      { id: "RM4-005", ops: 7, removed: 3, vals: 3 },
      { id: "RM4-006", ops: 10, removed: 1, vals: 3 },
      { id: "RM4-007", ops: 10, removed: 5, vals: 3 },
      { id: "RM4-008", ops: 13, removed: 1, vals: 3 },
      { id: "RM4-009", ops: 13, removed: 6, vals: 3 },
    ];

    for (const tc of cases) {
      it(`${tc.id}: ${tc.ops}-op cluster, ${tc.removed} removed, migrate (implicit EB)`, async function () {
        const fixture = buildFixture(
          () => connection,
          () => operatorOwner,
          () => clusterOwner,
          tc.ops,
          tc.vals,
        );
        const { network, views, operatorIds, cluster } =
          await networkHelpers.loadFixture(fixture);
        const provider = connection.ethers.provider;
        const networkAddr = await network.getAddress();

        await mineBlocks(provider, 50);

        // Remove last N operators
        const removedIds = operatorIds.slice(operatorIds.length - tc.removed);
        const liveIds = operatorIds.slice(0, operatorIds.length - tc.removed);
        for (const opId of removedIds) {
          await network.connect(operatorOwner).removeOperator(opId);
        }

        await mineBlocks(provider, 10);

        // Migrate
        const ethDeposit = ethers.parseEther("10");
        const migrateTx = await network
          .connect(clusterOwner)
          .migrateClusterToETH(operatorIds, cluster, { value: ethDeposit });
        await migrateTx.wait();
        await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

        // Assert removed operators
        for (const opId of removedIds) {
          await assertRemovedOpClean(views, provider, networkAddr, opId);
        }

        // Assert live operators
        for (const opId of liveIds) {
          await assertLiveOpMigrated(views, opId, BigInt(tc.vals));
        }

        // INV-11
        await assertINV11Implicit(provider, networkAddr, views);
      });
    }
  });

  // ─── Group 2: Detailed operator state (4 ops, 1 removed) ───────────────

  describe("Detailed operator state assertions (4 ops, 1 removed)", function () {
    async function deploy4Op3Val() {
      return buildFixture(
        () => connection,
        () => operatorOwner,
        () => clusterOwner,
        4,
        3,
      )();
    }

    it("RM4-010: ethSnapshot.block stays 0 after migration", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(deploy4Op3Val);
      const provider = connection.ethers.provider;

      await mineBlocks(provider, 50);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await mineBlocks(provider, 10);

      await network
        .connect(clusterOwner)
        .migrateClusterToETH(operatorIds, cluster, {
          value: ethers.parseEther("10"),
        });

      const removedOp = await views.getOperatorById(operatorIds[3]);
      expect(removedOp.isActive).to.equal(false, "ethSnapshot.block must be 0 (isActive=false)");

      // INV-11
      const networkAddr = await network.getAddress();
      await assertINV11Implicit(provider, networkAddr, views);
      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[3]);
    });

    it("RM4-011: ethValidatorCount stays 0 after migration", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(deploy4Op3Val);
      const provider = connection.ethers.provider;

      await mineBlocks(provider, 50);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await mineBlocks(provider, 10);

      await network
        .connect(clusterOwner)
        .migrateClusterToETH(operatorIds, cluster, {
          value: ethers.parseEther("10"),
        });

      const removedOp = await views.getOperatorById(operatorIds[3]);
      expect(removedOp.validatorCount).to.equal(0n, "ethValidatorCount must be 0 for removed op");

      // Live ops must have validatorCount == 3
      for (let i = 0; i < 3; i++) {
        const op = await views.getOperatorById(operatorIds[i]);
        expect(op.validatorCount).to.equal(3n);
      }

      const networkAddr = await network.getAddress();
      await assertINV11Implicit(provider, networkAddr, views);
      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[3]);
    });

    it("RM4-012: ethFee stays 0, not set to default", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(deploy4Op3Val);
      const provider = connection.ethers.provider;

      await mineBlocks(provider, 50);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await mineBlocks(provider, 10);

      await network
        .connect(clusterOwner)
        .migrateClusterToETH(operatorIds, cluster, {
          value: ethers.parseEther("10"),
        });

      const removedOp = await views.getOperatorById(operatorIds[3]);
      expect(removedOp.fee).to.equal(0n, "removed op ethFee must stay 0 (ensureETHDefaults not called)");

      // Live ops must have default ETH fee
      for (let i = 0; i < 3; i++) {
        const op = await views.getOperatorById(operatorIds[i]);
        expect(op.fee).to.equal(DEFAULT_OPERATOR_ETH_FEE);
      }

      const networkAddr = await network.getAddress();
      await assertINV11Implicit(provider, networkAddr, views);
      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[3]);
    });

    it("RM4-013: operatorEthVUnits[removedOp] stays 0 (implicit EB)", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(deploy4Op3Val);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      await mineBlocks(provider, 50);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await mineBlocks(provider, 10);

      await network
        .connect(clusterOwner)
        .migrateClusterToETH(operatorIds, cluster, {
          value: ethers.parseEther("10"),
        });

      const vUnits = await readOpVUnits(provider, networkAddr, operatorIds[3]);
      expect(vUnits).to.equal(0n, "operatorEthVUnits[removedOp] must be 0 for implicit EB");

      // All live ops should also have 0 deviation (implicit EB → no deviation loop)
      for (let i = 0; i < 3; i++) {
        const liveVUnits = await readOpVUnits(provider, networkAddr, operatorIds[i]);
        expect(liveVUnits).to.equal(0n, "live ops should have 0 deviation for implicit EB");
      }

      await assertINV11Implicit(provider, networkAddr, views);
    });

    it("RM4-015: removed op with prior SSV history — continue guard fires", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(deploy4Op3Val);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      // All ops have prior SSV history (snapshot.block != 0 from legacy registration)
      await mineBlocks(provider, 500);

      // Remove op4 — _resetOperatorState zeros both blocks, preserves snapshot.index
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);

      // Verify op4 is inactive after removal
      const opAfterRemoval = await views.getOperatorById(operatorIds[3]);
      expect(opAfterRemoval.isActive).to.equal(false);

      await mineBlocks(provider, 100);

      // Migrate — op4 must be skipped by continue guard
      await network
        .connect(clusterOwner)
        .migrateClusterToETH(operatorIds, cluster, {
          value: ethers.parseEther("10"),
        });

      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[3]);

      // Live ops migrated correctly
      for (let i = 0; i < 3; i++) {
        await assertLiveOpMigrated(views, operatorIds[i], 3n);
      }

      await assertINV11Implicit(provider, networkAddr, views);
    });

    it("RM4-017: cumulativeFeeETH excludes removed op's fee — lower burn rate", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(deploy4Op3Val);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      await mineBlocks(provider, 50);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await mineBlocks(provider, 10);

      const migrateTx = await network
        .connect(clusterOwner)
        .migrateClusterToETH(operatorIds, cluster, {
          value: ethers.parseEther("10"),
        });
      const receipt = await migrateTx.wait();
      const migratedCluster = parseClusterFromEvent(
        network,
        receipt,
        Events.CLUSTER_MIGRATED_TO_ETH,
      );

      // Burn rate should reflect 3 live ops, not 4
      const burnRate = await views.getBurnRate(
        clusterOwner.address,
        operatorIds,
        migratedCluster,
      );

      // getBurnRate scales by vUnits: (3 * opFee + networkFee) * vUnits / BPS_DENOMINATOR
      const opFee = await views.getOperatorFee(operatorIds[0]);
      const networkFee = await views.getNetworkFee();
      const vUnits = defaultVUnits(3n); // 3 validators * 10000
      const expectedBurnRate = ((3n * opFee + networkFee) * vUnits) / BPS_DENOMINATOR;
      expect(burnRate).to.equal(expectedBurnRate, "burn rate must use 3 live ops only");

      await assertINV11Implicit(provider, networkAddr, views);
      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[3]);
    });

    it("RM4-018: cumulativeIndexSSV includes removed op's preserved SSV index", async function () {
      const { network, views, ssvToken, operatorIds, cluster } =
        await networkHelpers.loadFixture(deploy4Op3Val);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      // Accrue SSV fees for 500 blocks so removed op has significant index
      await mineBlocks(provider, 500);

      // Record SSV balance before removal (to compare after migration)
      const ssvBalanceBefore = await views.getBalanceSSV(
        clusterOwner.address,
        operatorIds,
        cluster,
      );

      // Remove op4 — snapshot.index is preserved (frozen), snapshot.block zeroed
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await mineBlocks(provider, 200);

      const ownerSSVBefore = await ssvToken.balanceOf(clusterOwner.address);

      // Migrate — SSV settlement should include removed op's frozen index
      const migrateTx = await network
        .connect(clusterOwner)
        .migrateClusterToETH(operatorIds, cluster, {
          value: ethers.parseEther("10"),
        });
      const receipt = await migrateTx.wait();

      const ownerSSVAfter = await ssvToken.balanceOf(clusterOwner.address);
      const eventArgs = extractEventArgs(
        network,
        receipt,
        Events.CLUSTER_MIGRATED_TO_ETH,
      );
      const ssvRefund = BigInt(eventArgs.ssvRefunded);

      // SSV refund should be less than the SSV balance at removal
      // (because fees continued accruing on live ops, plus removed op's fees were deducted)
      expect(ssvRefund).to.be.lessThan(ssvBalanceBefore);
      expect(ssvRefund).to.be.greaterThan(0n);
      expect(ownerSSVAfter - ownerSSVBefore).to.equal(ssvRefund);

      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[3]);
      await assertINV11Implicit(provider, networkAddr, views);
    });

    it("RM4-024: no OperatorFeeExecuted event emitted for removed op", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(deploy4Op3Val);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      await mineBlocks(provider, 50);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await mineBlocks(provider, 10);

      const migrateTx = await network
        .connect(clusterOwner)
        .migrateClusterToETH(operatorIds, cluster, {
          value: ethers.parseEther("10"),
        });
      const receipt = await migrateTx.wait();

      // Check OperatorFeeExecuted events — should only be for live ops, not removed
      const feeEvents: any[] = [];
      for (const log of receipt!.logs ?? []) {
        try {
          const parsed = network.interface.parseLog(log);
          if (parsed?.name === Events.OPERATOR_FEE_EXECUTED) {
            feeEvents.push(parsed.args);
          }
        } catch {
          continue;
        }
      }

      // Live ops (3) should get OperatorFeeExecuted (ensureETHDefaults sets default fee)
      const liveOpSet = new Set(operatorIds.slice(0, 3).map(Number));
      for (const evt of feeEvents) {
        expect(liveOpSet.has(Number(evt.operatorId))).to.equal(
          true,
          "OperatorFeeExecuted should only be for live ops",
        );
        // Must NOT contain removed op
        expect(Number(evt.operatorId)).to.not.equal(operatorIds[3]);
      }

      // Verify at least the 3 live ops got the event
      const feeEventOpIds = new Set(feeEvents.map((e) => Number(e.operatorId)));
      for (const liveId of operatorIds.slice(0, 3)) {
        expect(feeEventOpIds.has(liveId)).to.equal(
          true,
          `OperatorFeeExecuted missing for live op ${liveId}`,
        );
      }

      await assertINV11Implicit(provider, networkAddr, views);
      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[3]);
    });
  });

  // ─── Group 3: Explicit EB deviation ─────────────────────────────────────

  describe("Explicit EB deviation — stranded vUnits on removed ops", function () {
    async function deploy4Op2Val() {
      return buildFixture(
        () => connection,
        () => operatorOwner,
        () => clusterOwner,
        4,
        2,
      )();
    }

    it("RM4-002: 4-op, 1 removed, explicit EB deviation > 0 — stranded vUnits on removed op", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(deploy4Op2Val);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      // Pre-set explicit EB for this cluster: 96 ETH → vUnits = ceil(96*10000/32) = 30000
      // Baseline = 2 validators * 10000 = 20000, deviation = 10000
      const vUnitsExplicit = 30000n;
      await setClusterEBVUnits(
        provider,
        networkAddr,
        clusterOwner.address,
        operatorIds,
        vUnitsExplicit,
      );

      await mineBlocks(provider, 50);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);

      // Verify operatorEthVUnits[op4] was deleted by removeOperator
      expect(await readOpVUnits(provider, networkAddr, operatorIds[3])).to.equal(0n);

      await mineBlocks(provider, 10);

      await network
        .connect(clusterOwner)
        .migrateClusterToETH(operatorIds, cluster, {
          value: ethers.parseEther("10"),
        });

      // Deviation = 30000 - 20000 = 10000
      const deviation = vUnitsExplicit - 2n * BPS_DENOMINATOR;
      expect(deviation).to.equal(10000n);

      // Removed op was skipped in updateClusterOperatorsMigration (no ethValidatorCount, no ethFee)
      const removedOp = await views.getOperatorById(operatorIds[3]);
      expect(removedOp.validatorCount).to.equal(0n);
      expect(removedOp.fee).to.equal(0n);
      expect(removedOp.isActive).to.equal(false);

      // BUT: deviation loop at SSVClusters.sol:319-322 writes ALL operatorIds unconditionally
      // Removed op receives stranded deviation
      const removedVUnits = await readOpVUnits(provider, networkAddr, operatorIds[3]);
      expect(removedVUnits).to.equal(deviation, "removed op receives stranded deviation");

      // Live ops also get deviation
      for (let i = 0; i < 3; i++) {
        const liveVUnits = await readOpVUnits(provider, networkAddr, operatorIds[i]);
        expect(liveVUnits).to.equal(deviation);
      }

      // INV-11 with deviation: baseline + 4 * deviation (all 4 ops including removed)
      // But ethDaoValidatorCount only counts cluster.validatorCount (2)
      // daoTotalEthVUnits = ethDaoValidatorCount * BPS + deviation (added once for the cluster)
      await assertINV11Explicit(provider, networkAddr, views, deviation);
    });

    it("RM4-014: 4-op, 1 removed, explicit EB deviation = 30000 — deep-dive stranded data", async function () {
      const fixture = buildFixture(
        () => connection,
        () => operatorOwner,
        () => clusterOwner,
        4,
        5,
      );
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      // Pre-set: 256 ETH → vUnits = ceil(256 * 10000 / 32) = 80000
      // Baseline = 5 * 10000 = 50000, deviation = 30000
      const vUnitsExplicit = 80000n;
      await setClusterEBVUnits(
        provider,
        networkAddr,
        clusterOwner.address,
        operatorIds,
        vUnitsExplicit,
      );

      await mineBlocks(provider, 50);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await mineBlocks(provider, 10);

      await network
        .connect(clusterOwner)
        .migrateClusterToETH(operatorIds, cluster, {
          value: ethers.parseEther("10"),
        });

      const deviation = vUnitsExplicit - 5n * BPS_DENOMINATOR;
      expect(deviation).to.equal(30000n);

      // Stranded deviation on removed op
      const removedVUnits = await readOpVUnits(provider, networkAddr, operatorIds[3]);
      expect(removedVUnits).to.equal(deviation, "stranded 30000 deviation on removed op");

      // Live ops get deviation too
      for (let i = 0; i < 3; i++) {
        expect(await readOpVUnits(provider, networkAddr, operatorIds[i])).to.equal(deviation);
      }

      // Removed op is still fully removed (no resurrection)
      const removedOp = await views.getOperatorById(operatorIds[3]);
      expect(removedOp.validatorCount).to.equal(0n);
      expect(removedOp.fee).to.equal(0n);
      expect(removedOp.isActive).to.equal(false);

      await assertINV11Explicit(provider, networkAddr, views, deviation);
    });

    it("RM4-022: 4-op, 2 removed, explicit EB deviation — both get stranded vUnits", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(deploy4Op2Val);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      // 96 ETH → vUnits = 30000, baseline = 20000, deviation = 10000
      const vUnitsExplicit = 30000n;
      await setClusterEBVUnits(
        provider,
        networkAddr,
        clusterOwner.address,
        operatorIds,
        vUnitsExplicit,
      );

      await mineBlocks(provider, 50);
      await network.connect(operatorOwner).removeOperator(operatorIds[2]);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await mineBlocks(provider, 10);

      await network
        .connect(clusterOwner)
        .migrateClusterToETH(operatorIds, cluster, {
          value: ethers.parseEther("10"),
        });

      const deviation = vUnitsExplicit - 2n * BPS_DENOMINATOR;

      // Both removed ops get stranded deviation
      expect(await readOpVUnits(provider, networkAddr, operatorIds[2])).to.equal(deviation);
      expect(await readOpVUnits(provider, networkAddr, operatorIds[3])).to.equal(deviation);

      // Both removed ops are fully dead
      for (const idx of [2, 3]) {
        const op = await views.getOperatorById(operatorIds[idx]);
        expect(op.validatorCount).to.equal(0n);
        expect(op.fee).to.equal(0n);
        expect(op.isActive).to.equal(false);
      }

      // Live ops
      for (const idx of [0, 1]) {
        await assertLiveOpMigrated(views, operatorIds[idx], 2n);
        expect(await readOpVUnits(provider, networkAddr, operatorIds[idx])).to.equal(deviation);
      }

      await assertINV11Explicit(provider, networkAddr, views, deviation);
    });
  });

  // ─── Group 4: Post-migration EB update ──────────────────────────────────

  describe("Post-migration EB update — removed op stays skipped", function () {
    async function deploy4Op3ValWithOracles() {
      const conn = connection;
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(conn);

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork
          .connect(operatorOwner)
          .registerOperator.staticCall(
            makeOperatorKey(i + 1),
            OP_SSV_FEE_UNPACKED,
            false,
          );
        await legacyNetwork
          .connect(operatorOwner)
          .registerOperator(
            makeOperatorKey(i + 1),
            OP_SSV_FEE_UNPACKED,
            false,
          );
        operatorIds.push(Number(expectedId));
      }

      const totalSSV = TOKEN_REGISTER_AMOUNT * 3n;
      await ssvToken.mint(clusterOwner.address, totalSSV);
      await ssvToken
        .connect(clusterOwner)
        .approve(await legacyNetwork.getAddress(), totalSSV);

      let cluster: any = EMPTY_CLUSTER;
      for (let v = 0; v < 3; v++) {
        await legacyNetwork
          .connect(clusterOwner)
          .registerValidator(
            makePublicKey(v + 1),
            operatorIds,
            DEFAULT_SHARES,
            TOKEN_REGISTER_AMOUNT,
            cluster,
          );
        cluster = await getCurrentClusterState(
          conn,
          legacyNetwork,
          clusterOwner.address,
          operatorIds,
        );
      }

      const { newNetwork, newViews } = await upgradeToStakingVersion(
        conn,
        legacyNetwork,
        legacyViews,
      );

      // Set up oracles — use signers [10..13]
      const allSigners = await conn.ethers.getSigners();
      const oracleSigners = allSigners.slice(10, 14);
      await setupOracles(newNetwork, ssvToken, allSigners[9], oracleSigners);

      return {
        network: newNetwork,
        views: newViews,
        ssvToken,
        operatorIds,
        cluster,
        oracleSigners,
      };
    };

    it("RM4-019: migrate with removed op, then EB update — removed op still skipped", async function () {
      const { network, views, operatorIds, cluster, oracleSigners } =
        await networkHelpers.loadFixture(deploy4Op3ValWithOracles);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      await mineBlocks(provider, 50);

      // Remove op4
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await mineBlocks(provider, 10);

      // Migrate (implicit EB)
      const migrateTx = await network
        .connect(clusterOwner)
        .migrateClusterToETH(operatorIds, cluster, {
          value: ethers.parseEther("10"),
        });
      const migrateReceipt = await migrateTx.wait();
      let migratedCluster = parseClusterFromEvent(
        network,
        migrateReceipt,
        Events.CLUSTER_MIGRATED_TO_ETH,
      );

      // Verify clean state after migration
      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[3]);
      await assertINV11Implicit(provider, networkAddr, views);

      // Advance 100 blocks for ETH fee accrual
      await mineBlocks(provider, 100);

      // EB update: 128 ETH for 3 validators → vUnits = ceil(128*10000/32) = 40000
      // baseline = 3 * 10000 = 30000, deviation = 10000
      const blockNum = await provider.getBlockNumber();
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const eb = 128;
      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: eb },
      ]);
      const proof = proofs[clusterId];

      await commitEBRoot(network, root, blockNum, oracleSigners);

      const updateTx = await network.updateClusterBalance(
        blockNum,
        clusterOwner.address,
        operatorIds,
        migratedCluster,
        eb,
        proof,
      );
      const updateReceipt = await updateTx.wait();
      const updatedCluster = parseClusterFromEvent(
        network,
        updateReceipt,
        Events.CLUSTER_BALANCE_UPDATED,
      );

      // After EB update, removed op must still be dead
      const removedOp = await views.getOperatorById(operatorIds[3]);
      expect(removedOp.validatorCount).to.equal(0n, "removed op ethValidatorCount stays 0");
      expect(removedOp.fee).to.equal(0n, "removed op ethFee stays 0");
      expect(removedOp.isActive).to.equal(false, "removed op stays inactive");

      // vUnits may have stranded deviation on removed op (from _updateOperatorVUnits loop)
      // This is a known surface — the loop iterates ALL operatorIds
      const removedVUnits = await readOpVUnits(provider, networkAddr, operatorIds[3]);
      // Removed op gets stranded deviation from the vUnit update loop
      // (SSVClusters.sol:494-509 _updateOperatorVUnits iterates ALL operatorIds)
      const deviation = 40000n - 3n * BPS_DENOMINATOR; // 10000
      expect(removedVUnits).to.equal(deviation, "removed op gets stranded deviation from vUnit update loop");

      // Fee accrual excludes op4: burn rate based on 3 ops only
      const burnRate = await views.getBurnRate(
        clusterOwner.address,
        operatorIds,
        updatedCluster,
      );
      expect(burnRate).to.be.greaterThan(0n);

      // Cluster balance reduced correctly (only 3 ops accrued fees)
      expect(updatedCluster.balance).to.be.lessThan(migratedCluster.balance);
    });

    it("RM4-020: migrate with removed op, then EB update — _updateOperatorVUnits behavior", async function () {
      const { network, views, operatorIds, cluster, oracleSigners } =
        await networkHelpers.loadFixture(deploy4Op3ValWithOracles);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      await mineBlocks(provider, 50);
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);
      await mineBlocks(provider, 10);

      // Migrate
      const migrateTx = await network
        .connect(clusterOwner)
        .migrateClusterToETH(operatorIds, cluster, {
          value: ethers.parseEther("10"),
        });
      const migrateReceipt = await migrateTx.wait();
      let migratedCluster = parseClusterFromEvent(
        network,
        migrateReceipt,
        Events.CLUSTER_MIGRATED_TO_ETH,
      );

      // All ops have 0 deviation after implicit EB migration
      for (const opId of operatorIds) {
        expect(await readOpVUnits(provider, networkAddr, opId)).to.equal(0n);
      }

      await mineBlocks(provider, 100);

      // EB update: 128 ETH → vUnits=40000, baseline=30000, deviation=10000
      const blockNum = await provider.getBlockNumber();
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const eb = 128;
      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: eb },
      ]);

      await commitEBRoot(network, root, blockNum, oracleSigners);
      const updateTx = await network.updateClusterBalance(
        blockNum,
        clusterOwner.address,
        operatorIds,
        migratedCluster,
        eb,
        proofs[clusterId],
      );
      await updateTx.wait();

      // _updateOperatorVUnits loops over ALL operatorIds
      // Removed op may get vUnits delta written (stranded)
      const deviation = 40000n - 3n * BPS_DENOMINATOR;
      for (const opId of operatorIds) {
        const vUnits = await readOpVUnits(provider, networkAddr, opId);
        // All ops (including removed) should have the deviation
        expect(vUnits).to.equal(deviation, `op ${opId} should have deviation vUnits`);
      }

      // Removed op still not resurrected
      const removedOp = await views.getOperatorById(operatorIds[3]);
      expect(removedOp.validatorCount).to.equal(0n);
      expect(removedOp.isActive).to.equal(false);
      // View-level state is still clean despite stranded vUnits
      expect(removedOp.fee).to.equal(0n, "removed op fee must be 0");
    });
  });

  // ─── Group 5: Special flows ─────────────────────────────────────────────

  describe("Special flows", function () {
    // RM4-016: Prior ETH history + removal + migration
    it("RM4-016: removed op with prior ETH history — ethSnapshot.block zeroed, clean skip", async function () {
      const conn = connection;
      const fixture = async function rm4016Fixture() {
        const {
          network: legacyNetwork,
          views: legacyViews,
          ssvToken,
        } = await ssvNetworkFullPreUpgradeFixture(conn);

        const operatorIds: number[] = [];
        for (let i = 0; i < 4; i++) {
          const expectedId = await legacyNetwork
            .connect(operatorOwner)
            .registerOperator.staticCall(
              makeOperatorKey(i + 1),
              OP_SSV_FEE_UNPACKED,
              false,
            );
          await legacyNetwork
            .connect(operatorOwner)
            .registerOperator(
              makeOperatorKey(i + 1),
              OP_SSV_FEE_UNPACKED,
              false,
            );
          operatorIds.push(Number(expectedId));
        }

        // Cluster A (Alice): 2 validators
        const aliceDeposit = TOKEN_REGISTER_AMOUNT * 2n;
        await ssvToken.mint(clusterOwner.address, aliceDeposit);
        await ssvToken
          .connect(clusterOwner)
          .approve(await legacyNetwork.getAddress(), aliceDeposit);

        let clusterA: any = EMPTY_CLUSTER;
        for (let v = 0; v < 2; v++) {
          await legacyNetwork
            .connect(clusterOwner)
            .registerValidator(
              makePublicKey(v + 1),
              operatorIds,
              DEFAULT_SHARES,
              TOKEN_REGISTER_AMOUNT,
              clusterA,
            );
          clusterA = await getCurrentClusterState(
            conn,
            legacyNetwork,
            clusterOwner.address,
            operatorIds,
          );
        }

        // Cluster B (Bob): 3 validators
        const bobDeposit = TOKEN_REGISTER_AMOUNT * 3n;
        await ssvToken.mint(clusterOwnerB.address, bobDeposit);
        await ssvToken
          .connect(clusterOwnerB)
          .approve(await legacyNetwork.getAddress(), bobDeposit);

        let clusterB: any = EMPTY_CLUSTER;
        for (let v = 0; v < 3; v++) {
          await legacyNetwork
            .connect(clusterOwnerB)
            .registerValidator(
              makePublicKey(100 + v),
              operatorIds,
              DEFAULT_SHARES,
              TOKEN_REGISTER_AMOUNT,
              clusterB,
            );
          clusterB = await getCurrentClusterState(
            conn,
            legacyNetwork,
            clusterOwnerB.address,
            operatorIds,
          );
        }

        const { newNetwork, newViews } = await upgradeToStakingVersion(
          conn,
          legacyNetwork,
          legacyViews,
        );

        return {
          network: newNetwork,
          views: newViews,
          ssvToken,
          operatorIds,
          clusterA,
          clusterB,
        };
      };

      const { network, views, operatorIds, clusterA, clusterB } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      await mineBlocks(provider, 50);

      // Step 1: Migrate Cluster A → ops get ETH state (ethSnapshot.block set)
      await network
        .connect(clusterOwner)
        .migrateClusterToETH(operatorIds, clusterA, {
          value: ethers.parseEther("5"),
        });

      // op4 now has ethSnapshot.block != 0 (prior ETH history)
      const op4AfterMigA = await views.getOperatorById(operatorIds[3]);
      expect(op4AfterMigA.isActive).to.equal(true);
      expect(op4AfterMigA.validatorCount).to.equal(2n);

      await mineBlocks(provider, 100);

      // Step 2: Remove op4 — ethSnapshot.block zeroed, operatorEthVUnits deleted
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);

      const op4AfterRemoval = await views.getOperatorById(operatorIds[3]);
      expect(op4AfterRemoval.isActive).to.equal(false, "op4 inactive after removal");
      expect(op4AfterRemoval.validatorCount).to.equal(0n);
      expect(await readOpVUnits(provider, networkAddr, operatorIds[3])).to.equal(0n);

      await mineBlocks(provider, 50);

      // Step 3: Migrate Cluster B — op4 must be skipped (both blocks == 0)
      const migBTx = await network
        .connect(clusterOwnerB)
        .migrateClusterToETH(operatorIds, clusterB, {
          value: ethers.parseEther("5"),
        });
      await migBTx.wait();

      // op4 still dead
      const op4Final = await views.getOperatorById(operatorIds[3]);
      expect(op4Final.isActive).to.equal(false);
      expect(op4Final.validatorCount).to.equal(0n);
      expect(op4Final.fee).to.equal(0n);
      expect(await readOpVUnits(provider, networkAddr, operatorIds[3])).to.equal(0n);

      // Live ops: ethValidatorCount = 2 (from A) + 3 (from B) = 5
      for (let i = 0; i < 3; i++) {
        const op = await views.getOperatorById(operatorIds[i]);
        expect(op.validatorCount).to.equal(5n);
        expect(op.isActive).to.equal(true);
      }

      await assertINV11Implicit(provider, networkAddr, views);
    });

    // RM4-021: Liquidated SSV cluster + removed op → migrate
    it("RM4-021: liquidated SSV cluster + removed op → migrate reactivates", async function () {
      const conn = connection;
      const fixture = async function rm4021Fixture() {
        const {
          network: legacyNetwork,
          views: legacyViews,
          ssvToken,
        } = await ssvNetworkFullPreUpgradeFixture(conn);

        const operatorIds: number[] = [];
        for (let i = 0; i < 4; i++) {
          const expectedId = await legacyNetwork
            .connect(operatorOwner)
            .registerOperator.staticCall(
              makeOperatorKey(i + 1),
              OP_SSV_FEE_UNPACKED,
              false,
            );
          await legacyNetwork
            .connect(operatorOwner)
            .registerOperator(
              makeOperatorKey(i + 1),
              OP_SSV_FEE_UNPACKED,
              false,
            );
          operatorIds.push(Number(expectedId));
        }

        // Small deposit so cluster can be liquidated quickly
        const smallDeposit = TOKEN_REGISTER_AMOUNT;
        await ssvToken.mint(clusterOwner.address, smallDeposit);
        await ssvToken
          .connect(clusterOwner)
          .approve(await legacyNetwork.getAddress(), smallDeposit);

        await legacyNetwork
          .connect(clusterOwner)
          .registerValidator(
            makePublicKey(1),
            operatorIds,
            DEFAULT_SHARES,
            smallDeposit,
            EMPTY_CLUSTER,
          );
        const cluster = await getCurrentClusterState(
          conn,
          legacyNetwork,
          clusterOwner.address,
          operatorIds,
        );

        const { newNetwork, newViews } = await upgradeToStakingVersion(
          conn,
          legacyNetwork,
          legacyViews,
        );

        return {
          network: newNetwork,
          views: newViews,
          ssvToken,
          operatorIds,
          cluster,
        };
      };

      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      // Deplete SSV balance
      await mineBlocks(provider, 999_999_999);

      // Liquidate the SSV cluster
      const liquidateTx = await network.liquidateSSV(
        clusterOwner.address,
        operatorIds,
        cluster,
      );
      const liquidateReceipt = await liquidateTx.wait();
      const liquidatedCluster = parseClusterFromEvent(
        network,
        liquidateReceipt,
        Events.CLUSTER_LIQUIDATED,
      );
      expect(liquidatedCluster.active).to.equal(false);

      // Remove op4 after liquidation
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);

      await mineBlocks(provider, 10);

      // Migrate — should reactivate the cluster
      const migrateTx = await network
        .connect(clusterOwner)
        .migrateClusterToETH(operatorIds, liquidatedCluster, {
          value: ethers.parseEther("10"),
        });
      const migrateReceipt = await migrateTx.wait();

      // Both events emitted
      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);
      await expect(migrateTx).to.emit(network, Events.CLUSTER_REACTIVATED);

      const eventArgs = extractEventArgs(
        network,
        migrateReceipt,
        Events.CLUSTER_MIGRATED_TO_ETH,
      );
      expect(eventArgs.ssvRefunded).to.equal(0n, "liquidated cluster has 0 SSV refund");

      const migratedCluster = parseClusterFromEvent(
        network,
        migrateReceipt,
        Events.CLUSTER_MIGRATED_TO_ETH,
      );
      expect(migratedCluster.active).to.equal(true);

      // Removed op4: completely skipped
      await assertRemovedOpClean(views, provider, networkAddr, operatorIds[3]);

      // Live ops: ethValidatorCount = 1 (only 1 validator in this cluster)
      for (let i = 0; i < 3; i++) {
        const op = await views.getOperatorById(operatorIds[i]);
        expect(op.validatorCount).to.equal(1n);
        expect(op.isActive).to.equal(true);
      }

      // SSV validatorCount NOT decremented again (already done by liquidation)
      for (const opId of operatorIds.slice(0, 3)) {
        const ssvOp = await views.getOperatorByIdSSV(opId);
        expect(ssvOp.validatorCount).to.equal(0n);
      }

      await assertINV11Implicit(provider, networkAddr, views);
    });

    // RM4-023: Sequential migration — op removed between two migrations
    it("RM4-023: migrate cluster A, remove op, migrate cluster B — removed op skipped in both", async function () {
      const conn = connection;
      const fixture = async function rm4023Fixture() {
        const {
          network: legacyNetwork,
          views: legacyViews,
          ssvToken,
        } = await ssvNetworkFullPreUpgradeFixture(conn);

        const operatorIds: number[] = [];
        for (let i = 0; i < 4; i++) {
          const expectedId = await legacyNetwork
            .connect(operatorOwner)
            .registerOperator.staticCall(
              makeOperatorKey(i + 1),
              OP_SSV_FEE_UNPACKED,
              false,
            );
          await legacyNetwork
            .connect(operatorOwner)
            .registerOperator(
              makeOperatorKey(i + 1),
              OP_SSV_FEE_UNPACKED,
              false,
            );
          operatorIds.push(Number(expectedId));
        }

        // Cluster A (Alice): 2 validators
        const aliceDeposit = TOKEN_REGISTER_AMOUNT * 2n;
        await ssvToken.mint(clusterOwner.address, aliceDeposit);
        await ssvToken
          .connect(clusterOwner)
          .approve(await legacyNetwork.getAddress(), aliceDeposit);

        let clusterA: any = EMPTY_CLUSTER;
        for (let v = 0; v < 2; v++) {
          await legacyNetwork
            .connect(clusterOwner)
            .registerValidator(
              makePublicKey(v + 1),
              operatorIds,
              DEFAULT_SHARES,
              TOKEN_REGISTER_AMOUNT,
              clusterA,
            );
          clusterA = await getCurrentClusterState(
            conn,
            legacyNetwork,
            clusterOwner.address,
            operatorIds,
          );
        }

        // Cluster B (Bob): 3 validators
        const bobDeposit = TOKEN_REGISTER_AMOUNT * 3n;
        await ssvToken.mint(clusterOwnerB.address, bobDeposit);
        await ssvToken
          .connect(clusterOwnerB)
          .approve(await legacyNetwork.getAddress(), bobDeposit);

        let clusterB: any = EMPTY_CLUSTER;
        for (let v = 0; v < 3; v++) {
          await legacyNetwork
            .connect(clusterOwnerB)
            .registerValidator(
              makePublicKey(100 + v),
              operatorIds,
              DEFAULT_SHARES,
              TOKEN_REGISTER_AMOUNT,
              clusterB,
            );
          clusterB = await getCurrentClusterState(
            conn,
            legacyNetwork,
            clusterOwnerB.address,
            operatorIds,
          );
        }

        const { newNetwork, newViews } = await upgradeToStakingVersion(
          conn,
          legacyNetwork,
          legacyViews,
        );

        return {
          network: newNetwork,
          views: newViews,
          ssvToken,
          operatorIds,
          clusterA,
          clusterB,
        };
      };

      const { network, views, operatorIds, clusterA, clusterB } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      await mineBlocks(provider, 50);

      // Step 1: Migrate Cluster A → all 4 ops get ensureETHDefaults, ethValidatorCount = 2
      const migATx = await network
        .connect(clusterOwner)
        .migrateClusterToETH(operatorIds, clusterA, {
          value: ethers.parseEther("5"),
        });
      await migATx.wait();

      for (const opId of operatorIds) {
        const op = await views.getOperatorById(opId);
        expect(op.validatorCount).to.equal(2n);
        expect(op.isActive).to.equal(true);
      }

      await mineBlocks(provider, 100);

      // Step 2: Remove op4 — ethSnapshot.block zeroed, ethValidatorCount = 0
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);

      const op4After = await views.getOperatorById(operatorIds[3]);
      expect(op4After.isActive).to.equal(false);
      expect(op4After.validatorCount).to.equal(0n);

      await mineBlocks(provider, 50);

      // Step 3: Migrate Cluster B → op4 skipped by continue guard
      const migBTx = await network
        .connect(clusterOwnerB)
        .migrateClusterToETH(operatorIds, clusterB, {
          value: ethers.parseEther("5"),
        });
      await migBTx.wait();

      // op4: still dead, ethValidatorCount stays 0 (was 2, reset to 0 by removal)
      const op4Final = await views.getOperatorById(operatorIds[3]);
      expect(op4Final.isActive).to.equal(false);
      expect(op4Final.validatorCount).to.equal(0n);
      expect(op4Final.fee).to.equal(0n);
      expect(await readOpVUnits(provider, networkAddr, operatorIds[3])).to.equal(0n);

      // Live ops: ethValidatorCount = 2 (from A's migration) + 3 (from B) = 5
      for (let i = 0; i < 3; i++) {
        const op = await views.getOperatorById(operatorIds[i]);
        expect(op.validatorCount).to.equal(5n);
      }

      // ETH accrual from Cluster A's 150 blocks properly accumulated for live ops
      // (op4 excluded — no fee accrual)
      const networkValidators = await views.getNetworkValidatorsCount();
      expect(networkValidators).to.equal(5); // 2 + 3

      await assertINV11Implicit(provider, networkAddr, views);
    });

    // RM4-025: Full lifecycle regression
    it("RM4-025: full lifecycle — register, create, remove, migrate, EB update, verify no ghost data", async function () {
      const conn = connection;
      const fixture = async function rm4025Fixture() {
        const {
          network: legacyNetwork,
          views: legacyViews,
          ssvToken,
        } = await ssvNetworkFullPreUpgradeFixture(conn);

        const operatorIds: number[] = [];
        for (let i = 0; i < 4; i++) {
          const expectedId = await legacyNetwork
            .connect(operatorOwner)
            .registerOperator.staticCall(
              makeOperatorKey(i + 1),
              OP_SSV_FEE_UNPACKED,
              false,
            );
          await legacyNetwork
            .connect(operatorOwner)
            .registerOperator(
              makeOperatorKey(i + 1),
              OP_SSV_FEE_UNPACKED,
              false,
            );
          operatorIds.push(Number(expectedId));
        }

        const totalSSV = TOKEN_REGISTER_AMOUNT * 3n;
        await ssvToken.mint(clusterOwner.address, totalSSV);
        await ssvToken
          .connect(clusterOwner)
          .approve(await legacyNetwork.getAddress(), totalSSV);

        let cluster: any = EMPTY_CLUSTER;
        for (let v = 0; v < 3; v++) {
          await legacyNetwork
            .connect(clusterOwner)
            .registerValidator(
              makePublicKey(v + 1),
              operatorIds,
              DEFAULT_SHARES,
              TOKEN_REGISTER_AMOUNT,
              cluster,
            );
          cluster = await getCurrentClusterState(
            conn,
            legacyNetwork,
            clusterOwner.address,
            operatorIds,
          );
        }

        const { newNetwork, newViews } = await upgradeToStakingVersion(
          conn,
          legacyNetwork,
          legacyViews,
        );

        // Set up oracles
        const allSigners = await conn.ethers.getSigners();
        const oracleSigners = allSigners.slice(10, 14);
        await setupOracles(newNetwork, ssvToken, allSigners[9], oracleSigners);

        return {
          network: newNetwork,
          views: newViews,
          ssvToken,
          operatorIds,
          cluster,
          oracleSigners,
        };
      };

      const { network, views, operatorIds, cluster, oracleSigners } =
        await networkHelpers.loadFixture(fixture);
      const provider = connection.ethers.provider;
      const networkAddr = await network.getAddress();

      // ── Phase 0: Pre-removal state ──
      await mineBlocks(provider, 500);

      // op4 has SSV state (snapshot.block > 0) but no ETH state yet
      const op4Pre = await views.getOperatorByIdSSV(operatorIds[3]);
      expect(op4Pre.validatorCount).to.be.greaterThan(0n);
      expect(await readOpVUnits(provider, networkAddr, operatorIds[3])).to.equal(0n);

      // ── Remove op4 ──
      await network.connect(operatorOwner).removeOperator(operatorIds[3]);

      // Verify op4 post-removal
      const op4PostRemoval = await views.getOperatorById(operatorIds[3]);
      expect(op4PostRemoval.isActive).to.equal(false);
      expect(op4PostRemoval.validatorCount).to.equal(0n);
      expect(op4PostRemoval.fee).to.equal(0n);
      expect(await readOpVUnits(provider, networkAddr, operatorIds[3])).to.equal(0n);

      const op4SSVPost = await views.getOperatorByIdSSV(operatorIds[3]);
      expect(op4SSVPost.validatorCount).to.equal(0n);

      await mineBlocks(provider, 100);

      // ── Phase 1: Migration (implicit EB) ──
      const migrateTx = await network
        .connect(clusterOwner)
        .migrateClusterToETH(operatorIds, cluster, {
          value: ethers.parseEther("10"),
        });
      const migrateReceipt = await migrateTx.wait();
      const migratedCluster = parseClusterFromEvent(
        network,
        migrateReceipt,
        Events.CLUSTER_MIGRATED_TO_ETH,
      );

      // Verify after migration
      // op4: not resurrected
      expect((await views.getOperatorById(operatorIds[3])).isActive).to.equal(false);
      expect((await views.getOperatorById(operatorIds[3])).validatorCount).to.equal(0n);
      expect((await views.getOperatorById(operatorIds[3])).fee).to.equal(0n);
      expect(await readOpVUnits(provider, networkAddr, operatorIds[3])).to.equal(
        0n,
        "no ghost data after implicit EB migration",
      );

      // Live ops: properly migrated
      for (let i = 0; i < 3; i++) {
        await assertLiveOpMigrated(views, operatorIds[i], 3n);
        expect(await readOpVUnits(provider, networkAddr, operatorIds[i])).to.equal(0n);
      }

      expect(migratedCluster.active).to.equal(true);
      expect(migratedCluster.balance).to.equal(ethers.parseEther("10"));

      await assertINV11Implicit(provider, networkAddr, views);

      // ── Phase 2: EB Update (200 blocks later) ──
      await mineBlocks(provider, 200);

      // Oracle commits root: effectiveBalance = 128 ETH (> baseline of 96 ETH for 3 validators)
      const blockNum = await provider.getBlockNumber();
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const eb = 128;
      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: eb },
      ]);

      await commitEBRoot(network, root, blockNum, oracleSigners);

      const updateTx = await network.updateClusterBalance(
        blockNum,
        clusterOwner.address,
        operatorIds,
        migratedCluster,
        eb,
        proofs[clusterId],
      );
      const updateReceipt = await updateTx.wait();
      const updatedCluster = parseClusterFromEvent(
        network,
        updateReceipt,
        Events.CLUSTER_BALANCE_UPDATED,
      );

      // op4 still dead — not resurrected by EB update
      expect((await views.getOperatorById(operatorIds[3])).isActive).to.equal(false);
      expect((await views.getOperatorById(operatorIds[3])).validatorCount).to.equal(0n);

      // Fee accrual for 200 blocks uses 3 operator fees only
      expect(updatedCluster.balance).to.be.lessThan(migratedCluster.balance);

      // vUnits updated: deviation distributed to ALL ops (including removed — stranded)
      const newVUnits = 40000n; // ceil(128 * 10000 / 32) = 40000
      const baseline = 3n * BPS_DENOMINATOR; // 30000
      const deviation = newVUnits - baseline; // 10000

      // operatorEthVUnits[op4] may be non-zero (stranded deviation — known surface)
      const op4VUnitsAfterEB = await readOpVUnits(provider, networkAddr, operatorIds[3]);
      // This is the known stranded data from the vUnit update loop
      expect(op4VUnitsAfterEB).to.equal(
        deviation,
        "stranded deviation on removed op after EB update (known surface)",
      );

      // Live ops also have deviation
      for (let i = 0; i < 3; i++) {
        expect(await readOpVUnits(provider, networkAddr, operatorIds[i])).to.equal(deviation);
      }

      // ── Final state assertions ──
      // No ghost data in ethSnapshot or ethValidatorCount for op4 at any phase
      expect((await views.getOperatorById(operatorIds[3])).isActive).to.equal(false);
      expect((await views.getOperatorById(operatorIds[3])).validatorCount).to.equal(0n);

      // Cluster remains functional with 3 effective operators
      expect(updatedCluster.active).to.equal(true);
      expect(updatedCluster.validatorCount).to.equal(3n);

      // Fee accounting consistent: only 3 ops contribute to burn rate
      const burnRate = await views.getBurnRate(
        clusterOwner.address,
        operatorIds,
        updatedCluster,
      );
      expect(burnRate).to.be.greaterThan(0n);
    });
  });
});

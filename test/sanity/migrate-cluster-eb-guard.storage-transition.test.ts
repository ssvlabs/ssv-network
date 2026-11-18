import { expect } from "chai";
import { ethers } from "ethers";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvClustersHarnessFixture } from "../setup/fixtures.ts";
import type { NetworkHelpersType } from "../common/types.ts";
import type { SSVClustersHarness } from "../../types/ethers-contracts/index.js";
import {
  BPS_DENOMINATOR,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  MINIMAL_OPERATOR_ETH_FEE,
} from "../common/constants.ts";
import {
  computeClusterId,
  createLegacySSVCluster,
  extractEventArgs,
  makePublicKey,
  parseClusterFromEvent,
  setupTestContext,
} from "../helpers/index.js";
import { Events } from "../common/events.js";
import { Errors } from "../common/errors.js";

// Exact ClusterLib.hashClusterData encoding: keccak256(abi.encodePacked(
//   uint32 validatorCount, uint64 networkFeeIndex, uint64 index, uint256 balance, bool active))
function expectedClusterHash(c: {
  validatorCount: bigint;
  networkFeeIndex: bigint;
  index: bigint;
  balance: bigint;
  active: boolean;
}) {
  return ethers.keccak256(
    ethers.solidityPacked(
      ["uint32", "uint64", "uint64", "uint256", "bool"],
      [c.validatorCount, c.networkFeeIndex, c.index, c.balance, c.active],
    ),
  );
}

describe("migrateClusterToETH guard: storage transitions for cases E/F/I", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [, clusterOwner] } = await setupTestContext());
  });

  const deployHarnessFixture = async () =>
    ssvClustersHarnessFixture(connection, 4, MINIMAL_OPERATOR_ETH_FEE);

  // Drives a legacy SSV cluster into the "phantom" pre-fix shape:
  //   s.clusters[clusterId] != 0, validatorCount == 0, seb.clusterEB[clusterId].vUnits > 0
  // by registering, optionally liquidating, removing the last validator (which now zeroes vUnits
  // via the SSV-side fix), then re-seeding vUnits via mockSetClusterVUnits to simulate a
  // cluster that was poisoned before the SSV-side fix shipped. The migration-side guard is the
  // only thing standing between this state and a deviation injection on migrate.
  async function setupPhantomCluster(
    clusters: SSVClustersHarness,
    operatorIds: bigint[],
    seed: number,
    options: { liquidate?: boolean; phantomVUnits?: bigint } = {},
  ) {
    const phantomVUnits = options.phantomVUnits ?? 640_000n;
    const key = makePublicKey(seed);
    const ssvCluster = createLegacySSVCluster({ validatorCount: 1n, balance: 0n });
    await clusters.mockRegisterSSVValidator(key, operatorIds, clusterOwner.address, ssvCluster);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    let working = ssvCluster;

    if (options.liquidate) {
      const liqReceipt = await (
        await clusters.connect(clusterOwner).liquidateSSV(clusterOwner.address, operatorIds, ssvCluster)
      ).wait();
      working = parseClusterFromEvent(clusters, liqReceipt, Events.CLUSTER_LIQUIDATED);
      expect(working.active).to.equal(false);
    }

    const removeReceipt = await (
      await clusters.connect(clusterOwner).removeValidator(key, operatorIds, working)
    ).wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);
    expect(clusterAfterRemove.validatorCount).to.equal(0n);
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n); // vUnits starts at 0; mockSetClusterVUnits below poisons it to simulate pre-fix state

    await clusters.mockSetClusterVUnits(clusterId, phantomVUnits);
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(phantomVUnits);

    return { clusterId, clusterAfterRemove };
  }

  // ── E: active branch, msg.value == 0 ────────────────────────────────────────────────
  it("E: clears s.clusters slot, writes s.ethClusters to expected hash, zeroes vUnits, leaves DAO/operator state untouched", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployHarnessFixture);
    const { clusterId, clusterAfterRemove } = await setupPhantomCluster(clusters, operatorIds, 200);

    const daoTotalEthVUnitsBefore = await clusters.getDaoTotalEthVUnits();
    const daoValidatorCountBefore = await clusters.getDaoValidatorCount();
    const daoEthValidatorCountBefore = await clusters.getDaoEthValidatorCount();
    const operatorEthVUnitsBefore = await Promise.all(
      operatorIds.map((op) => clusters.getOperatorEthVUnits(op)),
    );
    const operatorEthValidatorCountsBefore = await Promise.all(
      operatorIds.map((op) => clusters.getOperatorEthValidatorCount(op)),
    );
    const contractEthBefore = await connection.ethers.provider.getBalance(await clusters.getAddress());

    const migrateReceipt = await (
      await clusters.connect(clusterOwner).migrateClusterToETH(operatorIds, clusterAfterRemove, { value: 0 })
    ).wait();
    const args = extractEventArgs(clusters, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);
    const clusterAfterMigrate = parseClusterFromEvent(clusters, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);

    // post-state cluster shape (used to reconstruct the expected ETH-slot hash)
    expect(clusterAfterMigrate.validatorCount).to.equal(0n);
    expect(clusterAfterMigrate.balance).to.equal(0n);
    expect(clusterAfterMigrate.active).to.equal(true);

    // ── slot transitions
    expect(await clusters.getSSVClusterHash(clusterId)).to.equal(ethers.ZeroHash);
    expect(await clusters.getClusterHash(clusterId)).to.equal(expectedClusterHash(clusterAfterMigrate));

    // ── EB snapshot wiped
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);

    // ── event reflects cleared snapshot
    expect(args.effectiveBalance).to.equal(0);
    expect(args.ethDeposited).to.equal(0n);

    // ── DAO and per-operator state must be byte-for-byte identical: vCount=0 implies
    //    sp.updateDAOSSV(false, 0) and sp.updateDAO(true, 0) both no-op, deviation skipped.
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(daoTotalEthVUnitsBefore);
    expect(await clusters.getDaoValidatorCount()).to.equal(daoValidatorCountBefore);
    expect(await clusters.getDaoEthValidatorCount()).to.equal(daoEthValidatorCountBefore);
    for (let i = 0; i < operatorIds.length; i++) {
      expect(await clusters.getOperatorEthVUnits(operatorIds[i])).to.equal(operatorEthVUnitsBefore[i]);
      expect(await clusters.getOperatorEthValidatorCount(operatorIds[i])).to.equal(operatorEthValidatorCountsBefore[i]);
    }

    // ── contract ETH balance unchanged (msg.value == 0)
    expect(await connection.ethers.provider.getBalance(await clusters.getAddress())).to.equal(contractEthBefore);
  });

  // ── F: active branch, msg.value > 0 ─────────────────────────────────────────────────
  it("F: msg.value flows into cluster.balance and contract ETH, fix-cleared vUnits keeps deviation untouched", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployHarnessFixture);
    const { clusterId, clusterAfterRemove } = await setupPhantomCluster(clusters, operatorIds, 201);

    const depositValue = ethers.parseEther("3");
    const daoTotalEthVUnitsBefore = await clusters.getDaoTotalEthVUnits();
    const daoEthValidatorCountBefore = await clusters.getDaoEthValidatorCount();
    const operatorEthVUnitsBefore = await Promise.all(
      operatorIds.map((op) => clusters.getOperatorEthVUnits(op)),
    );
    const operatorEthValidatorCountsBefore = await Promise.all(
      operatorIds.map((op) => clusters.getOperatorEthValidatorCount(op)),
    );
    const contractEthBefore = await connection.ethers.provider.getBalance(await clusters.getAddress());

    const migrateReceipt = await (
      await clusters.connect(clusterOwner).migrateClusterToETH(operatorIds, clusterAfterRemove, { value: depositValue })
    ).wait();
    const args = extractEventArgs(clusters, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);
    const clusterAfterMigrate = parseClusterFromEvent(clusters, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);

    // ── balance landed in cluster + contract ETH
    expect(clusterAfterMigrate.balance).to.equal(depositValue);
    expect(args.ethDeposited).to.equal(depositValue);
    expect(args.effectiveBalance).to.equal(0); // vUnits cleared → vUnitsToEB(0) == 0
    expect(
      (await connection.ethers.provider.getBalance(await clusters.getAddress())) - contractEthBefore,
    ).to.equal(depositValue);

    // ── slot transitions and cleared EB snapshot
    expect(await clusters.getSSVClusterHash(clusterId)).to.equal(ethers.ZeroHash);
    expect(await clusters.getClusterHash(clusterId)).to.equal(expectedClusterHash(clusterAfterMigrate));
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);

    // ── deviation accounting must NOT have absorbed the phantom vUnits
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(daoTotalEthVUnitsBefore);
    expect(await clusters.getDaoEthValidatorCount()).to.equal(daoEthValidatorCountBefore);
    for (let i = 0; i < operatorIds.length; i++) {
      expect(await clusters.getOperatorEthVUnits(operatorIds[i])).to.equal(operatorEthVUnitsBefore[i]);
      expect(await clusters.getOperatorEthValidatorCount(operatorIds[i])).to.equal(operatorEthValidatorCountsBefore[i]);
    }
  });

  // ── I: liquidated branch (cluster.active == false at migration entry) ──────────────
  it("I: liquidated SSV cluster with phantom vUnits migrates, reactivates, and emits ClusterReactivated", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployHarnessFixture);
    const { clusterId, clusterAfterRemove } = await setupPhantomCluster(clusters, operatorIds, 202, {
      liquidate: true,
    });
    expect(clusterAfterRemove.active).to.equal(false);

    const daoTotalEthVUnitsBefore = await clusters.getDaoTotalEthVUnits();
    const daoEthValidatorCountBefore = await clusters.getDaoEthValidatorCount();
    const operatorEthVUnitsBefore = await Promise.all(
      operatorIds.map((op) => clusters.getOperatorEthVUnits(op)),
    );
    const operatorEthValidatorCountsBefore = await Promise.all(
      operatorIds.map((op) => clusters.getOperatorEthValidatorCount(op)),
    );

    const migrateTx = await clusters
      .connect(clusterOwner)
      .migrateClusterToETH(operatorIds, clusterAfterRemove, { value: 0 });
    const migrateReceipt = await migrateTx.wait();
    const clusterAfterMigrate = parseClusterFromEvent(clusters, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);

    // ── reactivation path emits the secondary event
    await expect(migrateTx).to.emit(clusters, Events.CLUSTER_REACTIVATED);

    // ── cluster flipped to active, vCount stays 0, balance 0
    expect(clusterAfterMigrate.active).to.equal(true);
    expect(clusterAfterMigrate.validatorCount).to.equal(0n);
    expect(clusterAfterMigrate.balance).to.equal(0n);

    // ── slot transitions and cleared EB snapshot
    expect(await clusters.getSSVClusterHash(clusterId)).to.equal(ethers.ZeroHash);
    expect(await clusters.getClusterHash(clusterId)).to.equal(expectedClusterHash(clusterAfterMigrate));
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);

    // ── liquidated branch: updateDAOSSV is skipped, updateDAO(true, 0) is no-op, deviation skipped
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(daoTotalEthVUnitsBefore);
    expect(await clusters.getDaoEthValidatorCount()).to.equal(daoEthValidatorCountBefore);
    for (let i = 0; i < operatorIds.length; i++) {
      expect(await clusters.getOperatorEthVUnits(operatorIds[i])).to.equal(operatorEthVUnitsBefore[i]);
      expect(await clusters.getOperatorEthValidatorCount(operatorIds[i])).to.equal(operatorEthValidatorCountsBefore[i]);
    }
  });

  // ── E adversarial: SSV slot is gone, re-migration must revert ───────────────────────
  // The revert is caused by the deleted s.clusters slot (validateHashedCluster sees VERSION_ETH),
  // not the EB guard — this is lifecycle idempotency coverage, not guard coverage.
  it("E adversarial: re-migration after fix-clean migration reverts IncorrectClusterVersion (s.clusters slot deleted)", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployHarnessFixture);
    const { clusterAfterRemove } = await setupPhantomCluster(clusters, operatorIds, 203);

    const migrateReceipt = await (
      await clusters.connect(clusterOwner).migrateClusterToETH(operatorIds, clusterAfterRemove, { value: 0 })
    ).wait();
    const clusterAfterMigrate = parseClusterFromEvent(clusters, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);

    // validateHashedCluster sees ETH-only slot → version=ETH; validateClusterVersion(VERSION_SSV) reverts.
    await expect(
      clusters.connect(clusterOwner).migrateClusterToETH(operatorIds, clusterAfterMigrate, { value: 0 }),
    ).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_VERSION);
  });

  // ── E adversarial: post-fix register lands on a clean implicit baseline ─────────────
  it("E adversarial: registerValidator after fix-clean migration produces a clean implicit cluster (vUnits=0, deviation=0, baseline=BPS)", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployHarnessFixture);
    const { clusterId, clusterAfterRemove } = await setupPhantomCluster(clusters, operatorIds, 204);

    const clusterAfterMigrate = parseClusterFromEvent(
      clusters,
      await (
        await clusters.connect(clusterOwner).migrateClusterToETH(operatorIds, clusterAfterRemove, { value: 0 })
      ).wait(),
      Events.CLUSTER_MIGRATED_TO_ETH,
    );

    const clusterAfterRegister = parseClusterFromEvent(
      clusters,
      await (
        await clusters
          .connect(clusterOwner)
          .registerValidator(makePublicKey(304), operatorIds, DEFAULT_SHARES, clusterAfterMigrate, {
            value: DEFAULT_ETH_REGISTER_VALUE,
          })
      ).wait(),
      Events.VALIDATOR_ADDED,
    );

    // post-register cluster shape lands as a clean 1-validator ETH cluster
    expect(clusterAfterRegister.validatorCount).to.equal(1n);
    expect(clusterAfterRegister.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);
    expect(clusterAfterRegister.active).to.equal(true);

    // SPEC.md: implicit cluster keeps clusterEB.vUnits == 0 (default 32 ETH/validator), no deviation injected
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);
    for (const op of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(op)).to.equal(0n);
      // effectiveOperatorVUnits = operatorEthVUnits + ethValidatorCount * BPS = 0 + 1 * BPS
      expect(await clusters.getEffectiveOperatorVUnits(op)).to.equal(BPS_DENOMINATOR);
      expect(await clusters.getOperatorEthValidatorCount(op)).to.equal(1n);
    }
    // DAO baseline tracks 1 validator's worth of vUnits, no deviation contribution
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(BPS_DENOMINATOR);

    // SSV slot still empty, ETH slot matches new state
    expect(await clusters.getSSVClusterHash(clusterId)).to.equal(ethers.ZeroHash);
    expect(await clusters.getClusterHash(clusterId)).to.equal(expectedClusterHash(clusterAfterRegister));
  });
});

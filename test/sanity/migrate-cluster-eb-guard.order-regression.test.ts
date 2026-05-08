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

// Mirrors ClusterLib.hashClusterData: keccak256(abi.encodePacked(validatorCount, networkFeeIndex, index, balance, active))
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

// Each test pins one ordering constraint inside migrateClusterToETH and shows that
// swapping the two steps would produce a wrong post-state that the assertion catches.

describe("migrateClusterToETH guard: order-of-checks regression", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [, clusterOwner] } = await setupTestContext());
  });

  const deployHarnessFixture = async () =>
    ssvClustersHarnessFixture(connection, 4, MINIMAL_OPERATOR_ETH_FEE);

  // Drives a cluster to vCount=0 with stale phantom vUnits (simulates pre-fix poisoned state).
  async function setupPhantomCluster(
    clusters: SSVClustersHarness,
    operatorIds: bigint[],
    seed: number,
    phantomVUnits = 640_000n,
  ) {
    const key = makePublicKey(seed);
    const ssvCluster = createLegacySSVCluster({ validatorCount: 1n, balance: 0n });
    await clusters.mockRegisterSSVValidator(key, operatorIds, clusterOwner.address, ssvCluster);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const removeReceipt = await (
      await clusters.connect(clusterOwner).removeValidator(key, operatorIds, ssvCluster)
    ).wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);
    await clusters.mockSetClusterVUnits(clusterId, phantomVUnits);
    return { clusterId, clusterAfterRemove };
  }

  // Returns a 1-validator SSV cluster (validator NOT removed) with optional explicit vUnits.
  async function setupOneValidatorCluster(
    clusters: SSVClustersHarness,
    operatorIds: bigint[],
    seed: number,
    vUnits?: bigint,
  ) {
    const key = makePublicKey(seed);
    const ssvCluster = createLegacySSVCluster({ validatorCount: 1n, balance: 0n });
    await clusters.mockRegisterSSVValidator(key, operatorIds, clusterOwner.address, ssvCluster);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    if (vUnits !== undefined) {
      await clusters.mockSetClusterVUnits(clusterId, vUnits);
    }
    return { clusterId, ssvCluster };
  }

  // ── EB guard fires before deviation loop ─────────────────────────────────────────────
  // The guard zeroes vUnitsCluster when vCount=0 && vUnits>0.
  // The deviation loop then sees vUnitsCluster=0 and skips.
  // If the order were reversed: deviation would add phantom vUnits to DAO/operators before the
  // guard zeroed the snapshot, leaving daoTotalEthVUnits permanently inflated.
  it("guard zeroes vUnits before deviation loop — DAO stays clean when vCount=0 and phantom vUnits exist", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployHarnessFixture);
    const { clusterId, clusterAfterRemove } = await setupPhantomCluster(clusters, operatorIds, 300);

    const daoTotalEthVUnitsBefore = await clusters.getDaoTotalEthVUnits();
    const operatorEthVUnitsBefore = await Promise.all(
      operatorIds.map((op) => clusters.getOperatorEthVUnits(op)),
    );

    await (
      await clusters.connect(clusterOwner).migrateClusterToETH(operatorIds, clusterAfterRemove, { value: 0 })
    ).wait();

    // Guard ran first → vUnitsCluster=0 before deviation block → no phantom deviation injected.
    // Ordering violation would leave daoTotalEthVUnits == 640_000.
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(daoTotalEthVUnitsBefore);
    for (let i = 0; i < operatorIds.length; i++) {
      expect(await clusters.getOperatorEthVUnits(operatorIds[i])).to.equal(operatorEthVUnitsBefore[i]);
    }
  });

  // ── Guard condition is vCount==0 exactly — does NOT fire for vCount=1 ────────────────
  // With a 1-validator cluster that has explicit vUnits=20_000 (64 ETH EB):
  //   baseline = 1 * BPS_DENOMINATOR = 10_000
  //   deviation = 20_000 - 10_000 = 10_000
  // If the guard fired unconditionally on any vUnits>0 (removing the vCount==0 check), it
  // would zero out vUnitsCluster before the deviation block, leaving daoTotalEthVUnits at
  // only the baseline (10_000) with no deviation applied.
  it("guard does NOT zero vUnits when vCount=1 — explicit deviation reaches DAO and operators", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployHarnessFixture);
    const { clusterId, ssvCluster } = await setupOneValidatorCluster(
      clusters,
      operatorIds,
      301,
      20_000n,
    );
    // updateDAO(true, 1) adds baseline (BPS_DENOMINATOR) to daoTotalEthVUnits.
    // Deviation block adds (vUnits - baseline). Total DAO = baseline + deviation = vUnits.
    const explicitVUnits = 20_000n;
    const operatorDeviation = explicitVUnits - BPS_DENOMINATOR; // 10_000

    await (
      await clusters
        .connect(clusterOwner)
        .migrateClusterToETH(operatorIds, ssvCluster, { value: DEFAULT_ETH_REGISTER_VALUE })
    ).wait();

    // Guard must NOT have fired (vCount=1 ≠ 0) → vUnits intact, deviation applied.
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(explicitVUnits);
    // DAO gets baseline + deviation = explicitVUnits; operators get deviation only.
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(explicitVUnits);
    for (const op of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(op)).to.equal(operatorDeviation);
    }
  });

  // ── validateHashedCluster fires before updateClusterOperatorsMigration ───────────────
  // If hash validation ran after operator state was mutated, a tampered cluster struct would
  // partially corrupt operator.ethValidatorCount before the revert cleaned up.
  it("validateHashedCluster fires first — tampered cluster reverts before operator ETH state is mutated", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployHarnessFixture);
    const key = makePublicKey(302);
    const realCluster = createLegacySSVCluster({ validatorCount: 1n, balance: 0n });
    await clusters.mockRegisterSSVValidator(key, operatorIds, clusterOwner.address, realCluster);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const ssvHashBefore = await clusters.getSSVClusterHash(clusterId);
    const operatorEthValidatorCountsBefore = await Promise.all(
      operatorIds.map((op) => clusters.getOperatorEthValidatorCount(op)),
    );

    // Submit a tampered struct: wrong validatorCount → hash mismatch → IncorrectClusterState
    const tamperedCluster = { ...realCluster, validatorCount: 2n };
    await expect(
      clusters.connect(clusterOwner).migrateClusterToETH(operatorIds, tamperedCluster, { value: 0 }),
    ).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_STATE);

    // Hash check fired before any mutation: both slots unchanged, operator counts untouched.
    expect(await clusters.getSSVClusterHash(clusterId)).to.equal(ssvHashBefore);
    expect(await clusters.getClusterHash(clusterId)).to.equal(ethers.ZeroHash);
    for (let i = 0; i < operatorIds.length; i++) {
      expect(await clusters.getOperatorEthValidatorCount(operatorIds[i])).to.equal(
        operatorEthValidatorCountsBefore[i],
      );
    }
  });

  // ── cluster.balance = msg.value assigned before isLiquidatableWithEB ─────────────────
  // SSV cluster balance is 0 (createLegacySSVCluster({ balance: 0n })).
  // If isLiquidatableWithEB read cluster.balance before the assignment, it would see 0,
  // which is < minimumLiquidationCollateral, and revert with InsufficientBalance.
  // Migration succeeds → proves the assignment `cluster.balance = msg.value` happened first.
  it("liquidation check uses msg.value not SSV balance — vCount=1 with SSV balance=0 and msg.value=10 ETH succeeds", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployHarnessFixture);
    const { ssvCluster } = await setupOneValidatorCluster(clusters, operatorIds, 303);

    // ssvCluster.balance == 0 → would fail minimumLiquidationCollateral if used for the check
    const migrateReceipt = await (
      await clusters
        .connect(clusterOwner)
        .migrateClusterToETH(operatorIds, ssvCluster, { value: DEFAULT_ETH_REGISTER_VALUE })
    ).wait();
    const clusterAfterMigrate = parseClusterFromEvent(
      clusters,
      migrateReceipt,
      Events.CLUSTER_MIGRATED_TO_ETH,
    );

    expect(clusterAfterMigrate.validatorCount).to.equal(1n);
    expect(clusterAfterMigrate.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);
  });

  // ── updateDAOSSV is conditional on !isLiquidated ─────────────────────────────────────
  // Active SSV cluster: updateDAOSSV(false, vCount) called → daoValidatorCount decrements.
  // Liquidated SSV cluster: updateDAOSSV SKIPPED (already removed at liquidation time).
  // If the `if (!isLiquidated)` guard were removed, a liquidated migration would call
  // updateDAOSSV again and decrement daoValidatorCount below its post-liquidation value.
  it("updateDAOSSV skipped for liquidated SSV cluster — daoValidatorCount unchanged after liquidated migration", async function () {
    // sub-case: active cluster → migration decrements SSV DAO count
    const { clusters: clustersA, operatorIds: opsA } =
      await networkHelpers.loadFixture(deployHarnessFixture);

    const daoCountBeforeA = await clustersA.getDaoValidatorCount();
    const { ssvCluster: clusterA } = await setupOneValidatorCluster(clustersA, opsA, 304);
    expect(await clustersA.getDaoValidatorCount()).to.equal(daoCountBeforeA + 1n);

    await (
      await clustersA
        .connect(clusterOwner)
        .migrateClusterToETH(opsA, clusterA, { value: DEFAULT_ETH_REGISTER_VALUE })
    ).wait();
    // updateDAOSSV(false, 1) called → decrements back to baseline
    expect(await clustersA.getDaoValidatorCount()).to.equal(daoCountBeforeA);

    // sub-case: liquidated cluster → migration does NOT decrement SSV DAO count
    const { clusters: clustersB, operatorIds: opsB } =
      await networkHelpers.loadFixture(deployHarnessFixture);

    const key = makePublicKey(305);
    const ssvCluster = createLegacySSVCluster({ validatorCount: 1n, balance: 0n });
    await clustersB.mockRegisterSSVValidator(key, opsB, clusterOwner.address, ssvCluster);

    // Owner self-liquidates (liquidateSSV allows clusterOwner == msg.sender without threshold check)
    const liqReceipt = await (
      await clustersB.connect(clusterOwner).liquidateSSV(clusterOwner.address, opsB, ssvCluster)
    ).wait();
    const liquidatedCluster = parseClusterFromEvent(clustersB, liqReceipt, Events.CLUSTER_LIQUIDATED);

    // Capture daoValidatorCount post-liquidation (already decremented)
    const daoCountPostLiquidation = await clustersB.getDaoValidatorCount();

    // Liquidated cluster still has validatorCount=1; provide msg.value to pass the collateral check.
    await (
      await clustersB
        .connect(clusterOwner)
        .migrateClusterToETH(opsB, liquidatedCluster, { value: DEFAULT_ETH_REGISTER_VALUE })
    ).wait();

    // updateDAOSSV must NOT have run (isLiquidated=true) → count stays at post-liquidation value.
    // Ordering violation would produce daoCountPostLiquidation - 1.
    expect(await clustersB.getDaoValidatorCount()).to.equal(daoCountPostLiquidation);
  });

  // ── updateClusterOperatorsMigration initialises ethSnapshot.block before deviation loop
  // The deviation loop skips operators with ethSnapshot.block == 0.
  // updateClusterOperatorsMigration calls ensureETHDefaults which sets ethSnapshot.block
  // for SSV-only operators. If the deviation loop ran first, all operators would still have
  // ethSnapshot.block == 0, the `continue` would skip them, and operatorEthVUnits would
  // stay at 0 even though the cluster has explicit deviation.
  it("operator deviation applied after updateClusterOperatorsMigration initialises ethSnapshot.block", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployHarnessFixture);

    // Force all operators into SSV-only state so ethSnapshot.block == 0.
    // Without this, the fixture already initialises ethSnapshot.block, and the
    // deviation loop would credit operators regardless of execution order.
    for (const op of operatorIds) {
      await clusters.mockSetOperatorLegacySSV(op, 1n);
      const [, ethBlockBefore] = await clusters.getOperatorEthSnapshot(op);
      expect(ethBlockBefore).to.equal(0);
    }

    // vUnits=20_000 (64 ETH EB), vCount=1 → deviation = 20_000 - BPS_DENOMINATOR = 10_000
    const { ssvCluster } = await setupOneValidatorCluster(clusters, operatorIds, 306, 20_000n);
    const explicitVUnits = 20_000n;
    const operatorDeviation = explicitVUnits - BPS_DENOMINATOR; // 10_000

    await (
      await clusters
        .connect(clusterOwner)
        .migrateClusterToETH(operatorIds, ssvCluster, { value: DEFAULT_ETH_REGISTER_VALUE })
    ).wait();

    // updateClusterOperatorsMigration must have run first: ethSnapshot.block is now set.
    for (const op of operatorIds) {
      const [, ethBlockAfter] = await clusters.getOperatorEthSnapshot(op);
      expect(ethBlockAfter).to.be.greaterThan(0);
    }
    // Each operator receives the deviation; DAO gets baseline + deviation.
    for (const op of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(op)).to.equal(operatorDeviation);
    }
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(explicitVUnits);
  });

  // ── Scenario D: vCount=0 AND vUnits=0 (clean implicit baseline) ──────────────────────
  // Guard condition `vCount==0 && vUnits>0` is FALSE (vUnits already zero, no write needed).
  // Deviation loop `vUnits>0` is also FALSE — skipped entirely.
  // updateDAO(true, 0) and updateDAOSSV(false, 0) are both arithmetic no-ops.
  // Net effect: only the slot transition (SSV cleared → ETH written) and the event happen;
  // every other piece of storage is byte-for-byte identical before and after.
  it("vCount=0 && vUnits=0 — guard and deviation loop both no-op, slot transition correct, DAO/operator state untouched", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployHarnessFixture);

    const key = makePublicKey(307);
    const ssvCluster = createLegacySSVCluster({ validatorCount: 1n, balance: 0n });
    await clusters.mockRegisterSSVValidator(key, operatorIds, clusterOwner.address, ssvCluster);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const removeReceipt = await (
      await clusters.connect(clusterOwner).removeValidator(key, operatorIds, ssvCluster)
    ).wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);
    expect(clusterAfterRemove.validatorCount).to.equal(0n);
    // vUnits was never poisoned — confirmed clean baseline
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);

    // Snapshot every piece of state that must NOT change
    const daoTotalEthVUnitsBefore = await clusters.getDaoTotalEthVUnits();
    const daoEthValidatorCountBefore = await clusters.getDaoEthValidatorCount();
    const daoSSVValidatorCountBefore = await clusters.getDaoValidatorCount();
    const operatorEthVUnitsBefore = await Promise.all(
      operatorIds.map((op) => clusters.getOperatorEthVUnits(op)),
    );
    const operatorEthValidatorCountsBefore = await Promise.all(
      operatorIds.map((op) => clusters.getOperatorEthValidatorCount(op)),
    );
    // SSV slot must be present before migration
    expect(await clusters.getSSVClusterHash(clusterId)).to.not.equal(ethers.ZeroHash);

    const migrateReceipt = await (
      await clusters.connect(clusterOwner).migrateClusterToETH(operatorIds, clusterAfterRemove, { value: 0 })
    ).wait();
    const args = extractEventArgs(clusters, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);
    const clusterAfterMigrate = parseClusterFromEvent(clusters, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);

    // effectiveVUnits = 0 * BPS = 0 → effectiveBalance = vUnitsToEB(0) = 0
    expect(args.effectiveBalance).to.equal(0);
    expect(args.ethDeposited).to.equal(0n);

    // EB snapshot: guard did not write (condition was false), stays at 0
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);

    // Slot transitions: SSV slot deleted, ETH slot written with exact hash
    expect(await clusters.getSSVClusterHash(clusterId)).to.equal(ethers.ZeroHash);
    expect(await clusters.getClusterHash(clusterId)).to.equal(expectedClusterHash(clusterAfterMigrate));

    // DAO and per-operator state: byte-for-byte identical (all loops were no-ops)
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(daoTotalEthVUnitsBefore);
    expect(await clusters.getDaoEthValidatorCount()).to.equal(daoEthValidatorCountBefore);
    expect(await clusters.getDaoValidatorCount()).to.equal(daoSSVValidatorCountBefore);
    for (let i = 0; i < operatorIds.length; i++) {
      expect(await clusters.getOperatorEthVUnits(operatorIds[i])).to.equal(operatorEthVUnitsBefore[i]);
      expect(await clusters.getOperatorEthValidatorCount(operatorIds[i])).to.equal(
        operatorEthValidatorCountsBefore[i],
      );
    }
  });
});

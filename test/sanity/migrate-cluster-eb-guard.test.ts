import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { ssvClustersHarnessFixture } from "../setup/fixtures.ts";
import type { NetworkHelpersType } from "../common/types.ts";
import type { SSVClustersHarness } from "../../types/ethers-contracts/index.js";
import {
  BPS_DENOMINATOR,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  MINIMAL_OPERATOR_ETH_FEE,
} from "../common/constants.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import {
  computeClusterId,
  computeEBRoot,
  createLegacySSVCluster,
  extractEventArgs,
  makePublicKey,
  mineBlocks,
  parseClusterFromEvent,
  setupTestContext,
} from "../helpers/index.js";
import { Events } from "../common/events.js";
import { Errors } from "../common/errors.ts";

describe("migrateClusterToETH guard: stale vUnits on empty SSV cluster", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({
      connection,
      networkHelpers,
      signers: [, clusterOwner],
    } = await setupTestContext());
  });

  const deployHarnessFixture = async () =>
    ssvClustersHarnessFixture(connection, 4, MINIMAL_OPERATOR_ETH_FEE);

  async function setupBrokenStateCluster(
    clusters: SSVClustersHarness,
    operatorIds: bigint[],
    seed: number,
  ) {
    const key = makePublicKey(seed);
    const ssvCluster = createLegacySSVCluster({ validatorCount: 1n, balance: 0n });
    await clusters.mockRegisterSSVValidator(key, operatorIds, clusterOwner.address, ssvCluster);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const removeTx = await clusters
      .connect(clusterOwner)
      .removeValidator(key, operatorIds, ssvCluster);
    const clusterAfterRemove = parseClusterFromEvent(
      clusters,
      await removeTx.wait(),
      Events.VALIDATOR_REMOVED,
    );
    expect(clusterAfterRemove.validatorCount).to.equal(0n);

    await clusters.mockSetClusterVUnits(clusterId, 640_000n);

    return { clusterId, clusterAfterRemove };
  }

  it("guard zeroes stale vUnits on migration, effectiveBalance is nullified", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployHarnessFixture);
    const { clusterAfterRemove } = await setupBrokenStateCluster(clusters, operatorIds, 100);

    const migrateReceipt = await (
      await clusters.connect(clusterOwner).migrateClusterToETH(operatorIds, clusterAfterRemove, { value: 0 })
    ).wait();
    const migrateArgs = extractEventArgs(clusters, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);

    expect(migrateArgs.effectiveBalance).to.equal(0);
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(0n);
    for (const op of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(op)).to.equal(0n);
    }
  });

  it("can register validator after guard-patched migration with clean 32 ETH baseline", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployHarnessFixture);
    const { clusterAfterRemove } = await setupBrokenStateCluster(clusters, operatorIds, 101);

    const clusterAfterMigrate = parseClusterFromEvent(
      clusters,
      await (
        await clusters
          .connect(clusterOwner)
          .migrateClusterToETH(operatorIds, clusterAfterRemove, { value: 0 })
      ).wait(),
      Events.CLUSTER_MIGRATED_TO_ETH,
    );
    expect(clusterAfterMigrate.validatorCount).to.equal(0n);
    expect(clusterAfterMigrate.active).to.equal(true);

    const clusterAfterReg = parseClusterFromEvent(
      clusters,
      await (
        await clusters.connect(clusterOwner).registerValidator(
          makePublicKey(102),
          operatorIds,
          DEFAULT_SHARES,
          clusterAfterMigrate,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        )
      ).wait(),
      Events.VALIDATOR_ADDED,
    );
    expect(clusterAfterReg.validatorCount).to.equal(1n);

    expect(await clusters.getDaoTotalEthVUnits()).to.equal(BPS_DENOMINATOR);
    for (const op of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(op)).to.equal(0n);
      expect(await clusters.getEffectiveOperatorVUnits(op)).to.equal(BPS_DENOMINATOR);
    }
  });

  it("operator ETH earnings are stale after migration nullified the eb", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployHarnessFixture);
    const { clusterAfterRemove } = await setupBrokenStateCluster(clusters, operatorIds, 103);

    await clusters
      .connect(clusterOwner)
      .migrateClusterToETH(operatorIds, clusterAfterRemove, { value: 0 });

    for (const op of operatorIds) {
      expect(await clusters.getOperatorEthValidatorCount(op)).to.equal(0);
      expect(await clusters.getEffectiveOperatorVUnits(op)).to.equal(0n);
    }

    await mineBlocks(connection.ethers.provider, 1000);

    for (const op of operatorIds) {
      expect(await clusters.getOperatorEthValidatorCount(op)).to.equal(0);
      expect(await clusters.getEffectiveOperatorVUnits(op)).to.equal(0n);
    }
  });

  it("Non-zero msg.value — cluster.balance equals msg.value, ETH cluster stored, SSV cluster deleted", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployHarnessFixture);
    const { clusterId, clusterAfterRemove } = await setupBrokenStateCluster(clusters, operatorIds, 110);

    const migrateReceipt = await (
      await clusters
        .connect(clusterOwner)
        .migrateClusterToETH(operatorIds, clusterAfterRemove, { value: DEFAULT_ETH_REGISTER_VALUE })
    ).wait();
    const clusterAfterMigrate = parseClusterFromEvent(clusters, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);

    expect(clusterAfterMigrate.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);

    const expectedHash = connection.ethers.solidityPackedKeccak256(
      ["uint32", "uint64", "uint64", "uint256", "bool"],
      [
        clusterAfterMigrate.validatorCount,
        clusterAfterMigrate.networkFeeIndex,
        clusterAfterMigrate.index,
        clusterAfterMigrate.balance,
        clusterAfterMigrate.active,
      ],
    );
    expect(await clusters.getClusterHash(clusterId)).to.equal(expectedHash);
    expect(await clusters.getSSVClusterHash(clusterId)).to.equal(connection.ethers.ZeroHash);
  });

  it("Liquidated SSV cluster with stale vUnits at validatorCount=0 - guard fires, ClusterReactivated emitted", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployHarnessFixture);

    const ssvCluster = createLegacySSVCluster({ validatorCount: 1n, balance: 0n });
    const key = makePublicKey(120);
    await clusters.mockRegisterSSVValidator(key, operatorIds, clusterOwner.address, ssvCluster);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const clusterAfterLiq = parseClusterFromEvent(
      clusters,
      await (await clusters.connect(clusterOwner).liquidateSSV(clusterOwner.address, operatorIds, ssvCluster)).wait(),
      Events.CLUSTER_LIQUIDATED,
    );
    expect(clusterAfterLiq.active).to.equal(false);

    const clusterAfterRemove = parseClusterFromEvent(
      clusters,
      await (await clusters.connect(clusterOwner).removeValidator(key, operatorIds, clusterAfterLiq)).wait(),
      Events.VALIDATOR_REMOVED,
    );
    expect(clusterAfterRemove.validatorCount).to.equal(0n);

    await clusters.mockSetClusterVUnits(clusterId, 640_000n);

    const migrateReceipt = await (
      await clusters.connect(clusterOwner).migrateClusterToETH(operatorIds, clusterAfterRemove, { value: 0 })
    ).wait();
    const migrateArgs = extractEventArgs(clusters, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);
    const reactivateArgs = extractEventArgs(clusters, migrateReceipt, Events.CLUSTER_REACTIVATED);

    expect(migrateArgs.effectiveBalance).to.equal(0);
    expect(reactivateArgs).to.not.be.undefined;
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(0n);
    for (const op of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(op)).to.equal(0n);
    }
  });

  it("Explicit vUnits == baseline - no deviation added, vUnits preserved in storage", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployHarnessFixture);

    const ssvCluster = createLegacySSVCluster({ validatorCount: 1n, balance: 0n });
    await clusters.mockRegisterSSVValidator(makePublicKey(130), operatorIds, clusterOwner.address, ssvCluster);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    await clusters.mockSetClusterVUnits(clusterId, BPS_DENOMINATOR);

    await clusters.connect(clusterOwner).migrateClusterToETH(operatorIds, ssvCluster, { value: DEFAULT_ETH_REGISTER_VALUE });

    expect(await clusters.getDaoTotalEthVUnits()).to.equal(BPS_DENOMINATOR);
    for (const op of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(op)).to.equal(0n);
    }
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(BPS_DENOMINATOR);
  });

  it("Explicit vUnits > baseline with 2 validators - each operator gets exact deviation, DAO matches", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployHarnessFixture);

    const ssvCluster = createLegacySSVCluster({ validatorCount: 2n, balance: 0n });
    await clusters.mockRegisterSSVValidator(makePublicKey(140), operatorIds, clusterOwner.address, ssvCluster);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const vUnits = 40_000n;
    const baseline = 2n * BPS_DENOMINATOR;
    const deviation = vUnits - baseline;
    await clusters.mockSetClusterVUnits(clusterId, vUnits);

    await clusters.connect(clusterOwner).migrateClusterToETH(operatorIds, ssvCluster, { value: DEFAULT_ETH_REGISTER_VALUE });

    expect(await clusters.getDaoTotalEthVUnits()).to.equal(baseline + deviation);
    for (const op of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(op)).to.equal(deviation);
    }
  });

  it("EBBelowMinimum: oracle cannot set EB below floor (validatorCount * 32 ETH)", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployHarnessFixture);

    const cluster1 = parseClusterFromEvent(
      clusters,
      await (
        await clusters.connect(clusterOwner).registerValidator(
          makePublicKey(200),
          operatorIds,
          DEFAULT_SHARES,
          { validatorCount: 0, networkFeeIndex: 0, index: 0, balance: 0, active: true },
          { value: DEFAULT_ETH_REGISTER_VALUE },
        )
      ).wait(),
      Events.VALIDATOR_ADDED,
    );
    const cluster2 = parseClusterFromEvent(
      clusters,
      await (
        await clusters.connect(clusterOwner).registerValidator(
          makePublicKey(201),
          operatorIds,
          DEFAULT_SHARES,
          cluster1,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        )
      ).wait(),
      Events.VALIDATOR_ADDED,
    );

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const rootBelow = computeEBRoot(clusterId, 63);
    await clusters.mockSetEBRoot(1, rootBelow);
    await expect(
      clusters.connect(clusterOwner).updateClusterBalance(1, clusterOwner.address, operatorIds, cluster2, 63, []),
    ).to.be.revertedWithCustomError(clusters, Errors.EB_BELOW_MINIMUM);

    const rootZero = computeEBRoot(clusterId, 0);
    await clusters.mockSetEBRoot(2, rootZero);
    await expect(
      clusters.connect(clusterOwner).updateClusterBalance(2, clusterOwner.address, operatorIds, cluster2, 0, []),
    ).to.be.revertedWithCustomError(clusters, Errors.EB_BELOW_MINIMUM);

    const rootFloor = computeEBRoot(clusterId, 64);
    await clusters.mockSetEBRoot(3, rootFloor);
    await expect(
      clusters.connect(clusterOwner).updateClusterBalance(3, clusterOwner.address, operatorIds, cluster2, 64, []),
    ).to.not.revert(connection.ethers);
  });

  it("EBExceedsMaximum: stale root (EB=1000) rejected after validators removed and cluster migrated", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployHarnessFixture);

    const key = makePublicKey(210);
    const ssvCluster = createLegacySSVCluster({ validatorCount: 1n, balance: 0n });
    await clusters.mockRegisterSSVValidator(key, operatorIds, clusterOwner.address, ssvCluster);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const rootEB1000 = computeEBRoot(clusterId, 1000);
    await clusters.mockSetEBRoot(10, rootEB1000);
    await clusters.updateClusterBalance(10, clusterOwner.address, operatorIds, ssvCluster, 1000, []);

    const clusterAfterRemove = parseClusterFromEvent(
      clusters,
      await (await clusters.connect(clusterOwner).removeValidator(key, operatorIds, ssvCluster)).wait(),
      Events.VALIDATOR_REMOVED,
    );
    expect(clusterAfterRemove.validatorCount).to.equal(0n);

    const clusterAfterMigrate = parseClusterFromEvent(
      clusters,
      await (
        await clusters.connect(clusterOwner).migrateClusterToETH(operatorIds, clusterAfterRemove, { value: 0 })
      ).wait(),
      Events.CLUSTER_MIGRATED_TO_ETH,
    );
    expect(clusterAfterMigrate.validatorCount).to.equal(0n);

    await clusters.mockSetEBRoot(20, rootEB1000);
    await expect(
      clusters.updateClusterBalance(20, clusterOwner.address, operatorIds, clusterAfterMigrate, 1000, []),
    ).to.be.revertedWithCustomError(clusters, Errors.EB_EXCEEDS_MAXIMUM);
  });
});

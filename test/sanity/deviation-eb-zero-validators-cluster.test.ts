import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { ssvClustersHarnessFixture, ssvNetworkFullPreUpgradeFixture, upgradeToStakingVersion } from "../setup/fixtures.ts";
import type { NetworkHelpersType } from "../common/types.ts";
import {
  BPS_DENOMINATOR,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
  TOKEN_REGISTER_AMOUNT,
} from "../common/constants.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import {
  computeClusterId,
  computeEBRoot,
  commitEBRoot,
  createCluster,
  createLegacySSVCluster,
  generateMerkleForClusterEB,
  getCurrentClusterState,
  extractEventArgs,
  makePublicKey,
  mineBlocks,
  getBlockNumber,
  parseClusterFromEvent,
  registerOperatorsSSV,
  setupOracles,
  setupTestContext,
  whitelistAddresses,
} from "../helpers/index.js";
import { Events } from "../common/events.js";

describe("Deviated effective balance and removed validators sanity", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let oracle1: HardhatEthersSigner;
  let oracle2: HardhatEthersSigner;
  let oracle3: HardhatEthersSigner;

  before(async function () {
    ({
      connection,
      networkHelpers,
      signers: [operatorOwner, clusterOwner, oracle1, oracle2, oracle3],
    } = await setupTestContext());
  });

  const deployFixture = async () => ssvNetworkFullPreUpgradeFixture(connection);

  async function setupSsvClusterWithDeviatedEB(
    ssvPublicKeySeed: number,
    effectiveBalance = 64,
  ) {
    const { network: legacyNetwork, views: legacyViews, ssvToken } =
      await networkHelpers.loadFixture(deployFixture);

    await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
    await ssvToken.connect(clusterOwner).approve(await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT);

    const operatorIds = await registerOperatorsSSV(legacyNetwork, operatorOwner, 4);
    await whitelistAddresses(legacyNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

    await legacyNetwork.connect(clusterOwner).registerValidator(
      makePublicKey(ssvPublicKeySeed),
      operatorIds,
      DEFAULT_SHARES,
      TOKEN_REGISTER_AMOUNT,
      EMPTY_CLUSTER,
    );

    const ssvCluster = await getCurrentClusterState(
      connection,
      legacyNetwork,
      clusterOwner.address,
      operatorIds,
    );

    const { newNetwork, newViews } = await upgradeToStakingVersion(
      connection,
      legacyNetwork,
      legacyViews,
    );

    await setupOracles(newNetwork, ssvToken, clusterOwner, [oracle1, oracle2, oracle3]);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const root = computeEBRoot(clusterId, effectiveBalance);

    await mineBlocks(connection.ethers.provider, 1);
    const blockNum = await getBlockNumber(connection.ethers.provider);
    await commitEBRoot(newNetwork, root, blockNum, [oracle1, oracle2, oracle3]);

    const updateTx = await newNetwork
      .connect(clusterOwner)
      .updateClusterBalance(
        blockNum,
        clusterOwner.address,
        operatorIds,
        ssvCluster,
        effectiveBalance,
        [],
      );
    const clusterAfterUpdate = parseClusterFromEvent(
      newNetwork,
      await updateTx.wait(),
      Events.CLUSTER_BALANCE_UPDATED,
    );

    return { newNetwork, newViews, operatorIds, ssvCluster, clusterAfterUpdate, clusterId };
  }

  describe("Cluster with deviated effective balance and zero validators", () => {
    it("removing last SSV validator clears clusterEB vUnits — getEffectiveBalance returns 0", async function () {
      const { newNetwork, newViews, operatorIds, clusterAfterUpdate } =
        await setupSsvClusterWithDeviatedEB(1);

      expect(
        await newViews.getEffectiveBalance(clusterOwner.address, operatorIds, clusterAfterUpdate),
      ).to.equal(64);

      const removeTx = await newNetwork
        .connect(clusterOwner)
        .removeValidator(makePublicKey(1), operatorIds, clusterAfterUpdate);
      const clusterAfterRemove = parseClusterFromEvent(
        newNetwork,
        await removeTx.wait(),
        Events.VALIDATOR_REMOVED,
      );
      expect(clusterAfterRemove.validatorCount).to.equal(0n);

      expect(
        await newViews.getEffectiveBalance(clusterOwner.address, operatorIds, clusterAfterRemove),
      ).to.equal(0);
    });

    it("migrating SSV cluster after removing last validator emits effectiveBalance=0 and adds no phantom deviation", async function () {
      const { newNetwork, newViews, operatorIds, clusterAfterUpdate } =
        await setupSsvClusterWithDeviatedEB(2);

      const removeTx = await newNetwork
        .connect(clusterOwner)
        .removeValidator(makePublicKey(2), operatorIds, clusterAfterUpdate);
      const clusterAfterRemove = parseClusterFromEvent(
        newNetwork,
        await removeTx.wait(),
        Events.VALIDATOR_REMOVED,
      );
      expect(clusterAfterRemove.validatorCount).to.equal(0n);

      const migrateTx = await newNetwork
        .connect(clusterOwner)
        .migrateClusterToETH(operatorIds, clusterAfterRemove, {
          value: DEFAULT_ETH_REGISTER_VALUE,
        });
      const migrateReceipt = await migrateTx.wait();
      const migrateArgs = extractEventArgs(newNetwork, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);

      expect(migrateArgs.effectiveBalance).to.equal(0);

      const clusterAfterMigrate = parseClusterFromEvent(
        newNetwork,
        migrateReceipt,
        Events.CLUSTER_MIGRATED_TO_ETH,
      );
      expect(clusterAfterMigrate.validatorCount).to.equal(0n);
      expect(clusterAfterMigrate.active).to.equal(true);

      const regTx = await newNetwork
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(3),
          operatorIds,
          DEFAULT_SHARES,
          clusterAfterMigrate,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        );
      const clusterAfterReg = parseClusterFromEvent(
        newNetwork,
        await regTx.wait(),
        Events.VALIDATOR_ADDED,
      );
      expect(clusterAfterReg.validatorCount).to.equal(1n);

      expect(
        await newViews.getEffectiveBalance(clusterOwner.address, operatorIds, clusterAfterReg),
      ).to.equal(32);
    });

    it("operator ETH earnings frozen after liquidation and removing validators", async function () {
      const { newNetwork, newViews, operatorIds, clusterAfterUpdate } =
        await setupSsvClusterWithDeviatedEB(4);

      const liqTx = await newNetwork
        .connect(clusterOwner)
        .liquidateSSV(clusterOwner.address, operatorIds, clusterAfterUpdate);
      const clusterAfterLiq = parseClusterFromEvent(
        newNetwork,
        await liqTx.wait(),
        Events.CLUSTER_LIQUIDATED,
      );
      expect(clusterAfterLiq.active).to.equal(false);
      expect(clusterAfterLiq.validatorCount).to.equal(1n);

      const removeTx = await newNetwork
        .connect(clusterOwner)
        .removeValidator(makePublicKey(4), operatorIds, clusterAfterLiq);
      const clusterAfterRemove = parseClusterFromEvent(
        newNetwork,
        await removeTx.wait(),
        Events.VALIDATOR_REMOVED,
      );
      expect(clusterAfterRemove.validatorCount).to.equal(0n);

      const migrateTx = await newNetwork
        .connect(clusterOwner)
        .migrateClusterToETH(operatorIds, clusterAfterRemove, {
          value: DEFAULT_ETH_REGISTER_VALUE,
        });
      const clusterAfterMigrate = parseClusterFromEvent(
        newNetwork,
        await migrateTx.wait(),
        Events.CLUSTER_MIGRATED_TO_ETH,
      );
      expect(clusterAfterMigrate.active).to.equal(true);
      expect(clusterAfterMigrate.validatorCount).to.equal(0n);

      const earningsBefore = await Promise.all(
        operatorIds.map((id) => newViews.getOperatorEarnings(id)),
      );

      await mineBlocks(connection.ethers.provider, 1000);

      const earningsAfter = await Promise.all(
        operatorIds.map((id) => newViews.getOperatorEarnings(id)),
      );

      for (let i = 0; i < operatorIds.length; i++) {
        expect(earningsAfter[i]).to.equal(earningsBefore[i]);
      }
    });

    it("operator earnings are stale on empty migrated ETH cluster", async function () {
      const { newNetwork, newViews, operatorIds, clusterAfterUpdate } =
        await setupSsvClusterWithDeviatedEB(3);

      const removeTx = await newNetwork
        .connect(clusterOwner)
        .removeValidator(makePublicKey(3), operatorIds, clusterAfterUpdate);
      const clusterAfterRemove = parseClusterFromEvent(
        newNetwork,
        await removeTx.wait(),
        Events.VALIDATOR_REMOVED,
      );

      await newNetwork
        .connect(clusterOwner)
        .migrateClusterToETH(operatorIds, clusterAfterRemove, {
          value: DEFAULT_ETH_REGISTER_VALUE,
        });

      const earningsBefore = await Promise.all(
        operatorIds.map((id) => newViews.getOperatorEarnings(id)),
      );

      await mineBlocks(connection.ethers.provider, 1000);

      const earningsAfter = await Promise.all(
        operatorIds.map((id) => newViews.getOperatorEarnings(id)),
      );

      for (let i = 0; i < operatorIds.length; i++) {
        expect(earningsAfter[i]).to.equal(earningsBefore[i]);
      }
    });
  });

  describe("Two SSV clusters sharing operators — full empty migration cycle", () => {
    it("shared operators lifecycle", async function () {
      const clusterOwnerB = (await connection.ethers.getSigners())[5];

      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwner).approve(await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT);
      await ssvToken.mint(clusterOwnerB.address, TOKEN_REGISTER_AMOUNT);
      await ssvToken.connect(clusterOwnerB).approve(await legacyNetwork.getAddress(), TOKEN_REGISTER_AMOUNT);

      const operatorIds = await registerOperatorsSSV(legacyNetwork, operatorOwner, 4);
      await whitelistAddresses(legacyNetwork, operatorOwner, operatorIds, [
        clusterOwner.address,
        clusterOwnerB.address,
      ]);

      const keysA = Array.from({ length: 5 }, (_, i) => makePublicKey(201 + i));
      await legacyNetwork.connect(clusterOwner).registerValidator(
        keysA[0], operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      for (let i = 1; i < 5; i++) {
        const state = await getCurrentClusterState(connection, legacyNetwork, clusterOwner.address, operatorIds);
        await legacyNetwork.connect(clusterOwner).registerValidator(keysA[i], operatorIds, DEFAULT_SHARES, 0n, state);
      }
      const ssvClusterA = await getCurrentClusterState(connection, legacyNetwork, clusterOwner.address, operatorIds);

      const keysB = Array.from({ length: 5 }, (_, i) => makePublicKey(206 + i));
      await legacyNetwork.connect(clusterOwnerB).registerValidator(
        keysB[0], operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
      );
      for (let i = 1; i < 5; i++) {
        const state = await getCurrentClusterState(connection, legacyNetwork, clusterOwnerB.address, operatorIds);
        await legacyNetwork.connect(clusterOwnerB).registerValidator(keysB[i], operatorIds, DEFAULT_SHARES, 0n, state);
      }
      const ssvClusterB = await getCurrentClusterState(connection, legacyNetwork, clusterOwnerB.address, operatorIds);

      const { newNetwork, newViews } = await upgradeToStakingVersion(connection, legacyNetwork, legacyViews);
      await setupOracles(newNetwork, ssvToken, clusterOwner, [oracle1, oracle2, oracle3]);

      const clusterIdA = computeClusterId(clusterOwner.address, operatorIds);
      const clusterIdB = computeClusterId(clusterOwnerB.address, operatorIds);

      await mineBlocks(connection.ethers.provider, 1);
      const blockNum1 = await getBlockNumber(connection.ethers.provider);
      const { root: root1, proofs: proofs1 } = generateMerkleForClusterEB(connection, [
        { clusterId: clusterIdA, effectiveBalance: 1000 },
        { clusterId: clusterIdB, effectiveBalance: 1000 },
      ]);
      await commitEBRoot(newNetwork, root1, blockNum1, [oracle1, oracle2, oracle3]);

      let clusterA = parseClusterFromEvent(
        newNetwork,
        await (await newNetwork.connect(clusterOwner).updateClusterBalance(
          blockNum1, clusterOwner.address, operatorIds, ssvClusterA, 1000, proofs1[clusterIdA],
        )).wait(),
        Events.CLUSTER_BALANCE_UPDATED,
      );
      let clusterB = parseClusterFromEvent(
        newNetwork,
        await (await newNetwork.connect(clusterOwnerB).updateClusterBalance(
          blockNum1, clusterOwnerB.address, operatorIds, ssvClusterB, 1000, proofs1[clusterIdB],
        )).wait(),
        Events.CLUSTER_BALANCE_UPDATED,
      );

      const clusterAfterRemoveA = parseClusterFromEvent(
        newNetwork,
        await (await newNetwork.connect(clusterOwner).bulkRemoveValidator(keysA, operatorIds, clusterA)).wait(),
        Events.VALIDATOR_REMOVED,
      );
      expect(clusterAfterRemoveA.validatorCount).to.equal(0n);

      await mineBlocks(connection.ethers.provider, 1);
      const blockNum2 = await getBlockNumber(connection.ethers.provider);
      const root2 = computeEBRoot(clusterIdB, 160);
      await commitEBRoot(newNetwork, root2, blockNum2, [oracle1, oracle2, oracle3]);
      clusterB = parseClusterFromEvent(
        newNetwork,
        await (await newNetwork.connect(clusterOwnerB).updateClusterBalance(
          blockNum2, clusterOwnerB.address, operatorIds, clusterB, 160, [],
        )).wait(),
        Events.CLUSTER_BALANCE_UPDATED,
      );

      const clusterAfterRemoveB = parseClusterFromEvent(
        newNetwork,
        await (await newNetwork.connect(clusterOwnerB).bulkRemoveValidator(keysB, operatorIds, clusterB)).wait(),
        Events.VALIDATOR_REMOVED,
      );
      expect(clusterAfterRemoveB.validatorCount).to.equal(0n);

      const clusterAfterMigrateA = parseClusterFromEvent(
        newNetwork,
        await (await newNetwork.connect(clusterOwner).migrateClusterToETH(
          operatorIds, clusterAfterRemoveA, { value: DEFAULT_ETH_REGISTER_VALUE },
        )).wait(),
        Events.CLUSTER_MIGRATED_TO_ETH,
      );
      const clusterAfterMigrateB = parseClusterFromEvent(
        newNetwork,
        await (await newNetwork.connect(clusterOwnerB).migrateClusterToETH(
          operatorIds, clusterAfterRemoveB, { value: DEFAULT_ETH_REGISTER_VALUE },
        )).wait(),
        Events.CLUSTER_MIGRATED_TO_ETH,
      );

      expect(await newViews.getEffectiveBalance(clusterOwner.address, operatorIds, clusterAfterMigrateA)).to.equal(0);
      expect(await newViews.getEffectiveBalance(clusterOwnerB.address, operatorIds, clusterAfterMigrateB)).to.equal(0);
      expect(await newViews.getBurnRate(clusterOwner.address, operatorIds, clusterAfterMigrateA)).to.equal(0);
      expect(await newViews.getBurnRate(clusterOwnerB.address, operatorIds, clusterAfterMigrateB)).to.equal(0);

      const earningsBefore = await Promise.all(operatorIds.map((id) => newViews.getOperatorEarnings(id)));
      await mineBlocks(connection.ethers.provider, 20);
      const earningsAfter = await Promise.all(operatorIds.map((id) => newViews.getOperatorEarnings(id)));
      for (let i = 0; i < operatorIds.length; i++) {
        expect(earningsAfter[i]).to.equal(earningsBefore[i]);
      }
    });
  });

  describe("Shared-operator leakage regression", () => {
    const deployHarnessFixture = async () =>
      ssvClustersHarnessFixture(connection, 4, MINIMAL_OPERATOR_ETH_FEE);

    it("stale SSV clusterEB vUnits do not inject phantom deviation into shared operator pool after empty-cluster migration", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployHarnessFixture);
      const [, , clusterOwnerB] = await connection.ethers.getSigners();

      const keyA = makePublicKey(900);
      const ssvCluster = createLegacySSVCluster({ validatorCount: 1n, balance: 0n });
      await clusters.mockRegisterSSVValidator(keyA, operatorIds, clusterOwner.address, ssvCluster);

      const clusterIdA = computeClusterId(clusterOwner.address, operatorIds);
      await clusters.mockSetClusterVUnits(clusterIdA, 640_000n);

      const removeTx = await clusters
        .connect(clusterOwner)
        .removeValidator(keyA, operatorIds, ssvCluster);
      const clusterAfterRemove = parseClusterFromEvent(
        clusters,
        await removeTx.wait(),
        Events.VALIDATOR_REMOVED,
      );
      expect(clusterAfterRemove.validatorCount).to.equal(0n);
      expect(await clusters.getClusterVUnits(clusterIdA)).to.equal(0n);

      await clusters
        .connect(clusterOwner)
        .migrateClusterToETH(operatorIds, clusterAfterRemove, { value: 0 });

      for (const op of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(op)).to.equal(0n);
      }

      await clusters.connect(clusterOwnerB).registerValidator(
        makePublicKey(901),
        operatorIds,
        DEFAULT_SHARES,
        createCluster(),
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      expect(await clusters.getDaoTotalEthVUnits()).to.equal(BPS_DENOMINATOR);
      for (const op of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(op)).to.equal(0n);
        expect(await clusters.getEffectiveOperatorVUnits(op)).to.equal(BPS_DENOMINATOR);
      }
    });
  });
});

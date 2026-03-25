import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvClustersHarnessFixture, ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { Cluster } from "../../common/types.ts";
import {
  makePublicKey,
  parseClusterFromEvent,
  registerOperators,
  setupTestContext,
  whitelistAddresses,
} from "../../common/helpers.ts";
import {
  BPS_DENOMINATOR,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_NETWORK_FEE_RAW,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  OP_ETH_FEE_RAW,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import {
  calcClusterBurn,
  calcVUnits,
  commitEBRoot,
  computeClusterId,
  computeEBRoot,
  defaultVUnits,
  getBlockNumber,
  mineBlocks,
  setupOracles,
} from "../../helpers/index.ts";

const CLUSTER_SIZES = [4, 7, 10, 13] as const;
const FEE_ACCRUAL_SIZES = [7, 10, 13] as const;
const EB_SIZES = [7, 13] as const;
const OPERATOR_FEE_UNPACKED = 10_000_000_000n;
const EXPLICIT_EB_64_VUNITS = calcVUnits(64n);
const EXPLICIT_EB_128_VUNITS = calcVUnits(128n);
const EXPLICIT_EB_DEVIATION_64 = EXPLICIT_EB_64_VUNITS - BPS_DENOMINATOR;
const EXPLICIT_EB_DEVIATION_128 = EXPLICIT_EB_128_VUNITS - BPS_DENOMINATOR;

describe("TEST-35: vUnits cluster-size variants", () => {
  let connection: NetworkConnection<"generic">;
  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let liquidator: HardhatEthersSigner;
  let oracle1: HardhatEthersSigner;
  let oracle2: HardhatEthersSigner;
  let oracle3: HardhatEthersSigner;
  let oracle4: HardhatEthersSigner;
  let staker: HardhatEthersSigner;
  let extraClusterOwner1: HardhatEthersSigner;
  let extraClusterOwner2: HardhatEthersSigner;
  let extraClusterOwner3: HardhatEthersSigner;

  before(async function () {
    ({
      connection,
      signers: [
        operatorOwner,
        clusterOwner,
        liquidator,
        oracle1,
        oracle2,
        oracle3,
        oracle4,
        staker,
        extraClusterOwner1,
        extraClusterOwner2,
        extraClusterOwner3,
      ],
    } = await setupTestContext());
  });

  async function deployFullNetworkFixture(operatorCount: number) {
    const { network, views, ssvToken } = await ssvNetworkFullFixture(connection);
    await network.updateNetworkFee(DEFAULT_NETWORK_FEE_RAW * 100_000n);

    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

    const operatorIds = await registerOperators(network, operatorOwner, operatorCount);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

    return { network, views, operatorIds };
  }

  async function registerSingleValidator(network: any, operatorIds: number[]) {
    const tx = await network.connect(clusterOwner).registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE },
    );
    const receipt = await tx.wait();
    return {
      cluster: parseClusterFromEvent(network, receipt, Events.VALIDATOR_ADDED),
      blockNumber: BigInt(receipt.blockNumber),
    };
  }

  async function updateClusterEBOnNetwork(
    network: any,
    operatorIds: number[],
    cluster: Cluster,
    effectiveBalance: number,
  ): Promise<{ cluster: Cluster; blockNumber: bigint }> {
    const provider = connection.ethers.provider;
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const root = computeEBRoot(clusterId, effectiveBalance);

    await mineBlocks(provider, 1);
    const rootBlockNum = await getBlockNumber(provider);
    await commitEBRoot(network, root, rootBlockNum, [oracle1, oracle2, oracle3]);

    const tx = await network.connect(clusterOwner).updateClusterBalance(
      rootBlockNum,
      clusterOwner.address,
      operatorIds,
      cluster,
      effectiveBalance,
      [],
    );
    const receipt = await tx.wait();
    return {
      cluster: parseClusterFromEvent(network, receipt, Events.CLUSTER_BALANCE_UPDATED),
      blockNumber: BigInt(receipt.blockNumber),
    };
  }

  async function setHarnessProtocolParams(clusters: any) {
    await clusters.mockEthNetworkFee(DEFAULT_NETWORK_FEE_RAW);
    await clusters.mockMinimumBlocksBeforeLiquidation(10n);
    await clusters.mockMinimumLiquidationCollateral(0n);
  }

  async function updateClusterEBOnHarness(
    clusters: any,
    ownerAddress: string,
    operatorIds: bigint[],
    cluster: Cluster,
    effectiveBalance: number,
    blockNum: number,
  ): Promise<{ cluster: Cluster; blockNumber: bigint }> {
    const clusterId = computeClusterId(ownerAddress, operatorIds);
    const root = computeEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(blockNum, root);
    const tx = await clusters.updateClusterBalance(
      blockNum,
      ownerAddress,
      operatorIds,
      cluster,
      effectiveBalance,
      [],
    );
    const receipt = await tx.wait();
    return {
      cluster: parseClusterFromEvent(clusters, receipt, Events.CLUSTER_BALANCE_UPDATED),
      blockNumber: BigInt(receipt.blockNumber),
    };
  }

  async function assertAllOperatorDeviation(clusters: any, operatorIds: bigint[], expectedDeviation: bigint) {
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(expectedDeviation);
    }
  }

  async function assertRemovedAndSurvivorDeviation(
    clusters: any,
    operatorIds: bigint[],
    removedCount: number,
    survivorDeviation: bigint,
  ) {
    for (const operatorId of operatorIds.slice(0, removedCount)) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
    for (const operatorId of operatorIds.slice(removedCount)) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(survivorDeviation);
    }
  }

  describe("CS-01/02/03: fee accrual across sizes", () => {
    for (const operatorCount of FEE_ACCRUAL_SIZES) {
      it(`CS-${operatorCount === 7 ? "01" : operatorCount === 10 ? "02" : "03"}: exact burn for ${operatorCount} operators`, async function () {
        const { network, views, operatorIds } = await deployFullNetworkFixture(operatorCount);
        const provider = connection.ethers.provider;

        const { cluster, blockNumber: registerBlock } = await registerSingleValidator(network, operatorIds);

        const blocksToMine = 37;
        await mineBlocks(provider, blocksToMine);
        const currentBlock = BigInt(await getBlockNumber(provider));
        const blockDiff = currentBlock - registerBlock;

        const expectedBurn = calcClusterBurn({
          blockDiff,
          numOperators: BigInt(operatorCount),
          ethFee: OP_ETH_FEE_RAW,
          networkFee: DEFAULT_NETWORK_FEE_RAW,
          effectiveVUnits: defaultVUnits(1n),
        });

        expect(await views.getBalance(clusterOwner.address, operatorIds, cluster)).to.equal(
          cluster.balance - expectedBurn,
        );
      });
    }
  });

  describe("CS-04/05/06/07/08: EB distribution and transitions", () => {
    it("CS-04: 13 operators get ethValidatorCount == 1 on registration", async function () {
      const { network, views, operatorIds } = await deployFullNetworkFixture(13);
      await registerSingleValidator(network, operatorIds);

      for (const operatorId of operatorIds) {
        const op = await views.getOperatorById(BigInt(operatorId)) as any;
        expect(BigInt(op.validatorCount)).to.equal(1n);
      }
    });

    for (const operatorCount of EB_SIZES) {
      it(`CS-${operatorCount === 7 ? "05" : "06"}: EB=64 deviation distributed to all ${operatorCount} operators`, async function () {
        const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, operatorCount, OPERATOR_FEE_UNPACKED);
        await setHarnessProtocolParams(clusters);

        const registerTx = await clusters.connect(clusterOwner).registerValidator(
          makePublicKey(1),
          operatorIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        );
        const clusterAfterRegister = parseClusterFromEvent(clusters, await registerTx.wait(), Events.VALIDATOR_ADDED);

        const { cluster: clusterAfterEB64 } = await updateClusterEBOnHarness(
          clusters,
          clusterOwner.address,
          operatorIds,
          clusterAfterRegister,
          64,
          1,
        );
        const clusterId = computeClusterId(clusterOwner.address, operatorIds);

        expect(clusterAfterEB64.active).to.equal(true);
        expect(await clusters.getClusterVUnits(clusterId)).to.equal(EXPLICIT_EB_64_VUNITS);
        await assertAllOperatorDeviation(clusters, operatorIds, EXPLICIT_EB_DEVIATION_64);
      });
    }

    it("CS-07: EB 64->32 on 7 operators settles at old rate, then clears deviations", async function () {
      const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, 7, OPERATOR_FEE_UNPACKED);
      await setHarnessProtocolParams(clusters);

      const ethFeeRaw = BigInt(await clusters.getOperatorEthFee(operatorIds[0]));

      const registerTx = await clusters.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const clusterAfterRegister = parseClusterFromEvent(clusters, await registerTx.wait(), Events.VALIDATOR_ADDED);
      const { cluster: clusterAfterEB64, blockNumber: eb64Block } = await updateClusterEBOnHarness(
        clusters,
        clusterOwner.address,
        operatorIds,
        clusterAfterRegister,
        64,
        1,
      );

      await mineBlocks(connection.ethers.provider, 19);

      const { cluster: clusterAfterEB32, blockNumber: eb32Block } = await updateClusterEBOnHarness(
        clusters,
        clusterOwner.address,
        operatorIds,
        clusterAfterEB64,
        32,
        2,
      );

      const expectedBurnAtOldRate = calcClusterBurn({
        blockDiff: eb32Block - eb64Block,
        numOperators: 7n,
        ethFee: ethFeeRaw,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: EXPLICIT_EB_64_VUNITS,
      });

      expect(clusterAfterEB32.balance).to.equal(clusterAfterEB64.balance - expectedBurnAtOldRate);
      await assertAllOperatorDeviation(clusters, operatorIds, 0n);
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(BPS_DENOMINATOR);
    });

    it("CS-08: EB 64->128 on 13 operators settles at old rate, then increases deviations", async function () {
      const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, 13, OPERATOR_FEE_UNPACKED);
      await setHarnessProtocolParams(clusters);

      const ethFeeRaw = BigInt(await clusters.getOperatorEthFee(operatorIds[0]));

      const registerTx = await clusters.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const clusterAfterRegister = parseClusterFromEvent(clusters, await registerTx.wait(), Events.VALIDATOR_ADDED);
      const { cluster: clusterAfterEB64, blockNumber: eb64Block } = await updateClusterEBOnHarness(
        clusters,
        clusterOwner.address,
        operatorIds,
        clusterAfterRegister,
        64,
        1,
      );

      await mineBlocks(connection.ethers.provider, 23);

      const { cluster: clusterAfterEB128, blockNumber: eb128Block } = await updateClusterEBOnHarness(
        clusters,
        clusterOwner.address,
        operatorIds,
        clusterAfterEB64,
        128,
        2,
      );

      const expectedBurnAtOldRate = calcClusterBurn({
        blockDiff: eb128Block - eb64Block,
        numOperators: 13n,
        ethFee: ethFeeRaw,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: EXPLICIT_EB_64_VUNITS,
      });

      expect(clusterAfterEB128.balance).to.equal(clusterAfterEB64.balance - expectedBurnAtOldRate);
      await assertAllOperatorDeviation(clusters, operatorIds, EXPLICIT_EB_DEVIATION_128);
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(EXPLICIT_EB_128_VUNITS);
    });
  });

  describe("CS-20/21/22/23: liquidation and reactivation", () => {
    for (const operatorCount of EB_SIZES) {
      it(`CS-${operatorCount === 7 ? "20" : "21"}: liquidation and reactivation preserve EB=64 semantics for ${operatorCount} operators`, async function () {
        const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, operatorCount, OPERATOR_FEE_UNPACKED);
        await setHarnessProtocolParams(clusters);

        const registerTx = await clusters.connect(clusterOwner).registerValidator(
          makePublicKey(1),
          operatorIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: 5_000_000_000_000n },
        );
        const clusterAfterRegister = parseClusterFromEvent(clusters, await registerTx.wait(), Events.VALIDATOR_ADDED);
        const { cluster: clusterAfterEB64 } = await updateClusterEBOnHarness(
          clusters,
          clusterOwner.address,
          operatorIds,
          clusterAfterRegister,
          64,
          1,
        );

        await mineBlocks(connection.ethers.provider, 200);

        const liquidateTx = await clusters.connect(liquidator).liquidate(
          clusterOwner.address,
          operatorIds,
          clusterAfterEB64,
        );
        const clusterAfterLiquidation = parseClusterFromEvent(clusters, await liquidateTx.wait(), Events.CLUSTER_LIQUIDATED);
        expect(clusterAfterLiquidation.active).to.equal(false);
        await assertAllOperatorDeviation(clusters, operatorIds, 0n);
        expect(await clusters.getDaoTotalEthVUnits()).to.equal(0n);

        const reactivateTx = await clusters.connect(clusterOwner).reactivate(
          operatorIds,
          clusterAfterLiquidation,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        );
        const clusterAfterReactivation = parseClusterFromEvent(clusters, await reactivateTx.wait(), Events.CLUSTER_REACTIVATED);
        expect(clusterAfterReactivation.active).to.equal(true);
        await assertAllOperatorDeviation(clusters, operatorIds, EXPLICIT_EB_DEVIATION_64);
        expect(await clusters.getDaoTotalEthVUnits()).to.equal(EXPLICIT_EB_64_VUNITS);
      });
    }

    for (const [operatorCount, removeCount, caseId] of [[7, 2, "22"], [13, 6, "23"]] as const) {
      it(`CS-${caseId}: liquidation -> remove ${removeCount} operators -> reactivate restores only survivors (${operatorCount} operators)`, async function () {
        const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, operatorCount, OPERATOR_FEE_UNPACKED);
        await setHarnessProtocolParams(clusters);

        const registerTx = await clusters.connect(clusterOwner).registerValidator(
          makePublicKey(1),
          operatorIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: 5_000_000_000_000n },
        );
        const clusterAfterRegister = parseClusterFromEvent(clusters, await registerTx.wait(), Events.VALIDATOR_ADDED);
        const { cluster: clusterAfterEB64 } = await updateClusterEBOnHarness(
          clusters,
          clusterOwner.address,
          operatorIds,
          clusterAfterRegister,
          64,
          1,
        );

        await mineBlocks(connection.ethers.provider, 200);

        const liquidateTx = await clusters.connect(liquidator).liquidate(
          clusterOwner.address,
          operatorIds,
          clusterAfterEB64,
        );
        const clusterAfterLiquidation = parseClusterFromEvent(clusters, await liquidateTx.wait(), Events.CLUSTER_LIQUIDATED);
        expect(clusterAfterLiquidation.active).to.equal(false);

        for (const removedOperatorId of operatorIds.slice(0, removeCount)) {
          await clusters.mockRemoveOperator(removedOperatorId);
        }

        const reactivateTx = await clusters.connect(clusterOwner).reactivate(
          operatorIds,
          clusterAfterLiquidation,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        );
        const clusterAfterReactivation = parseClusterFromEvent(clusters, await reactivateTx.wait(), Events.CLUSTER_REACTIVATED);
        expect(clusterAfterReactivation.active).to.equal(true);
        await assertRemovedAndSurvivorDeviation(clusters, operatorIds, removeCount, EXPLICIT_EB_DEVIATION_64);
        expect(await clusters.getDaoTotalEthVUnits()).to.equal(EXPLICIT_EB_64_VUNITS);
      });
    }
  });

  describe("CS-26/27: migration with explicit EB snapshot", () => {
    for (const operatorCount of EB_SIZES) {
      it(`CS-${operatorCount === 7 ? "26" : "27"}: legacy cluster with EB=64 migrates for ${operatorCount} operators`, async function () {
        const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, operatorCount, OPERATOR_FEE_UNPACKED);
        await setHarnessProtocolParams(clusters);

        const ssvCluster: Cluster = {
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

        const { cluster: clusterAfterEB64 } = await updateClusterEBOnHarness(
          clusters,
          clusterOwner.address,
          operatorIds,
          ssvCluster,
          64,
          1,
        );

        const migrateTx = await clusters.connect(clusterOwner).migrateClusterToETH(
          operatorIds,
          clusterAfterEB64,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        );
        const migratedCluster = parseClusterFromEvent(clusters, await migrateTx.wait(), Events.CLUSTER_MIGRATED_TO_ETH);

        expect(migratedCluster.active).to.equal(true);
        expect(migratedCluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);
        await assertAllOperatorDeviation(clusters, operatorIds, EXPLICIT_EB_DEVIATION_64);
        expect(await clusters.getDaoTotalEthVUnits()).to.equal(EXPLICIT_EB_64_VUNITS);
      });
    }
  });

  describe("CS-33/34: DAO vUnits invariant across 4/7/10/13 sizes", () => {
    type ScenarioCluster = {
      owner: HardhatEthersSigner;
      operatorIds: bigint[];
      cluster: Cluster;
    };

    async function registerExplicitEB64Cluster(
      clusters: any,
      owner: HardhatEthersSigner,
      operatorIds: bigint[],
      pubkeyIndex: number,
      blockNum: number,
    ): Promise<ScenarioCluster> {
      const registerTx = await clusters.connect(owner).registerValidator(
        makePublicKey(pubkeyIndex),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: 5_000_000_000_000n },
      );
      const clusterAfterRegister = parseClusterFromEvent(clusters, await registerTx.wait(), Events.VALIDATOR_ADDED);

      const clusterId = computeClusterId(owner.address, operatorIds);
      const root = computeEBRoot(clusterId, 64);
      await clusters.mockSetEBRoot(blockNum, root);
      const updateTx = await clusters.connect(owner).updateClusterBalance(
        blockNum,
        owner.address,
        operatorIds,
        clusterAfterRegister,
        64,
        [],
      );
      const clusterAfterUpdate = parseClusterFromEvent(clusters, await updateTx.wait(), Events.CLUSTER_BALANCE_UPDATED);

      return { owner, operatorIds, cluster: clusterAfterUpdate };
    }

    async function prepareCrossSizeClusters() {
      const { clusters, operatorIds: allOperators } = await ssvClustersHarnessFixture(connection, 13, OPERATOR_FEE_UNPACKED);
      await setHarnessProtocolParams(clusters);

      const op4 = allOperators.slice(0, 4);
      const op7 = allOperators.slice(0, 7);
      const op10 = allOperators.slice(0, 10);
      const op13 = allOperators.slice(0, 13);

      const prepared = [
        await registerExplicitEB64Cluster(clusters, clusterOwner, op4, 1, 1),
        await registerExplicitEB64Cluster(clusters, extraClusterOwner1, op7, 2, 2),
        await registerExplicitEB64Cluster(clusters, extraClusterOwner2, op10, 3, 3),
        await registerExplicitEB64Cluster(clusters, extraClusterOwner3, op13, 4, 4),
      ];

      return { clusters, prepared };
    }

    it("CS-33: all 4/7/10/13 clusters at EB=64 liquidate to daoTotalEthVUnits == 0", async function () {
      const { clusters, prepared } = await prepareCrossSizeClusters();
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(EXPLICIT_EB_64_VUNITS * 4n);

      await mineBlocks(connection.ethers.provider, 250);

      for (const item of prepared) {
        const tx = await clusters.connect(liquidator).liquidate(item.owner.address, item.operatorIds, item.cluster);
        await tx.wait();
      }

      expect(await clusters.getDaoTotalEthVUnits()).to.equal(0n);
    });

    it("CS-34: remove one operator per cluster before liquidation and keep daoTotalEthVUnits invariant", async function () {
      const { clusters, prepared } = await prepareCrossSizeClusters();
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(EXPLICIT_EB_64_VUNITS * 4n);

      const removedOperators = [
        prepared[0].operatorIds[3],
        prepared[1].operatorIds[6],
        prepared[2].operatorIds[9],
        prepared[3].operatorIds[12],
      ];
      for (const opId of removedOperators) {
        await clusters.mockRemoveOperator(opId);
      }

      await mineBlocks(connection.ethers.provider, 250);

      for (const item of prepared) {
        const tx = await clusters.connect(liquidator).liquidate(item.owner.address, item.operatorIds, item.cluster);
        await tx.wait();
      }

      expect(await clusters.getDaoTotalEthVUnits()).to.equal(0n);
    });
  });

  it("sanity: cluster size constants are kept in canonical order", async function () {
    expect(CLUSTER_SIZES).to.deep.equal([4, 7, 10, 13]);
  });
});

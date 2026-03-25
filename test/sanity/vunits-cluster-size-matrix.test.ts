import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvClustersHarnessFixture } from "../setup/fixtures.ts";
import type { NetworkHelpersType } from "../common/types.ts";
import {
  setupTestContext,
  computeClusterId,
  computeEBRoot,
  createCluster,
  makePublicKey,
  parseClusterFromEvent,
} from "../common/helpers.ts";
import { DEFAULT_SHARES, DEFAULT_ETH_REGISTER_VALUE, BPS_DENOMINATOR, ETH_DEDUCTED_DIGITS } from "../common/constants.ts";
import { Events } from "../common/events.ts";
import { calcClusterBurn, defaultVUnits } from "../helpers/index.ts";

const OPERATOR_FEE_RAW = 100_000n;
const OPERATOR_FEE_WEI = OPERATOR_FEE_RAW * ETH_DEDUCTED_DIGITS;

describe("vUnits cluster-size matrix coverage", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let ownerA: HardhatEthersSigner;
  let ownerB: HardhatEthersSigner;
  let ownerC: HardhatEthersSigner;
  let ownerD: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await setupTestContext());
    [ownerA, ownerB, ownerC, ownerD] = await connection.ethers.getSigners();
  });

  const deployWith13Operators = async () => ssvClustersHarnessFixture(connection, 13, OPERATOR_FEE_WEI);

  const ops = (operatorIds: bigint[], size: 4 | 7 | 10 | 13) => operatorIds.slice(0, size);

  async function registerSingleValidator(
    clusters: any,
    owner: HardhatEthersSigner,
    operatorIds: bigint[],
    publicKeySeed: number,
    cluster = createCluster(),
    depositValue = DEFAULT_ETH_REGISTER_VALUE,
  ) {
    const tx = await clusters.connect(owner).registerValidator(
      makePublicKey(publicKeySeed),
      operatorIds,
      DEFAULT_SHARES,
      cluster,
      { value: depositValue }
    );
    return parseClusterFromEvent(clusters, await tx.wait(), Events.VALIDATOR_ADDED);
  }

  async function updateEB(
    clusters: any,
    owner: HardhatEthersSigner,
    operatorIds: bigint[],
    cluster: any,
    effectiveBalance: number,
    blockNum: number,
  ) {
    const clusterId = computeClusterId(owner.address, operatorIds);
    await clusters.mockSetEBRoot(blockNum, computeEBRoot(clusterId, effectiveBalance));
    const tx = await clusters.connect(owner).updateClusterBalance(
      blockNum,
      owner.address,
      operatorIds,
      cluster,
      effectiveBalance,
      []
    );
    return parseClusterFromEvent(clusters, await tx.wait(), Events.CLUSTER_BALANCE_UPDATED);
  }

  it("fee accrual scales with 7/10/13 operators", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWith13Operators);
    await clusters.mockEthNetworkFee(0n);

    for (const size of [7, 10, 13] as const) {
      const operatorSet = ops(operatorIds, size);
      const regTx = await clusters.connect(ownerA).registerValidator(
        makePublicKey(1000 + size),
        operatorSet,
        DEFAULT_SHARES,
        createCluster(),
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const regReceipt = await regTx.wait();
      const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);
      const regBlock = BigInt(regReceipt!.blockNumber);

      await networkHelpers.mine(12);
      const withdrawTx = await clusters.connect(ownerA).withdraw(operatorSet, 0n, clusterAfterReg);
      const withdrawReceipt = await withdrawTx.wait();
      const withdrawBlock = BigInt(withdrawReceipt!.blockNumber);
      const clusterAfterWithdraw = parseClusterFromEvent(clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

      const expectedBurn = calcClusterBurn({
        blockDiff: withdrawBlock - regBlock,
        numOperators: BigInt(size),
        ethFee: OPERATOR_FEE_RAW,
        networkFee: 0n,
        effectiveVUnits: defaultVUnits(1n),
      });

      expect(clusterAfterReg.balance - clusterAfterWithdraw.balance).to.equal(expectedBurn);
    }
  });

  it("per-operator counts and EB=64 deviation distribution are exact for 7/13 operators", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWith13Operators);
    await clusters.mockEthNetworkFee(0n);

    const operatorSet13 = ops(operatorIds, 13);
    const cluster13 = await registerSingleValidator(clusters, ownerA, operatorSet13, 2013);
    for (const operatorId of operatorSet13) {
      expect(await clusters.getOperatorEthValidatorCount(operatorId)).to.equal(1n);
    }

    const operatorSet7 = ops(operatorIds, 7);
    const cluster7 = await registerSingleValidator(clusters, ownerB, operatorSet7, 2007);

    await updateEB(clusters, ownerB, operatorSet7, cluster7, 64, 1);
    await updateEB(clusters, ownerA, operatorSet13, cluster13, 64, 2);

    for (const operatorId of operatorSet7) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(20000n);
    }
    for (const operatorId of operatorSet13.slice(7)) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(10000n);
    }
  });

  it("EB transitions on 7/13 operators apply exact per-operator deltas", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWith13Operators);
    await clusters.mockEthNetworkFee(0n);

    const operatorSet7 = ops(operatorIds, 7);
    const cluster7 = await registerSingleValidator(clusters, ownerA, operatorSet7, 3007);
    const cluster7After64 = await updateEB(clusters, ownerA, operatorSet7, cluster7, 64, 1);
    await updateEB(clusters, ownerA, operatorSet7, cluster7After64, 32, 2);
    for (const operatorId of operatorSet7) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }

    const operatorSet13 = ops(operatorIds, 13);
    const cluster13 = await registerSingleValidator(clusters, ownerB, operatorSet13, 3013);
    const cluster13After64 = await updateEB(clusters, ownerB, operatorSet13, cluster13, 64, 3);
    await updateEB(clusters, ownerB, operatorSet13, cluster13After64, 128, 4);
    for (const operatorId of operatorSet13) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(30000n);
    }
  });

  it("explicit-EB liquidation/reactivation restores deviations for 7/13 operators", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWith13Operators);
    await clusters.mockEthNetworkFee(0n);
    await clusters.mockMinimumBlocksBeforeLiquidation(1n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    const operatorSet7 = ops(operatorIds, 7);
    const cluster7 = await registerSingleValidator(clusters, ownerA, operatorSet7, 4007);
    const cluster7After64 = await updateEB(clusters, ownerA, operatorSet7, cluster7, 64, 1);
    const liqTx7 = await clusters.connect(ownerA).liquidate(ownerA.address, operatorSet7, cluster7After64);
    const liqCluster7 = parseClusterFromEvent(clusters, await liqTx7.wait(), Events.CLUSTER_LIQUIDATED);
    await clusters.connect(ownerA).reactivate(operatorSet7, liqCluster7, { value: DEFAULT_ETH_REGISTER_VALUE });
    for (const operatorId of operatorSet7) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(10000n);
    }

    const { clusters: clusters2, operatorIds: operatorIds2 } = await networkHelpers.loadFixture(deployWith13Operators);
    await clusters2.mockEthNetworkFee(0n);
    await clusters2.mockMinimumBlocksBeforeLiquidation(1n);
    await clusters2.mockMinimumLiquidationCollateral(0n);
    const operatorSet13 = ops(operatorIds2, 13);
    const cluster13 = await registerSingleValidator(clusters2, ownerB, operatorSet13, 4013);
    const cluster13After64 = await updateEB(clusters2, ownerB, operatorSet13, cluster13, 64, 1);
    const liqTx13 = await clusters2.connect(ownerB).liquidate(ownerB.address, operatorSet13, cluster13After64);
    const liqCluster13 = parseClusterFromEvent(clusters2, await liqTx13.wait(), Events.CLUSTER_LIQUIDATED);
    await clusters2.connect(ownerB).reactivate(operatorSet13, liqCluster13, { value: DEFAULT_ETH_REGISTER_VALUE });
    for (const operatorId of operatorSet13) {
      expect(await clusters2.getOperatorEthVUnits(operatorId)).to.equal(10000n);
    }
  });

  it("post-liquidation operator removals are skipped on reactivation for 7/13 operators", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWith13Operators);
    await clusters.mockEthNetworkFee(0n);
    await clusters.mockMinimumBlocksBeforeLiquidation(1n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    const operatorSet7 = ops(operatorIds, 7);
    const cluster7 = await registerSingleValidator(clusters, ownerA, operatorSet7, 5007);
    const cluster7After64 = await updateEB(clusters, ownerA, operatorSet7, cluster7, 64, 1);
    const liqTx7 = await clusters.connect(ownerA).liquidate(ownerA.address, operatorSet7, cluster7After64);
    const liqCluster7 = parseClusterFromEvent(clusters, await liqTx7.wait(), Events.CLUSTER_LIQUIDATED);
    await clusters.mockRemoveOperator(operatorSet7[0]);
    await clusters.mockRemoveOperator(operatorSet7[1]);
    await clusters.connect(ownerA).reactivate(operatorSet7, liqCluster7, { value: DEFAULT_ETH_REGISTER_VALUE });
    expect(await clusters.getOperatorEthVUnits(operatorSet7[0])).to.equal(0n);
    expect(await clusters.getOperatorEthVUnits(operatorSet7[1])).to.equal(0n);

    const { clusters: clusters2, operatorIds: operatorIds2 } = await networkHelpers.loadFixture(deployWith13Operators);
    await clusters2.mockEthNetworkFee(0n);
    await clusters2.mockMinimumBlocksBeforeLiquidation(1n);
    await clusters2.mockMinimumLiquidationCollateral(0n);
    const operatorSet13 = ops(operatorIds2, 13);
    const cluster13 = await registerSingleValidator(clusters2, ownerB, operatorSet13, 5013);
    const cluster13After64 = await updateEB(clusters2, ownerB, operatorSet13, cluster13, 64, 1);
    const liqTx13 = await clusters2.connect(ownerB).liquidate(ownerB.address, operatorSet13, cluster13After64);
    const liqCluster13 = parseClusterFromEvent(clusters2, await liqTx13.wait(), Events.CLUSTER_LIQUIDATED);
    for (const removedId of operatorSet13.slice(0, 6)) {
      await clusters2.mockRemoveOperator(removedId);
    }
    await clusters2.connect(ownerB).reactivate(operatorSet13, liqCluster13, { value: DEFAULT_ETH_REGISTER_VALUE });
    for (const removedId of operatorSet13.slice(0, 6)) {
      expect(await clusters2.getOperatorEthVUnits(removedId)).to.equal(0n);
    }
  });

  it("migration with explicit EB=64 works for 7/13 operators", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWith13Operators);
    await clusters.mockEthNetworkFee(0n);

    const ssvCluster = {
      validatorCount: 1n,
      networkFeeIndex: 0n,
      index: 0n,
      balance: 0n,
      active: true,
    };

    const operatorSet7 = ops(operatorIds, 7);
    await clusters.mockRegisterSSVValidator(makePublicKey(6007), operatorSet7, ownerA.address, ssvCluster);
    const clusterId7 = computeClusterId(ownerA.address, operatorSet7);
    await clusters.mockSetClusterVUnits(clusterId7, 20000n);
    await clusters.connect(ownerA).migrateClusterToETH(operatorSet7, ssvCluster, { value: DEFAULT_ETH_REGISTER_VALUE });
    for (const operatorId of operatorSet7) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(10000n);
    }

    const { clusters: clusters2, operatorIds: operatorIds2 } = await networkHelpers.loadFixture(deployWith13Operators);
    await clusters2.mockEthNetworkFee(0n);
    const operatorSet13 = ops(operatorIds2, 13);
    await clusters2.mockRegisterSSVValidator(makePublicKey(6013), operatorSet13, ownerB.address, ssvCluster);
    const clusterId13 = computeClusterId(ownerB.address, operatorSet13);
    await clusters2.mockSetClusterVUnits(clusterId13, 20000n);
    await clusters2.connect(ownerB).migrateClusterToETH(operatorSet13, ssvCluster, { value: DEFAULT_ETH_REGISTER_VALUE });
    for (const operatorId of operatorSet13) {
      expect(await clusters2.getOperatorEthVUnits(operatorId)).to.equal(10000n);
    }
  });

  it("mixed-size shared-operator interactions keep per-cluster accounting isolated", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWith13Operators);
    await clusters.mockEthNetworkFee(0n);
    await clusters.mockMinimumBlocksBeforeLiquidation(1n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    const operatorSet4 = ops(operatorIds, 4);
    const operatorSet7 = ops(operatorIds, 7);
    const operatorSet13 = ops(operatorIds, 13);

    const cluster4 = await registerSingleValidator(clusters, ownerA, operatorSet4, 7004);
    const cluster13 = await registerSingleValidator(clusters, ownerB, operatorSet13, 7013);
    const cluster7 = await registerSingleValidator(clusters, ownerC, operatorSet7, 7007);
    const cluster7ForLiquidation = await registerSingleValidator(clusters, ownerD, operatorSet7, 7107);
    const cluster4After64 = await updateEB(clusters, ownerA, operatorSet4, cluster4, 64, 1);
    const cluster13After64 = await updateEB(clusters, ownerB, operatorSet13, cluster13, 64, 2);
    const cluster7After128 = await updateEB(clusters, ownerC, operatorSet7, cluster7, 128, 3);
    const cluster7ForLiquidationAfter64 = await updateEB(clusters, ownerD, operatorSet7, cluster7ForLiquidation, 64, 4);

    await clusters.mockRemoveOperator(operatorSet4[0]);
    expect(await clusters.getOperatorEthVUnits(operatorSet4[1])).to.be.greaterThan(10000n);
    expect(await clusters.getOperatorEthVUnits(operatorSet13[12])).to.equal(10000n);

    await clusters.connect(ownerA).liquidate(ownerA.address, operatorSet4, cluster4After64);
    for (const operatorId of operatorSet7.slice(1)) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.be.greaterThanOrEqual(30000n);
    }

    await clusters.connect(ownerD).liquidate(ownerD.address, operatorSet7, cluster7ForLiquidationAfter64);
    await clusters.connect(ownerB).liquidate(ownerB.address, operatorSet13, cluster13After64);
    await clusters.connect(ownerC).liquidate(ownerC.address, operatorSet7, cluster7After128);
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(0n);
  });

  it("DAO invariant holds across 4/7/10/13 clusters with and without removals", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWith13Operators);
    await clusters.mockEthNetworkFee(0n);
    await clusters.mockMinimumBlocksBeforeLiquidation(1n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    const operatorSet4 = ops(operatorIds, 4);
    const operatorSet7 = ops(operatorIds, 7);
    const operatorSet10 = ops(operatorIds, 10);
    const operatorSet13 = ops(operatorIds, 13);

    const cluster4 = await updateEB(
      clusters,
      ownerA,
      operatorSet4,
      await registerSingleValidator(clusters, ownerA, operatorSet4, 8004),
      64,
      1
    );
    const cluster7 = await updateEB(
      clusters,
      ownerB,
      operatorSet7,
      await registerSingleValidator(clusters, ownerB, operatorSet7, 8007),
      64,
      2
    );
    const cluster10 = await updateEB(
      clusters,
      ownerC,
      operatorSet10,
      await registerSingleValidator(clusters, ownerC, operatorSet10, 8010),
      64,
      3
    );
    const cluster13 = await updateEB(
      clusters,
      ownerD,
      operatorSet13,
      await registerSingleValidator(clusters, ownerD, operatorSet13, 8013),
      64,
      4
    );

    expect(await clusters.getDaoTotalEthVUnits()).to.equal(80000n);

    await clusters.connect(ownerA).liquidate(ownerA.address, operatorSet4, cluster4);
    await clusters.connect(ownerB).liquidate(ownerB.address, operatorSet7, cluster7);
    await clusters.connect(ownerC).liquidate(ownerC.address, operatorSet10, cluster10);
    await clusters.connect(ownerD).liquidate(ownerD.address, operatorSet13, cluster13);
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(0n);

    const { clusters: clusters2, operatorIds: operatorIds2 } = await networkHelpers.loadFixture(deployWith13Operators);
    await clusters2.mockEthNetworkFee(0n);
    await clusters2.mockMinimumBlocksBeforeLiquidation(1n);
    await clusters2.mockMinimumLiquidationCollateral(0n);

    const operatorSet4b = ops(operatorIds2, 4);
    const operatorSet7b = ops(operatorIds2, 7);
    const operatorSet10b = ops(operatorIds2, 10);
    const operatorSet13b = ops(operatorIds2, 13);

    const cluster4b = await updateEB(
      clusters2,
      ownerA,
      operatorSet4b,
      await registerSingleValidator(clusters2, ownerA, operatorSet4b, 8104),
      64,
      1
    );
    const cluster7b = await updateEB(
      clusters2,
      ownerB,
      operatorSet7b,
      await registerSingleValidator(clusters2, ownerB, operatorSet7b, 8107),
      64,
      2
    );
    const cluster10b = await updateEB(
      clusters2,
      ownerC,
      operatorSet10b,
      await registerSingleValidator(clusters2, ownerC, operatorSet10b, 8110),
      64,
      3
    );
    const cluster13b = await updateEB(
      clusters2,
      ownerD,
      operatorSet13b,
      await registerSingleValidator(clusters2, ownerD, operatorSet13b, 8113),
      64,
      4
    );

    await clusters2.mockRemoveOperator(operatorSet4b[0]);
    await clusters2.mockRemoveOperator(operatorSet7b[4]);
    await clusters2.mockRemoveOperator(operatorSet10b[7]);
    await clusters2.mockRemoveOperator(operatorSet13b[10]);

    await clusters2.connect(ownerA).liquidate(ownerA.address, operatorSet4b, cluster4b);
    await clusters2.connect(ownerB).liquidate(ownerB.address, operatorSet7b, cluster7b);
    await clusters2.connect(ownerC).liquidate(ownerC.address, operatorSet10b, cluster10b);
    await clusters2.connect(ownerD).liquidate(ownerD.address, operatorSet13b, cluster13b);

    expect(await clusters2.getDaoTotalEthVUnits()).to.equal(0n);
  });
});

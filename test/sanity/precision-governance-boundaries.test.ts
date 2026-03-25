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
import { Errors } from "../common/errors.ts";
import { calcClusterBurn } from "../helpers/index.ts";

const OPERATOR_FEE_RAW = 100_000n;
const OPERATOR_FEE_WEI = OPERATOR_FEE_RAW * ETH_DEDUCTED_DIGITS;

describe("precision and governance boundaries", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;
  let liquidator: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner, liquidator] } = await setupTestContext());
  });

  const deployWithFee = async () => ssvClustersHarnessFixture(connection, 4, OPERATOR_FEE_WEI);
  const deployWithZeroFee = async () => ssvClustersHarnessFixture(connection, 4, 0n);

  async function registerOne(clusters: any, operatorIds: bigint[], publicKeySeed: number) {
    const tx = await clusters.registerValidator(
      makePublicKey(publicKeySeed),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    return {
      cluster: parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED),
      block: BigInt(receipt!.blockNumber),
    };
  }

  async function registerMany(clusters: any, operatorIds: bigint[], count: number, firstSeed: number) {
    let cluster = createCluster();
    for (let i = 0; i < count; i++) {
      const tx = await clusters.registerValidator(
        makePublicKey(firstSeed + i),
        operatorIds,
        DEFAULT_SHARES,
        cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      cluster = parseClusterFromEvent(clusters, await tx.wait(), Events.VALIDATOR_ADDED);
    }
    return cluster;
  }

  async function updateEB(clusters: any, operatorIds: bigint[], cluster: any, effectiveBalance: number, blockNum: number) {
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    await clusters.mockSetEBRoot(blockNum, computeEBRoot(clusterId, effectiveBalance));
    const tx = await clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      cluster,
      effectiveBalance,
      []
    );
    const receipt = await tx.wait();
    return {
      cluster: parseClusterFromEvent(clusters, receipt, Events.CLUSTER_BALANCE_UPDATED),
      block: BigInt(receipt!.blockNumber),
    };
  }

  it("explicit EB=32 with removed operator liquidates without underflow", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWithFee);
    await clusters.mockEthNetworkFee(0n);
    await clusters.mockMinimumBlocksBeforeLiquidation(1n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    const { cluster } = await registerOne(clusters, operatorIds, 2001);
    const { cluster: clusterAfter32 } = await updateEB(clusters, operatorIds, cluster, 32, 1);
    await clusters.mockRemoveOperator(operatorIds[0]);

    await expect(
      clusters.liquidate(clusterOwner.address, operatorIds, clusterAfter32)
    ).to.emit(clusters, Events.CLUSTER_LIQUIDATED);
  });

  it("EB=33 lifecycle keeps exact minimal non-default vUnits", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWithFee);
    await clusters.mockEthNetworkFee(0n);

    const { cluster } = await registerOne(clusters, operatorIds, 2002);
    const { cluster: clusterAfter33, block: blockAfter33 } = await updateEB(clusters, operatorIds, cluster, 33, 1);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const expectedVUnits = (33n * BPS_DENOMINATOR + 31n) / 32n;
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedVUnits);

    await networkHelpers.mine(10);
    const withdrawTx = await clusters.withdraw(operatorIds, 0n, clusterAfter33);
    const withdrawReceipt = await withdrawTx.wait();
    const blockAfterWithdraw = BigInt(withdrawReceipt!.blockNumber);
    const clusterAfterWithdraw = parseClusterFromEvent(clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

    const expectedBurn = calcClusterBurn({
      blockDiff: blockAfterWithdraw - blockAfter33,
      numOperators: 4n,
      ethFee: OPERATOR_FEE_RAW,
      networkFee: 0n,
      effectiveVUnits: expectedVUnits,
    });
    expect(clusterAfter33.balance - clusterAfterWithdraw.balance).to.equal(expectedBurn);
  });

  it("same-EB update has zero vUnit delta", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWithFee);
    await clusters.mockEthNetworkFee(0n);
    await clusters.mockSetMinBlocksBetweenUpdates(1);

    const { cluster } = await registerOne(clusters, operatorIds, 2003);
    const { cluster: clusterAfter64 } = await updateEB(clusters, operatorIds, cluster, 64, 1);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const vUnitsBefore = await clusters.getClusterVUnits(clusterId);
    const opVUnitsBefore = await clusters.getOperatorEthVUnits(operatorIds[0]);
    await networkHelpers.mine(1);

    await updateEB(clusters, operatorIds, clusterAfter64, 64, 2);
    const vUnitsAfter = await clusters.getClusterVUnits(clusterId);
    const opVUnitsAfter = await clusters.getOperatorEthVUnits(operatorIds[0]);

    expect(vUnitsAfter).to.equal(vUnitsBefore);
    expect(opVUnitsAfter).to.equal(opVUnitsBefore);
  });

  it("governance parameter changes move explicit-EB liquidation boundaries deterministically", async function () {
    const { clusters: clustersFee, operatorIds: operatorIdsFee } = await networkHelpers.loadFixture(deployWithZeroFee);
    const { cluster: feeCluster } = await registerOne(clustersFee, operatorIdsFee, 2004);
    const { cluster: feeClusterAfter64 } = await updateEB(clustersFee, operatorIdsFee, feeCluster, 64, 1);
    await clustersFee.mockMinimumBlocksBeforeLiquidation(1n);
    await clustersFee.mockMinimumLiquidationCollateral(0n);
    await clustersFee.mockEthNetworkFee(1n);
    await expect(
      clustersFee.connect(liquidator).liquidate(clusterOwner.address, operatorIdsFee, feeClusterAfter64)
    ).to.be.revertedWithCustomError(clustersFee, Errors.CLUSTER_NOT_LIQUIDATABLE);
    await clustersFee.mockEthNetworkFee(1_000_000_000_000_000n);
    await expect(
      clustersFee.connect(liquidator).liquidate(clusterOwner.address, operatorIdsFee, feeClusterAfter64)
    ).to.emit(clustersFee, Events.CLUSTER_LIQUIDATED);

    const { clusters: clustersCollateral, operatorIds: operatorIdsCollateral } = await networkHelpers.loadFixture(deployWithZeroFee);
    const { cluster: collateralCluster } = await registerOne(clustersCollateral, operatorIdsCollateral, 2005);
    const { cluster: collateralClusterAfter64 } = await updateEB(clustersCollateral, operatorIdsCollateral, collateralCluster, 64, 1);
    await clustersCollateral.mockEthNetworkFee(0n);
    await clustersCollateral.mockMinimumBlocksBeforeLiquidation(1n);
    await clustersCollateral.mockMinimumLiquidationCollateral(collateralClusterAfter64.balance + 1n);
    await expect(
      clustersCollateral.connect(liquidator).liquidate(clusterOwner.address, operatorIdsCollateral, collateralClusterAfter64)
    ).to.emit(clustersCollateral, Events.CLUSTER_LIQUIDATED);

    const { clusters: clustersPeriod, operatorIds: operatorIdsPeriod } = await networkHelpers.loadFixture(deployWithZeroFee);
    const { cluster: periodCluster } = await registerOne(clustersPeriod, operatorIdsPeriod, 2006);
    const { cluster: periodClusterAfter64 } = await updateEB(clustersPeriod, operatorIdsPeriod, periodCluster, 64, 1);
    await clustersPeriod.mockEthNetworkFee(1_000_000_000_000_000n);
    await clustersPeriod.mockMinimumLiquidationCollateral(0n);
    await clustersPeriod.mockMinimumBlocksBeforeLiquidation(1_000_000_000n);
    await expect(
      clustersPeriod.connect(liquidator).liquidate(clusterOwner.address, operatorIdsPeriod, periodClusterAfter64)
    ).to.emit(clustersPeriod, Events.CLUSTER_LIQUIDATED);
  });

  it("maximum deviation decrease (2048 -> 32) after operator removal is safe and exact", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWithZeroFee);
    await clusters.mockEthNetworkFee(0n);

    const { cluster } = await registerOne(clusters, operatorIds, 2005);
    const { cluster: clusterAfter2048 } = await updateEB(clusters, operatorIds, cluster, 2048, 1);
    await clusters.mockRemoveOperator(operatorIds[0]);
    const { cluster: clusterAfter32 } = await updateEB(clusters, operatorIds, clusterAfter2048, 32, 2);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    expect(clusterAfter32.active).to.equal(true);
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(BPS_DENOMINATOR);
    expect(await clusters.getOperatorEthVUnits(operatorIds[0])).to.equal(0n);
    for (const operatorId of operatorIds.slice(1)) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
  });

  it("non-round vUnits accrual is exact across EB 33 -> 65 transition", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWithFee);
    await clusters.mockEthNetworkFee(0n);

    const { cluster } = await registerOne(clusters, operatorIds, 2006);
    const { cluster: clusterAfter33, block: blockAfter33 } = await updateEB(clusters, operatorIds, cluster, 33, 1);

    await networkHelpers.mine(10);
    const { cluster: clusterAfter65, block: blockAfter65 } = await updateEB(clusters, operatorIds, clusterAfter33, 65, 2);

    await networkHelpers.mine(10);
    const withdrawTx = await clusters.withdraw(operatorIds, 0n, clusterAfter65);
    const withdrawReceipt = await withdrawTx.wait();
    const blockAfterWithdraw = BigInt(withdrawReceipt!.blockNumber);
    const clusterAfterWithdraw = parseClusterFromEvent(clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

    const vUnits33 = (33n * BPS_DENOMINATOR + 31n) / 32n;
    const vUnits65 = (65n * BPS_DENOMINATOR + 31n) / 32n;
    const expectedBurn = calcClusterBurn({
      blockDiff: blockAfter65 - blockAfter33,
      numOperators: 4n,
      ethFee: OPERATOR_FEE_RAW,
      networkFee: 0n,
      effectiveVUnits: vUnits33,
    }) + calcClusterBurn({
      blockDiff: blockAfterWithdraw - blockAfter65,
      numOperators: 4n,
      ethFee: OPERATOR_FEE_RAW,
      networkFee: 0n,
      effectiveVUnits: vUnits65,
    });

    expect(clusterAfter33.balance - clusterAfterWithdraw.balance).to.equal(expectedBurn);
  });

  it("EB=225 with 7 validators yields exact per-operator rounded deviation", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWithZeroFee);
    await clusters.mockEthNetworkFee(0n);

    const clusterWithSevenValidators = await registerMany(clusters, operatorIds, 7, 3000);
    const { cluster: clusterAfter225 } = await updateEB(clusters, operatorIds, clusterWithSevenValidators, 225, 1);
    expect(clusterAfter225.validatorCount).to.equal(7n);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const expectedVUnits = (225n * BPS_DENOMINATOR + 31n) / 32n;
    const baseline = 7n * BPS_DENOMINATOR;
    const expectedDeviation = expectedVUnits - baseline;
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedVUnits);
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(expectedDeviation);
    }
  });

  it("withdrawing exact max after settlement leaves zero residual dust", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWithZeroFee);
    await clusters.mockEthNetworkFee(0n);
    await clusters.mockMinimumBlocksBeforeLiquidation(1n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    const { cluster } = await registerOne(clusters, operatorIds, 2007);
    const { cluster: clusterAfter64 } = await updateEB(clusters, operatorIds, cluster, 64, 1);

    await networkHelpers.mine(5);
    const settleTx = await clusters.withdraw(operatorIds, 0n, clusterAfter64);
    const settleReceipt = await settleTx.wait();
    const clusterAfterSettle = parseClusterFromEvent(clusters, settleReceipt, Events.CLUSTER_WITHDRAWN);
    const exactMaxWithdraw = clusterAfterSettle.balance;

    const maxWithdrawTx = await clusters.withdraw(operatorIds, exactMaxWithdraw, clusterAfterSettle);
    const maxWithdrawReceipt = await maxWithdrawTx.wait();
    const clusterAfterMaxWithdraw = parseClusterFromEvent(clusters, maxWithdrawReceipt, Events.CLUSTER_WITHDRAWN);
    expect(clusterAfterMaxWithdraw.balance).to.equal(0n);
  });
});

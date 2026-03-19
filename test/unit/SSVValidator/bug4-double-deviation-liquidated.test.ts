import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext, createCluster, makePublicKey, parseClusterFromEvent, computeEBRoot, computeClusterId } from "../../common/helpers.ts";
import { DEFAULT_SHARES, BPS_DENOMINATOR } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { ethers } from "ethers";
const OPERATOR_FEE = 10_000_000_000n;

describe("BUG-4: Double deviation cleanup on liquidated cluster validator removal", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;
  let liquidator: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner, liquidator] } = await setupTestContext());
  });

  const deployClustersWithFee = async () => {
    return ssvClustersHarnessFixture(connection, 4, OPERATOR_FEE);
  };

  it("should not double-subtract deviation when removing all validators from a liquidated cluster with explicit EB", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);
    const networkFeeRate = 100_000n;
    await clusters.mockEthNetworkFee(networkFeeRate);
    await clusters.mockMinimumBlocksBeforeLiquidation(100n);
    await clusters.mockMinimumLiquidationCollateral(0n);
    const pk1 = makePublicKey(1);
    const pk2 = makePublicKey(2);
    const pk3 = makePublicKey(3);
    const depositValue = ethers.parseEther("0.0001");

    const reg1 = await clusters.connect(clusterOwner).registerValidator(
      pk1, operatorIds, DEFAULT_SHARES, createCluster(), { value: depositValue }
    );
    const cluster1 = parseClusterFromEvent(clusters, await reg1.wait(), Events.VALIDATOR_ADDED);

    const reg2 = await clusters.connect(clusterOwner).registerValidator(
      pk2, operatorIds, DEFAULT_SHARES, cluster1, { value: depositValue }
    );
    const cluster2 = parseClusterFromEvent(clusters, await reg2.wait(), Events.VALIDATOR_ADDED);

    const reg3 = await clusters.connect(clusterOwner).registerValidator(
      pk3, operatorIds, DEFAULT_SHARES, cluster2, { value: depositValue }
    );
    const clusterAfterReg = parseClusterFromEvent(clusters, await reg3.wait(), Events.VALIDATOR_ADDED);

    expect(clusterAfterReg.validatorCount).to.equal(3n);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const effectiveBalance = 160;
    const root1 = computeEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(1, root1);

    const ebTx = await clusters.updateClusterBalance(
      1, clusterOwner.address, operatorIds, clusterAfterReg, effectiveBalance, []
    );
    const clusterAfterEB = parseClusterFromEvent(clusters, await ebTx.wait(), Events.CLUSTER_BALANCE_UPDATED);

    const expectedVUnits = (BigInt(effectiveBalance) * BPS_DENOMINATOR + 31n) / 32n;
    const baselineVUnits = 3n * BPS_DENOMINATOR;
    const deviation = expectedVUnits - baselineVUnits;

    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedVUnits);
    expect(deviation).to.be.gt(0n);
    const opVUnitsBefore = await clusters.getOperatorEthVUnits(operatorIds[0]);
    const daoVUnitsBefore = await clusters.getDaoTotalEthVUnits();
    expect(opVUnitsBefore).to.equal(deviation);
    const root2 = computeEBRoot(clusterId, 2048);
    await clusters.mockSetEBRoot(2, root2);

    const ebTx2 = await clusters.updateClusterBalance(
      2, clusterOwner.address, operatorIds, clusterAfterEB, 2048, []
    );
    const clusterAfterLiq = parseClusterFromEvent(clusters, await ebTx2.wait(), Events.CLUSTER_LIQUIDATED);

    expect(clusterAfterLiq.active).to.equal(false);
    expect(clusterAfterLiq.balance).to.equal(0n);
    expect(clusterAfterLiq.validatorCount).to.equal(3n);
    const vUnitsAt2048 = (2048n * BPS_DENOMINATOR + 31n) / 32n;
    const deviationAt2048 = vUnitsAt2048 - baselineVUnits;
    const opVUnitsAfterLiq = await clusters.getOperatorEthVUnits(operatorIds[0]);
    const daoVUnitsAfterLiq = await clusters.getDaoTotalEthVUnits();
    const removeTx = await clusters.connect(clusterOwner).bulkRemoveValidator(
      [pk1, pk2, pk3], operatorIds, clusterAfterLiq
    );
    await removeTx.wait();
    const opVUnitsAfterRemove = await clusters.getOperatorEthVUnits(operatorIds[0]);
    const daoVUnitsAfterRemove = await clusters.getDaoTotalEthVUnits();

    expect(opVUnitsAfterRemove).to.equal(opVUnitsAfterLiq,
      "operatorEthVUnits should not change after removing validators from a liquidated cluster");
    expect(daoVUnitsAfterRemove).to.equal(daoVUnitsAfterLiq,
      "daoTotalEthVUnits should not change after removing validators from a liquidated cluster");
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);
  });

  it("should not double-subtract deviation when removing validators one-by-one from a liquidated cluster", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);

    await clusters.mockEthNetworkFee(100_000n);
    await clusters.mockMinimumBlocksBeforeLiquidation(100n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    const pk1 = makePublicKey(1);
    const pk2 = makePublicKey(2);
    const depositValue = ethers.parseEther("0.0001");

    const reg1 = await clusters.connect(clusterOwner).registerValidator(
      pk1, operatorIds, DEFAULT_SHARES, createCluster(), { value: depositValue }
    );
    const cluster1 = parseClusterFromEvent(clusters, await reg1.wait(), Events.VALIDATOR_ADDED);

    const reg2 = await clusters.connect(clusterOwner).registerValidator(
      pk2, operatorIds, DEFAULT_SHARES, cluster1, { value: depositValue }
    );
    const clusterAfterReg = parseClusterFromEvent(clusters, await reg2.wait(), Events.VALIDATOR_ADDED);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const root1 = computeEBRoot(clusterId, 96);
    await clusters.mockSetEBRoot(1, root1);

    const ebTx = await clusters.updateClusterBalance(
      1, clusterOwner.address, operatorIds, clusterAfterReg, 96, []
    );
    const clusterAfterEB = parseClusterFromEvent(clusters, await ebTx.wait(), Events.CLUSTER_BALANCE_UPDATED);
    const root2 = computeEBRoot(clusterId, 2048);
    await clusters.mockSetEBRoot(2, root2);

    const ebTx2 = await clusters.updateClusterBalance(
      2, clusterOwner.address, operatorIds, clusterAfterEB, 2048, []
    );
    const clusterAfterLiq = parseClusterFromEvent(clusters, await ebTx2.wait(), Events.CLUSTER_LIQUIDATED);
    expect(clusterAfterLiq.active).to.equal(false);

    const opVUnitsAfterLiq = await clusters.getOperatorEthVUnits(operatorIds[0]);
    const daoVUnitsAfterLiq = await clusters.getDaoTotalEthVUnits();
    const remove1 = await clusters.connect(clusterOwner).removeValidator(pk1, operatorIds, clusterAfterLiq);
    const clusterAfterRemove1 = parseClusterFromEvent(clusters, await remove1.wait(), Events.VALIDATOR_REMOVED);
    expect(clusterAfterRemove1.validatorCount).to.equal(1n);
    expect(await clusters.getOperatorEthVUnits(operatorIds[0])).to.equal(opVUnitsAfterLiq);
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(daoVUnitsAfterLiq);
    const remove2 = await clusters.connect(clusterOwner).removeValidator(pk2, operatorIds, clusterAfterRemove1);
    await remove2.wait();
    expect(await clusters.getOperatorEthVUnits(operatorIds[0])).to.equal(opVUnitsAfterLiq,
      "operatorEthVUnits should not change when removing last validator from liquidated cluster");
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(daoVUnitsAfterLiq,
      "daoTotalEthVUnits should not change when removing last validator from liquidated cluster");
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);
  });

  it("should still correctly clean up deviation when removing validators from an ACTIVE cluster", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);

    const pk1 = makePublicKey(1);
    const depositValue = ethers.parseEther("10");

    const reg1 = await clusters.connect(clusterOwner).registerValidator(
      pk1, operatorIds, DEFAULT_SHARES, createCluster(), { value: depositValue }
    );
    const clusterAfterReg = parseClusterFromEvent(clusters, await reg1.wait(), Events.VALIDATOR_ADDED);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const root = computeEBRoot(clusterId, 96);
    await clusters.mockSetEBRoot(1, root);

    const ebTx = await clusters.updateClusterBalance(
      1, clusterOwner.address, operatorIds, clusterAfterReg, 96, []
    );
    const clusterAfterEB = parseClusterFromEvent(clusters, await ebTx.wait(), Events.CLUSTER_BALANCE_UPDATED);

    const expectedVUnits = (96n * BPS_DENOMINATOR + 31n) / 32n;
    const deviation = expectedVUnits - BPS_DENOMINATOR;

    expect(await clusters.getOperatorEthVUnits(operatorIds[0])).to.equal(deviation);
    const removeTx = await clusters.connect(clusterOwner).removeValidator(pk1, operatorIds, clusterAfterEB);
    await removeTx.wait();
    expect(await clusters.getOperatorEthVUnits(operatorIds[0])).to.equal(0n,
      "operatorEthVUnits should be zeroed after removing last validator from active cluster");
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);
  });
});

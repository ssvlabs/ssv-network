import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { createCluster, makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_SHARES, BPS_DENOMINATOR } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { ethers } from "ethers";

// Operator fee: 1e10 wei/block (packed = 1e10 / 1e5 = 1e5)
const OPERATOR_FEE = 10_000_000_000n;

describe("BUG-4: Double deviation cleanup on liquidated cluster validator removal", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;
  let liquidator: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner, liquidator] = await connection.ethers.getSigners();
  });

  const deployClustersWithFee = async () => {
    return ssvClustersHarnessFixture(connection, 4, OPERATOR_FEE);
  };

  const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
    return ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds])
    );
  };

  const getEBRoot = (clusterId: string, effectiveBalance: number): string => {
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const innerHash = ethers.keccak256(coder.encode(["bytes32", "uint32"], [clusterId, effectiveBalance]));
    return ethers.keccak256(ethers.solidityPacked(["bytes32"], [innerHash]));
  };

  it("should not double-subtract deviation when removing all validators from a liquidated cluster with explicit EB", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);

    // Setup liquidation parameters
    const networkFeeRate = 100_000n;
    await clusters.mockEthNetworkFee(networkFeeRate);
    await clusters.mockMinimumBlocksBeforeLiquidation(100n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    // Register 3 validators with small deposit (will become liquidatable at high EB)
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

    // Set explicit EB: 160 ETH for 3 validators
    // vUnits = ceil(160 * 10000 / 32) = 50000
    // baseline = 3 * 10000 = 30000
    // deviation = 50000 - 30000 = 20000
    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    const effectiveBalance = 160;
    const root1 = getEBRoot(clusterId, effectiveBalance);
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

    // Record pre-liquidation deviation values
    const opVUnitsBefore = await clusters.getOperatorEthVUnits(operatorIds[0]);
    const daoVUnitsBefore = await clusters.getDaoTotalEthVUnits();
    expect(opVUnitsBefore).to.equal(deviation);

    // Now increase EB to 2048 to trigger auto-liquidation
    const root2 = getEBRoot(clusterId, 2048);
    await clusters.mockSetEBRoot(2, root2);

    const ebTx2 = await clusters.updateClusterBalance(
      2, clusterOwner.address, operatorIds, clusterAfterEB, 2048, []
    );
    const clusterAfterLiq = parseClusterFromEvent(clusters, await ebTx2.wait(), Events.CLUSTER_LIQUIDATED);

    expect(clusterAfterLiq.active).to.equal(false);
    expect(clusterAfterLiq.balance).to.equal(0n);
    expect(clusterAfterLiq.validatorCount).to.equal(3n);

    // After liquidation: deviation was cleaned up by _executeLiquidation
    // The new EB (2048) produced different vUnits, so deviation changed
    const vUnitsAt2048 = (2048n * BPS_DENOMINATOR + 31n) / 32n; // 640000
    const deviationAt2048 = vUnitsAt2048 - baselineVUnits; // 640000 - 30000 = 610000

    // After liquidation, deviation was subtracted from operator/DAO
    const opVUnitsAfterLiq = await clusters.getOperatorEthVUnits(operatorIds[0]);
    const daoVUnitsAfterLiq = await clusters.getDaoTotalEthVUnits();

    // Now remove all 3 validators from the liquidated cluster
    // Before the fix, this would double-subtract deviation and revert with underflow
    const removeTx = await clusters.connect(clusterOwner).bulkRemoveValidator(
      [pk1, pk2, pk3], operatorIds, clusterAfterLiq
    );
    await removeTx.wait();

    // After removal: operatorEthVUnits and daoTotalEthVUnits should be unchanged
    // (deviation was already cleaned during liquidation, should NOT be subtracted again)
    const opVUnitsAfterRemove = await clusters.getOperatorEthVUnits(operatorIds[0]);
    const daoVUnitsAfterRemove = await clusters.getDaoTotalEthVUnits();

    expect(opVUnitsAfterRemove).to.equal(opVUnitsAfterLiq,
      "operatorEthVUnits should not change after removing validators from a liquidated cluster");
    expect(daoVUnitsAfterRemove).to.equal(daoVUnitsAfterLiq,
      "daoTotalEthVUnits should not change after removing validators from a liquidated cluster");

    // ebSnapshot should be fully zeroed
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

    // Set explicit EB: 96 ETH for 2 validators → vUnits = ceil(96*10000/32) = 30000
    // baseline = 2*10000 = 20000, deviation = 10000
    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    const root1 = getEBRoot(clusterId, 96);
    await clusters.mockSetEBRoot(1, root1);

    const ebTx = await clusters.updateClusterBalance(
      1, clusterOwner.address, operatorIds, clusterAfterReg, 96, []
    );
    const clusterAfterEB = parseClusterFromEvent(clusters, await ebTx.wait(), Events.CLUSTER_BALANCE_UPDATED);

    // Increase EB to trigger auto-liquidation
    const root2 = getEBRoot(clusterId, 2048);
    await clusters.mockSetEBRoot(2, root2);

    const ebTx2 = await clusters.updateClusterBalance(
      2, clusterOwner.address, operatorIds, clusterAfterEB, 2048, []
    );
    const clusterAfterLiq = parseClusterFromEvent(clusters, await ebTx2.wait(), Events.CLUSTER_LIQUIDATED);
    expect(clusterAfterLiq.active).to.equal(false);

    const opVUnitsAfterLiq = await clusters.getOperatorEthVUnits(operatorIds[0]);
    const daoVUnitsAfterLiq = await clusters.getDaoTotalEthVUnits();

    // Remove first validator — partial removal, cluster still has 1 validator
    const remove1 = await clusters.connect(clusterOwner).removeValidator(pk1, operatorIds, clusterAfterLiq);
    const clusterAfterRemove1 = parseClusterFromEvent(clusters, await remove1.wait(), Events.VALIDATOR_REMOVED);
    expect(clusterAfterRemove1.validatorCount).to.equal(1n);

    // Operator/DAO vUnits should be unchanged after partial removal
    expect(await clusters.getOperatorEthVUnits(operatorIds[0])).to.equal(opVUnitsAfterLiq);
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(daoVUnitsAfterLiq);

    // Remove second (last) validator
    const remove2 = await clusters.connect(clusterOwner).removeValidator(pk2, operatorIds, clusterAfterRemove1);
    await remove2.wait();

    // After removing the last validator, operator/DAO vUnits should still be unchanged
    expect(await clusters.getOperatorEthVUnits(operatorIds[0])).to.equal(opVUnitsAfterLiq,
      "operatorEthVUnits should not change when removing last validator from liquidated cluster");
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(daoVUnitsAfterLiq,
      "daoTotalEthVUnits should not change when removing last validator from liquidated cluster");

    // ebSnapshot should be fully zeroed
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

    // Set explicit EB: 96 ETH for 1 validator → vUnits = ceil(96*10000/32) = 30000
    // baseline = 1*10000 = 10000, deviation = 20000
    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    const root = getEBRoot(clusterId, 96);
    await clusters.mockSetEBRoot(1, root);

    const ebTx = await clusters.updateClusterBalance(
      1, clusterOwner.address, operatorIds, clusterAfterReg, 96, []
    );
    const clusterAfterEB = parseClusterFromEvent(clusters, await ebTx.wait(), Events.CLUSTER_BALANCE_UPDATED);

    const expectedVUnits = (96n * BPS_DENOMINATOR + 31n) / 32n;
    const deviation = expectedVUnits - BPS_DENOMINATOR;

    expect(await clusters.getOperatorEthVUnits(operatorIds[0])).to.equal(deviation);

    // Remove the validator from active cluster — deviation should be cleaned up
    const removeTx = await clusters.connect(clusterOwner).removeValidator(pk1, operatorIds, clusterAfterEB);
    await removeTx.wait();

    // For active clusters, deviation SHOULD be subtracted
    expect(await clusters.getOperatorEthVUnits(operatorIds[0])).to.equal(0n,
      "operatorEthVUnits should be zeroed after removing last validator from active cluster");
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);
  });
});

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext, computeClusterId, computeEBRoot, createCluster, makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, BPS_DENOMINATOR } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { ethers } from "ethers";

const OPERATOR_FEE = 10_000_000_000n;

describe("EB decrease scenarios", async () => {
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



  it("EB decrease from 64 to 32 ETH reduces vUnits, clears deviation, settles fees at old rate", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);

    await clusters.mockEthNetworkFee(0n);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const regTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const regReceipt = await regTx.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

    const root1 = computeEBRoot(clusterId, 64);
    await clusters.mockSetEBRoot(1, root1);

    const ebTx1 = await clusters.updateClusterBalance(1, clusterOwner.address, operatorIds, clusterAfterReg, 64, []);
    const ebReceipt1 = await ebTx1.wait();
    const blockEB64 = ebReceipt1!.blockNumber;
    const clusterAfterEB64 = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);

    const expectedVUnits64 = ((64n * BPS_DENOMINATOR) + 31n) / 32n;
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedVUnits64);

    const expectedDeviation64 = expectedVUnits64 - BPS_DENOMINATOR;
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(expectedDeviation64);
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(expectedVUnits64);
    }

    await networkHelpers.mine(100);

    const balanceAfterEB64 = clusterAfterEB64.balance;

    const root2 = computeEBRoot(clusterId, 32);
    await clusters.mockSetEBRoot(2, root2);

    const ebTx2 = await clusters.updateClusterBalance(2, clusterOwner.address, operatorIds, clusterAfterEB64, 32, []);
    const ebReceipt2 = await ebTx2.wait();
    const blockEB32 = ebReceipt2!.blockNumber;
    const clusterAfterEB32 = parseClusterFromEvent(clusters, ebReceipt2, Events.CLUSTER_BALANCE_UPDATED);

    expect(await clusters.getClusterVUnits(clusterId)).to.equal(BPS_DENOMINATOR);

    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(BPS_DENOMINATOR);
    }
    const blocksDelta = BigInt(blockEB32 - blockEB64);
    const vUnits64 = 20000n;
    const ETH_DEDUCTED_DIGITS = 100_000n;
    const packedOpFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
    const totalPackedFeeRate = 4n * packedOpFee;
    const expectedFees = ((blocksDelta * totalPackedFeeRate * vUnits64) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;

    const feesDeducted = balanceAfterEB64 - clusterAfterEB32.balance;
    expect(feesDeducted).to.equal(expectedFees);

    expect(clusterAfterEB32.active).to.equal(true);
  });

  it("EB decrease below 32 ETH per validator reverts with EBBelowMinimum", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const regTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const regReceipt = await regTx.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

    const root1 = computeEBRoot(clusterId, 128);
    await clusters.mockSetEBRoot(1, root1);

    const ebTx1 = await clusters.updateClusterBalance(1, clusterOwner.address, operatorIds, clusterAfterReg, 128, []);
    const ebReceipt1 = await ebTx1.wait();
    const clusterAfter128 = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);

    expect(await clusters.getClusterVUnits(clusterId)).to.be.gt(BPS_DENOMINATOR);

    const belowMinEB = 31;
    const root2 = computeEBRoot(clusterId, belowMinEB);
    await clusters.mockSetEBRoot(2, root2);

    await expect(
      clusters.updateClusterBalance(2, clusterOwner.address, operatorIds, clusterAfter128, belowMinEB, [])
    ).to.be.revertedWithCustomError(clusters, Errors.EB_BELOW_MINIMUM);
  });

  it("EB decrease auto-liquidates cluster when balance falls below new lower threshold", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);

    const networkFeeRate = 100_000n;
    await clusters.mockEthNetworkFee(networkFeeRate);
    await clusters.mockMinimumBlocksBeforeLiquidation(100n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    const depositValue = 12_000_000_000_000n;
    const regTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: depositValue }
    );
    const regReceipt = await regTx.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);
    expect(clusterAfterReg.active).to.equal(true);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const root1 = computeEBRoot(clusterId, 64);
    await clusters.mockSetEBRoot(1, root1);

    const ebTx1 = await clusters.updateClusterBalance(1, clusterOwner.address, operatorIds, clusterAfterReg, 64, []);
    const ebReceipt1 = await ebTx1.wait();
    const clusterAfterEB64 = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);

    expect(clusterAfterEB64.active).to.equal(true);
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(20000n);

    await expect(
      clusters.connect(liquidator).liquidate(clusterOwner.address, operatorIds, clusterAfterEB64)
    ).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_NOT_LIQUIDATABLE);

    await networkHelpers.mine(70);

    const root2 = computeEBRoot(clusterId, 32);
    await clusters.mockSetEBRoot(2, root2);

    const ebTx2 = await clusters.updateClusterBalance(2, clusterOwner.address, operatorIds, clusterAfterEB64, 32, []);
    const ebReceipt2 = await ebTx2.wait();

    const clusterAfterEB32 = parseClusterFromEvent(clusters, ebReceipt2, Events.CLUSTER_LIQUIDATED);
    expect(clusterAfterEB32.active).to.equal(false);
    expect(clusterAfterEB32.balance).to.equal(0n);
  });

  it("EB decrease correctly decrements operator deviation and daoTotalEthVUnits", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);

    await clusters.mockEthNetworkFee(0n);
    await clusters.mockMinimumLiquidationCollateral(0n);
    await clusters.mockMinimumBlocksBeforeLiquidation(1n);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);

    const regTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const regReceipt = await regTx.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(BPS_DENOMINATOR);

    const root1 = computeEBRoot(clusterId, 64);
    await clusters.mockSetEBRoot(1, root1);

    const ebTx1 = await clusters.updateClusterBalance(1, clusterOwner.address, operatorIds, clusterAfterReg, 64, []);
    const ebReceipt1 = await ebTx1.wait();
    const clusterAfterEB64 = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);

    const expectedDeviation = 20000n - BPS_DENOMINATOR;
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(expectedDeviation);
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(20000n);
    }
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(20000n);

    const root2 = computeEBRoot(clusterId, 32);
    await clusters.mockSetEBRoot(2, root2);

    const ebTx2 = await clusters.updateClusterBalance(2, clusterOwner.address, operatorIds, clusterAfterEB64, 32, []);
    const ebReceipt2 = await ebTx2.wait();
    parseClusterFromEvent(clusters, ebReceipt2, Events.CLUSTER_BALANCE_UPDATED);

    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(BPS_DENOMINATOR);
    }
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(BPS_DENOMINATOR);

    expect(await clusters.getClusterVUnits(clusterId)).to.equal(BPS_DENOMINATOR);
  });
});

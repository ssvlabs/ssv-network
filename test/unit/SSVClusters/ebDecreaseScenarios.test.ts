import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { createCluster, makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, VUNITS_PRECISION } from "../../common/constants.ts";
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

  it("EB decrease from 64 to 32 ETH reduces vUnits, clears deviation, settles fees at old rate", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);

    await clusters.mockEthNetworkFee(0n);

    const clusterId = getClusterId(clusterOwner.address, operatorIds);

    const regTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const regReceipt = await regTx.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

    const root1 = getEBRoot(clusterId, 64);
    await clusters.mockSetEBRoot(1, root1);

    const ebTx1 = await clusters.updateClusterBalance(1, clusterOwner.address, operatorIds, clusterAfterReg, 64, []);
    const ebReceipt1 = await ebTx1.wait();
    const blockEB64 = ebReceipt1!.blockNumber;
    const clusterAfterEB64 = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);

    const expectedVUnits64 = ((64n * VUNITS_PRECISION) + 31n) / 32n; // ceil(64 * 10000 / 32) = 20000
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedVUnits64);

    const expectedDeviation64 = expectedVUnits64 - VUNITS_PRECISION; // 10000
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(expectedDeviation64);
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(expectedVUnits64);
    }

    await networkHelpers.mine(100);

    const balanceAfterEB64 = clusterAfterEB64.balance;

    const root2 = getEBRoot(clusterId, 32);
    await clusters.mockSetEBRoot(2, root2);

    const ebTx2 = await clusters.updateClusterBalance(2, clusterOwner.address, operatorIds, clusterAfterEB64, 32, []);
    const ebReceipt2 = await ebTx2.wait();
    const blockEB32 = ebReceipt2!.blockNumber;
    const clusterAfterEB32 = parseClusterFromEvent(clusters, ebReceipt2, Events.CLUSTER_BALANCE_UPDATED);

    expect(await clusters.getClusterVUnits(clusterId)).to.equal(VUNITS_PRECISION);

    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(VUNITS_PRECISION);
    }

    // Calculate exact expected fees using SPEC.md formula:
    // fees = (blocksDelta * sum(packedOperatorFees) * vUnits / VUNITS_PRECISION) * ETH_DEDUCTED_DIGITS
    // During the 64 ETH period, fees are charged at 64 ETH rate (20,000 vUnits)
    const blocksDelta = BigInt(blockEB32 - blockEB64);
    const vUnits64 = 20000n;
    const ETH_DEDUCTED_DIGITS = 100_000n;
    const packedOpFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS; // 100_000
    const totalPackedFeeRate = 4n * packedOpFee; // 4 operators
    const expectedFees = ((blocksDelta * totalPackedFeeRate * vUnits64) / VUNITS_PRECISION) * ETH_DEDUCTED_DIGITS;

    const feesDeducted = balanceAfterEB64 - clusterAfterEB32.balance;
    expect(feesDeducted).to.equal(expectedFees);

    expect(clusterAfterEB32.active).to.equal(true);
  });

  it("EB decrease below 32 ETH per validator reverts with EBBelowMinimum", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);

    const clusterId = getClusterId(clusterOwner.address, operatorIds);

    const regTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const regReceipt = await regTx.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

    const root1 = getEBRoot(clusterId, 128);
    await clusters.mockSetEBRoot(1, root1);

    const ebTx1 = await clusters.updateClusterBalance(1, clusterOwner.address, operatorIds, clusterAfterReg, 128, []);
    const ebReceipt1 = await ebTx1.wait();
    const clusterAfter128 = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);

    expect(await clusters.getClusterVUnits(clusterId)).to.be.gt(VUNITS_PRECISION);

    const belowMinEB = 31;
    const root2 = getEBRoot(clusterId, belowMinEB);
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

    const clusterId = getClusterId(clusterOwner.address, operatorIds);

    const root1 = getEBRoot(clusterId, 64);
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

    const root2 = getEBRoot(clusterId, 32);
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

    const clusterId = getClusterId(clusterOwner.address, operatorIds);

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
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(VUNITS_PRECISION);

    const root1 = getEBRoot(clusterId, 64);
    await clusters.mockSetEBRoot(1, root1);

    const ebTx1 = await clusters.updateClusterBalance(1, clusterOwner.address, operatorIds, clusterAfterReg, 64, []);
    const ebReceipt1 = await ebTx1.wait();
    const clusterAfterEB64 = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);

    const expectedDeviation = 20000n - VUNITS_PRECISION; // 10000
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(expectedDeviation);
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(20000n);
    }
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(20000n);

    const root2 = getEBRoot(clusterId, 32);
    await clusters.mockSetEBRoot(2, root2);

    const ebTx2 = await clusters.updateClusterBalance(2, clusterOwner.address, operatorIds, clusterAfterEB64, 32, []);
    const ebReceipt2 = await ebTx2.wait();
    parseClusterFromEvent(clusters, ebReceipt2, Events.CLUSTER_BALANCE_UPDATED);

    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(VUNITS_PRECISION);
    }
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(VUNITS_PRECISION);

    expect(await clusters.getClusterVUnits(clusterId)).to.equal(VUNITS_PRECISION);
  });
});

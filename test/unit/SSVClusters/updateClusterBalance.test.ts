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
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";

type ClusterType = ReturnType<typeof createCluster>;

describe("SSVClusters function `updateClusterBalance()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [clusterOwner] = await connection.ethers.getSigners();
  });

  const deploySSVClustersAndPrepareOperatorsFixture = async () => {
    return ssvClustersHarnessFixture(connection);
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

  const getClusterBalanceUpdatedEventArgs = (clusters: any, receipt: any) => {
    for (const log of receipt.logs ?? []) {
      let parsed;
      try {
        parsed = clusters.interface.parseLog(log);
      } catch {
        continue;
      }
      if (parsed?.name === Events.CLUSTER_BALANCE_UPDATED) {
        return parsed.args;
      }
    }
    throw new Error("ClusterBalanceUpdated event not found");
  };

  const registerCluster = async (clusters: any, operatorIds: bigint[]): Promise<ClusterType> => {
    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await registerTx.wait();
    return parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);
  };

  it("Is reverted with 'RootNotFound' when EB root is missing for the provided block", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const cluster = await registerCluster(clusters, operatorIds);

    await expect(clusters.updateClusterBalance(
      1, // blockNum
      clusterOwner.address,
      operatorIds,
      cluster,
      32, // effectiveBalance
      [] // merkleProof
    )).to.be.revertedWithCustomError(clusters, Errors.ROOT_NOT_FOUND);
  });

  it("Updates cluster balance when proof is valid", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const cluster = await registerCluster(clusters, operatorIds);

    const blockNum = 1;
    const effectiveBalance = 32;

    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    const root = getEBRoot(clusterId, effectiveBalance);

    await clusters.mockSetEBRoot(blockNum, root);

    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(VUNITS_PRECISION);
    }

    const tx = await clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      cluster,
      effectiveBalance,
      []
    );
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.UPDATE_CLUSTER_BALANCE]);

    await expect(tx).to.emit(clusters, Events.CLUSTER_BALANCE_UPDATED);
    const eventArgs = getClusterBalanceUpdatedEventArgs(clusters, receipt);
    expect(eventArgs.owner).to.equal(clusterOwner.address);
    expect(eventArgs.operatorIds).to.deep.equal(operatorIds);
    expect(eventArgs.blockNum).to.equal(BigInt(blockNum));
    expect(eventArgs.effectiveBalance).to.equal(effectiveBalance);

    const clusterAfter = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_BALANCE_UPDATED);
    expect(clusterAfter.active).to.equal(true);
    expect(clusterAfter.validatorCount).to.equal(cluster.validatorCount);

    expect(await clusters.getClusterVUnits(clusterId)).to.equal(VUNITS_PRECISION);
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(VUNITS_PRECISION);
    }
  });

  it("Updates operator ETH vUnits when effective balance changes", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const cluster = await registerCluster(clusters, operatorIds);

    const blockNum = 1;
    const effectiveBalance = 33;

    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    const root = getEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(blockNum, root);

    const vUnitsPerValidator = 32n;
    const newVUnits = ((BigInt(effectiveBalance) * VUNITS_PRECISION) + vUnitsPerValidator - 1n) / vUnitsPerValidator;

    const tx = await clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      cluster,
      effectiveBalance,
      []
    );
    const receipt = await tx.wait();

    const eventArgs = getClusterBalanceUpdatedEventArgs(clusters, receipt);
    expect(eventArgs.effectiveBalance).to.equal(effectiveBalance);

    expect(await clusters.getClusterVUnits(clusterId)).to.equal(newVUnits);
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(newVUnits);
    }
  });

  it("Is reverted with 'InvalidProof' when merkle proof is invalid", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const cluster = await registerCluster(clusters, operatorIds);

    const blockNum = 1;
    const effectiveBalance = 32;

    await clusters.mockSetEBRoot(blockNum, ethers.keccak256("0x1234"));

    await expect(clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      cluster,
      effectiveBalance,
      []
    )).to.be.revertedWithCustomError(clusters, Errors.INVALID_PROOF);
  });

  it("Is reverted with 'EBExceedsMaximum' when effective balance exceeds 2048 ETH per validator", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const cluster = await registerCluster(clusters, operatorIds);

    const blockNum = 1;
    const effectiveBalance = 2049;

    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    const root = getEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(blockNum, root);

    await expect(clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      cluster,
      effectiveBalance,
      []
    )).to.be.revertedWithCustomError(clusters, Errors.EB_EXCEEDS_MAXIMUM);
  });

  it("Is reverted with 'StaleUpdate' when blockNum is not increasing", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const cluster = await registerCluster(clusters, operatorIds);

    const blockNum = 1;
    const effectiveBalance = 32;

    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    const root = getEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(blockNum, root);

    const tx1 = await clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      cluster,
      effectiveBalance,
      []
    );
    const receipt1 = await tx1.wait();
    const clusterAfter1 = parseClusterFromEvent(clusters, receipt1, Events.CLUSTER_BALANCE_UPDATED);

    await expect(clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      clusterAfter1,
      effectiveBalance,
      []
    )).to.be.revertedWithCustomError(clusters, Errors.STALE_UPDATE);
  });

  it("Updates only EB snapshot for SSV clusters (no ETH operator vUnits accounting)", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const ssvCluster = {
      validatorCount: 1n,
      networkFeeIndex: 0n,
      index: 0n,
      balance: 0n,
      active: true,
    };
    await clusters.mockRegisterSSVValidator(makePublicKey(1), operatorIds, clusterOwner.address, ssvCluster);

    const blockNum = 1;
    const effectiveBalance = 32;

    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    const root = getEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(blockNum, root);

    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
    expect(await clusters.getClusterHash(clusterId)).to.equal(ethers.ZeroHash);

    await (await clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      ssvCluster,
      effectiveBalance,
      []
    )).wait();

    expect(await clusters.getClusterVUnits(clusterId)).to.equal(VUNITS_PRECISION);
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
    expect(await clusters.getClusterHash(clusterId)).to.equal(ethers.ZeroHash);
  });

  it("Is reverted with 'EBBelowMinimum' when effective balance is below 32 ETH per validator", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const registerTx1 = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt1 = await registerTx1.wait();
    const clusterAfter1 = parseClusterFromEvent(clusters, receipt1, Events.VALIDATOR_ADDED);

    const registerTx2 = await clusters.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      0,
      clusterAfter1,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt2 = await registerTx2.wait();
    const clusterAfter2 = parseClusterFromEvent(clusters, receipt2, Events.VALIDATOR_ADDED);

    const blockNum = 1;
    const effectiveBalance = 60; // < 2 * 32

    const clusterId = ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [clusterOwner.address, operatorIds])
    );
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const innerHash = ethers.keccak256(coder.encode(["bytes32", "uint32"], [clusterId, effectiveBalance]));
    const root = ethers.keccak256(ethers.solidityPacked(["bytes32"], [innerHash]));
    await clusters.mockSetEBRoot(blockNum, root);

    await expect(clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      clusterAfter2,
      effectiveBalance,
      []
    )).to.be.revertedWithCustomError(clusters, Errors.EB_BELOW_MINIMUM);
  });
});

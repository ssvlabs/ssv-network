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
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n); // deviation only
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(VUNITS_PRECISION); // baseline + deviation
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
      // After EB update to 32 ETH (same as baseline), deviation is 0
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n); // deviation only
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(VUNITS_PRECISION); // baseline + deviation
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
      // EB update to 33 ETH: newVUnits = 10313, baseline = 10000, deviation = 313
      const deviation = newVUnits - VUNITS_PRECISION;
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(deviation); // deviation only
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(newVUnits); // baseline + deviation
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

  it("Succeeds on a liquidated cluster: updates EB snapshot but skips fee settlement and vUnit updates", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const cluster = await registerCluster(clusters, operatorIds);
    const clusterId = getClusterId(clusterOwner.address, operatorIds);

    const liquidateTx = await clusters.liquidate(clusterOwner.address, operatorIds, cluster);
    const liquidateReceipt = await liquidateTx.wait();
    const liquidatedCluster = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);
    expect(liquidatedCluster.active).to.equal(false);
    expect(liquidatedCluster.balance).to.equal(0n);

    const operatorVUnitsBefore = await clusters.getOperatorEthVUnits(operatorIds[0]);
    expect(operatorVUnitsBefore).to.equal(0n);
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);

    const blockNum = 1;
    const effectiveBalance = 33; // 33 ETH → vUnits = ceil(33 * 10000 / 32) = 10313
    const root = getEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(blockNum, root);

    const tx = await clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      liquidatedCluster,
      effectiveBalance,
      []
    );
    const receipt = await tx.wait();

    await expect(tx).to.emit(clusters, Events.CLUSTER_BALANCE_UPDATED);
    const eventArgs = getClusterBalanceUpdatedEventArgs(clusters, receipt);
    expect(eventArgs.effectiveBalance).to.equal(effectiveBalance);

    const clusterAfter = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_BALANCE_UPDATED);
    expect(clusterAfter.active).to.equal(false);
    expect(clusterAfter.balance).to.equal(0n);

    const expectedVUnits = (BigInt(effectiveBalance) * VUNITS_PRECISION + 32n - 1n) / 32n;
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedVUnits);

    expect(await clusters.getOperatorEthVUnits(operatorIds[0])).to.equal(operatorVUnitsBefore);
  });

  it("EB update on insolvent liquidated cluster does not corrupt operator or DAO vUnit accounting", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    // Register cluster (1 validator, implicit EB)
    const cluster = await registerCluster(clusters, operatorIds);
    const clusterId = getClusterId(clusterOwner.address, operatorIds);

    // Step 1: Update EB to 64 ETH while cluster is ACTIVE — establishes deviation in operatorEthVUnits
    const blockNum1 = 1;
    const effectiveBalance1 = 64; // 64 ETH → vUnits = 20000
    const root1 = getEBRoot(clusterId, effectiveBalance1);
    await clusters.mockSetEBRoot(blockNum1, root1);

    const tx1 = await clusters.updateClusterBalance(
      blockNum1,
      clusterOwner.address,
      operatorIds,
      cluster,
      effectiveBalance1,
      []
    );
    const receipt1 = await tx1.wait();
    const clusterAfterEB = parseClusterFromEvent(clusters, receipt1, Events.CLUSTER_BALANCE_UPDATED);

    // Verify deviation was applied: deviation = 20000 - 10000 = 10000 per operator
    const deviationAfterEBUpdate = 10000n; // (64 ETH / 32) * 10000 - baseline 10000
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(deviationAfterEBUpdate);
    }

    // Step 2: Liquidate the cluster — _executeLiquidation cleans up deviation
    const liquidateTx = await clusters.liquidate(clusterOwner.address, operatorIds, clusterAfterEB);
    const liquidateReceipt = await liquidateTx.wait();
    const liquidatedCluster = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);
    expect(liquidatedCluster.active).to.equal(false);

    // Deviation cleaned up by _executeLiquidation: both operator and DAO vUnits back to 0
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
    const daoVUnitsAfterLiquidation = await clusters.getDaoTotalEthVUnits();

    // Step 3: Call updateClusterBalance with even HIGHER EB (128 ETH) on the liquidated cluster
    // This simulates an oracle reporting increased effective balance on an already-liquidated cluster
    const blockNum2 = 2; // must be > blockNum1 to pass StaleUpdate check
    const effectiveBalance2 = 128; // 128 ETH → vUnits = 40000
    const root2 = getEBRoot(clusterId, effectiveBalance2);
    await clusters.mockSetEBRoot(blockNum2, root2);

    const tx2 = await clusters.updateClusterBalance(
      blockNum2,
      clusterOwner.address,
      operatorIds,
      liquidatedCluster,
      effectiveBalance2,
      []
    );
    const receipt2 = await tx2.wait();

    // Succeeds and emits event
    await expect(tx2).to.emit(clusters, Events.CLUSTER_BALANCE_UPDATED);
    const clusterAfterUpdate = parseClusterFromEvent(clusters, receipt2, Events.CLUSTER_BALANCE_UPDATED);
    expect(clusterAfterUpdate.active).to.equal(false);
    expect(clusterAfterUpdate.balance).to.equal(0n);

    // EB snapshot is updated — this is the ONLY state that changes
    const expectedVUnits2 = (BigInt(effectiveBalance2) * VUNITS_PRECISION + 32n - 1n) / 32n; // 40000
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedVUnits2);

    // Operator vUnits are NOT re-incremented — deviation stays at 0 (cleaned up during liquidation)
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }

    // DAO vUnits unchanged from post-liquidation state — no additional accounting for liquidated clusters
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(daoVUnitsAfterLiquidation);
  });

  it("Is reverted with 'EBBelowMinimum' when effective balance is below 32 ETH per validator", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const registerTx1 = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt1 = await registerTx1.wait();
    const clusterAfter1 = parseClusterFromEvent(clusters, receipt1, Events.VALIDATOR_ADDED);

    const registerTx2 = await clusters.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
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

  it("Multi-validator liquidated cluster: EB update preserves per-validator vUnit accounting", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    // Register 2 validators
    const registerTx1 = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt1 = await registerTx1.wait();
    const clusterAfter1 = parseClusterFromEvent(clusters, receipt1, Events.VALIDATOR_ADDED);

    const registerTx2 = await clusters.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      clusterAfter1,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt2 = await registerTx2.wait();
    const clusterWith2Validators = parseClusterFromEvent(clusters, receipt2, Events.VALIDATOR_ADDED);

    // Liquidate the cluster
    const liquidateTx = await clusters.liquidate(clusterOwner.address, operatorIds, clusterWith2Validators);
    const liquidateReceipt = await liquidateTx.wait();
    const liquidatedCluster = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);
    expect(liquidatedCluster.active).to.equal(false);
    expect(liquidatedCluster.validatorCount).to.equal(2n);

    const clusterId = getClusterId(clusterOwner.address, operatorIds);

    // Update EB to 66 ETH total (33 ETH per validator average)
    const blockNum = 1;
    const effectiveBalance = 66; // 2 validators * 33 ETH avg
    const root = getEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(blockNum, root);

    const tx = await clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      liquidatedCluster,
      effectiveBalance,
      []
    );
    const receipt = await tx.wait();

    await expect(tx).to.emit(clusters, Events.CLUSTER_BALANCE_UPDATED);
    const clusterAfter = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_BALANCE_UPDATED);
    expect(clusterAfter.active).to.equal(false);
    expect(clusterAfter.balance).to.equal(0n);
    expect(clusterAfter.validatorCount).to.equal(2n);

    // vUnits = ceil(66 * 10000 / 32) = ceil(20625) = 20625
    const expectedVUnits = (BigInt(effectiveBalance) * VUNITS_PRECISION + 32n - 1n) / 32n;
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedVUnits);

    // Operator vUnits should NOT be updated (stays 0 after liquidation cleanup)
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
  });

  it("EB decrease on liquidated cluster: updates snapshot without corrupting accounting", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const cluster = await registerCluster(clusters, operatorIds);
    const clusterId = getClusterId(clusterOwner.address, operatorIds);

    // Step 1: Update EB to 64 ETH while cluster is ACTIVE
    const blockNum1 = 1;
    const effectiveBalance1 = 64;
    const root1 = getEBRoot(clusterId, effectiveBalance1);
    await clusters.mockSetEBRoot(blockNum1, root1);

    const tx1 = await clusters.updateClusterBalance(
      blockNum1,
      clusterOwner.address,
      operatorIds,
      cluster,
      effectiveBalance1,
      []
    );
    const receipt1 = await tx1.wait();
    const clusterAfterEBIncrease = parseClusterFromEvent(clusters, receipt1, Events.CLUSTER_BALANCE_UPDATED);

    // Verify deviation applied: vUnits = 20000, deviation = 10000
    const deviationAfterIncrease = 10000n;
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(deviationAfterIncrease);
    }

    // Step 2: Liquidate the cluster — deviation cleaned up
    const liquidateTx = await clusters.liquidate(clusterOwner.address, operatorIds, clusterAfterEBIncrease);
    const liquidateReceipt = await liquidateTx.wait();
    const liquidatedCluster = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);
    expect(liquidatedCluster.active).to.equal(false);

    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
    const daoVUnitsAfterLiquidation = await clusters.getDaoTotalEthVUnits();

    // Step 3: EB DECREASES to 40 ETH on liquidated cluster (penalty scenario)
    const blockNum2 = 2;
    const effectiveBalance2 = 40; // Decreased from 64 to 40 ETH
    const root2 = getEBRoot(clusterId, effectiveBalance2);
    await clusters.mockSetEBRoot(blockNum2, root2);

    const tx2 = await clusters.updateClusterBalance(
      blockNum2,
      clusterOwner.address,
      operatorIds,
      liquidatedCluster,
      effectiveBalance2,
      []
    );
    const receipt2 = await tx2.wait();

    await expect(tx2).to.emit(clusters, Events.CLUSTER_BALANCE_UPDATED);
    const clusterAfterDecrease = parseClusterFromEvent(clusters, receipt2, Events.CLUSTER_BALANCE_UPDATED);
    expect(clusterAfterDecrease.active).to.equal(false);
    expect(clusterAfterDecrease.balance).to.equal(0n);

    // EB snapshot updated to decreased value
    const expectedVUnits2 = (BigInt(effectiveBalance2) * VUNITS_PRECISION + 32n - 1n) / 32n; // 12500
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedVUnits2);

    // Operator vUnits unchanged — no accounting corruption from EB decrease
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }

    // DAO vUnits unchanged
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(daoVUnitsAfterLiquidation);
  });

  it("Liquidated cluster with implicit EB: first updateClusterBalance transitions to explicit tracking", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    // Register cluster (starts with implicit EB = 32 ETH per validator)
    const cluster = await registerCluster(clusters, operatorIds);
    const clusterId = getClusterId(clusterOwner.address, operatorIds);

    // Verify cluster starts with implicit EB (vUnits = 0 in storage before first EB update)
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);

    // Liquidate immediately (cluster still has implicit EB)
    const liquidateTx = await clusters.liquidate(clusterOwner.address, operatorIds, cluster);
    const liquidateReceipt = await liquidateTx.wait();
    const liquidatedCluster = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);
    expect(liquidatedCluster.active).to.equal(false);

    // vUnits should still be 0 (implicit EB not yet transitioned)
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);

    // First EB update on liquidated cluster with implicit EB
    const blockNum = 1;
    const effectiveBalance = 35; // 35 ETH (slightly above baseline)
    const root = getEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(blockNum, root);

    const tx = await clusters.updateClusterBalance(
      blockNum,
      clusterOwner.address,
      operatorIds,
      liquidatedCluster,
      effectiveBalance,
      []
    );
    const receipt = await tx.wait();

    await expect(tx).to.emit(clusters, Events.CLUSTER_BALANCE_UPDATED);
    const clusterAfter = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_BALANCE_UPDATED);
    expect(clusterAfter.active).to.equal(false);
    expect(clusterAfter.balance).to.equal(0n);

    // Cluster now has explicit EB tracking (vUnits set in storage)
    const expectedVUnits = (BigInt(effectiveBalance) * VUNITS_PRECISION + 32n - 1n) / 32n; // ceil(35 * 10000 / 32) = 10938
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedVUnits);

    // Operator vUnits stay at 0 (liquidated cluster doesn't update operator accounting)
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
  });

  it("EB update with effectiveBalance = 0 on zero-validator cluster succeeds without modifying vUnit state", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const cluster = await registerCluster(clusters, operatorIds);
    const clusterId = getClusterId(clusterOwner.address, operatorIds);

    const removeTx = await clusters.removeValidator(makePublicKey(1), operatorIds, cluster);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);
    expect(clusterAfterRemove.validatorCount).to.equal(0n);

    const daoVUnitsBefore = await clusters.getDaoTotalEthVUnits();

    const blockNum = 1;
    const root = getEBRoot(clusterId, 0);
    await clusters.mockSetEBRoot(blockNum, root);

    const tx = await clusters.updateClusterBalance(
      blockNum, clusterOwner.address, operatorIds, clusterAfterRemove, 0, []
    );
    const receipt = await tx.wait();

    await expect(tx).to.emit(clusters, Events.CLUSTER_BALANCE_UPDATED);
    const eventArgs = getClusterBalanceUpdatedEventArgs(clusters, receipt);
    expect(eventArgs.effectiveBalance).to.equal(0);

    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(daoVUnitsBefore);
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
  });

  it("Oracle EB report effectiveBalance = 0 on active zero-validator cluster resets explicit EB to implicit-EB sentinel", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await clusters.mockMinimumBlocksBeforeLiquidation(100n);
    await clusters.mockMinimumLiquidationCollateral(0n);
    await clusters.mockEthNetworkFee(0n);

    const cluster = await registerCluster(clusters, operatorIds);
    const clusterId = getClusterId(clusterOwner.address, operatorIds);

    const blockNum1 = 1;
    const effectiveBalance1 = 64;
    const root1 = getEBRoot(clusterId, effectiveBalance1);
    await clusters.mockSetEBRoot(blockNum1, root1);

    const ebTx1 = await clusters.updateClusterBalance(
      blockNum1, clusterOwner.address, operatorIds, cluster, effectiveBalance1, []
    );
    const ebReceipt1 = await ebTx1.wait();
    const clusterAfterEB = parseClusterFromEvent(clusters, ebReceipt1, Events.CLUSTER_BALANCE_UPDATED);

    const expectedVUnits = (64n * VUNITS_PRECISION + 32n - 1n) / 32n; // 20000
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(expectedVUnits);

    const removeTx = await clusters.removeValidator(makePublicKey(1), operatorIds, clusterAfterEB);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);
    expect(clusterAfterRemove.validatorCount).to.equal(0n);
    expect(clusterAfterRemove.active).to.equal(true);

    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
    const daoVUnitsAfterRemove = await clusters.getDaoTotalEthVUnits();

    const blockNum2 = 2;
    const root2 = getEBRoot(clusterId, 0);
    await clusters.mockSetEBRoot(blockNum2, root2);

    const tx = await clusters.updateClusterBalance(
      blockNum2, clusterOwner.address, operatorIds, clusterAfterRemove, 0, []
    );
    const receipt = await tx.wait();

    await expect(tx).to.emit(clusters, Events.CLUSTER_BALANCE_UPDATED);
    const eventArgs = getClusterBalanceUpdatedEventArgs(clusters, receipt);
    expect(eventArgs.effectiveBalance).to.equal(0);

    const clusterAfterEB0 = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_BALANCE_UPDATED);
    expect(clusterAfterEB0.active).to.equal(true);
    expect(clusterAfterEB0.validatorCount).to.equal(0n);

    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);
    expect(await clusters.getDaoTotalEthVUnits()).to.equal(daoVUnitsAfterRemove);
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
    }
  });
});

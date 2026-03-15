import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getClustersHarnessFixture } from "../../setup/fixtures.ts";
import { defaultClustersFixture } from "../../helpers/fixture-presets.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext, computeClusterId, createCluster, makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, BPS_DENOMINATOR, ETH_DEDUCTED_DIGITS } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";
import { expectETHDelta, expectETHDeltas, expectContractETHDelta } from "../../helpers/balance.ts";
import { ethers } from "ethers";

describe("SSVClusters function `liquidate()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;
  let otherAccount: HardhatEthersSigner;
  let deployClustersWith7Operators!: ReturnType<typeof getClustersHarnessFixture>;
  let deployClustersWith10Operators!: ReturnType<typeof getClustersHarnessFixture>;
  let deployClustersWith13Operators!: ReturnType<typeof getClustersHarnessFixture>;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner, otherAccount] } = await setupTestContext());

    deployClustersWith7Operators = getClustersHarnessFixture(connection, 7);
    deployClustersWith10Operators = getClustersHarnessFixture(connection, 10);
    deployClustersWith13Operators = getClustersHarnessFixture(connection, 13);
  });

  const deploySSVClustersAndPrepareOperatorsFixture = async () => {
    return defaultClustersFixture(connection);
  };


  it("Allows the cluster owner to liquidate and emits correct event", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);

    await clusters.mockCurrentNetworkFeeIndex(1000n);

    const registerTx = await clusters.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    await clusters.mockCurrentNetworkFeeIndex(2000n);

    const liquidateTx = await clusters.liquidate(clusterOwner.address, operatorIds, clusterAfterRegister);
    const liquidateReceipt = await liquidateTx.wait();
    await trackGasFromReceipt(liquidateReceipt, [GasGroup.LIQUIDATE_CLUSTER_4]);
    const clusterAfterLiquidation = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);

    await expect(liquidateTx).to.emit(clusters, Events.CLUSTER_LIQUIDATED);
    expect(clusterAfterLiquidation.active).to.equal(false);
    expect(clusterAfterLiquidation.balance).to.equal(0n);
  });

  it("Transfers remaining cluster ETH balance to the liquidator", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await clusters.mockCurrentNetworkFeeIndex(1000n);

    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);
    const harnessAddress = await clusters.getAddress();
    const harnessBalance = await connection.ethers.provider.getBalance(harnessAddress);
    const minCollateral = harnessBalance / ETH_DEDUCTED_DIGITS + 1n;
    await clusters.mockMinimumLiquidationCollateral(minCollateral);

    await expectETHDeltas(connection.ethers.provider,
      () => clusters.connect(otherAccount).liquidate(clusterOwner.address, operatorIds, clusterAfterRegister),
      [
        { address: otherAccount.address, expectedDelta: DEFAULT_ETH_REGISTER_VALUE, accountForGas: true },
        { address: harnessAddress, expectedDelta: -DEFAULT_ETH_REGISTER_VALUE },
      ]);
  });

  it("Transfers no ETH when cluster remaining balance is zero after fee accrual", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const drainFeeIndex = DEFAULT_ETH_REGISTER_VALUE / ETH_DEDUCTED_DIGITS;
    await clusters.mockCurrentNetworkFeeIndex(drainFeeIndex);

    await expectContractETHDelta(connection.ethers.provider, await clusters.getAddress(),
      () => clusters.liquidate(clusterOwner.address, operatorIds, clusterAfterRegister),
      0n);
  });

  it("Self-liquidation returns remaining ETH balance to the cluster owner", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    await expectETHDelta(connection.ethers.provider, clusterOwner.address,
      () => clusters.liquidate(clusterOwner.address, operatorIds, clusterAfterRegister),
      DEFAULT_ETH_REGISTER_VALUE, { accountForGas: true });
  });

  it("Updates operatorEthVUnits on liquidation even when cluster EB snapshot is not set", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await clusters.mockCurrentNetworkFeeIndex(1000n);

    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(BPS_DENOMINATOR);
    }

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    expect(await clusters.getClusterVUnits(clusterId)).to.equal(0n);

    const liquidateTx = await clusters.liquidate(clusterOwner.address, operatorIds, clusterAfterRegister);
    await liquidateTx.wait();

    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(0n);
    }
  });

  it("Uses stored cluster EB snapshot vUnits when present when updating operatorEthVUnits on liquidation", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await clusters.mockCurrentNetworkFeeIndex(1000n);

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

    const registerTx3 = await clusters.registerValidator(
      makePublicKey(3),
      operatorIds,
      DEFAULT_SHARES,
      clusterAfter2,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt3 = await registerTx3.wait();
    const clusterAfter3 = parseClusterFromEvent(clusters, receipt3, Events.VALIDATOR_ADDED);

    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(3n * BPS_DENOMINATOR);
    }

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const explicitVUnits = 5n * BPS_DENOMINATOR;
    const baseline = 3n * BPS_DENOMINATOR;
    const deviation = explicitVUnits - baseline;
    await clusters.mockSetClusterVUnits(clusterId, explicitVUnits);
    await clusters.mockSetDaoTotalEthVUnits(explicitVUnits);
    for (const operatorId of operatorIds) {
      await clusters.mockSetOperatorEthVUnits(operatorId, deviation);
    }

    const beforeSnapshotVUnits = await clusters.getClusterVUnits(clusterId);
    expect(beforeSnapshotVUnits).to.equal(explicitVUnits);

    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(deviation);
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(explicitVUnits);
    }

    const liquidateTx = await clusters.liquidate(clusterOwner.address, operatorIds, clusterAfter3);
    await liquidateTx.wait();
    for (const operatorId of operatorIds) {
      expect(await clusters.getOperatorEthVUnits(operatorId)).to.equal(0n);
      expect(await clusters.getEffectiveOperatorVUnits(operatorId)).to.equal(0n);
    }

    const afterSnapshotVUnits = await clusters.getClusterVUnits(clusterId);
    expect(afterSnapshotVUnits).to.equal(explicitVUnits);
  });

  it("Allows the cluster owner to liquidate with 7 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith7Operators);

    await clusters.mockCurrentNetworkFeeIndex(1000n);

    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    await clusters.mockCurrentNetworkFeeIndex(2000n);

    const liquidateTx = await clusters.liquidate(clusterOwner.address, operatorIds, clusterAfterRegister);
    const liquidateReceipt = await liquidateTx.wait();
    await trackGasFromReceipt(liquidateReceipt, [GasGroup.LIQUIDATE_CLUSTER_7]);
  });

  it("Allows the cluster owner to liquidate with 10 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith10Operators);

    await clusters.mockCurrentNetworkFeeIndex(1000n);

    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    await clusters.mockCurrentNetworkFeeIndex(2000n);

    const liquidateTx = await clusters.liquidate(clusterOwner.address, operatorIds, clusterAfterRegister);
    const liquidateReceipt = await liquidateTx.wait();
    await trackGasFromReceipt(liquidateReceipt, [GasGroup.LIQUIDATE_CLUSTER_10]);
  });

  it("Allows the cluster owner to liquidate with 13 operators", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith13Operators);

    await clusters.mockCurrentNetworkFeeIndex(1000n);

    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    await clusters.mockCurrentNetworkFeeIndex(2000n);

    const liquidateTx = await clusters.liquidate(clusterOwner.address, operatorIds, clusterAfterRegister);
    const liquidateReceipt = await liquidateTx.wait();
    await trackGasFromReceipt(liquidateReceipt, [GasGroup.LIQUIDATE_CLUSTER_13]);
  });

  it("Allows a third party to liquidate when the cluster is liquidatable", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);

    await clusters.mockCurrentNetworkFeeIndex(1000n);

    const registerTx = await clusters.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    await clusters.mockCurrentNetworkFeeIndex(2000n);
    await clusters.mockMinimumLiquidationCollateral(DEFAULT_ETH_REGISTER_VALUE + 1n);

    const liquidateTx = await clusters.connect(otherAccount).liquidate(
      clusterOwner.address,
      operatorIds,
      clusterAfterRegister
    );
    const liquidateReceipt = await liquidateTx.wait();
    const clusterAfterLiquidation = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);

    await expect(liquidateTx).to.emit(clusters, Events.CLUSTER_LIQUIDATED);
    expect(clusterAfterLiquidation.active).to.equal(false);
    expect(clusterAfterLiquidation.balance).to.equal(0n);
  });

  it("Allows a third party to liquidate when liquidation threshold units exceed uint64", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deployClustersWith13Operators);

    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const maxUint64 = (1n << 64n) - 1n;
    const rate = 1n << 20n;
    const minimumBlocksBeforeLiquidation = (1n << 44n) + 1n;
    const thresholdUnits = minimumBlocksBeforeLiquidation * rate;
    const wrappedThresholdUnits = thresholdUnits & maxUint64;

    expect(thresholdUnits).to.be.greaterThan(maxUint64);
    expect(wrappedThresholdUnits * ETH_DEDUCTED_DIGITS).to.be.lessThan(clusterAfterRegister.balance);

    await clusters.mockMinimumLiquidationCollateral(0n);
    await clusters.mockEthNetworkFee(rate);
    await clusters.mockMinimumBlocksBeforeLiquidation(minimumBlocksBeforeLiquidation);

    const liquidateTx = await clusters.connect(otherAccount).liquidate(
      clusterOwner.address,
      operatorIds,
      clusterAfterRegister
    );
    const liquidateReceipt = await liquidateTx.wait();
    const clusterAfterLiquidation = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);

    await expect(liquidateTx).to.emit(clusters, Events.CLUSTER_LIQUIDATED);
    expect(clusterAfterLiquidation.active).to.equal(false);
    expect(clusterAfterLiquidation.balance).to.equal(0n);
  });

  it("Is reverted with 'ClusterNotLiquidatable' when a third party tries to liquidate a healthy cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);
    const registerTx = await clusters.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    await expect(clusters.connect(otherAccount).liquidate(
      clusterOwner.address,
      operatorIds,
      clusterAfterRegister
    )).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_NOT_LIQUIDATABLE);
  });

  it("Is reverted with 'ClusterIsLiquidated' when liquidating an already liquidated cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);

    const registerTx = await clusters.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const liquidateTx = await clusters.liquidate(clusterOwner.address, operatorIds, clusterAfterRegister);
    const liquidateReceipt = await liquidateTx.wait();
    const clusterAfterLiquidation = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);

    await expect(clusters.liquidate(
      clusterOwner.address,
      operatorIds,
      clusterAfterLiquidation
    )).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_IS_LIQUIDATED);
  });

  it("Is reverted with 'IncorrectClusterState' when provided cluster data is stale or mismatched", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);

    const registerTx = await clusters.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const mismatchedCluster = {
      ...clusterAfterRegister,
      balance: clusterAfterRegister.balance + 1n,
    };

    await expect(clusters.liquidate(
      clusterOwner.address,
      operatorIds,
      mismatchedCluster
    )).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_STATE);
  });

  it("Is reverted with 'ClusterDoesNotExists' when attempting to liquidate a missing cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await expect(clusters.liquidate(
      clusterOwner.address,
      operatorIds,
      createCluster()
    )).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_DOES_NOT_EXIST);
  });
});

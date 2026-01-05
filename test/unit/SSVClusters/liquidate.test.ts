import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makePublicKey } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, EMPTY_CLUSTER } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";

type ClusterType = typeof EMPTY_CLUSTER;

const createCluster = (overrides: Partial<ClusterType> = {}): ClusterType => ({
  ...EMPTY_CLUSTER,
  active: true,
  ...overrides,
});

const parseClusterFromEvent = (contract: any, receipt: any, eventName: string): ClusterType => {
  for (const log of receipt.logs ?? []) {
    let parsed;
    try {
      parsed = contract.interface.parseLog(log);
    } catch {
      continue;
    }

    if (parsed?.name === eventName) {
      const clusterTuple = parsed.args[parsed.args.length - 1];
      const [validatorCount, networkFeeIndex, index, active, balance] = clusterTuple;

      return {
        validatorCount: BigInt(validatorCount),
        networkFeeIndex: BigInt(networkFeeIndex),
        index: BigInt(index),
        active,
        balance: BigInt(balance),
      };
    }
  }

  throw new Error(`Event ${eventName} not found`);
};

describe("SSVClusters function `liquidate()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;
  let otherAccount: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [clusterOwner, otherAccount] = await connection.ethers.getSigners();
  });

  const deploySSVClustersAndPrepareOperatorsFixture = async () => {
    return ssvClustersHarnessFixture(connection);
  };

  it("Allows the cluster owner to liquidate and emits correct event", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);

    const registerTx = await clusters.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const liquidateTx = await clusters.liquidate(clusterOwner.address, operatorIds, clusterAfterRegister);
    const liquidateReceipt = await liquidateTx.wait();
    const clusterAfterLiquidation = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);

    await expect(liquidateTx).to.emit(clusters, Events.CLUSTER_LIQUIDATED);
    expect(clusterAfterLiquidation.active).to.equal(false);
    expect(clusterAfterLiquidation.balance).to.equal(0n);
  });

  it("Allows a third party to liquidate when the cluster is liquidatable", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);

    const registerTx = await clusters.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    // Make cluster liquidatable by increasing the minimum liquidation collateral above its balance
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

  it("Is reverted with 'ClusterNotLiquidatable' when a third party tries to liquidate a healthy cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const publicKey = makePublicKey(1);
    const registerTx = await clusters.registerValidator(
      publicKey,
      operatorIds,
      DEFAULT_SHARES,
      0,
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
      0,
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
      0,
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
    )).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_DOES_NOT_EXISTS);
  });
});

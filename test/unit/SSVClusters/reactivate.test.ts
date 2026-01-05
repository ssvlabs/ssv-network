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

describe("SSVClusters function `reactivate()`", async () => {
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

  const registerAndLiquidate = async (clusters: any, operatorIds: bigint[]) => {
    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
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

    return { clusterAfterRegister, clusterAfterLiquidation };
  };

  it("Reactivates a liquidated cluster with sufficient balance and emits correct event", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const { clusterAfterLiquidation } = await registerAndLiquidate(clusters, operatorIds);

    const reactivateTx = await clusters.reactivate(
      operatorIds,
      0,
      clusterAfterLiquidation,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const reactivateReceipt = await reactivateTx.wait();
    const clusterAfterReactivate = parseClusterFromEvent(clusters, reactivateReceipt, Events.CLUSTER_REACTIVATED);

    await expect(reactivateTx).to.emit(clusters, Events.CLUSTER_REACTIVATED);
    expect(clusterAfterReactivate.active).to.equal(true);
    expect(clusterAfterReactivate.validatorCount).to.equal(clusterAfterLiquidation.validatorCount);
  });

  it("Is reverted with 'ClusterAlreadyEnabled' when trying to reactivate an active cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const registerTx = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      0,
      createCluster(),
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    await expect(clusters.reactivate(
      operatorIds,
      0,
      clusterAfterRegister,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_ALREADY_ENABLED);
  });

  it("Is reverted with 'ClusterDoesNotExists' when a non-owner tries to reactivate a cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const { clusterAfterLiquidation } = await registerAndLiquidate(clusters, operatorIds);

    await expect(clusters.connect(otherAccount).reactivate(
      operatorIds,
      0,
      clusterAfterLiquidation,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_DOES_NOT_EXISTS);
  });

  it("Is reverted with 'IncorrectClusterState' when provided cluster data is stale or mismatched", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const { clusterAfterLiquidation } = await registerAndLiquidate(clusters, operatorIds);

    const mismatchedCluster = {
      ...clusterAfterLiquidation,
      balance: clusterAfterLiquidation.balance + 1n,
    };

    await expect(clusters.reactivate(
      operatorIds,
      0,
      mismatchedCluster,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_STATE);
  });

  it("Is reverted with 'InsufficientBalance' when reactivation deposit is too low", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const { clusterAfterLiquidation } = await registerAndLiquidate(clusters, operatorIds);

    // Make minimum collateral slightly higher than the provided deposit to force insufficiency.
    await clusters.mockMinimumLiquidationCollateral(DEFAULT_ETH_REGISTER_VALUE + 1_000_000_000n);

    await expect(clusters.reactivate(
      operatorIds,
      0,
      clusterAfterLiquidation,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    )).to.be.revertedWithCustomError(clusters, Errors.INSUFFICIENT_BALANCE);
  });
});

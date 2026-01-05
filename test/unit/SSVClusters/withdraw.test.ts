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

describe("SSVClusters function `withdraw()`", async () => {
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

  const registerCluster = async (clusters: any, operatorIds: bigint[]) => {
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

  it("Withdraws from an existing cluster, updates balance and emits correct event", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const clusterBeforeWithdraw = await registerCluster(clusters, operatorIds);
    const withdrawAmount = 1n;

    const withdrawTx = await clusters.withdraw(operatorIds, withdrawAmount, clusterBeforeWithdraw);
    const withdrawReceipt = await withdrawTx.wait();
    const clusterAfterWithdraw = parseClusterFromEvent(clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

    await expect(withdrawTx).to.emit(clusters, Events.CLUSTER_WITHDRAWN);
    expect(clusterAfterWithdraw.balance).to.equal(clusterBeforeWithdraw.balance - withdrawAmount);
  });

  it("Is reverted with 'InsufficientBalance' when withdrawing more than the cluster balance", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const clusterBeforeWithdraw = await registerCluster(clusters, operatorIds);
    const excessiveAmount = clusterBeforeWithdraw.balance + 1n;

    await expect(clusters.withdraw(
      operatorIds,
      excessiveAmount,
      clusterBeforeWithdraw
    )).to.be.revertedWithCustomError(clusters, Errors.INSUFFICIENT_BALANCE);
  });

  it("Is reverted with 'IncorrectClusterState' when provided cluster data is stale or mismatched", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const clusterBeforeWithdraw = await registerCluster(clusters, operatorIds);

    const mismatchedCluster = {
      ...clusterBeforeWithdraw,
      balance: clusterBeforeWithdraw.balance + 1n,
    };

    await expect(clusters.withdraw(
      operatorIds,
      1n,
      mismatchedCluster
    )).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_STATE);
  });

  it("Is reverted with 'ClusterDoesNotExists' when a non-owner tries to withdraw", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const clusterBeforeWithdraw = await registerCluster(clusters, operatorIds);

    await expect(clusters.connect(otherAccount).withdraw(
      operatorIds,
      1n,
      clusterBeforeWithdraw
    )).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_DOES_NOT_EXISTS);
  });

  it("Is reverted with 'ClusterIsLiquidated' when attempting to withdraw from a liquidated cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const clusterBeforeWithdraw = await registerCluster(clusters, operatorIds);
    await clusters.mockSetClusterLiquidated(clusterOwner.address, operatorIds);

    const liquidatedCluster = {
      validatorCount: 0n,
      networkFeeIndex: 0n,
      index: 0n,
      balance: 0n,
      active: false,
    };

    await expect(clusters.withdraw(
      operatorIds,
      1n,
      liquidatedCluster
    )).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_IS_LIQUIDATED);
  });
});

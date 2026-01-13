import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, EMPTY_CLUSTER } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";

type ClusterType = typeof EMPTY_CLUSTER;

const createCluster = (overrides: Partial<ClusterType> = {}): ClusterType => ({
  ...EMPTY_CLUSTER,
  active: true,
  ...overrides,
});

describe("SSVClusters function `deposit()`", async () => {
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

  it("Deposits into an existing cluster, updates balance and emits correct event", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const clusterBeforeDeposit = await registerCluster(clusters, operatorIds);

    const depositAmount = 1n;

    const depositTx = await clusters.deposit(
      clusterOwner.address,
      operatorIds,
      0,
      clusterBeforeDeposit,
      { value: depositAmount }
    );
    const depositReceipt = await depositTx.wait();
    const clusterAfterDeposit = parseClusterFromEvent(clusters, depositReceipt, Events.CLUSTER_DEPOSITED);

    await expect(depositTx).to.emit(clusters, Events.CLUSTER_DEPOSITED);
    expect(clusterAfterDeposit.balance).to.equal(clusterBeforeDeposit.balance + depositAmount);
  });

  it("Allows a third party to deposit to an existing cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const clusterBeforeDeposit = await registerCluster(clusters, operatorIds);

    const depositAmount = 2n;
    const depositTx = await clusters.connect(otherAccount).deposit(
      clusterOwner.address,
      operatorIds,
      0,
      clusterBeforeDeposit,
      { value: depositAmount }
    );
    const depositReceipt = await depositTx.wait();
    const clusterAfterDeposit = parseClusterFromEvent(clusters, depositReceipt, Events.CLUSTER_DEPOSITED);

    await expect(depositTx).to.emit(clusters, Events.CLUSTER_DEPOSITED);
    expect(clusterAfterDeposit.balance).to.equal(clusterBeforeDeposit.balance + depositAmount);
  });

  it("Is reverted with 'IncorrectClusterState' when provided cluster data is stale or mismatched", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const clusterBeforeDeposit = await registerCluster(clusters, operatorIds);

    const mismatchedCluster = {
      ...clusterBeforeDeposit,
      balance: clusterBeforeDeposit.balance + 1n,
    };

    await expect(clusters.deposit(
      clusterOwner.address,
      operatorIds,
      0,
      mismatchedCluster,
      { value: 1n }
    )).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_STATE);
  });

  it("Is reverted with 'ClusterDoesNotExists' when attempting to deposit into a missing cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await expect(clusters.deposit(
      clusterOwner.address,
      operatorIds,
      0,
      createCluster(),
      { value: 1n }
    )).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_DOES_NOT_EXISTS);
  });
});

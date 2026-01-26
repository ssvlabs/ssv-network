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
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";
import { ethers } from "ethers";

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

  const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
    return ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds])
    );
  };

  const registerCluster = async (clusters: any, operatorIds: bigint[]) => {
    const receipt = await trackGas(
      clusters.registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        0,
        createCluster(),
        { value: DEFAULT_ETH_REGISTER_VALUE }
      ),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE]
    );
    return parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);
  };

  it("Deposits into an existing cluster, updates balance and emits correct event", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const clusterBeforeDeposit = await registerCluster(clusters, operatorIds);

    const depositAmount = 1n;

    const depositReceipt = await trackGas(
      clusters.deposit(
        clusterOwner.address,
        operatorIds,
        0,
        clusterBeforeDeposit,
        { value: depositAmount }
      ),
      [GasGroup.DEPOSIT]
    );
    const clusterAfterDeposit = parseClusterFromEvent(clusters, depositReceipt, Events.CLUSTER_DEPOSITED);

    expect(depositReceipt.eventsByName[Events.CLUSTER_DEPOSITED]).to.have.lengthOf(1);
    expect(clusterAfterDeposit.balance).to.equal(clusterBeforeDeposit.balance + depositAmount);
  });

  it("Does not change operatorEthVUnits or stored cluster EB snapshot when depositing", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const clusterBeforeDeposit = await registerCluster(clusters, operatorIds);

    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    await clusters.mockSetClusterVUnits(clusterId, 7n * VUNITS_PRECISION);

    const beforeClusterVUnits = await clusters.getClusterVUnits(clusterId);
    const beforeOperatorVUnits = await Promise.all(operatorIds.map((id) => clusters.getOperatorEthVUnits(id)));

    const depositAmount = 3n;
    const depositReceipt = await trackGas(
      clusters.deposit(
        clusterOwner.address,
        operatorIds,
        0,
        clusterBeforeDeposit,
        { value: depositAmount }
      ),
      [GasGroup.DEPOSIT]
    );
    const clusterAfterDeposit = parseClusterFromEvent(clusters, depositReceipt, Events.CLUSTER_DEPOSITED);

    expect(clusterAfterDeposit.balance).to.equal(clusterBeforeDeposit.balance + depositAmount);

    const afterClusterVUnits = await clusters.getClusterVUnits(clusterId);
    const afterOperatorVUnits = await Promise.all(operatorIds.map((id) => clusters.getOperatorEthVUnits(id)));

    expect(afterClusterVUnits).to.equal(beforeClusterVUnits);
    expect(afterOperatorVUnits).to.deep.equal(beforeOperatorVUnits);
  });

  it("Allows a third party to deposit to an existing cluster", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const clusterBeforeDeposit = await registerCluster(clusters, operatorIds);

    const depositAmount = 2n;
    const depositReceipt = await trackGas(
      clusters.connect(otherAccount).deposit(
        clusterOwner.address,
        operatorIds,
        0,
        clusterBeforeDeposit,
        { value: depositAmount }
      ),
      [GasGroup.DEPOSIT]
    );
    const clusterAfterDeposit = parseClusterFromEvent(clusters, depositReceipt, Events.CLUSTER_DEPOSITED);

    expect(depositReceipt.eventsByName[Events.CLUSTER_DEPOSITED]).to.have.lengthOf(1);
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

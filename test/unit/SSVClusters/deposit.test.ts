import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import { defaultClustersFixture } from "../../helpers/fixture-presets.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext, computeClusterId, createCluster, makePublicKey, parseClusterFromEvent, registerAndParseCluster } from "../../common/helpers.ts";
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
    ({ connection, networkHelpers, signers: [clusterOwner, otherAccount] } = await setupTestContext());
  });

  const deploySSVClustersAndPrepareOperatorsFixture = async () => {
    return defaultClustersFixture(connection);
  };

  const getContractEthBalance = async (clusters: any) =>
    connection.ethers.provider.getBalance(await clusters.getAddress());

  it("Deposits into an existing cluster, updates balance and emits correct event", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const clusterBeforeDeposit = await registerAndParseCluster(clusters, operatorIds);

    const depositAmount = 1n;
    const contractBalanceBeforeDeposit = await getContractEthBalance(clusters);

    const depositReceipt = await trackGas(
      clusters.deposit(
        clusterOwner.address,
        operatorIds,
        clusterBeforeDeposit,
        { value: depositAmount }
      ),
      [GasGroup.DEPOSIT]
    );
    const clusterAfterDeposit = parseClusterFromEvent(clusters, depositReceipt, Events.CLUSTER_DEPOSITED);
    const contractBalanceAfterDeposit = await getContractEthBalance(clusters);

    expect(depositReceipt.eventsByName[Events.CLUSTER_DEPOSITED]).to.have.lengthOf(1);
    expect(clusterAfterDeposit.balance).to.equal(clusterBeforeDeposit.balance + depositAmount);
    expect(contractBalanceAfterDeposit - contractBalanceBeforeDeposit).to.equal(depositAmount);
  });

  it("Does not change operatorEthVUnits or stored cluster EB snapshot when depositing", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const clusterBeforeDeposit = await registerAndParseCluster(clusters, operatorIds);

    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    await clusters.mockSetClusterVUnits(clusterId, 7n * VUNITS_PRECISION);

    const beforeClusterVUnits = await clusters.getClusterVUnits(clusterId);
    const beforeOperatorVUnits = await Promise.all(operatorIds.map((id) => clusters.getOperatorEthVUnits(id)));

    const depositAmount = 3n;
    const depositReceipt = await trackGas(
      clusters.deposit(
        clusterOwner.address,
        operatorIds,
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

    const clusterBeforeDeposit = await registerAndParseCluster(clusters, operatorIds);

    const depositAmount = 2n;
    const contractBalanceBeforeDeposit = await getContractEthBalance(clusters);

    const depositReceipt = await trackGas(
      clusters.connect(otherAccount).deposit(
        clusterOwner.address,
        operatorIds,
        clusterBeforeDeposit,
        { value: depositAmount }
      ),
      [GasGroup.DEPOSIT]
    );
    const clusterAfterDeposit = parseClusterFromEvent(clusters, depositReceipt, Events.CLUSTER_DEPOSITED);
    const contractBalanceAfterDeposit = await getContractEthBalance(clusters);

    expect(depositReceipt.eventsByName[Events.CLUSTER_DEPOSITED]).to.have.lengthOf(1);
    expect(clusterAfterDeposit.balance).to.equal(clusterBeforeDeposit.balance + depositAmount);
    expect(contractBalanceAfterDeposit - contractBalanceBeforeDeposit).to.equal(depositAmount);
  });

  it("Accumulates contract ETH balance by the sum of multiple deposits", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await clusters.mockEthNetworkFee(0n);
    await clusters.mockCurrentNetworkFeeIndex(0n);
    for (const operatorId of operatorIds) {
      await clusters.mockSetOperatorFee(operatorId, 0n);
    }

    const clusterBeforeDeposits = await registerAndParseCluster(clusters, operatorIds);
    const contractBalanceBeforeDeposits = await getContractEthBalance(clusters);

    const deposit1 = ethers.parseEther("0.01");
    const depositReceipt1 = await trackGas(
      clusters.deposit(
        clusterOwner.address,
        operatorIds,
        clusterBeforeDeposits,
        { value: deposit1 }
      ),
      [GasGroup.DEPOSIT]
    );
    const clusterAfterDeposit1 = parseClusterFromEvent(clusters, depositReceipt1, Events.CLUSTER_DEPOSITED);
    const contractBalanceAfterDeposit1 = await getContractEthBalance(clusters);

    const deposit2 = ethers.parseEther("0.02");
    const depositReceipt2 = await trackGas(
      clusters.connect(otherAccount).deposit(
        clusterOwner.address,
        operatorIds,
        clusterAfterDeposit1,
        { value: deposit2 }
      ),
      [GasGroup.DEPOSIT]
    );
    const clusterAfterDeposit2 = parseClusterFromEvent(clusters, depositReceipt2, Events.CLUSTER_DEPOSITED);
    const contractBalanceAfterDeposit2 = await getContractEthBalance(clusters);

    expect(contractBalanceAfterDeposit1 - contractBalanceBeforeDeposits).to.equal(deposit1);
    expect(contractBalanceAfterDeposit2 - contractBalanceAfterDeposit1).to.equal(deposit2);
    expect(contractBalanceAfterDeposit2 - contractBalanceBeforeDeposits).to.equal(deposit1 + deposit2);
    expect(clusterAfterDeposit2.balance).to.equal(clusterBeforeDeposits.balance + deposit1 + deposit2);
  });

  it("Is reverted with 'IncorrectClusterState' when provided cluster data is stale or mismatched", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const clusterBeforeDeposit = await registerAndParseCluster(clusters, operatorIds);

    const mismatchedCluster = {
      ...clusterBeforeDeposit,
      balance: clusterBeforeDeposit.balance + 1n,
    };

    await expect(clusters.deposit(
      clusterOwner.address,
      operatorIds,
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
      createCluster(),
      { value: 1n }
    )).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_DOES_NOT_EXIST);
  });

  it("Deposit into zero-validator cluster accrues no fees over elapsed blocks", async function () {
    const deployWithFee = async () => ssvClustersHarnessFixture(connection, 4, 10_000_000_000n);
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployWithFee);

    const publicKey = makePublicKey(1);
    const registerTx = await clusters.registerValidator(
      publicKey, operatorIds, DEFAULT_SHARES, createCluster(), { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const removeTx = await clusters.removeValidator(publicKey, operatorIds, clusterAfterRegister);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);
    expect(clusterAfterRemove.validatorCount).to.equal(0n);
    const balanceAtRemoval = clusterAfterRemove.balance;

    await networkHelpers.mine(100);

    const depositAmount = ethers.parseEther("0.5");
    const depositTx = await clusters.deposit(
      clusterOwner.address, operatorIds, clusterAfterRemove, { value: depositAmount }
    );
    const depositReceipt = await depositTx.wait();
    const clusterAfterDeposit = parseClusterFromEvent(clusters, depositReceipt, Events.CLUSTER_DEPOSITED);

    expect(clusterAfterDeposit.balance).to.equal(balanceAtRemoval + depositAmount);
  });

  it("Does not change contract balance when deposit reverts", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const clusterBeforeDeposit = await registerAndParseCluster(clusters, operatorIds);

    const mismatchedCluster = {
      ...clusterBeforeDeposit,
      balance: clusterBeforeDeposit.balance + 1n,
    };
    const contractBalanceBefore = await getContractEthBalance(clusters);

    await expect(
      clusters.deposit(clusterOwner.address, operatorIds, mismatchedCluster, { value: 1n })
    ).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_STATE);

    const contractBalanceAfter = await getContractEthBalance(clusters);
    expect(contractBalanceAfter).to.equal(contractBalanceBefore);
  });
});

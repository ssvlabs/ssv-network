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
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";
import { ethers } from "ethers";

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

  const deploySSVClustersWithLowFeesFixture = async () => {
    return ssvClustersHarnessFixture(connection, 4, 100_000n);
  };

  const registerCluster = async (clusters: any, operatorIds: bigint[]) => {
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

  const getClusterWithdrawnEventArgs = (clusters: any, receipt: any) => {
    for (const log of receipt.logs ?? []) {
      let parsed;
      try {
        parsed = clusters.interface.parseLog(log);
      } catch {
        continue;
      }
      if (parsed?.name === Events.CLUSTER_WITHDRAWN) {
        return parsed.args;
      }
    }
    throw new Error("ClusterWithdrawn event not found");
  };

  it("Withdraws from an existing cluster, updates balance and emits correct event", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await clusters.mockEthNetworkFee(0);
    await clusters.mockCurrentNetworkFeeIndex(0);

    const clusterBeforeWithdraw = await registerCluster(clusters, operatorIds);
    const withdrawAmount = 1n;

    const provider = connection.ethers.provider;
    const ownerBalanceBefore = await provider.getBalance(clusterOwner.address);
    const harnessAddress = await clusters.getAddress();
    const harnessBalanceBefore = await provider.getBalance(harnessAddress);

    const withdrawTx = await clusters.withdraw(operatorIds, withdrawAmount, clusterBeforeWithdraw);
    const withdrawReceipt: any = await withdrawTx.wait();
    await trackGasFromReceipt(withdrawReceipt, [GasGroup.WITHDRAW_CLUSTER_BALANCE]);
    const clusterAfterWithdraw = parseClusterFromEvent(clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN);
    const eventArgs = getClusterWithdrawnEventArgs(clusters, withdrawReceipt);

    const ownerBalanceAfter = await provider.getBalance(clusterOwner.address);
    const harnessBalanceAfter = await provider.getBalance(harnessAddress);
    const gasCost = withdrawReceipt.gasUsed * (withdrawReceipt.effectiveGasPrice ?? withdrawReceipt.gasPrice);

    await expect(withdrawTx).to.emit(clusters, Events.CLUSTER_WITHDRAWN);

    expect(eventArgs.owner).to.equal(clusterOwner.address);
    expect(eventArgs.operatorIds).to.deep.equal(operatorIds);
    expect(eventArgs.value).to.equal(withdrawAmount);

    expect(clusterAfterWithdraw.balance).to.equal(clusterBeforeWithdraw.balance - withdrawAmount);

    expect(harnessBalanceBefore - harnessBalanceAfter).to.equal(withdrawAmount);
    expect(ownerBalanceAfter - ownerBalanceBefore + BigInt(gasCost)).to.equal(withdrawAmount);

    await expect(clusters.withdraw(operatorIds, 1n, clusterBeforeWithdraw))
      .to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_STATE);
  });

  it("Is reverted with 'InsufficientBalance' when withdrawal would make the cluster liquidatable", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await clusters.mockEthNetworkFee(0);
    await clusters.mockCurrentNetworkFeeIndex(0);

    const clusterBeforeWithdraw = await registerCluster(clusters, operatorIds);
    await clusters.mockMinimumLiquidationCollateral(clusterBeforeWithdraw.balance);

    await expect(clusters.withdraw(
      operatorIds,
      1n,
      clusterBeforeWithdraw
    )).to.be.revertedWithCustomError(clusters, Errors.INSUFFICIENT_BALANCE);
  });

  it("Settles full fees when usageUnits exceeds uint64", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersWithLowFeesFixture);

    const clusterBeforeWithdraw = await registerCluster(clusters, operatorIds);

    await connection.ethers.provider.send("evm_mine", []);

    const maxUint64 = (1n << 64n) - 1n;
    await clusters.mockEthNetworkFee(0n);
    await clusters.mockCurrentNetworkFeeIndex(maxUint64);
    await clusters.mockMinimumBlocksBeforeLiquidation(0n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    const withdrawTx = await clusters.withdraw(operatorIds, 0n, clusterBeforeWithdraw);
    const withdrawReceipt = await withdrawTx.wait();
    const clusterAfterWithdraw = parseClusterFromEvent(clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

    const units = clusterBeforeWithdraw.validatorCount * VUNITS_PRECISION;
    const idxOp = clusterAfterWithdraw.index - clusterBeforeWithdraw.index;
    const idxNet = maxUint64 - clusterBeforeWithdraw.networkFeeIndex;
    const usageUnits = (idxOp * units) / VUNITS_PRECISION + (idxNet * units) / VUNITS_PRECISION;
    const wrappedUsageUnits = usageUnits & maxUint64;

    expect(usageUnits).to.be.greaterThan(maxUint64);
    expect(wrappedUsageUnits * 100_000n).to.be.lessThan(clusterBeforeWithdraw.balance);
    expect(clusterAfterWithdraw.balance).to.equal(0n);
  });

  it("Is reverted with 'IncorrectClusterVersion' when withdrawing from an SSV cluster", async function () {
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

    await expect(clusters.withdraw(
      operatorIds,
      1n,
      ssvCluster
    )).to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_VERSION);
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
    )).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_DOES_NOT_EXIST);
  });

  it("Withdraws deposited funds from a liquidated cluster without reactivating", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await clusters.mockEthNetworkFee(0);
    await clusters.mockCurrentNetworkFeeIndex(0);

    // Register then liquidate the cluster
    await registerCluster(clusters, operatorIds);
    await clusters.mockSetClusterLiquidated(clusterOwner.address, operatorIds);

    const liquidatedCluster = {
      validatorCount: 0n,
      networkFeeIndex: 0n,
      index: 0n,
      balance: 0n,
      active: false,
    };

    // Deposit to the liquidated cluster in preparation for reactivation
    const depositAmount = ethers.parseEther("0.1");
    const depositTx = await clusters.deposit(
      clusterOwner.address,
      operatorIds,
      liquidatedCluster,
      { value: depositAmount }
    );
    const depositReceipt = await depositTx.wait();
    const clusterAfterDeposit = parseClusterFromEvent(clusters, depositReceipt, Events.CLUSTER_DEPOSITED);

    // Owner changes mind — withdraw the deposit without reactivating
    const provider = connection.ethers.provider;
    const ownerBalanceBefore = await provider.getBalance(clusterOwner.address);
    const harnessAddress = await clusters.getAddress();
    const harnessBalanceBefore = await provider.getBalance(harnessAddress);

    const withdrawTx = await clusters.withdraw(operatorIds, depositAmount, clusterAfterDeposit);
    const withdrawReceipt: any = await withdrawTx.wait();
    const clusterAfterWithdraw = parseClusterFromEvent(clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

    const ownerBalanceAfter = await provider.getBalance(clusterOwner.address);
    const harnessBalanceAfter = await provider.getBalance(harnessAddress);
    const gasCost = withdrawReceipt.gasUsed * (withdrawReceipt.effectiveGasPrice ?? withdrawReceipt.gasPrice);

    await expect(withdrawTx).to.emit(clusters, Events.CLUSTER_WITHDRAWN);

    // Cluster balance returned to zero, ETH transferred back to owner
    expect(clusterAfterWithdraw.balance).to.equal(0n);
    expect(clusterAfterWithdraw.active).to.equal(false);
    expect(harnessBalanceBefore - harnessBalanceAfter).to.equal(depositAmount);
    expect(ownerBalanceAfter - ownerBalanceBefore + BigInt(gasCost)).to.equal(depositAmount);
  });

  it("Withdraws full balance from a liquidated cluster that received multiple deposits", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await clusters.mockEthNetworkFee(0);
    await clusters.mockCurrentNetworkFeeIndex(0);

    // Register then liquidate
    await registerCluster(clusters, operatorIds);
    await clusters.mockSetClusterLiquidated(clusterOwner.address, operatorIds);

    const liquidatedCluster = {
      validatorCount: 0n,
      networkFeeIndex: 0n,
      index: 0n,
      balance: 0n,
      active: false,
    };

    // Two separate deposits
    const deposit1 = ethers.parseEther("0.05");
    const deposit2 = ethers.parseEther("0.03");

    const depositTx1 = await clusters.deposit(clusterOwner.address, operatorIds, liquidatedCluster, { value: deposit1 });
    const receipt1 = await depositTx1.wait();
    const clusterAfterDeposit1 = parseClusterFromEvent(clusters, receipt1, Events.CLUSTER_DEPOSITED);

    const depositTx2 = await clusters.deposit(clusterOwner.address, operatorIds, clusterAfterDeposit1, { value: deposit2 });
    const receipt2 = await depositTx2.wait();
    const clusterAfterDeposit2 = parseClusterFromEvent(clusters, receipt2, Events.CLUSTER_DEPOSITED);

    expect(clusterAfterDeposit2.balance).to.equal(deposit1 + deposit2);

    // Withdraw the full accumulated balance
    const withdrawTx = await clusters.withdraw(operatorIds, deposit1 + deposit2, clusterAfterDeposit2);
    const withdrawReceipt: any = await withdrawTx.wait();
    const clusterAfterWithdraw = parseClusterFromEvent(clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

    expect(clusterAfterWithdraw.balance).to.equal(0n);
    expect(clusterAfterWithdraw.active).to.equal(false);

    // Partial withdrawal should also succeed — confirm InsufficientBalance on over-withdrawal
    await expect(
      clusters.withdraw(operatorIds, 1n, clusterAfterWithdraw)
    ).to.be.revertedWithCustomError(clusters, Errors.INSUFFICIENT_BALANCE);
  });
});

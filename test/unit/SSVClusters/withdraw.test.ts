import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import { defaultClustersFixture } from "../../helpers/fixture-presets.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext, computeClusterId, computeEBRoot, createCluster, extractEventArgs, makePublicKey, parseClusterFromEvent, registerAndParseCluster } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, ETH_DEDUCTED_DIGITS, VUNITS_PRECISION } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";
import { expectETHDeltas } from "../../helpers/balance.ts";
import { ethers } from "ethers";

describe("SSVClusters function `withdraw()`", async () => {
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

  const deploySSVClustersWithLowFeesFixture = async () => {
    return ssvClustersHarnessFixture(connection, 4, 100_000n);
  };



  it("Withdraws from an existing cluster, updates balance and emits correct event", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await clusters.mockEthNetworkFee(0);
    await clusters.mockCurrentNetworkFeeIndex(0);

    const clusterBeforeWithdraw = await registerAndParseCluster(clusters, operatorIds);
    const withdrawAmount = 1n;

    const harnessAddress = await clusters.getAddress();

    const { receipt: withdrawReceipt } = await expectETHDeltas(connection.ethers.provider,
      () => clusters.withdraw(operatorIds, withdrawAmount, clusterBeforeWithdraw),
      [
        { address: clusterOwner.address, expectedDelta: withdrawAmount, accountForGas: true },
        { address: harnessAddress, expectedDelta: -withdrawAmount },
      ]);
    await trackGasFromReceipt(withdrawReceipt, [GasGroup.WITHDRAW_CLUSTER_BALANCE]);
    const clusterAfterWithdraw = parseClusterFromEvent(clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN);
    const eventArgs = extractEventArgs(clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

    expect(eventArgs.owner).to.equal(clusterOwner.address);
    expect(eventArgs.operatorIds).to.deep.equal(operatorIds);
    expect(eventArgs.value).to.equal(withdrawAmount);

    expect(clusterAfterWithdraw.balance).to.equal(clusterBeforeWithdraw.balance - withdrawAmount);

    await expect(clusters.withdraw(operatorIds, 1n, clusterBeforeWithdraw))
      .to.be.revertedWithCustomError(clusters, Errors.INCORRECT_CLUSTER_STATE);
  });

  it("Is reverted with 'InsufficientBalance' when withdrawal would make the cluster liquidatable", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await clusters.mockEthNetworkFee(0);
    await clusters.mockCurrentNetworkFeeIndex(0);

    const clusterBeforeWithdraw = await registerAndParseCluster(clusters, operatorIds);
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

    const clusterBeforeWithdraw = await registerAndParseCluster(clusters, operatorIds);

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
    const overflowUnits = usageUnits >> 64n;
    const expectedUsageFromWrapped = wrappedUsageUnits + (overflowUnits << 64n);
    const expectedBalanceIfUint64Truncated = clusterBeforeWithdraw.balance - wrappedUsageUnits * 100_000n;

    expect(overflowUnits).to.equal(1n);
    expect(usageUnits).to.equal(expectedUsageFromWrapped);
    expect(expectedBalanceIfUint64Truncated).to.not.equal(clusterAfterWithdraw.balance);
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

    const clusterBeforeWithdraw = await registerAndParseCluster(clusters, operatorIds);
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

    const clusterBeforeWithdraw = await registerAndParseCluster(clusters, operatorIds);

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

    const clusterBeforeWithdraw = await registerAndParseCluster(clusters, operatorIds);

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
    await registerAndParseCluster(clusters, operatorIds);
    await clusters.mockSetClusterLiquidated(clusterOwner.address, operatorIds);

    const liquidatedCluster = {
      validatorCount: 0n,
      networkFeeIndex: 0n,
      index: 0n,
      balance: 0n,
      active: false,
    };
    const depositAmount = ethers.parseEther("0.1");
    const depositTx = await clusters.deposit(
      clusterOwner.address,
      operatorIds,
      liquidatedCluster,
      { value: depositAmount }
    );
    const depositReceipt = await depositTx.wait();
    const clusterAfterDeposit = parseClusterFromEvent(clusters, depositReceipt, Events.CLUSTER_DEPOSITED);
    const harnessAddress = await clusters.getAddress();

    const { receipt: withdrawReceipt } = await expectETHDeltas(connection.ethers.provider,
      () => clusters.withdraw(operatorIds, depositAmount, clusterAfterDeposit),
      [
        { address: clusterOwner.address, expectedDelta: depositAmount, accountForGas: true },
        { address: harnessAddress, expectedDelta: -depositAmount },
      ]);
    const clusterAfterWithdraw = parseClusterFromEvent(clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

    expect(clusterAfterWithdraw.balance).to.equal(0n);
    expect(clusterAfterWithdraw.active).to.equal(false);
  });

  it("Withdraws full balance from a liquidated cluster that received multiple deposits", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await clusters.mockEthNetworkFee(0);
    await clusters.mockCurrentNetworkFeeIndex(0);
    await registerAndParseCluster(clusters, operatorIds);
    await clusters.mockSetClusterLiquidated(clusterOwner.address, operatorIds);

    const liquidatedCluster = {
      validatorCount: 0n,
      networkFeeIndex: 0n,
      index: 0n,
      balance: 0n,
      active: false,
    };
    const deposit1 = ethers.parseEther("0.05");
    const deposit2 = ethers.parseEther("0.03");

    const depositTx1 = await clusters.deposit(clusterOwner.address, operatorIds, liquidatedCluster, { value: deposit1 });
    const receipt1 = await depositTx1.wait();
    const clusterAfterDeposit1 = parseClusterFromEvent(clusters, receipt1, Events.CLUSTER_DEPOSITED);

    const depositTx2 = await clusters.deposit(clusterOwner.address, operatorIds, clusterAfterDeposit1, { value: deposit2 });
    const receipt2 = await depositTx2.wait();
    const clusterAfterDeposit2 = parseClusterFromEvent(clusters, receipt2, Events.CLUSTER_DEPOSITED);

    expect(clusterAfterDeposit2.balance).to.equal(deposit1 + deposit2);
    const withdrawTx = await clusters.withdraw(operatorIds, deposit1 + deposit2, clusterAfterDeposit2);
    const withdrawReceipt: any = await withdrawTx.wait();
    const clusterAfterWithdraw = parseClusterFromEvent(clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

    expect(clusterAfterWithdraw.balance).to.equal(0n);
    expect(clusterAfterWithdraw.active).to.equal(false);
    await expect(
      clusters.withdraw(operatorIds, 1n, clusterAfterWithdraw)
    ).to.be.revertedWithCustomError(clusters, Errors.INSUFFICIENT_BALANCE);
  });

  it("Withdraws from a liquidated zero-validator cluster even with non-zero liquidation settings", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await clusters.mockEthNetworkFee(123_000n);
    await clusters.mockMinimumBlocksBeforeLiquidation(50_190n);
    await clusters.mockMinimumLiquidationCollateral(94_000n);
    await clusters.mockCurrentNetworkFeeIndex(777n);

    await registerAndParseCluster(clusters, operatorIds);
    await clusters.mockSetClusterLiquidated(clusterOwner.address, operatorIds);

    const liquidatedCluster = {
      validatorCount: 0n,
      networkFeeIndex: 0n,
      index: 0n,
      balance: 0n,
      active: false,
    };

    const depositAmount = ethers.parseEther("0.02");
    const depositTx = await clusters.deposit(
      clusterOwner.address,
      operatorIds,
      liquidatedCluster,
      { value: depositAmount }
    );
    const depositReceipt = await depositTx.wait();
    const clusterAfterDeposit = parseClusterFromEvent(clusters, depositReceipt, Events.CLUSTER_DEPOSITED);

    const withdrawTx = await clusters.withdraw(operatorIds, depositAmount, clusterAfterDeposit);
    const withdrawReceipt = await withdrawTx.wait();
    const clusterAfterWithdraw = parseClusterFromEvent(clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

    expect(clusterAfterWithdraw.active).to.equal(false);
    expect(clusterAfterWithdraw.validatorCount).to.equal(0n);
    expect(clusterAfterWithdraw.balance).to.equal(0n);
  });

  it("Cluster balance becomes 0 when accumulated fees exceed the remaining balance (no underflow)", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    await clusters.mockMinimumBlocksBeforeLiquidation(0n);
    await clusters.mockMinimumLiquidationCollateral(0n);
    await clusters.mockEthNetworkFee(0n);

    const cluster = await registerAndParseCluster(clusters, operatorIds);

    const indexToDrainBalance = DEFAULT_ETH_REGISTER_VALUE / ETH_DEDUCTED_DIGITS + 1n;
    await clusters.mockCurrentNetworkFeeIndex(indexToDrainBalance);

    const withdrawTx = await clusters.withdraw(operatorIds, 0n, cluster);
    const withdrawReceipt: any = await withdrawTx.wait();
    const clusterAfterWithdraw = parseClusterFromEvent(clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

    expect(clusterAfterWithdraw.balance).to.equal(0n);
  });

  it("Withdraws from a liquidated cluster after explicit EB update", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersAndPrepareOperatorsFixture);

    const cluster = await registerAndParseCluster(clusters, operatorIds);
    const clusterId = computeClusterId(clusterOwner.address, operatorIds);
    const effectiveBalance = 160;
    const ebBlockNum = 1;

    await clusters.mockSetEBRoot(ebBlockNum, computeEBRoot(clusterId, effectiveBalance));
    const ebTx = await clusters.updateClusterBalance(
      ebBlockNum,
      clusterOwner.address,
      operatorIds,
      cluster,
      effectiveBalance,
      []
    );
    const ebReceipt = await ebTx.wait();
    const clusterAfterEB = parseClusterFromEvent(clusters, ebReceipt, Events.CLUSTER_BALANCE_UPDATED);

    const liquidateTx = await clusters.liquidate(clusterOwner.address, operatorIds, clusterAfterEB);
    const liquidateReceipt = await liquidateTx.wait();
    const liquidatedCluster = parseClusterFromEvent(clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED);

    expect(liquidatedCluster.active).to.equal(false);
    expect(liquidatedCluster.validatorCount).to.equal(clusterAfterEB.validatorCount);

    const depositAmount = ethers.parseEther("0.03");
    const depositTx = await clusters.deposit(
      clusterOwner.address,
      operatorIds,
      liquidatedCluster,
      { value: depositAmount }
    );
    const depositReceipt = await depositTx.wait();
    const clusterAfterDeposit = parseClusterFromEvent(clusters, depositReceipt, Events.CLUSTER_DEPOSITED);

    const withdrawTx = await clusters.withdraw(operatorIds, depositAmount, clusterAfterDeposit);
    const withdrawReceipt = await withdrawTx.wait();
    const clusterAfterWithdraw = parseClusterFromEvent(clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

    expect(clusterAfterWithdraw.active).to.equal(false);
    expect(clusterAfterWithdraw.validatorCount).to.equal(clusterAfterEB.validatorCount);
    expect(clusterAfterWithdraw.balance).to.equal(0n);
  });

  it("Zero-validator cluster allows full balance withdrawal without fee deduction", async function () {
    const { clusters, operatorIds } =
      await networkHelpers.loadFixture(deploySSVClustersWithLowFeesFixture);

    await clusters.mockEthNetworkFee(100_000n);

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

    await networkHelpers.mine(100);

    const fullBalance = clusterAfterRemove.balance;
    const withdrawTx = await clusters.withdraw(operatorIds, fullBalance, clusterAfterRemove);
    const withdrawReceipt = await withdrawTx.wait();
    const clusterAfterWithdraw = parseClusterFromEvent(clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

    expect(clusterAfterWithdraw.balance).to.equal(0n);
    expect(clusterAfterWithdraw.active).to.equal(true);
  });
});

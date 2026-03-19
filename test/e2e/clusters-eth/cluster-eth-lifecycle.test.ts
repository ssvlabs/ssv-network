import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  makePublicKey,
  parseClusterFromEvent,
  registerOperators,
  whitelistAddresses,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_LIQUIDATION_THRESHOLD,
  OP_ETH_FEE_RAW,
  DEFAULT_NETWORK_FEE_RAW,
  DEFAULT_NETWORK_FEE_UNPACKED,
} from '../../common/constants.ts';
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import {
  mineBlocks,
  getBlockNumber,
  calcClusterBurn,
  calcLiquidationThreshold,
  defaultVUnits,
  snapshotContractBalance,
} from "../../helpers/index.ts";

const MIN_BLOCKS_BEFORE_LIQ = MINIMAL_LIQUIDATION_THRESHOLD;
const NUM_OPERATORS = 4n;

describe("ETH Cluster Lifecycle", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;
  let liquidator: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner, liquidator] } = await setupTestContext());
  });

  const deployFixture = async () => {
    const { network, views, ssvToken, cssvToken } = await ssvNetworkFullFixture(connection);

    await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
    await network.updateMinimumLiquidationCollateral(0n);

    const operatorIds = await registerOperators(network, clusterOwner, 4);
    await whitelistAddresses(network, clusterOwner, operatorIds, [clusterOwner.address]);

    return { network, views, operatorIds };
  };


  describe("ETH Cluster Lifecycle", () => {
    it("Creates cluster, deposits, advances blocks, withdraws with correct fee deduction", async function () {
      const { network, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regReceipt = await regTx.wait();
      const b0 = regReceipt!.blockNumber;
      let cluster = parseClusterFromEvent(network, regReceipt, Events.VALIDATOR_ADDED);
      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);
      expect(cluster.validatorCount).to.equal(1n);
      expect(cluster.active).to.equal(true);

      await mineBlocks(provider, 49);
      const depositVal = connection.ethers.parseEther("5");
      const depTx = await network.connect(clusterOwner).deposit(
        clusterOwner.address, operatorIds, cluster,
        { value: depositVal },
      );
      const depReceipt = await depTx.wait();
      cluster = parseClusterFromEvent(network, depReceipt, Events.CLUSTER_DEPOSITED);
      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE + depositVal);

      const currentBlock = await getBlockNumber(provider);
      const blocksToMine = (b0 + 100) - currentBlock - 1;
      await mineBlocks(provider, blocksToMine);

      const withdrawAmount = connection.ethers.parseEther("2");
      const contractBalBefore = await snapshotContractBalance(provider, await network.getAddress());
      const withdrawTx = await network.connect(clusterOwner).withdraw(operatorIds, withdrawAmount, cluster);
      const withdrawReceipt = await withdrawTx.wait();
      const wBlock = withdrawReceipt!.blockNumber;
      const clusterAfter = parseClusterFromEvent(network, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

      const blockDiff = BigInt(wBlock - b0);
      const vUnits = defaultVUnits(1n);
      const expectedFees = calcClusterBurn({
        blockDiff,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      const expectedBalance = DEFAULT_ETH_REGISTER_VALUE + depositVal - expectedFees - withdrawAmount;
      expect(clusterAfter.balance).to.equal(expectedBalance);

      const contractBalAfter = await snapshotContractBalance(provider, await network.getAddress());
      expect(contractBalBefore - contractBalAfter).to.equal(withdrawAmount);
    });

    it("Deposit at same block as registration — no fee settlement (edge)", async function () {
      const { network, operatorIds } = await networkHelpers.loadFixture(deployFixture);

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = parseClusterFromEvent(network, await regTx.wait(), Events.VALIDATOR_ADDED);

      const secondDeposit = connection.ethers.parseEther("5")
      const depTx = await network.connect(clusterOwner).deposit(
        clusterOwner.address, operatorIds, cluster,
        { value: secondDeposit},
      );
      cluster = parseClusterFromEvent(network, await depTx.wait(), Events.CLUSTER_DEPOSITED);

      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE + secondDeposit);
    });

    it("Multiple deposits accumulate without fee settlement (edge)", async function () {
      const { network, operatorIds } = await networkHelpers.loadFixture(deployFixture);

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = parseClusterFromEvent(network, await regTx.wait(), Events.VALIDATOR_ADDED);

      await mineBlocks(connection.ethers.provider, 10);

      const secondDep = connection.ethers.parseEther("3");
      let depTx = await network.connect(clusterOwner).deposit(
        clusterOwner.address, operatorIds, cluster, { value: secondDep },
      );
      cluster = parseClusterFromEvent(network, await depTx.wait(), Events.CLUSTER_DEPOSITED);
      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE + secondDep);

      await mineBlocks(connection.ethers.provider, 10);

      const thirdDep = connection.ethers.parseEther("2");
      depTx = await network.connect(clusterOwner).deposit(
        clusterOwner.address, operatorIds, cluster, { value: thirdDep },
      );
      cluster = parseClusterFromEvent(network, await depTx.wait(), Events.CLUSTER_DEPOSITED);

      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE + secondDep + thirdDep);
    });
  });

  describe(" Withdraw Exactly To Liquidation Threshold", () => {
    it("Allows withdraw to exact threshold but rejects 1 more wei", async function () {
      const { network, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regReceipt = await regTx.wait();
      let cluster = parseClusterFromEvent(network, regReceipt, Events.VALIDATOR_ADDED);

      await mineBlocks(provider, 9);

      const blockDiff = 10n;
      const vUnits = defaultVUnits(1n);
      const feesAt10 = calcClusterBurn({
        blockDiff,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      const balanceAfterFees = DEFAULT_ETH_REGISTER_VALUE - feesAt10;

      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_BEFORE_LIQ,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      const maxWithdrawable = balanceAfterFees - liqThreshold;

      const withdrawTx = await network.connect(clusterOwner).withdraw(operatorIds, maxWithdrawable, cluster);
      cluster = parseClusterFromEvent(network, await withdrawTx.wait(), Events.CLUSTER_WITHDRAWN);

      expect(cluster.balance).to.equal(liqThreshold);

      await expect(
        network.connect(clusterOwner).withdraw(operatorIds, 1n, cluster),
      ).to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
    });

    it("ValidatorCount == 0 allows full withdrawal (edge)", async function () {
      const { network, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const deposit = connection.ethers.parseEther("5");
      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: deposit },
      );
      const regReceipt = await regTx.wait();
      const regBlock = regReceipt!.blockNumber;
      let cluster = parseClusterFromEvent(network, regReceipt, Events.VALIDATOR_ADDED);

      await mineBlocks(provider, 5);

      const removeTx = await network.connect(clusterOwner).removeValidator(makePublicKey(1), operatorIds, cluster);
      const removeReceipt = await removeTx.wait();
      const removeBlock = removeReceipt!.blockNumber;
      cluster = parseClusterFromEvent(network, removeReceipt, Events.VALIDATOR_REMOVED);
      expect(cluster.validatorCount).to.equal(0n);

      const blockDiff = BigInt(removeBlock - regBlock);
      const vUnits = defaultVUnits(1n);
      const fees = calcClusterBurn({
        blockDiff,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const expectedFullBalance = deposit - fees;

      const fullBalance = cluster.balance;
      expect(fullBalance).to.equal(expectedFullBalance);

      const wTx = await network.connect(clusterOwner).withdraw(operatorIds, fullBalance, cluster);
      cluster = parseClusterFromEvent(network, await wTx.wait(), Events.CLUSTER_WITHDRAWN);
      expect(cluster.balance).to.equal(0n);
    });
  });

  describe("Third-Party Liquidation With Bounty", () => {
    it("Liquidates cluster after balance drops below threshold, liquidator receives bounty", async function () {
      const { network, views, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const vUnits = defaultVUnits(1n);
      const burnPerBlock = calcClusterBurn({
        blockDiff: 1n,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_BEFORE_LIQ,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      const blocksAboveThreshold = 10n;
      const deposit = liqThreshold + burnPerBlock * (blocksAboveThreshold + 1n);

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: deposit },
      );
      const regReceipt = await regTx.wait();
      const b0 = regReceipt!.blockNumber;
      let cluster = parseClusterFromEvent(network, regReceipt, Events.VALIDATOR_ADDED);

      const blocksUntilLiquidatable = Number((deposit - liqThreshold) / burnPerBlock);

      const currentBlock1 = await getBlockNumber(provider);
      const targetForNotLiq = b0 + blocksUntilLiquidatable;
      const blocksToMineForNotLiq = targetForNotLiq - currentBlock1 - 1;
      if (blocksToMineForNotLiq > 0) await mineBlocks(provider, blocksToMineForNotLiq);

      await expect(
        network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, cluster),
      ).to.be.revertedWithCustomError(network, Errors.CLUSTER_NOT_LIQUIDATABLE);

      const currentBlock2 = await getBlockNumber(provider);
      const targetForLiq = b0 + blocksUntilLiquidatable + 1;
      const blocksToMineForLiq = targetForLiq - currentBlock2 - 1;
      if (blocksToMineForLiq > 0) await mineBlocks(provider, blocksToMineForLiq);

      const liqBalBefore = await provider.getBalance(liquidator.address);
      const liqTx = await network.connect(liquidator).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      const liqReceipt = await liqTx.wait();
      const liqBlock = liqReceipt!.blockNumber;
      const blockDiff = BigInt(liqBlock - b0);

      const totalFees = calcClusterBurn({
        blockDiff,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      const balanceAfterFees = deposit - totalFees;

      const liqBalAfter = await provider.getBalance(liquidator.address);
      const gasUsed = liqReceipt!.gasUsed * liqReceipt!.gasPrice;
      expect(liqBalAfter - liqBalBefore + gasUsed).to.equal(balanceAfterFees);

      const liqCluster = parseClusterFromEvent(network, liqReceipt, Events.CLUSTER_LIQUIDATED);
      expect(liqCluster.active).to.equal(false);
      expect(liqCluster.balance).to.equal(0n);
      expect(liqCluster.index).to.equal(0n);
      expect(liqCluster.networkFeeIndex).to.equal(0n);

      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(opId);
        expect(opData.validatorCount).to.equal(0);
      }
      expect(await views.getNetworkValidatorsCount()).to.equal(0);
    });

    it("Owner can always self-liquidate regardless of balance (edge)", async function () {
      const { network, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regReceipt = await regTx.wait();
      const b0 = regReceipt!.blockNumber;
      let cluster = parseClusterFromEvent(network, regReceipt, Events.VALIDATOR_ADDED);

      const ownerBalBefore = await provider.getBalance(clusterOwner.address);
      const selfLiqTx = await network.connect(clusterOwner).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      const selfLiqReceipt = await selfLiqTx.wait();
      const selfLiqBlock = selfLiqReceipt!.blockNumber;
      const blockDiff = BigInt(selfLiqBlock - b0);

      const vUnits = defaultVUnits(1n);
      const totalFees = calcClusterBurn({
        blockDiff,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const expectedBounty = DEFAULT_ETH_REGISTER_VALUE - totalFees;

      const ownerBalAfter = await provider.getBalance(clusterOwner.address);
      const gasUsed = selfLiqReceipt!.gasUsed * selfLiqReceipt!.gasPrice;
      expect(ownerBalAfter - ownerBalBefore + gasUsed).to.equal(expectedBounty);

      const liqCluster = parseClusterFromEvent(network, selfLiqReceipt, Events.CLUSTER_LIQUIDATED);
      expect(liqCluster.active).to.equal(false);
      expect(liqCluster.balance).to.equal(0n);
    });
  });

  describe("Reactivation After Liquidation", () => {
    it("Full lifecycle: create → liquidate → reactivate → verify fee accrual from reactivation point", async function () {
      const { network, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const vUnits = defaultVUnits(1n);
      const burnPerBlock = calcClusterBurn({
        blockDiff: 1n,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_BEFORE_LIQ,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      const deposit = liqThreshold + burnPerBlock * 5n;

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: deposit },
      );
      const regReceipt = await regTx.wait();
      let cluster = parseClusterFromEvent(network, regReceipt, Events.VALIDATOR_ADDED);

      const blocksUntilLiquidatable = Number((deposit - liqThreshold) / burnPerBlock);
      await mineBlocks(provider, blocksUntilLiquidatable);

      const liqTx = await network.connect(liquidator).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      const liqReceipt = await liqTx.wait();
      cluster = parseClusterFromEvent(network, liqReceipt, Events.CLUSTER_LIQUIDATED);
      expect(cluster.active).to.equal(false);
      expect(cluster.balance).to.equal(0n);

      await mineBlocks(provider, 76);

      const reactivateAmount = connection.ethers.parseEther("5");
      const reactivateTx = await network.connect(clusterOwner).reactivate(
        operatorIds, cluster, { value: reactivateAmount },
      );
      const reactivateReceipt = await reactivateTx.wait();
      const reactivateBlock = reactivateReceipt!.blockNumber;
      cluster = parseClusterFromEvent(network, reactivateReceipt, Events.CLUSTER_REACTIVATED);

      expect(cluster.active).to.equal(true);
      expect(cluster.balance).to.equal(reactivateAmount);

      await mineBlocks(provider, 99);
      const withdrawAmount = connection.ethers.parseEther("1");
      const withdrawTx = await network.connect(clusterOwner).withdraw(operatorIds, withdrawAmount, cluster);
      const withdrawReceipt = await withdrawTx.wait();
      const withdrawBlock = withdrawReceipt!.blockNumber;
      const clusterAfter = parseClusterFromEvent(network, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

      const blocksSinceReactivation = BigInt(withdrawBlock - reactivateBlock);
      const feesAfterReactivation = calcClusterBurn({
        blockDiff: blocksSinceReactivation,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      const expectedBalance = reactivateAmount - feesAfterReactivation - withdrawAmount;
      expect(clusterAfter.balance).to.equal(expectedBalance);
    });
  });

  describe("Deposit Into Liquidated Cluster + Reactivation", () => {
    it("Deposits into liquidated cluster accumulate, reactivation uses sum", async function () {
      const { network, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const vUnits = defaultVUnits(1n);
      const burnPerBlock = calcClusterBurn({
        blockDiff: 1n,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_BEFORE_LIQ,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      const deposit = liqThreshold + burnPerBlock * 5n;

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await regTx.wait(), Events.VALIDATOR_ADDED);

      const blocksUntilLiquidatable = Number((deposit - liqThreshold) / burnPerBlock);
      await mineBlocks(provider, blocksUntilLiquidatable);

      const liqTx = await network.connect(liquidator).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      cluster = parseClusterFromEvent(network, await liqTx.wait(), Events.CLUSTER_LIQUIDATED);
      expect(cluster.active).to.equal(false);
      expect(cluster.balance).to.equal(0n);

      const deposit1 = connection.ethers.parseEther("3");
      const dep1Tx = await network.connect(clusterOwner).deposit(
        clusterOwner.address, operatorIds, cluster, { value: deposit1 },
      );
      cluster = parseClusterFromEvent(network, await dep1Tx.wait(), Events.CLUSTER_DEPOSITED);
      expect(cluster.active).to.equal(false);
      expect(cluster.balance).to.equal(deposit1);

      const deposit2 = connection.ethers.parseEther("2");
      const dep2Tx = await network.connect(clusterOwner).deposit(
        clusterOwner.address, operatorIds, cluster, { value: deposit2 },
      );
      cluster = parseClusterFromEvent(network, await dep2Tx.wait(), Events.CLUSTER_DEPOSITED);
      expect(cluster.active).to.equal(false);
      expect(cluster.balance).to.equal(deposit1 + deposit2);

      const reactivateAmount = connection.ethers.parseEther("1");
      const reactivateTx = await network.connect(clusterOwner).reactivate(
        operatorIds, cluster, { value: reactivateAmount },
      );
      cluster = parseClusterFromEvent(network, await reactivateTx.wait(), Events.CLUSTER_REACTIVATED);

      expect(cluster.active).to.equal(true);
      expect(cluster.balance).to.equal(deposit1 + deposit2 + reactivateAmount);
    });
  });
});

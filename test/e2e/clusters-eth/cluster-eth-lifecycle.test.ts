import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  createCluster,
  makePublicKey,
  parseClusterFromEvent,
} from "../../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  ETH_DEDUCTED_DIGITS,
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
} from "../helpers/index.ts";

const OP_ETH_FEE = 1_000_000_000n;
const OP_ETH_FEE_RAW = OP_ETH_FEE / ETH_DEDUCTED_DIGITS;
const NETWORK_FEE_RAW = 5_000n;
const MIN_BLOCKS_BEFORE_LIQ = 100n;
const MIN_LIQ_COLLATERAL_RAW = 100_000n;
const NUM_OPERATORS = 4n;

describe.only("ETH Cluster Lifecycle", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;
  let liquidator: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner, liquidator] = await connection.ethers.getSigners();
  });

  const deployFixture = async () => {
    const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, 4, OP_ETH_FEE);

    await clusters.mockEthNetworkFee(NETWORK_FEE_RAW);
    await clusters.mockMinimumBlocksBeforeLiquidation(MIN_BLOCKS_BEFORE_LIQ);
    await clusters.mockMinimumLiquidationCollateral(MIN_LIQ_COLLATERAL_RAW);

    return { clusters, operatorIds };
  };


  describe("ETH Cluster Lifecycle", () => {
    it("Creates cluster, deposits, advances blocks, withdraws with correct fee deduction", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const regTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regReceipt = await regTx.wait();
      const b0 = regReceipt!.blockNumber;
      let cluster = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);
      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);
      expect(cluster.validatorCount).to.equal(1n);
      expect(cluster.active).to.equal(true);

      await mineBlocks(provider, 49);
      const depositVal = connection.ethers.parseEther("5");
      const depTx = await clusters.deposit(
        clusterOwner.address, operatorIds, cluster,
        { value: depositVal },
      );
      const depReceipt = await depTx.wait();
      cluster = parseClusterFromEvent(clusters, depReceipt, Events.CLUSTER_DEPOSITED);
      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE + depositVal);

      const currentBlock = await getBlockNumber(provider);
      const blocksToMine = (b0 + 100) - currentBlock - 1;
      await mineBlocks(provider, blocksToMine);

      const withdrawAmount = connection.ethers.parseEther("2");
      const contractBalBefore = await snapshotContractBalance(provider, await clusters.getAddress());
      const withdrawTx = await clusters.withdraw(operatorIds, withdrawAmount, cluster);
      const withdrawReceipt = await withdrawTx.wait();
      const wBlock = withdrawReceipt!.blockNumber;
      const clusterAfter = parseClusterFromEvent(clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

      const blockDiff = BigInt(wBlock - b0);
      const vUnits = defaultVUnits(1n);
      const expectedFees = calcClusterBurn({
        blockDiff,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      const expectedBalance = DEFAULT_ETH_REGISTER_VALUE + depositVal - expectedFees - withdrawAmount;
      expect(clusterAfter.balance).to.equal(expectedBalance);

      const contractBalAfter = await snapshotContractBalance(provider, await clusters.getAddress());
      expect(contractBalBefore - contractBalAfter).to.equal(withdrawAmount);
    });

    it("Deposit at same block as registration — no fee settlement (edge)", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);

      const regTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = parseClusterFromEvent(clusters, await regTx.wait(), Events.VALIDATOR_ADDED);

      const secondDeposit = connection.ethers.parseEther("5")
      const depTx = await clusters.deposit(
        clusterOwner.address, operatorIds, cluster,
        { value: secondDeposit},
      );
      cluster = parseClusterFromEvent(clusters, await depTx.wait(), Events.CLUSTER_DEPOSITED);

      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE + secondDeposit);
    });

    it("Multiple deposits accumulate without fee settlement (edge)", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);

      const regTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = parseClusterFromEvent(clusters, await regTx.wait(), Events.VALIDATOR_ADDED);

      await mineBlocks(connection.ethers.provider, 10);

      const secondDep = connection.ethers.parseEther("3");
      let depTx = await clusters.deposit(
        clusterOwner.address, operatorIds, cluster, { value: secondDep },
      );
      cluster = parseClusterFromEvent(clusters, await depTx.wait(), Events.CLUSTER_DEPOSITED);
      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE + secondDep);

      await mineBlocks(connection.ethers.provider, 10);

      const thirdDep = connection.ethers.parseEther("2");
      depTx = await clusters.deposit(
        clusterOwner.address, operatorIds, cluster, { value: thirdDep },
      );
      cluster = parseClusterFromEvent(clusters, await depTx.wait(), Events.CLUSTER_DEPOSITED);

      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE + secondDep + thirdDep);
    });
  });

  describe(" Withdraw Exactly To Liquidation Threshold", () => {
    it("Allows withdraw to exact threshold but rejects 1 more wei", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const regTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regReceipt = await regTx.wait();
      const b0 = regReceipt!.blockNumber;
      let cluster = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

      await mineBlocks(provider, 9);

      const blockDiff = 10n;
      const vUnits = defaultVUnits(1n);
      const feesAt10 = calcClusterBurn({
        blockDiff,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      const balanceAfterFees = DEFAULT_ETH_REGISTER_VALUE - feesAt10;

      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_BEFORE_LIQ,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      const maxWithdrawable = balanceAfterFees - liqThreshold;

      const withdrawTx = await clusters.withdraw(operatorIds, maxWithdrawable, cluster);
      cluster = parseClusterFromEvent(clusters, await withdrawTx.wait(), Events.CLUSTER_WITHDRAWN);

      expect(cluster.balance).to.equal(liqThreshold);

      await expect(
        clusters.withdraw(operatorIds, 1n, cluster),
      ).to.be.revertedWithCustomError(clusters, Errors.INSUFFICIENT_BALANCE);
    });

    it("ValidatorCount == 0 allows full withdrawal (edge)", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const deposit = connection.ethers.parseEther("5");
      const regTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: deposit },
      );
      const regReceipt = await regTx.wait();
      const regBlock = regReceipt!.blockNumber;
      let cluster = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

      await mineBlocks(provider, 5);

      const removeTx = await clusters.removeValidator(makePublicKey(1), operatorIds, cluster);
      const removeReceipt = await removeTx.wait();
      const removeBlock = removeReceipt!.blockNumber;
      cluster = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);
      expect(cluster.validatorCount).to.equal(0n);

      const blockDiff = BigInt(removeBlock - regBlock);
      const vUnits = defaultVUnits(1n);
      const fees = calcClusterBurn({
        blockDiff,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const expectedFullBalance = deposit - fees;

      const fullBalance = cluster.balance;
      expect(fullBalance).to.equal(expectedFullBalance);

      const wTx = await clusters.withdraw(operatorIds, fullBalance, cluster);
      cluster = parseClusterFromEvent(clusters, await wTx.wait(), Events.CLUSTER_WITHDRAWN);
      expect(cluster.balance).to.equal(0n);
    });
  });

  describe("Third-Party Liquidation With Bounty", () => {
    it("Liquidates cluster after balance drops below threshold, liquidator receives bounty", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const smallDeposit = 1_000_000_000_000n;
      const regTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: smallDeposit },
      );
      const regReceipt = await regTx.wait();
      const b0 = regReceipt!.blockNumber;
      let cluster = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

      const vUnits = defaultVUnits(1n);
      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_BEFORE_LIQ,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      const currentBlock1 = await getBlockNumber(provider);
      const targetForNotLiq = b0 + 122;
      const blocksToMineForNotLiq = targetForNotLiq - currentBlock1 - 1;
      if (blocksToMineForNotLiq > 0) await mineBlocks(provider, blocksToMineForNotLiq);

      await expect(
        clusters.connect(liquidator).liquidate(clusterOwner.address, operatorIds, cluster),
      ).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_NOT_LIQUIDATABLE);

      const currentBlock2 = await getBlockNumber(provider);
      const targetForLiq = b0 + 123;
      const blocksToMineForLiq = targetForLiq - currentBlock2 - 1;
      if (blocksToMineForLiq > 0) await mineBlocks(provider, blocksToMineForLiq);

      const liqBalBefore = await provider.getBalance(liquidator.address);
      const liqTx = await clusters.connect(liquidator).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      const liqReceipt = await liqTx.wait();
      const liqBlock = liqReceipt!.blockNumber;
      const blockDiff = BigInt(liqBlock - b0);

      const totalFees = calcClusterBurn({
        blockDiff,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      const perBlockBurnCM3 = calcClusterBurn({
        blockDiff: 1n,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const balanceAfterFees = smallDeposit - totalFees;
      expect(balanceAfterFees).to.equal(smallDeposit - blockDiff * perBlockBurnCM3);

      const liqBalAfter = await provider.getBalance(liquidator.address);
      const gasUsed = liqReceipt!.gasUsed * liqReceipt!.gasPrice;
      expect(liqBalAfter - liqBalBefore + gasUsed).to.equal(balanceAfterFees);

      const liqCluster = parseClusterFromEvent(clusters, liqReceipt, Events.CLUSTER_LIQUIDATED);
      expect(liqCluster.active).to.equal(false);
      expect(liqCluster.balance).to.equal(0n);
      expect(liqCluster.index).to.equal(0n);
      expect(liqCluster.networkFeeIndex).to.equal(0n);

      for (const opId of operatorIds) {
        expect(await clusters.getOperatorEthValidatorCount(opId)).to.equal(0);
      }
      expect(await clusters.getDaoEthValidatorCount()).to.equal(0);
    });

    it("Owner can always self-liquidate regardless of balance (edge)", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const regTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regReceipt = await regTx.wait();
      const b0 = regReceipt!.blockNumber;
      let cluster = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

      const ownerBalBefore = await provider.getBalance(clusterOwner.address);
      const selfLiqTx = await clusters.liquidate(
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
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const expectedBounty = DEFAULT_ETH_REGISTER_VALUE - totalFees;

      const ownerBalAfter = await provider.getBalance(clusterOwner.address);
      const gasUsed = selfLiqReceipt!.gasUsed * selfLiqReceipt!.gasPrice;
      expect(ownerBalAfter - ownerBalBefore + gasUsed).to.equal(expectedBounty);

      const liqCluster = parseClusterFromEvent(clusters, selfLiqReceipt, Events.CLUSTER_LIQUIDATED);
      expect(liqCluster.active).to.equal(false);
      expect(liqCluster.balance).to.equal(0n);
    });
  });

  describe("Reactivation After Liquidation", () => {
    it("Full lifecycle: create → liquidate → reactivate → verify fee accrual from reactivation point", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const smallDeposit = 1_000_000_000_000n;
      const regTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: smallDeposit },
      );
      const regReceipt = await regTx.wait();
      const b0 = regReceipt!.blockNumber;
      let cluster = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

      await mineBlocks(provider, 122);
      const liqTx = await clusters.connect(liquidator).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      const liqReceipt = await liqTx.wait();
      cluster = parseClusterFromEvent(clusters, liqReceipt, Events.CLUSTER_LIQUIDATED);
      expect(cluster.active).to.equal(false);
      expect(cluster.balance).to.equal(0n);

      await mineBlocks(provider, 76);

      const reactivateAmount = connection.ethers.parseEther("5");
      const reactivateTx = await clusters.reactivate(
        operatorIds, cluster, { value: reactivateAmount },
      );
      const reactivateReceipt = await reactivateTx.wait();
      const reactivateBlock = reactivateReceipt!.blockNumber;
      cluster = parseClusterFromEvent(clusters, reactivateReceipt, Events.CLUSTER_REACTIVATED);

      expect(cluster.active).to.equal(true);
      expect(cluster.balance).to.equal(reactivateAmount);

      await mineBlocks(provider, 99);
      const withdrawAmount = connection.ethers.parseEther("1");
      const withdrawTx = await clusters.withdraw(operatorIds, withdrawAmount, cluster);
      const withdrawReceipt = await withdrawTx.wait();
      const withdrawBlock = withdrawReceipt!.blockNumber;
      const clusterAfter = parseClusterFromEvent(clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

      const blocksSinceReactivation = BigInt(withdrawBlock - reactivateBlock);
      const vUnits = defaultVUnits(1n);
      const feesAfterReactivation = calcClusterBurn({
        blockDiff: blocksSinceReactivation,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      const expectedBalance = reactivateAmount - feesAfterReactivation - withdrawAmount;
      expect(clusterAfter.balance).to.equal(expectedBalance);
    });
  });

  describe("Deposit Into Liquidated Cluster + Reactivation", () => {
    it("Deposits into liquidated cluster accumulate, reactivation uses sum", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const smallDeposit = 1_000_000_000_000n;
      const regTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: smallDeposit },
      );
      let cluster = parseClusterFromEvent(clusters, await regTx.wait(), Events.VALIDATOR_ADDED);

      await mineBlocks(provider, 122);
      const liqTx = await clusters.connect(liquidator).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      cluster = parseClusterFromEvent(clusters, await liqTx.wait(), Events.CLUSTER_LIQUIDATED);
      expect(cluster.active).to.equal(false);
      expect(cluster.balance).to.equal(0n);

      const deposit1 = connection.ethers.parseEther("3");
      const dep1Tx = await clusters.deposit(
        clusterOwner.address, operatorIds, cluster, { value: deposit1 },
      );
      cluster = parseClusterFromEvent(clusters, await dep1Tx.wait(), Events.CLUSTER_DEPOSITED);
      expect(cluster.active).to.equal(false);
      expect(cluster.balance).to.equal(deposit1);

      const deposit2 = connection.ethers.parseEther("2");
      const dep2Tx = await clusters.deposit(
        clusterOwner.address, operatorIds, cluster, { value: deposit2 },
      );
      cluster = parseClusterFromEvent(clusters, await dep2Tx.wait(), Events.CLUSTER_DEPOSITED);
      expect(cluster.active).to.equal(false);
      expect(cluster.balance).to.equal(deposit1 + deposit2);

      const reactivateAmount = connection.ethers.parseEther("1");
      const reactivateTx = await clusters.reactivate(
        operatorIds, cluster, { value: reactivateAmount },
      );
      cluster = parseClusterFromEvent(clusters, await reactivateTx.wait(), Events.CLUSTER_REACTIVATED);

      expect(cluster.active).to.equal(true);
      expect(cluster.balance).to.equal(deposit1 + deposit2 + reactivateAmount);
    });
  });
});

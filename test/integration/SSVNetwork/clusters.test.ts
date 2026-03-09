import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { ssvNetworkFullFixture } from '../../setup/fixtures.ts';
import type { NetworkHelpersType } from '../../common/types.ts';
import {
  registerOperators,
  whitelistAddresses,
  makePublicKey,
  getCurrentClusterState,
  registerDefaultCluster,
  computeEBRoot,
  computeClusterId,
  setupTestContext,
} from '../../common/helpers.ts';
import {
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  DEFAULT_ETH_REGISTER_VALUE,
  MINIMAL_OPERATOR_ETH_FEE,
  NETWORK_FEE,
} from '../../common/constants.ts';
import { Events } from '../../common/events.ts';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import { Errors } from '../../common/errors.js';
import { ethers } from 'ethers';

/**
 * Enhanced Integration Tests for SSVNetwork Clusters
 * 
 * These tests focus on:
 * 1. Balance delta assertions for every ETH-moving operation (deposit, withdraw, liquidate)
 * 2. Boundary testing (liquidation thresholds, minimum collateral)
 * 3. Multi-block simulation with exact expected values for balance burn
 * 4. Basic invariant checks (cluster balance + operator earnings + network fees = deposited)
 * 5. Combined scenarios verifying full cluster lifecycle economics
 */
describe("SSVNetwork Integration - Clusters (Enhanced)", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let liquidator: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [operatorOwner, clusterOwner, liquidator] } = await setupTestContext());

    for (const signer of [operatorOwner, clusterOwner, liquidator]) {
      await connection.ethers.provider.send("hardhat_setBalance", [signer.address, "0x3635c9adc5dea00000"]);
    }
  });

  const deployFullSSVNetworkFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  describe("Balance Delta Assertions", async function() {

    it("deposit: verifies exact ETH transfer from depositor to contract", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const { cluster, operatorIds } = await registerDefaultCluster(
        connection, network, views, operatorOwner, clusterOwner
      );

      await connection.ethers.provider.send("hardhat_setBalance", [clusterOwner.address, "0x3635c9adc5dea00000"]);

      const depositAmount = connection.ethers.parseEther("5");
      const balanceBefore = await views.getBalance(clusterOwner.address, operatorIds, cluster);
      const contractBalanceBefore = await connection.ethers.provider.getBalance(await network.getAddress());
      const depositorBalanceBefore = await connection.ethers.provider.getBalance(clusterOwner.address);
      const blockBefore = await connection.ethers.provider.getBlockNumber();

      const tx = await network.connect(clusterOwner).deposit(
        clusterOwner.address,
        operatorIds,
        cluster,
        { value: depositAmount }
      );
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const blockAfter = receipt!.blockNumber;

      const clusterAfter = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const balanceAfter = await views.getBalance(clusterOwner.address, operatorIds, clusterAfter);
      const contractBalanceAfter = await connection.ethers.provider.getBalance(await network.getAddress());
      const depositorBalanceAfter = await connection.ethers.provider.getBalance(clusterOwner.address);
      const blocksDelta = BigInt(blockAfter - blockBefore);
      const burnRatePerBlock = (MINIMAL_OPERATOR_ETH_FEE * 4n) + NETWORK_FEE;
      const expectedBurn = blocksDelta * burnRatePerBlock;
      const expectedBalance = balanceBefore + depositAmount - expectedBurn;

      expect(balanceAfter).to.equal(expectedBalance);
      expect(contractBalanceAfter - contractBalanceBefore).to.equal(depositAmount);
      expect(depositorBalanceBefore - depositorBalanceAfter).to.equal(depositAmount + gasUsed);
    });

    it("withdraw: verifies exact ETH transfer from contract to owner", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const { cluster, operatorIds, receiptRegister } = await registerDefaultCluster(
        connection, network, views, operatorOwner, clusterOwner
      );

      const balanceBefore = await views.getBalance(clusterOwner.address, operatorIds, cluster);
      const withdrawAmount = balanceBefore / 2n;

      const contractBalanceBefore = await connection.ethers.provider.getBalance(await network.getAddress());
      const ownerBalanceBefore = await connection.ethers.provider.getBalance(clusterOwner.address);
      const blockRegister = receiptRegister.blockNumber;

      const tx = await network.connect(clusterOwner).withdraw(operatorIds, withdrawAmount, cluster);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const blockWithdraw = receipt!.blockNumber;

      const clusterAfter = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const balanceAfter = await views.getBalance(clusterOwner.address, operatorIds, clusterAfter);
      const contractBalanceAfter = await connection.ethers.provider.getBalance(await network.getAddress());
      const ownerBalanceAfter = await connection.ethers.provider.getBalance(clusterOwner.address);
      expect(contractBalanceBefore - contractBalanceAfter).to.equal(withdrawAmount);
      expect(ownerBalanceAfter + gasUsed - ownerBalanceBefore).to.equal(withdrawAmount);
      const blocksDelta = BigInt(blockWithdraw - blockRegister);
      const burnRatePerBlock = (MINIMAL_OPERATOR_ETH_FEE * 4n) + NETWORK_FEE;
      const expectedBurn = blocksDelta * burnRatePerBlock;
      const expectedBalanceDecrease = withdrawAmount + expectedBurn;

      expect(balanceBefore - balanceAfter).to.equal(expectedBalanceDecrease);
    });

    it("liquidate: liquidator receives remaining cluster balance", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const highNetworkFee = NETWORK_FEE * 100n;
      await network.updateNetworkFee(highNetworkFee);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      const txRegister = await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const receiptRegister = await txRegister.wait();
      const blockRegister = receiptRegister!.blockNumber;
      let currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      let isLiquidatable = false;
      let attempts = 0;
      while (!isLiquidatable && attempts < 20) {
        await connection.networkHelpers.mine(100000);
        isLiquidatable = await views.isLiquidatable(clusterOwner.address, operatorIds, currentCluster);
        attempts++;
      }
      expect(isLiquidatable).to.be.true;
      const liquidatorBalanceBefore = await connection.ethers.provider.getBalance(liquidator.address);
      const contractBalanceBefore = await connection.ethers.provider.getBalance(await network.getAddress());

      const tx = await network.connect(liquidator).liquidate(
        clusterOwner.address,
        operatorIds,
        currentCluster
      );
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const blockLiquidate = receipt!.blockNumber;

      const liquidatorBalanceAfter = await connection.ethers.provider.getBalance(liquidator.address);
      const contractBalanceAfter = await connection.ethers.provider.getBalance(await network.getAddress());
      const blocksDelta = BigInt(blockLiquidate - blockRegister);
      const burnRatePerBlock = (MINIMAL_OPERATOR_ETH_FEE * 4n) + highNetworkFee;
      const totalFees = blocksDelta * burnRatePerBlock;
      const expectedRemainingBalance = DEFAULT_ETH_REGISTER_VALUE - totalFees;
      const actualLiquidatorReward = expectedRemainingBalance > 0n ? expectedRemainingBalance : 0n;
      const liquidatorGain = liquidatorBalanceAfter + gasUsed - liquidatorBalanceBefore;
      expect(liquidatorGain).to.equal(actualLiquidatorReward);
      expect(contractBalanceBefore - contractBalanceAfter).to.equal(actualLiquidatorReward);
      const clusterAfter = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(clusterAfter.active).to.equal(false);
      expect(await views.isLiquidated(clusterOwner.address, operatorIds, clusterAfter)).to.equal(true);
    });
  });

  describe("Multi-Block Simulation - Cluster Balance Burn", async function() {

    it("Cluster balance decreases exactly by burn rate per block", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      let currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const initialBalance = await views.getBalance(clusterOwner.address, operatorIds, currentCluster);
      const expectedBurnRatePerBlock = (MINIMAL_OPERATOR_ETH_FEE * 4n) + NETWORK_FEE;
      const checkpoints = [10n, 50n, 100n, 200n];
      let totalBlocksMined = 0n;

      for (const blocks of checkpoints) {
        await connection.networkHelpers.mine(blocks);
        totalBlocksMined += blocks;

        const currentBalance = await views.getBalance(clusterOwner.address, operatorIds, currentCluster);
        const expectedBalance = initialBalance - (totalBlocksMined * expectedBurnRatePerBlock);

        expect(currentBalance).to.equal(
          expectedBalance,
          `Balance mismatch at block ${totalBlocksMined}`
        );
      }
    });

    it("Burn rate scales with validator count", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      let currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const balanceAfter1Validator = await views.getBalance(clusterOwner.address, operatorIds, currentCluster);
      await connection.networkHelpers.mine(100n);
      currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const balanceAfter100Blocks = await views.getBalance(clusterOwner.address, operatorIds, currentCluster);

      const burnRateWith1Validator = balanceAfter1Validator - balanceAfter100Blocks;
      const expectedBurnRate1 = 100n * ((MINIMAL_OPERATOR_ETH_FEE * 4n) + NETWORK_FEE);
      expect(burnRateWith1Validator).to.equal(expectedBurnRate1);
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(2),
        operatorIds,
        DEFAULT_SHARES,
        currentCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const balanceAfter2Validators = await views.getBalance(clusterOwner.address, operatorIds, currentCluster);
      await connection.networkHelpers.mine(100n);
      currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const balanceAfter2Val100Blocks = await views.getBalance(clusterOwner.address, operatorIds, currentCluster);

      const burnRateWith2Validators = balanceAfter2Validators - balanceAfter2Val100Blocks;
      const expectedBurnRate2 = 100n * ((MINIMAL_OPERATOR_ETH_FEE * 4n * 2n) + (NETWORK_FEE * 2n));
      expect(burnRateWith2Validators).to.equal(expectedBurnRate2);
      expect(burnRateWith2Validators).to.equal(burnRateWith1Validator * 2n);
    });

    it("removeValidator settles exact fee deduction from cluster balance", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      const clusterAfterReg = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const burnRatePerBlock = (MINIMAL_OPERATOR_ETH_FEE * 4n) + NETWORK_FEE;
      const blocksToMine = 100n;

      await connection.networkHelpers.mine(blocksToMine);

      await network.connect(clusterOwner).removeValidator(validatorKey, operatorIds, clusterAfterReg);
      const clusterAfterRemove = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

      const totalFeeDeducted = (blocksToMine + 1n) * burnRatePerBlock;
      const expectedBalance = DEFAULT_ETH_REGISTER_VALUE - totalFeeDeducted;

      const remainingBalance = await views.getBalance(clusterOwner.address, operatorIds, clusterAfterRemove);
      expect(remainingBalance).to.equal(expectedBalance);
      expect(clusterAfterRemove.validatorCount).to.equal(0n);
    });
  });

  describe("Invariant Checks - Balance Conservation", async function() {

    it("Invariant: Deposited = ClusterBalance + OperatorEarnings + NetworkEarnings", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      const depositAmount = DEFAULT_ETH_REGISTER_VALUE;
      const networkEarningsBefore = await views.getNetworkEarnings();

      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: depositAmount }
      );
      const blocks = 500n;
      let currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await connection.networkHelpers.mine(blocks);
      const clusterBalance = await views.getBalance(clusterOwner.address, operatorIds, currentCluster);

      let totalOperatorEarnings = 0n;
      for (const opId of operatorIds) {
        totalOperatorEarnings += await views.getOperatorEarnings(opId);
      }

      const networkEarningsAfter = await views.getNetworkEarnings();
      const networkEarningsDelta = networkEarningsAfter - networkEarningsBefore;
      const totalAccounted = clusterBalance + totalOperatorEarnings + networkEarningsDelta;
      expect(totalAccounted).to.equal(depositAmount, "Balance invariant violated: total accounted must equal deposited");
    });

    it("Invariant: Withdrawal reduces cluster balance exactly", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const { cluster, operatorIds, receiptRegister } = await registerDefaultCluster(
        connection, network, views, operatorOwner, clusterOwner
      );

      const balanceBefore = await views.getBalance(clusterOwner.address, operatorIds, cluster);
      const withdrawAmount = connection.ethers.parseEther("1");
      const blockRegister = receiptRegister.blockNumber;

      const tx = await network.connect(clusterOwner).withdraw(operatorIds, withdrawAmount, cluster);
      const receipt = await tx.wait();
      const blockWithdraw = receipt!.blockNumber;

      const clusterAfter = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const balanceAfter = await views.getBalance(clusterOwner.address, operatorIds, clusterAfter);
      const blocksDelta = BigInt(blockWithdraw - blockRegister);
      const burnRatePerBlock = (MINIMAL_OPERATOR_ETH_FEE * 4n) + NETWORK_FEE;
      const expectedBurn = blocksDelta * burnRatePerBlock;
      const expectedBalanceDecrease = withdrawAmount + expectedBurn;

      expect(balanceBefore - balanceAfter).to.equal(expectedBalanceDecrease);
    });

    it("Invariant: Deposit increases cluster balance exactly", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const { cluster, operatorIds, receiptRegister } = await registerDefaultCluster(
        connection, network, views, operatorOwner, clusterOwner
      );

      await connection.ethers.provider.send("hardhat_setBalance", [clusterOwner.address, "0x3635c9adc5dea00000"]);
      const balanceBefore = await views.getBalance(clusterOwner.address, operatorIds, cluster);
      const depositAmount = connection.ethers.parseEther("5");
      const blockRegister = receiptRegister.blockNumber;

      const tx = await network.connect(clusterOwner).deposit(
        clusterOwner.address,
        operatorIds,
        cluster,
        { value: depositAmount }
      );
      const receipt = await tx.wait();
      const blockDeposit = receipt!.blockNumber;

      const clusterAfter = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const balanceAfter = await views.getBalance(clusterOwner.address, operatorIds, clusterAfter);
      const blocksDelta = BigInt(blockDeposit - blockRegister);
      const burnRatePerBlock = (MINIMAL_OPERATOR_ETH_FEE * 4n) + NETWORK_FEE;
      const expectedBurn = blocksDelta * burnRatePerBlock;
      const expectedBalanceIncrease = depositAmount - expectedBurn;

      expect(balanceAfter - balanceBefore).to.equal(expectedBalanceIncrease);
    });
  });

  describe("Liquidation Boundary Tests", async function() {

    it("Cluster is not liquidatable just above threshold", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      const currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const isLiquidatable = await views.isLiquidatable(clusterOwner.address, operatorIds, currentCluster);
      expect(isLiquidatable).to.equal(false);
      await expect(
        network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, currentCluster)
      ).to.be.revertedWithCustomError(network, Errors.CLUSTER_NOT_LIQUIDATABLE);
    });

    it("Owner can self-liquidate even when not underfunded", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      const currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      
      const isLiquidatable = await views.isLiquidatable(clusterOwner.address, operatorIds, currentCluster);
      expect(isLiquidatable).to.equal(false);

      const networkAddress = await network.getAddress();
      const ownerBalanceBefore = await connection.ethers.provider.getBalance(clusterOwner.address);
      const contractBalanceBefore = await connection.ethers.provider.getBalance(networkAddress);

      const tx = await network.connect(clusterOwner).liquidate(
        clusterOwner.address,
        operatorIds,
        currentCluster
      );
      await expect(tx).to.emit(network, Events.CLUSTER_LIQUIDATED);
      const receipt = await tx.wait();
      const gasCost = receipt!.gasUsed * (receipt!.effectiveGasPrice ?? receipt!.gasPrice);

      const ownerBalanceAfter = await connection.ethers.provider.getBalance(clusterOwner.address);
      const contractBalanceAfter = await connection.ethers.provider.getBalance(networkAddress);

      const payout = contractBalanceBefore - contractBalanceAfter;
      expect(payout).to.be.greaterThan(0n);
      expect(ownerBalanceAfter - ownerBalanceBefore + gasCost).to.equal(payout);

      const clusterAfter = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(clusterAfter.active).to.equal(false);
    });

    it("Reactivation requires sufficient balance to avoid immediate liquidation", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      await network.updateNetworkFee(NETWORK_FEE * 100n);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      let currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      let attempts = 0;
      while (!(await views.isLiquidatable(clusterOwner.address, operatorIds, currentCluster)) && attempts < 20) {
        await connection.networkHelpers.mine(100000);
        attempts++;
      }
      await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, currentCluster);
      const liquidatedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(liquidatedCluster.active).to.equal(false);
      await expect(
        network.connect(clusterOwner).reactivate(
          operatorIds,
          liquidatedCluster,
          { value: 1n }
        )
      ).to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
      const tx = await network.connect(clusterOwner).reactivate(
        operatorIds,
        liquidatedCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      await expect(tx).to.emit(network, Events.CLUSTER_REACTIVATED);

      const reactivatedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(reactivatedCluster.active).to.equal(true);
    });
  });

  describe("Combined Scenarios - Full Lifecycle Economics", async function() {

    it("Full lifecycle: register → operate → withdraw → deposit → liquidate → reactivate", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      await network.updateNetworkFee(NETWORK_FEE * 100n);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      let currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(currentCluster.active).to.equal(true);
      const initialBalance = await views.getBalance(clusterOwner.address, operatorIds, currentCluster);
      await connection.networkHelpers.mine(100n);
      currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const balanceAfterOperation = await views.getBalance(clusterOwner.address, operatorIds, currentCluster);
      expect(balanceAfterOperation).to.be.lessThan(initialBalance);
      const operatorEarnings = await views.getOperatorEarnings(operatorIds[0]);
      expect(operatorEarnings).to.be.greaterThan(0n);
      const withdrawAmount = connection.ethers.parseEther("0.1");
      await network.connect(clusterOwner).withdraw(operatorIds, withdrawAmount, currentCluster);
      currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const balanceAfterWithdraw = await views.getBalance(clusterOwner.address, operatorIds, currentCluster);
      expect(balanceAfterWithdraw).to.be.lessThan(balanceAfterOperation);
      await network.connect(clusterOwner).deposit(
        clusterOwner.address,
        operatorIds,
        currentCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const balanceAfterDeposit = await views.getBalance(clusterOwner.address, operatorIds, currentCluster);
      expect(balanceAfterDeposit).to.be.greaterThan(balanceAfterWithdraw);
      let attempts = 0;
      while (!(await views.isLiquidatable(clusterOwner.address, operatorIds, currentCluster)) && attempts < 30) {
        await connection.networkHelpers.mine(100000);
        attempts++;
      }
      expect(await views.isLiquidatable(clusterOwner.address, operatorIds, currentCluster)).to.be.true;

      await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, currentCluster);
      currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(currentCluster.active).to.equal(false);
      await network.connect(clusterOwner).reactivate(
        operatorIds,
        currentCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(currentCluster.active).to.equal(true);
      await network.connect(clusterOwner).removeValidator(validatorKey, operatorIds, currentCluster);
      currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(currentCluster.validatorCount).to.equal(0n);
      const finalBalance = await views.getBalance(clusterOwner.address, operatorIds, currentCluster);
      expect(finalBalance).to.be.greaterThanOrEqual(0n);
    });

    it("Third-party deposit doesn't affect owner's ability to withdraw", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const { cluster, operatorIds } = await registerDefaultCluster(
        connection, network, views, operatorOwner, clusterOwner
      );

      const balanceBeforeThirdParty = await views.getBalance(clusterOwner.address, operatorIds, cluster);
      await network.connect(liquidator).deposit(
        clusterOwner.address,
        operatorIds,
        cluster,
        { value: connection.ethers.parseEther("2") }
      );

      const clusterAfterDeposit = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const balanceAfterThirdParty = await views.getBalance(clusterOwner.address, operatorIds, clusterAfterDeposit);
      expect(balanceAfterThirdParty).to.be.greaterThan(balanceBeforeThirdParty);
      const withdrawAmount = balanceAfterThirdParty / 2n;
      const tx = await network.connect(clusterOwner).withdraw(operatorIds, withdrawAmount, clusterAfterDeposit);
      await expect(tx).to.emit(network, Events.CLUSTER_WITHDRAWN);
    });
  });

  describe("Edge Cases and Error Conditions", async function() {

    it("Cannot withdraw more than available balance", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const { cluster, operatorIds } = await registerDefaultCluster(
        connection, network, views, operatorOwner, clusterOwner
      );

      const balance = await views.getBalance(clusterOwner.address, operatorIds, cluster);
      const excessiveAmount = balance * 2n;

      await expect(
        network.connect(clusterOwner).withdraw(operatorIds, excessiveAmount, cluster)
      ).to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
    });

    it("Cannot withdraw if it would make cluster liquidatable", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const { cluster, operatorIds } = await registerDefaultCluster(
        connection, network, views, operatorOwner, clusterOwner
      );

      const balance = await views.getBalance(clusterOwner.address, operatorIds, cluster);
      const excessiveAmount = balance - 1n;

      await expect(
        network.connect(clusterOwner).withdraw(operatorIds, excessiveAmount, cluster)
      ).to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
    });

    it("Deposit with stale cluster state reverts", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const { cluster, operatorIds } = await registerDefaultCluster(
        connection, network, views, operatorOwner, clusterOwner
      );
      const staleCluster = { ...cluster, balance: cluster.balance + 1n };

      await expect(
        network.connect(clusterOwner).deposit(
          clusterOwner.address,
          operatorIds,
          staleCluster,
          { value: DEFAULT_ETH_REGISTER_VALUE }
        )
      ).to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_STATE);
    });

    it("Cannot reactivate an already active cluster", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const { cluster, operatorIds } = await registerDefaultCluster(
        connection, network, views, operatorOwner, clusterOwner
      );

      await expect(
        network.connect(clusterOwner).reactivate(
          operatorIds,
          cluster,
          { value: DEFAULT_ETH_REGISTER_VALUE }
        )
      ).to.be.revertedWithCustomError(network, Errors.CLUSTER_ALREADY_ENABLED);
    });

    it("Cannot operate on non-existent cluster", async function() {
      const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);

      await expect(
        network.deposit(
          clusterOwner.address,
          operatorIds,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE }
        )
      ).to.be.revertedWithCustomError(network, Errors.CLUSTER_DOES_NOT_EXIST);

      await expect(
        network.connect(clusterOwner).withdraw(operatorIds, 1000n, EMPTY_CLUSTER)
      ).to.be.revertedWithCustomError(network, Errors.CLUSTER_DOES_NOT_EXIST);
    });

    it("updateClusterBalance succeeds on a liquidated cluster, emits ClusterBalanceUpdated with cluster still inactive", async function() {
      const { network, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const activeCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(activeCluster.active).to.equal(true);

      await network.connect(clusterOwner).liquidate(clusterOwner.address, operatorIds, activeCluster);
      const liquidatedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(liquidatedCluster.active).to.equal(false);

      await network.setQuorumBps(1000);
      await network.replaceOracle(1, operatorOwner.address);

      const stakeAmount = ethers.parseEther("10");
      await ssvToken.mint(clusterOwner.address, stakeAmount);
      await ssvToken.connect(clusterOwner).approve(await network.getAddress(), stakeAmount);
      await network.connect(clusterOwner).stake(stakeAmount);

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const effectiveBalance = 33;
      const ebRoot = computeEBRoot(clusterId, effectiveBalance);

      const blockNum = await connection.ethers.provider.getBlockNumber();

      await network.connect(operatorOwner).commitRoot(ebRoot, blockNum);

      const tx = await network.updateClusterBalance(
        blockNum, clusterOwner.address, operatorIds, liquidatedCluster, effectiveBalance, []
      );
      const receipt = await tx.wait();
      await expect(tx).to.emit(network, Events.CLUSTER_BALANCE_UPDATED);

      const clusterAfterUpdate = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds)
      expect(clusterAfterUpdate).to.not.be.null;
      expect(clusterAfterUpdate!.active).to.equal(false);
      expect(clusterAfterUpdate!.balance).to.equal(0n);

      const effectiveBalance2 = 64;
      const ebRoot2 = computeEBRoot(clusterId, effectiveBalance2);

      const blockNum2 = await connection.ethers.provider.getBlockNumber();
      await network.connect(operatorOwner).commitRoot(ebRoot2, blockNum2);
      const tx2 = await network.updateClusterBalance(
        blockNum2, clusterOwner.address, operatorIds, liquidatedCluster, effectiveBalance2, []
      );
      await expect(tx2).to.emit(network, Events.CLUSTER_BALANCE_UPDATED);

      const finalCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(finalCluster.active).to.equal(false);
    });

    it("Is reverted with 'InsufficientBalance' when withdrawing from a liquidated cluster with zero balance", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      await network.updateNetworkFee(NETWORK_FEE * 100n);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      let currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      let attempts = 0;
      while (!(await views.isLiquidatable(clusterOwner.address, operatorIds, currentCluster)) && attempts < 20) {
        await connection.networkHelpers.mine(100000);
        attempts++;
      }

      await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, currentCluster);
      const liquidatedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

      await expect(
        network.connect(clusterOwner).withdraw(operatorIds, 1n, liquidatedCluster)
      ).to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
    });

    it("Allows deposit to liquidated cluster and subsequent withdrawal without reactivation", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      await network.updateNetworkFee(NETWORK_FEE * 100n);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      const activeCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(activeCluster.active).to.equal(true);
      expect(activeCluster.validatorCount).to.equal(1n);
      let currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      let attempts = 0;
      while (!(await views.isLiquidatable(clusterOwner.address, operatorIds, currentCluster)) && attempts < 20) {
        await connection.networkHelpers.mine(100000);
        attempts++;
      }
      expect(attempts).to.be.lessThan(20, "Cluster should have become liquidatable");
      const networkBalanceBefore = await connection.ethers.provider.getBalance(await network.getAddress());

      await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, currentCluster);

      const liquidatedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(liquidatedCluster.active).to.equal(false);
      expect(liquidatedCluster.balance).to.equal(0n);
      expect(liquidatedCluster.validatorCount).to.equal(1n);
      const depositAmount = connection.ethers.parseEther("5");
      const ownerBalanceBeforeDeposit = await connection.ethers.provider.getBalance(clusterOwner.address);

      const depositTx = await network.connect(clusterOwner).deposit(
        clusterOwner.address,
        operatorIds,
        liquidatedCluster,
        { value: depositAmount }
      );
      const depositReceipt = await depositTx.wait();
      const depositGasCost = depositReceipt!.gasUsed * depositReceipt!.gasPrice;

      const clusterAfterDeposit = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(clusterAfterDeposit.active).to.equal(false);
      expect(clusterAfterDeposit.balance).to.equal(depositAmount);
      expect(clusterAfterDeposit.validatorCount).to.equal(1n);
      const networkBalanceAfterDeposit = await connection.ethers.provider.getBalance(await network.getAddress());
      expect(networkBalanceAfterDeposit - networkBalanceBefore).to.equal(depositAmount);
      const ownerBalanceAfterDeposit = await connection.ethers.provider.getBalance(clusterOwner.address);
      expect(ownerBalanceBeforeDeposit - ownerBalanceAfterDeposit).to.equal(depositAmount + depositGasCost);
      const ownerBalanceBeforeWithdraw = await connection.ethers.provider.getBalance(clusterOwner.address);
      const networkBalanceBeforeWithdraw = await connection.ethers.provider.getBalance(await network.getAddress());

      const withdrawAmount = depositAmount;
      const withdrawTx = await network.connect(clusterOwner).withdraw(
        operatorIds,
        withdrawAmount,
        clusterAfterDeposit
      );
      const withdrawReceipt = await withdrawTx.wait();
      const withdrawGasCost = withdrawReceipt!.gasUsed * withdrawReceipt!.gasPrice;

      await expect(withdrawTx)
        .to.emit(network, Events.CLUSTER_WITHDRAWN)
        .withArgs(
          clusterOwner.address,
          operatorIds,
          withdrawAmount,
          [1n, 0n, 0n, false, 0n]
        );
      const clusterAfterWithdraw = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(clusterAfterWithdraw.active).to.equal(false);
      expect(clusterAfterWithdraw.balance).to.equal(0n);
      expect(clusterAfterWithdraw.validatorCount).to.equal(1n);
      const ownerBalanceAfterWithdraw = await connection.ethers.provider.getBalance(clusterOwner.address);
      const ownerBalanceDelta = ownerBalanceAfterWithdraw - ownerBalanceBeforeWithdraw;
      expect(ownerBalanceDelta).to.equal(withdrawAmount - withdrawGasCost);
      const networkBalanceAfterWithdraw = await connection.ethers.provider.getBalance(await network.getAddress());
      expect(networkBalanceBeforeWithdraw - networkBalanceAfterWithdraw).to.equal(withdrawAmount);
      const ownerBalanceFinal = await connection.ethers.provider.getBalance(clusterOwner.address);
      const totalGasSpent = depositGasCost + withdrawGasCost;
      expect(ownerBalanceFinal).to.equal(ownerBalanceBeforeDeposit - totalGasSpent);
    });

    it("Reverts withdraw from liquidated cluster when using stale pre-deposit cluster state", async function() {
      const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      const activeCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.connect(clusterOwner).liquidate(clusterOwner.address, operatorIds, activeCluster);

      const liquidatedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(liquidatedCluster.active).to.equal(false);
      expect(liquidatedCluster.balance).to.equal(0n);

      const depositAmount = connection.ethers.parseEther("1");
      await network.connect(clusterOwner).deposit(
        clusterOwner.address,
        operatorIds,
        liquidatedCluster,
        { value: depositAmount }
      );

      await expect(
        network.connect(clusterOwner).withdraw(operatorIds, depositAmount, liquidatedCluster)
      ).to.be.revertedWithCustomError(network, Errors.INCORRECT_CLUSTER_STATE);
    });

    it("Does not change operator or DAO earnings when withdrawing from a liquidated cluster with pre-existing earnings", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const sumOperatorEarnings = async (operatorIds: number[]) => {
        let total = 0n;
        for (const opId of operatorIds) {
          total += await views.getOperatorEarnings(opId);
        }
        return total;
      };

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      const activeCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

      await connection.networkHelpers.mine(100);
      await network.connect(clusterOwner).liquidate(clusterOwner.address, operatorIds, activeCluster);

      const liquidatedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(liquidatedCluster.active).to.equal(false);

      const operatorEarningsBefore = await sumOperatorEarnings(operatorIds);
      const daoEarningsBefore = await views.getNetworkEarnings();

      const depositAmount = connection.ethers.parseEther("2");
      await network.connect(clusterOwner).deposit(
        clusterOwner.address,
        operatorIds,
        liquidatedCluster,
        { value: depositAmount }
      );

      const clusterAfterDeposit = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.connect(clusterOwner).withdraw(operatorIds, depositAmount, clusterAfterDeposit);

      const operatorEarningsAfter = await sumOperatorEarnings(operatorIds);
      const daoEarningsAfter = await views.getNetworkEarnings();

      expect(operatorEarningsAfter).to.equal(operatorEarningsBefore);
      expect(daoEarningsAfter).to.equal(daoEarningsBefore);
    });

    it("Maintains global ETH accounting invariant after liquidated cluster withdrawal", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const calculateInvariant = async () => {
        const contractBalance = await connection.ethers.provider.getBalance(await network.getAddress());
        const clusterBalance = BigInt((await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds)).balance);
        let totalOperatorEarnings = 0n;
        for (let i = 0; i < operatorIds.length; i++) {
          const earnings = await views.getOperatorEarnings(operatorIds[i]);
          totalOperatorEarnings += earnings;
        }
        const daoBalance = await views.getNetworkEarnings();
        const stakingBalance = await views.stakingEthPoolBalance();

        const expectedBalance = clusterBalance + totalOperatorEarnings + daoBalance + stakingBalance;

        return { contractBalance, expectedBalance, clusterBalance, totalOperatorEarnings, daoBalance, stakingBalance };
      };
      await network.updateNetworkFee(NETWORK_FEE * 100n);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      let invariant = await calculateInvariant();
      expect(invariant.contractBalance).to.equal(invariant.expectedBalance);
      const clusterBeforeLiquidation = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.connect(clusterOwner).liquidate(clusterOwner.address, operatorIds, clusterBeforeLiquidation);
      invariant = await calculateInvariant();
      expect(invariant.contractBalance).to.equal(invariant.expectedBalance);
      const liquidatedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const depositAmount = connection.ethers.parseEther("5");

      await network.connect(clusterOwner).deposit(
        clusterOwner.address,
        operatorIds,
        liquidatedCluster,
        { value: depositAmount }
      );
      invariant = await calculateInvariant();
      expect(invariant.contractBalance).to.equal(invariant.expectedBalance);
      const clusterAfterDeposit = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const partialWithdraw = connection.ethers.parseEther("3");

      await network.connect(clusterOwner).withdraw(operatorIds, partialWithdraw, clusterAfterDeposit);
      invariant = await calculateInvariant();
      expect(invariant.contractBalance).to.equal(invariant.expectedBalance);
      const clusterAfterPartialWithdraw = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const remainingWithdraw = connection.ethers.parseEther("2");

      await network.connect(clusterOwner).withdraw(operatorIds, remainingWithdraw, clusterAfterPartialWithdraw);
      invariant = await calculateInvariant();
      expect(invariant.contractBalance).to.equal(invariant.expectedBalance);
      const finalCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(finalCluster.balance).to.equal(0n);
    });

    it("Allows withdrawal from liquidated cluster even if one operator was removed", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      await network.updateNetworkFee(NETWORK_FEE * 100n);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      const activeCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(activeCluster.active).to.equal(true);
      expect(activeCluster.validatorCount).to.equal(1n);
      await network.connect(operatorOwner).removeOperator(operatorIds[0]);
      const removedOperatorDetails = await views.getOperatorById(operatorIds[0]);
      expect(removedOperatorDetails[0]).to.not.equal(connection.ethers.ZeroAddress);
      const currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.connect(clusterOwner).liquidate(clusterOwner.address, operatorIds, currentCluster);

      const liquidatedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(liquidatedCluster.active).to.equal(false);
      const depositAmount = connection.ethers.parseEther("4");

      const depositTx = await network.connect(clusterOwner).deposit(
        clusterOwner.address,
        operatorIds,
        liquidatedCluster,
        { value: depositAmount }
      );
      await depositTx.wait();

      const clusterAfterDeposit = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(clusterAfterDeposit.balance).to.equal(depositAmount);
      const ownerBalanceBefore = await connection.ethers.provider.getBalance(clusterOwner.address);

      const withdrawTx = await network.connect(clusterOwner).withdraw(
        operatorIds,
        depositAmount,
        clusterAfterDeposit
      );
      const withdrawReceipt = await withdrawTx.wait();
      const withdrawGasCost = withdrawReceipt!.gasUsed * withdrawReceipt!.gasPrice;
      const clusterAfterWithdraw = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(clusterAfterWithdraw.balance).to.equal(0n);
      expect(clusterAfterWithdraw.active).to.equal(false);
      const ownerBalanceAfter = await connection.ethers.provider.getBalance(clusterOwner.address);
      expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(depositAmount - withdrawGasCost);
    });

    it("Allows reactivation after partial withdrawal from liquidated cluster", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      await network.updateNetworkFee(NETWORK_FEE * 100n);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      const currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.connect(clusterOwner).liquidate(clusterOwner.address, operatorIds, currentCluster);

      const liquidatedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(liquidatedCluster.active).to.equal(false);
      const depositAmount = connection.ethers.parseEther("10");

      await network.connect(clusterOwner).deposit(
        clusterOwner.address,
        operatorIds,
        liquidatedCluster,
        { value: depositAmount }
      );

      const clusterAfterDeposit = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(clusterAfterDeposit.balance).to.equal(depositAmount);
      const partialWithdrawAmount = connection.ethers.parseEther("3");

      await network.connect(clusterOwner).withdraw(
        operatorIds,
        partialWithdrawAmount,
        clusterAfterDeposit
      );

      const clusterAfterPartialWithdraw = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(clusterAfterPartialWithdraw.balance).to.equal(depositAmount - partialWithdrawAmount);
      expect(clusterAfterPartialWithdraw.active).to.equal(false);
      const reactivationDeposit = connection.ethers.parseEther("3");

      const reactivateTx = await network.connect(clusterOwner).reactivate(
        operatorIds,
        clusterAfterPartialWithdraw,
        { value: reactivationDeposit }
      );

      await expect(reactivateTx)
        .to.emit(network, Events.CLUSTER_REACTIVATED);
      const reactivatedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(reactivatedCluster.active).to.equal(true);
      expect(reactivatedCluster.validatorCount).to.equal(1n);
      expect(reactivatedCluster.balance).to.equal(
        depositAmount - partialWithdrawAmount + reactivationDeposit
      );
      const isLiquidatable = await views.isLiquidatable(clusterOwner.address, operatorIds, reactivatedCluster);
      expect(isLiquidatable).to.equal(false);
    });
  });
});

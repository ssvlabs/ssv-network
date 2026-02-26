import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from '../../setup/connection.ts';
import { ssvNetworkFullFixture } from '../../setup/fixtures.ts';
import type { NetworkHelpersType } from '../../common/types.ts';
import {
  registerOperators,
  whitelistAddresses,
  makePublicKey,
  getCurrentClusterState,
  registerDefaultCluster,
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
    ({ connection, networkHelpers } = await getTestConnection());
    [operatorOwner, clusterOwner, liquidator] = await connection.ethers.getSigners();

    for (const signer of [operatorOwner, clusterOwner, liquidator]) {
      await connection.ethers.provider.send("hardhat_setBalance", [signer.address, "0x3635c9adc5dea00000"]);
    }
  });

  const deployFullSSVNetworkFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  // ============================================================================
  // SECTION 1: Balance Delta Assertions for ETH-Moving Operations
  // ============================================================================

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

      // Calculate exact expected balance using SPEC.md formula
      const blocksDelta = BigInt(blockAfter - blockBefore);
      const burnRatePerBlock = (MINIMAL_OPERATOR_ETH_FEE * 4n) + NETWORK_FEE;
      const expectedBurn = blocksDelta * burnRatePerBlock;
      const expectedBalance = balanceBefore + depositAmount - expectedBurn;

      expect(balanceAfter).to.equal(expectedBalance);

      // Contract received exactly the deposit amount
      expect(contractBalanceAfter - contractBalanceBefore).to.equal(depositAmount);

      // Depositor paid deposit + gas
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

      // Contract sent exactly the withdraw amount
      expect(contractBalanceBefore - contractBalanceAfter).to.equal(withdrawAmount);

      // Owner received withdraw amount minus gas
      expect(ownerBalanceAfter + gasUsed - ownerBalanceBefore).to.equal(withdrawAmount);

      // Calculate exact cluster balance decrease using SPEC.md formula
      const blocksDelta = BigInt(blockWithdraw - blockRegister);
      const burnRatePerBlock = (MINIMAL_OPERATOR_ETH_FEE * 4n) + NETWORK_FEE;
      const expectedBurn = blocksDelta * burnRatePerBlock;
      const expectedBalanceDecrease = withdrawAmount + expectedBurn;

      expect(balanceBefore - balanceAfter).to.equal(expectedBalanceDecrease);
    });

    it("liquidate: liquidator receives remaining cluster balance", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      // Use high network fee for faster liquidation
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

      // Mine until liquidatable
      let currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      let isLiquidatable = false;
      let attempts = 0;
      while (!isLiquidatable && attempts < 20) {
        await connection.networkHelpers.mine(100000);
        isLiquidatable = await views.isLiquidatable(clusterOwner.address, operatorIds, currentCluster);
        attempts++;
      }
      expect(isLiquidatable).to.be.true;

      // Capture balances before liquidation
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

      // Calculate exact fees accrued from register to liquidate
      const blocksDelta = BigInt(blockLiquidate - blockRegister);
      const burnRatePerBlock = (MINIMAL_OPERATOR_ETH_FEE * 4n) + highNetworkFee;
      const totalFees = blocksDelta * burnRatePerBlock;
      const expectedRemainingBalance = DEFAULT_ETH_REGISTER_VALUE - totalFees;

      // Liquidator receives remaining balance (capped at 0)
      const actualLiquidatorReward = expectedRemainingBalance > 0n ? expectedRemainingBalance : 0n;
      const liquidatorGain = liquidatorBalanceAfter + gasUsed - liquidatorBalanceBefore;
      expect(liquidatorGain).to.equal(actualLiquidatorReward);

      // Contract balance decreased by exact liquidator reward
      expect(contractBalanceBefore - contractBalanceAfter).to.equal(actualLiquidatorReward);

      // Cluster is now liquidated
      const clusterAfter = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(clusterAfter.active).to.equal(false);
      expect(await views.isLiquidated(clusterOwner.address, operatorIds, clusterAfter)).to.equal(true);
    });
  });

  // ============================================================================
  // SECTION 2: Multi-Block Simulation - Cluster Balance Burn
  // ============================================================================

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

      // Get initial balance
      let currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const initialBalance = await views.getBalance(clusterOwner.address, operatorIds, currentCluster);

      // Calculate expected burn rate: (4 operators * fee) + network fee
      const expectedBurnRatePerBlock = (MINIMAL_OPERATOR_ETH_FEE * 4n) + NETWORK_FEE;

      // Test at multiple checkpoints
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

      // Register first validator
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      let currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const balanceAfter1Validator = await views.getBalance(clusterOwner.address, operatorIds, currentCluster);

      // Mine 100 blocks with 1 validator
      await connection.networkHelpers.mine(100n);
      currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const balanceAfter100Blocks = await views.getBalance(clusterOwner.address, operatorIds, currentCluster);

      const burnRateWith1Validator = balanceAfter1Validator - balanceAfter100Blocks;
      const expectedBurnRate1 = 100n * ((MINIMAL_OPERATOR_ETH_FEE * 4n) + NETWORK_FEE);
      expect(burnRateWith1Validator).to.equal(expectedBurnRate1);

      // Register second validator
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(2),
        operatorIds,
        DEFAULT_SHARES,
        currentCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const balanceAfter2Validators = await views.getBalance(clusterOwner.address, operatorIds, currentCluster);

      // Mine 100 blocks with 2 validators
      await connection.networkHelpers.mine(100n);
      currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const balanceAfter2Val100Blocks = await views.getBalance(clusterOwner.address, operatorIds, currentCluster);

      const burnRateWith2Validators = balanceAfter2Validators - balanceAfter2Val100Blocks;
      const expectedBurnRate2 = 100n * ((MINIMAL_OPERATOR_ETH_FEE * 4n * 2n) + (NETWORK_FEE * 2n));
      expect(burnRateWith2Validators).to.equal(expectedBurnRate2);

      // Burn rate should double with 2 validators
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

  // ============================================================================
  // SECTION 3: Invariant Checks - Balance Conservation
  // ============================================================================

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

      // Mine blocks to accumulate fees
      const blocks = 500n;
      let currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await connection.networkHelpers.mine(blocks);

      // Calculate all balances
      const clusterBalance = await views.getBalance(clusterOwner.address, operatorIds, currentCluster);

      let totalOperatorEarnings = 0n;
      for (const opId of operatorIds) {
        totalOperatorEarnings += await views.getOperatorEarnings(opId);
      }

      const networkEarningsAfter = await views.getNetworkEarnings();
      const networkEarningsDelta = networkEarningsAfter - networkEarningsBefore;

      // INVARIANT: deposited = cluster + operators + network (exact equality)
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

      // Calculate exact balance decrease: withdrawAmount + fees accrued
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

      // Calculate exact balance increase: depositAmount - fees accrued
      const blocksDelta = BigInt(blockDeposit - blockRegister);
      const burnRatePerBlock = (MINIMAL_OPERATOR_ETH_FEE * 4n) + NETWORK_FEE;
      const expectedBurn = blocksDelta * burnRatePerBlock;
      const expectedBalanceIncrease = depositAmount - expectedBurn;

      expect(balanceAfter - balanceBefore).to.equal(expectedBalanceIncrease);
    });
  });

  // ============================================================================
  // SECTION 4: Liquidation Boundary Testing
  // ============================================================================

  describe("Liquidation Boundary Tests", async function() {

    it("Cluster is not liquidatable just above threshold", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      // Register with large deposit
      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      const currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      
      // Fresh cluster should not be liquidatable
      const isLiquidatable = await views.isLiquidatable(clusterOwner.address, operatorIds, currentCluster);
      expect(isLiquidatable).to.equal(false);

      // Third party cannot liquidate
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

      // Use high network fee for faster liquidation
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

      // Mine until liquidatable
      let currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      let attempts = 0;
      while (!(await views.isLiquidatable(clusterOwner.address, operatorIds, currentCluster)) && attempts < 20) {
        await connection.networkHelpers.mine(100000);
        attempts++;
      }

      // Liquidate
      await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, currentCluster);
      const liquidatedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(liquidatedCluster.active).to.equal(false);

      // Try to reactivate with insufficient balance
      await expect(
        network.connect(clusterOwner).reactivate(
          operatorIds,
          liquidatedCluster,
          { value: 1n } // Too small
        )
      ).to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);

      // Reactivate with sufficient balance
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

  // ============================================================================
  // SECTION 5: Combined Scenarios - Full Cluster Lifecycle Economics
  // ============================================================================

  describe("Combined Scenarios - Full Lifecycle Economics", async function() {

    it("Full lifecycle: register → operate → withdraw → deposit → liquidate → reactivate", async function() {
      // NOTE: This test uses directional assertions (lessThan/greaterThan) for simplicity
      // in multi-step flows. Individual operations are tested with exact formulas in other tests.
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      // Use high network fee for faster liquidation
      await network.updateNetworkFee(NETWORK_FEE * 100n);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      // STEP 1: Register validator
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

      // STEP 2: Operate for some blocks
      await connection.networkHelpers.mine(100n);
      currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const balanceAfterOperation = await views.getBalance(clusterOwner.address, operatorIds, currentCluster);
      expect(balanceAfterOperation).to.be.lessThan(initialBalance);

      // Verify operators earned fees
      const operatorEarnings = await views.getOperatorEarnings(operatorIds[0]);
      expect(operatorEarnings).to.be.greaterThan(0n);

      // STEP 3: Withdraw a small amount (to not trigger liquidation)
      const withdrawAmount = connection.ethers.parseEther("0.1");
      await network.connect(clusterOwner).withdraw(operatorIds, withdrawAmount, currentCluster);
      currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const balanceAfterWithdraw = await views.getBalance(clusterOwner.address, operatorIds, currentCluster);
      expect(balanceAfterWithdraw).to.be.lessThan(balanceAfterOperation);

      // STEP 4: Deposit more
      await network.connect(clusterOwner).deposit(
        clusterOwner.address,
        operatorIds,
        currentCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const balanceAfterDeposit = await views.getBalance(clusterOwner.address, operatorIds, currentCluster);
      expect(balanceAfterDeposit).to.be.greaterThan(balanceAfterWithdraw);

      // STEP 5: Mine until liquidatable and liquidate
      let attempts = 0;
      while (!(await views.isLiquidatable(clusterOwner.address, operatorIds, currentCluster)) && attempts < 30) {
        await connection.networkHelpers.mine(100000);
        attempts++;
      }
      expect(await views.isLiquidatable(clusterOwner.address, operatorIds, currentCluster)).to.be.true;

      await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, currentCluster);
      currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(currentCluster.active).to.equal(false);

      // STEP 6: Reactivate
      await network.connect(clusterOwner).reactivate(
        operatorIds,
        currentCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );
      currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(currentCluster.active).to.equal(true);

      // STEP 7: Remove validator
      await network.connect(clusterOwner).removeValidator(validatorKey, operatorIds, currentCluster);
      currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(currentCluster.validatorCount).to.equal(0n);

      // After removing all validators, we can withdraw remaining balance if any
      // Note: With no validators, the cluster may not have minimum collateral requirements
      const finalBalance = await views.getBalance(clusterOwner.address, operatorIds, currentCluster);
      expect(finalBalance).to.be.greaterThanOrEqual(0n);
    });

    it("Third-party deposit doesn't affect owner's ability to withdraw", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const { cluster, operatorIds } = await registerDefaultCluster(
        connection, network, views, operatorOwner, clusterOwner
      );

      const balanceBeforeThirdParty = await views.getBalance(clusterOwner.address, operatorIds, cluster);

      // Third party deposits
      await network.connect(liquidator).deposit(
        clusterOwner.address,
        operatorIds,
        cluster,
        { value: connection.ethers.parseEther("2") }
      );

      const clusterAfterDeposit = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const balanceAfterThirdParty = await views.getBalance(clusterOwner.address, operatorIds, clusterAfterDeposit);
      expect(balanceAfterThirdParty).to.be.greaterThan(balanceBeforeThirdParty);

      // Owner can still withdraw
      const withdrawAmount = balanceAfterThirdParty / 2n;
      const tx = await network.connect(clusterOwner).withdraw(operatorIds, withdrawAmount, clusterAfterDeposit);
      await expect(tx).to.emit(network, Events.CLUSTER_WITHDRAWN);
    });
  });

  // ============================================================================
  // SECTION 6: Edge Cases and Error Conditions
  // ============================================================================

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
      // Try to withdraw almost everything, leaving less than minimum collateral
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

      // Create stale state by modifying balance
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

      const getClusterId = (ownerAddress: string, opIds: bigint[]) =>
        ethers.keccak256(ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, opIds]));

      const getEBRoot = (clusterId: string, effectiveBalance: number) => {
        const coder = ethers.AbiCoder.defaultAbiCoder();
        const innerHash = ethers.keccak256(coder.encode(["bytes32", "uint32"], [clusterId, effectiveBalance]));
        return ethers.keccak256(ethers.solidityPacked(["bytes32"], [innerHash]));
      };

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

      const clusterId = getClusterId(clusterOwner.address, operatorIds);
      const effectiveBalance = 33;
      const ebRoot = getEBRoot(clusterId, effectiveBalance);

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
      const ebRoot2 = getEBRoot(clusterId, effectiveBalance2);

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

      // Use high network fee for faster liquidation
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

      // Mine until liquidatable
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

      // Use high network fee for faster liquidation
      await network.updateNetworkFee(NETWORK_FEE * 100n);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      // Step 1: Register validator with active cluster
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

      // Step 2: Mine blocks until cluster becomes liquidatable
      let currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      let attempts = 0;
      while (!(await views.isLiquidatable(clusterOwner.address, operatorIds, currentCluster)) && attempts < 20) {
        await connection.networkHelpers.mine(100000);
        attempts++;
      }
      expect(attempts).to.be.lessThan(20, "Cluster should have become liquidatable");

      // Step 3: Liquidate the cluster
      const networkBalanceBefore = await connection.ethers.provider.getBalance(await network.getAddress());

      await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, currentCluster);

      const liquidatedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(liquidatedCluster.active).to.equal(false);
      expect(liquidatedCluster.balance).to.equal(0n);
      // Note: validator count is NOT reset to 0 during liquidation
      expect(liquidatedCluster.validatorCount).to.equal(1n);

      // Step 4: Deposit to the liquidated cluster (preparing for potential reactivation)
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
      expect(clusterAfterDeposit.active).to.equal(false); // Still liquidated
      expect(clusterAfterDeposit.balance).to.equal(depositAmount);
      expect(clusterAfterDeposit.validatorCount).to.equal(1n); // Still has validator count from before liquidation

      // Verify ETH was transferred to contract
      const networkBalanceAfterDeposit = await connection.ethers.provider.getBalance(await network.getAddress());
      expect(networkBalanceAfterDeposit - networkBalanceBefore).to.equal(depositAmount);

      // Verify owner's balance decreased by deposit + gas
      const ownerBalanceAfterDeposit = await connection.ethers.provider.getBalance(clusterOwner.address);
      expect(ownerBalanceBeforeDeposit - ownerBalanceAfterDeposit).to.equal(depositAmount + depositGasCost);

      // Step 5: Owner changes their mind - withdraw without reactivating
      const ownerBalanceBeforeWithdraw = await connection.ethers.provider.getBalance(clusterOwner.address);
      const networkBalanceBeforeWithdraw = await connection.ethers.provider.getBalance(await network.getAddress());

      const withdrawAmount = depositAmount; // Withdraw full amount
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
          [1n, 0n, 0n, false, 0n] // Final cluster state: validatorCount still 1, rest zeros, inactive
        );

      // Step 6: Verify final state
      const clusterAfterWithdraw = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(clusterAfterWithdraw.active).to.equal(false);
      expect(clusterAfterWithdraw.balance).to.equal(0n);
      expect(clusterAfterWithdraw.validatorCount).to.equal(1n); // Validator count persists through liquidation/deposit/withdraw

      // Verify ETH was transferred back to owner
      const ownerBalanceAfterWithdraw = await connection.ethers.provider.getBalance(clusterOwner.address);
      const ownerBalanceDelta = ownerBalanceAfterWithdraw - ownerBalanceBeforeWithdraw;
      expect(ownerBalanceDelta).to.equal(withdrawAmount - withdrawGasCost);

      // Verify contract balance decreased
      const networkBalanceAfterWithdraw = await connection.ethers.provider.getBalance(await network.getAddress());
      expect(networkBalanceBeforeWithdraw - networkBalanceAfterWithdraw).to.equal(withdrawAmount);

      // Verify balance invariant: owner got back what they deposited (minus gas)
      const ownerBalanceFinal = await connection.ethers.provider.getBalance(clusterOwner.address);
      const totalGasSpent = depositGasCost + withdrawGasCost;
      expect(ownerBalanceFinal).to.equal(ownerBalanceBeforeDeposit - totalGasSpent);
    });

    it("Maintains global ETH accounting invariant after liquidated cluster withdrawal", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      // Helper to calculate global accounting invariant
      const calculateInvariant = async () => {
        const contractBalance = await connection.ethers.provider.getBalance(await network.getAddress());

        // Sum all cluster balances (we only have one cluster in this test)
        const clusterBalance = BigInt((await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds)).balance);

        // Sum operator ETH earnings
        let totalOperatorEarnings = 0n;
        for (let i = 0; i < operatorIds.length; i++) {
          const earnings = await views.getOperatorEarnings(operatorIds[i]);
          totalOperatorEarnings += earnings;
        }

        // Get DAO balance (network earnings)
        const daoBalance = await views.getNetworkEarnings();

        // Get staking pool balance (if any)
        const stakingBalance = await views.stakingEthPoolBalance();

        const expectedBalance = clusterBalance + totalOperatorEarnings + daoBalance + stakingBalance;

        return { contractBalance, expectedBalance, clusterBalance, totalOperatorEarnings, daoBalance, stakingBalance };
      };

      // Use high network fee for faster liquidation
      await network.updateNetworkFee(NETWORK_FEE * 100n);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      // Step 1: Register validator
      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      // Verify invariant after registration
      let invariant = await calculateInvariant();
      expect(invariant.contractBalance).to.equal(invariant.expectedBalance);

      // Step 2: Self-liquidate (owner can always liquidate their own cluster)
      const clusterBeforeLiquidation = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.connect(clusterOwner).liquidate(clusterOwner.address, operatorIds, clusterBeforeLiquidation);

      // Verify invariant after liquidation
      invariant = await calculateInvariant();
      expect(invariant.contractBalance).to.equal(invariant.expectedBalance);

      // Step 3: Deposit to liquidated cluster
      const liquidatedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const depositAmount = connection.ethers.parseEther("5");

      await network.connect(clusterOwner).deposit(
        clusterOwner.address,
        operatorIds,
        liquidatedCluster,
        { value: depositAmount }
      );

      // Verify invariant after deposit
      invariant = await calculateInvariant();
      expect(invariant.contractBalance).to.equal(invariant.expectedBalance);

      // Step 4: Partial withdrawal (3 ETH)
      const clusterAfterDeposit = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const partialWithdraw = connection.ethers.parseEther("3");

      await network.connect(clusterOwner).withdraw(operatorIds, partialWithdraw, clusterAfterDeposit);

      // Verify invariant after partial withdrawal
      invariant = await calculateInvariant();
      expect(invariant.contractBalance).to.equal(invariant.expectedBalance);

      // Step 5: Withdraw remaining balance (2 ETH)
      const clusterAfterPartialWithdraw = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const remainingWithdraw = connection.ethers.parseEther("2");

      await network.connect(clusterOwner).withdraw(operatorIds, remainingWithdraw, clusterAfterPartialWithdraw);

      // Verify invariant after full withdrawal
      invariant = await calculateInvariant();
      expect(invariant.contractBalance).to.equal(invariant.expectedBalance);

      // Final verification: cluster balance should be 0
      const finalCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(finalCluster.balance).to.equal(0n);
    });

    it("Allows withdrawal from liquidated cluster even if one operator was removed", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      // Use high network fee for faster liquidation
      await network.updateNetworkFee(NETWORK_FEE * 100n);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      // Step 1: Register validator with 4 operators
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

      // Step 2: Remove one operator (operator[0])
      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      // Verify operator is removed
      const removedOperatorDetails = await views.getOperatorById(operatorIds[0]);
      expect(removedOperatorDetails[0]).to.not.equal(connection.ethers.ZeroAddress); // Owner preserved after removal

      // Step 3: Self-liquidate (owner can always liquidate their own cluster)
      const currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.connect(clusterOwner).liquidate(clusterOwner.address, operatorIds, currentCluster);

      const liquidatedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(liquidatedCluster.active).to.equal(false);

      // Step 4: Deposit to liquidated cluster (despite removed operator)
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

      // Step 5: Withdraw from liquidated cluster (should succeed despite removed operator)
      const ownerBalanceBefore = await connection.ethers.provider.getBalance(clusterOwner.address);

      const withdrawTx = await network.connect(clusterOwner).withdraw(
        operatorIds,
        depositAmount,
        clusterAfterDeposit
      );
      const withdrawReceipt = await withdrawTx.wait();
      const withdrawGasCost = withdrawReceipt!.gasUsed * withdrawReceipt!.gasPrice;

      // Verify withdrawal succeeded
      const clusterAfterWithdraw = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(clusterAfterWithdraw.balance).to.equal(0n);
      expect(clusterAfterWithdraw.active).to.equal(false);

      // Verify ETH was transferred to owner
      const ownerBalanceAfter = await connection.ethers.provider.getBalance(clusterOwner.address);
      expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(depositAmount - withdrawGasCost);
    });

    it("Allows reactivation after partial withdrawal from liquidated cluster", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      // Use high network fee for faster liquidation
      await network.updateNetworkFee(NETWORK_FEE * 100n);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      // Step 1: Register validator
      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      // Step 2: Self-liquidate (owner can always liquidate their own cluster)
      const currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.connect(clusterOwner).liquidate(clusterOwner.address, operatorIds, currentCluster);

      const liquidatedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(liquidatedCluster.active).to.equal(false);

      // Step 3: Deposit substantial amount to liquidated cluster
      const depositAmount = connection.ethers.parseEther("10");

      await network.connect(clusterOwner).deposit(
        clusterOwner.address,
        operatorIds,
        liquidatedCluster,
        { value: depositAmount }
      );

      const clusterAfterDeposit = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(clusterAfterDeposit.balance).to.equal(depositAmount);

      // Step 4: Partial withdrawal (3 ETH, leaving 7 ETH)
      const partialWithdrawAmount = connection.ethers.parseEther("3");

      await network.connect(clusterOwner).withdraw(
        operatorIds,
        partialWithdrawAmount,
        clusterAfterDeposit
      );

      const clusterAfterPartialWithdraw = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(clusterAfterPartialWithdraw.balance).to.equal(depositAmount - partialWithdrawAmount);
      expect(clusterAfterPartialWithdraw.active).to.equal(false); // Still liquidated

      // Step 5: Reactivate with remaining balance (7 ETH should be sufficient)
      const reactivationDeposit = connection.ethers.parseEther("3"); // Additional deposit for reactivation

      const reactivateTx = await network.connect(clusterOwner).reactivate(
        operatorIds,
        clusterAfterPartialWithdraw,
        { value: reactivationDeposit }
      );

      await expect(reactivateTx)
        .to.emit(network, Events.CLUSTER_REACTIVATED);

      // Step 6: Verify cluster is now active
      const reactivatedCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(reactivatedCluster.active).to.equal(true);
      expect(reactivatedCluster.validatorCount).to.equal(1n);
      expect(reactivatedCluster.balance).to.equal(
        depositAmount - partialWithdrawAmount + reactivationDeposit
      ); // 7 ETH from deposit + 3 ETH from reactivation = 10 ETH

      // Step 7: Verify cluster is not liquidatable after reactivation
      const isLiquidatable = await views.isLiquidatable(clusterOwner.address, operatorIds, reactivatedCluster);
      expect(isLiquidatable).to.equal(false);
    });
  });
});

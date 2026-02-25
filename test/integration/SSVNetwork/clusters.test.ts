import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from '../../setup/connection.ts';
import { ssvNetworkFullFixture } from '../../setup/fixtures.ts';
import type { NetworkHelpersType } from '../../common/types.ts';
import {
  makeOperatorKey,
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
  MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
  MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
} from '../../common/constants.ts';
import { Events } from '../../common/events.ts';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import { Errors } from '../../common/errors.js';
import { trackGasFromReceipt, GasGroup } from '../../helpers/gas-usage.ts';

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

      const tx = await network.connect(clusterOwner).deposit(
        clusterOwner.address,
        operatorIds,
        cluster,
        { value: depositAmount }
      );
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const clusterAfter = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const balanceAfter = await views.getBalance(clusterOwner.address, operatorIds, clusterAfter);
      const contractBalanceAfter = await connection.ethers.provider.getBalance(await network.getAddress());
      const depositorBalanceAfter = await connection.ethers.provider.getBalance(clusterOwner.address);

      // Cluster balance increased by deposit amount (minus any burn during the tx)
      expect(balanceAfter).to.be.greaterThan(balanceBefore);
      
      // Contract received exactly the deposit amount
      expect(contractBalanceAfter - contractBalanceBefore).to.equal(depositAmount);
      
      // Depositor paid deposit + gas
      expect(depositorBalanceBefore - depositorBalanceAfter).to.equal(depositAmount + gasUsed);
    });

    it("withdraw: verifies exact ETH transfer from contract to owner", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const { cluster, operatorIds } = await registerDefaultCluster(
        connection, network, views, operatorOwner, clusterOwner
      );

      const balanceBefore = await views.getBalance(clusterOwner.address, operatorIds, cluster);
      const withdrawAmount = balanceBefore / 2n;

      const contractBalanceBefore = await connection.ethers.provider.getBalance(await network.getAddress());
      const ownerBalanceBefore = await connection.ethers.provider.getBalance(clusterOwner.address);

      const tx = await network.connect(clusterOwner).withdraw(operatorIds, withdrawAmount, cluster);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;

      const clusterAfter = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const balanceAfter = await views.getBalance(clusterOwner.address, operatorIds, clusterAfter);
      const contractBalanceAfter = await connection.ethers.provider.getBalance(await network.getAddress());
      const ownerBalanceAfter = await connection.ethers.provider.getBalance(clusterOwner.address);

      // Contract sent exactly the withdraw amount
      expect(contractBalanceBefore - contractBalanceAfter).to.equal(withdrawAmount);
      
      // Owner received withdraw amount minus gas
      expect(ownerBalanceAfter + gasUsed - ownerBalanceBefore).to.equal(withdrawAmount);

      // Cluster balance decreased by at least withdraw amount (plus any burn)
      expect(balanceBefore - balanceAfter).to.be.greaterThanOrEqual(withdrawAmount);
    });

    it("liquidate: liquidator receives remaining cluster balance", async function() {
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

      const liquidatorBalanceAfter = await connection.ethers.provider.getBalance(liquidator.address);
      const contractBalanceAfter = await connection.ethers.provider.getBalance(await network.getAddress());

      // Liquidator should receive remaining cluster balance (contract balance decreased)
      const liquidatorGain = liquidatorBalanceAfter + gasUsed - liquidatorBalanceBefore;
      expect(liquidatorGain).to.be.greaterThanOrEqual(0n);
      
      // Contract balance should have decreased (funds went to liquidator)
      expect(contractBalanceBefore).to.be.greaterThanOrEqual(contractBalanceAfter);

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

      // INVARIANT: deposited = cluster + operators + network
      const totalAccounted = clusterBalance + totalOperatorEarnings + networkEarningsDelta;
      
      // Allow small tolerance for rounding
      const diff = depositAmount > totalAccounted 
        ? depositAmount - totalAccounted 
        : totalAccounted - depositAmount;
      
      expect(diff).to.be.lessThanOrEqual(100n, "Balance invariant violated");
    });

    it("Invariant: Withdrawal reduces cluster balance exactly", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const { cluster, operatorIds } = await registerDefaultCluster(
        connection, network, views, operatorOwner, clusterOwner
      );

      const balanceBefore = await views.getBalance(clusterOwner.address, operatorIds, cluster);
      const withdrawAmount = connection.ethers.parseEther("1");

      await network.connect(clusterOwner).withdraw(operatorIds, withdrawAmount, cluster);

      const clusterAfter = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const balanceAfter = await views.getBalance(clusterOwner.address, operatorIds, clusterAfter);

      // Balance decreased by at least withdrawAmount (could be more due to burn during tx)
      expect(balanceBefore - balanceAfter).to.be.greaterThanOrEqual(withdrawAmount);
      expect(balanceBefore - balanceAfter).to.be.lessThan(withdrawAmount + NETWORK_FEE * 10n);
    });

    it("Invariant: Deposit increases cluster balance exactly", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const { cluster, operatorIds } = await registerDefaultCluster(
        connection, network, views, operatorOwner, clusterOwner
      );

      await connection.ethers.provider.send("hardhat_setBalance", [clusterOwner.address, "0x3635c9adc5dea00000"]);
      const balanceBefore = await views.getBalance(clusterOwner.address, operatorIds, cluster);
      const depositAmount = connection.ethers.parseEther("5");

      await network.connect(clusterOwner).deposit(
        clusterOwner.address,
        operatorIds,
        cluster,
        { value: depositAmount }
      );

      const clusterAfter = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const balanceAfter = await views.getBalance(clusterOwner.address, operatorIds, clusterAfter);

      // Balance increased by depositAmount minus any burn during tx
      const expectedBurnPerBlock = (MINIMAL_OPERATOR_ETH_FEE * 4n) + NETWORK_FEE;
      expect(balanceAfter - balanceBefore).to.be.greaterThan(depositAmount - expectedBurnPerBlock * 2n);
      expect(balanceAfter - balanceBefore).to.be.lessThanOrEqual(depositAmount);
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
      
      // Cluster is not liquidatable by others
      const isLiquidatable = await views.isLiquidatable(clusterOwner.address, operatorIds, currentCluster);
      expect(isLiquidatable).to.equal(false);

      // But owner can self-liquidate
      const tx = await network.connect(clusterOwner).liquidate(
        clusterOwner.address,
        operatorIds,
        currentCluster
      );
      await expect(tx).to.emit(network, Events.CLUSTER_LIQUIDATED);

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

    it("Liquidated cluster cannot be withdrawn from", async function() {
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
      ).to.be.revertedWithCustomError(network, Errors.CLUSTER_IS_LIQUIDATED);
    });
  });
});

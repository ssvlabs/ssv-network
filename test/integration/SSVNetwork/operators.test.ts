import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { ssvNetworkFullFixture } from '../../setup/fixtures.ts';
import type { NetworkHelpersType } from '../../common/types.ts';
import {
  makeOperatorKey,
  registerOperators,
  whitelistAddresses,
  makePublicKey,
  getCurrentClusterState,
  registerDefaultCluster,
  setupTestContext,
} from '../../common/helpers.ts';
import {
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  DEFAULT_ETH_REGISTER_VALUE,
  DECLARE_OPERATOR_FEE_PERIOD,
  EXECUTE_OPERATOR_FEE_PERIOD,
  MAXIMUM_OPERATORS_FEE,
  MINIMAL_OPERATOR_ETH_FEE,
  OPERATOR_MAX_FEE_INCREASE,
  NETWORK_FEE,
} from '../../common/constants.ts';
import { Events } from '../../common/events.ts';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import { Errors } from '../../common/errors.js';
import { deployContract } from '../../../scripts/common/helpers.js';
import { trackGasFromReceipt, GasGroup } from '../../helpers/gas-usage.ts';

/**
 * Enhanced Integration Tests for SSVNetwork Operators
 * 
 * These tests focus on:
 * 1. Balance delta assertions for every ETH-moving operation
 * 2. Boundary testing (min/max values, just below/above thresholds)
 * 3. Multi-block simulation with exact expected values
 * 4. Basic invariant checks (operator balances, DAO balance, cluster balance)
 * 5. Combined scenarios verifying cluster, operator, and network fee distribution
 */
describe("SSVNetwork Integration - Operators (Enhanced)", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let randomUser: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [operatorOwner, clusterOwner, randomUser] } = await setupTestContext());
  });

  const deployFullSSVNetworkFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  describe("Balance Delta Assertions", async function() {
    
    it("withdrawOperatorEarnings: verifies exact ETH transfer to operator owner", async function() {
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

      const earningsPeriod = 100n;
      await connection.networkHelpers.mine(earningsPeriod);
      const expectedEarnings = earningsPeriod * MINIMAL_OPERATOR_ETH_FEE;
      const actualEarnings = await views.getOperatorEarnings(operatorIds[0]);
      expect(actualEarnings).to.equal(expectedEarnings, "Operator earnings mismatch after mining");
      const ownerEthBefore = await connection.ethers.provider.getBalance(operatorOwner.address);
      const contractBalanceBefore = await connection.ethers.provider.getBalance(await network.getAddress());

      const tx = await network.withdrawOperatorEarnings(operatorIds[0], actualEarnings);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const ownerEthAfter = await connection.ethers.provider.getBalance(operatorOwner.address);
      const contractBalanceAfter = await connection.ethers.provider.getBalance(await network.getAddress());

      expect(ownerEthAfter).to.equal(
        ownerEthBefore + actualEarnings - gasUsed,
        "Owner ETH balance delta incorrect"
      );
      expect(contractBalanceAfter).to.equal(
        contractBalanceBefore - actualEarnings,
        "Contract ETH balance delta incorrect"
      );
      const earningsAfter = await views.getOperatorEarnings(operatorIds[0]);
      expect(earningsAfter).to.equal(MINIMAL_OPERATOR_ETH_FEE, "Remaining earnings should equal 1 block fee");
    });

    it("withdrawAllOperatorEarnings: verifies complete balance drain with exact amounts", async function() {
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

      const earningsPeriod = 50n;
      await connection.networkHelpers.mine(earningsPeriod);

      const earningsBefore = await views.getOperatorEarnings(operatorIds[0]);
      const ownerEthBefore = await connection.ethers.provider.getBalance(operatorOwner.address);

      const tx = await network.withdrawAllOperatorEarnings(operatorIds[0]);
      const receipt = await tx.wait();
      const gasUsed = receipt!.gasUsed * receipt!.gasPrice;
      const expectedWithdrawn = earningsBefore + MINIMAL_OPERATOR_ETH_FEE;

      const ownerEthAfter = await connection.ethers.provider.getBalance(operatorOwner.address);
      expect(ownerEthAfter).to.equal(
        ownerEthBefore + expectedWithdrawn - gasUsed,
        "Owner should receive exact withdrawn amount minus gas"
      );
      expect(await views.getOperatorEarnings(operatorIds[0])).to.equal(0n);
    });
  });

  describe("Boundary Tests - Operator Fees", async function() {

    it("registerOperator: succeeds at exact minimum fee", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorKey = makeOperatorKey(1);

      await expect(network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true))
        .to.emit(network, Events.OPERATOR_ADDED);

      expect(await views.getOperatorFee(1n)).to.equal(MINIMAL_OPERATOR_ETH_FEE);
    });

    it("registerOperator: reverts at just below minimum fee", async function() {
      const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorKey = makeOperatorKey(1);

      await expect(network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE - 1n, true))
        .to.be.revertedWithCustomError(network, Errors.FEE_TOO_LOW);
    });

    it("registerOperator: succeeds at exact maximum fee", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorKey = makeOperatorKey(1);

      await expect(network.registerOperator(operatorKey, MAXIMUM_OPERATORS_FEE, true))
        .to.emit(network, Events.OPERATOR_ADDED);

      expect(await views.getOperatorFee(1n)).to.equal(MAXIMUM_OPERATORS_FEE);
    });

    it("registerOperator: reverts at just above maximum fee", async function() {
      const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorKey = makeOperatorKey(1);

      await expect(network.registerOperator(operatorKey, MAXIMUM_OPERATORS_FEE + 1n, true))
        .to.be.revertedWithCustomError(network, Errors.FEE_TOO_HIGH);
    });

    it("registerOperator: succeeds with zero fee (special case)", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorKey = makeOperatorKey(1);

      await expect(network.registerOperator(operatorKey, 0n, true))
        .to.emit(network, Events.OPERATOR_ADDED);

      expect(await views.getOperatorFee(1n)).to.equal(0n);
    });

    it("declareOperatorFee: succeeds at exact max allowed increase", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorKey = makeOperatorKey(1);
      const startingFee = MINIMAL_OPERATOR_ETH_FEE * 10n;
      await network.registerOperator(operatorKey, startingFee, true);
      const maxAllowedFee = (startingFee * (10000n + OPERATOR_MAX_FEE_INCREASE)) / 10000n;
      const DEDUCTED_DIGITS = 10_000_000n;
      const precisionSafeFee = (maxAllowedFee / DEDUCTED_DIGITS) * DEDUCTED_DIGITS;

      await expect(network.declareOperatorFee(1n, precisionSafeFee))
        .to.emit(network, Events.OPERATOR_FEE_DECLARED);
    });

    it("declareOperatorFee: reverts at just above max allowed increase", async function() {
      const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorKey = makeOperatorKey(1);

      await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE, true);
      const currentFee = MINIMAL_OPERATOR_ETH_FEE;
      const exceedingFee = currentFee * 3n;

      await expect(network.declareOperatorFee(1n, exceedingFee))
        .to.be.revertedWithCustomError(network, Errors.FEE_EXCEEDS_INCREASE_LIMIT);
    });

    it("reduceOperatorFee: succeeds reducing to exact minimum fee", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorKey = makeOperatorKey(1);
      await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE * 2n, true);

      await expect(network.reduceOperatorFee(1n, MINIMAL_OPERATOR_ETH_FEE))
        .to.emit(network, Events.OPERATOR_FEE_EXECUTED);

      expect(await views.getOperatorFee(1n)).to.equal(MINIMAL_OPERATOR_ETH_FEE);
    });

    it("reduceOperatorFee: reverts when reducing below minimum fee", async function() {
      const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const operatorKey = makeOperatorKey(1);

      await network.registerOperator(operatorKey, MINIMAL_OPERATOR_ETH_FEE * 2n, true);

      await expect(network.reduceOperatorFee(1n, MINIMAL_OPERATOR_ETH_FEE - 1n))
        .to.be.revertedWithCustomError(network, Errors.FEE_TOO_LOW);
    });
  });

  describe("Multi-Block Simulation - Operator Earnings Accrual", async function() {

    it("Operator earnings accrue correctly over multiple block periods", async function() {
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
      const checkpoints = [10n, 50n, 100n, 500n];
      let totalBlocksMined = 0n;

      for (const blocks of checkpoints) {
        await connection.networkHelpers.mine(blocks);
        totalBlocksMined += blocks;

        const expectedEarnings = totalBlocksMined * MINIMAL_OPERATOR_ETH_FEE;
        const actualEarnings = await views.getOperatorEarnings(operatorIds[0]);

        expect(actualEarnings).to.equal(
          expectedEarnings,
          `Earnings mismatch at block ${totalBlocksMined}`
        );
      }
    });

    it("All 4 operators earn equally from a single validator cluster", async function() {
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

      const blocks = 200n;
      await connection.networkHelpers.mine(blocks);

      const expectedPerOperator = blocks * MINIMAL_OPERATOR_ETH_FEE;
      for (let i = 0; i < 4; i++) {
        const earnings = await views.getOperatorEarnings(operatorIds[i]);
        expect(earnings).to.equal(expectedPerOperator, `Operator ${i} earnings mismatch`);
      }
    });

    it("Operator earnings scale with validator count", async function() {
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

      const blocks1 = 100n;
      await connection.networkHelpers.mine(blocks1);
      const earningsAfter1Validator = await views.getOperatorEarnings(operatorIds[0]);
      expect(earningsAfter1Validator).to.equal(blocks1 * MINIMAL_OPERATOR_ETH_FEE);
      const cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(2),
        operatorIds,
        DEFAULT_SHARES,
        cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      const blocks2 = 100n;
      await connection.networkHelpers.mine(blocks2);
      const expectedTotal = earningsAfter1Validator + MINIMAL_OPERATOR_ETH_FEE + (blocks2 * MINIMAL_OPERATOR_ETH_FEE * 2n);
      const actualEarnings = await views.getOperatorEarnings(operatorIds[0]);
      
      expect(actualEarnings).to.equal(expectedTotal, "Earnings should scale with validator count");
    });

    it("removeValidator triggers exact settlement of operator earnings", async function() {
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

      const blocksToMine = 100n;
      await connection.networkHelpers.mine(blocksToMine);

      const currentCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.connect(clusterOwner).removeValidator(validatorKey, operatorIds, currentCluster);
      const expectedEarningsPerOperator = (blocksToMine + 1n) * MINIMAL_OPERATOR_ETH_FEE;

      for (const opId of operatorIds) {
        const earnings = await views.getOperatorEarnings(opId);
        expect(earnings).to.equal(expectedEarningsPerOperator);
      }
    });
  });

  describe("Invariant Checks - Operator Balance Consistency", async function() {

    it("Invariant: Total operator earnings <= Cluster balance drained", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      const depositAmount = DEFAULT_ETH_REGISTER_VALUE;
      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: depositAmount }
      );
      const cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

      const blocks = 500n;
      await connection.networkHelpers.mine(blocks);
      let totalOperatorEarnings = 0n;
      for (const opId of operatorIds) {
        totalOperatorEarnings += await views.getOperatorEarnings(opId);
      }
      const clusterBalance = await views.getBalance(clusterOwner.address, operatorIds, cluster);
      const networkEarnings = await views.getNetworkEarnings();
      const totalAccounted = clusterBalance + totalOperatorEarnings + networkEarnings;
      const difference = depositAmount > totalAccounted 
        ? depositAmount - totalAccounted 
        : totalAccounted - depositAmount;

      expect(difference).to.be.lessThanOrEqual(
        100n,
        "Balance invariant violated: funds not properly accounted"
      );
    });

    it("Invariant: Withdrawing all operator earnings zeros out balance", async function() {
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

      await connection.networkHelpers.mine(100n);
      await network.withdrawAllOperatorEarnings(operatorIds[0]);
      expect(await views.getOperatorEarnings(operatorIds[0])).to.equal(0n);
    });

    it("Invariant: Removing validator stops operator fee accrual", async function() {
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

      await connection.networkHelpers.mine(50n);
      const earningsBeforeRemoval = await views.getOperatorEarnings(operatorIds[0]);
      let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      await network.connect(clusterOwner).removeValidator(validatorKey, operatorIds, cluster);
      await connection.networkHelpers.mine(100n);
      const earningsAfterRemoval = await views.getOperatorEarnings(operatorIds[0]);
      expect(earningsAfterRemoval).to.equal(
        earningsBeforeRemoval + MINIMAL_OPERATOR_ETH_FEE,
        "Operator should not earn fees after validator removal"
      );
    });
  });

  describe("Combined Scenarios - Full Fee Distribution", async function() {

    it("Full accounting: cluster deposit -> operator earnings -> network fees", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const validatorKey = makePublicKey(1);
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

      const depositAmount = DEFAULT_ETH_REGISTER_VALUE;
      const networkFeeBefore = await views.getNetworkEarnings();

      await network.connect(clusterOwner).registerValidator(
        validatorKey,
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: depositAmount }
      );

      const blocks = 100n;
      await connection.networkHelpers.mine(blocks);
      const expectedOperatorEarningsPerOp = blocks * MINIMAL_OPERATOR_ETH_FEE;
      const expectedTotalOperatorEarnings = expectedOperatorEarningsPerOp * 4n;
      const expectedNetworkFeeEarnings = blocks * NETWORK_FEE;
      for (const opId of operatorIds) {
        const earnings = await views.getOperatorEarnings(opId);
        expect(earnings).to.equal(expectedOperatorEarningsPerOp, `Operator ${opId} earnings incorrect`);
      }
      const networkFeeAfter = await views.getNetworkEarnings();
      expect(networkFeeAfter - networkFeeBefore).to.equal(
        expectedNetworkFeeEarnings,
        "Network fee earnings incorrect"
      );
      const cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      const clusterBalance = await views.getBalance(clusterOwner.address, operatorIds, cluster);
      
      const expectedBurnRate = (MINIMAL_OPERATOR_ETH_FEE * 4n) + NETWORK_FEE;
      const expectedClusterBalance = depositAmount - (blocks * expectedBurnRate);
      
      expect(clusterBalance).to.equal(expectedClusterBalance, "Cluster balance incorrect after burn");
    });

    it("Operator withdrawal doesn't affect other operators' balances", async function() {
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

      await connection.networkHelpers.mine(100n);
      const earningsBefore: bigint[] = [];
      for (const opId of operatorIds) {
        earningsBefore.push(await views.getOperatorEarnings(opId));
      }
      await network.withdrawOperatorEarnings(operatorIds[0], earningsBefore[0]);
      for (let i = 1; i < operatorIds.length; i++) {
        const earningsAfter = await views.getOperatorEarnings(operatorIds[i]);
        expect(earningsAfter).to.equal(
          earningsBefore[i] + MINIMAL_OPERATOR_ETH_FEE,
          `Operator ${i} balance incorrectly affected by operator 0's withdrawal`
        );
      }
    });

    it("Fee change via declare->execute workflow with precise timing", async function() {
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

      const oldFee = MINIMAL_OPERATOR_ETH_FEE;
      const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
      const declareTx = await network.declareOperatorFee(operatorIds[0], newFee);
      const declareBlock = await declareTx.getBlock();

      await expect(declareTx)
        .to.emit(network, Events.OPERATOR_FEE_DECLARED)
        .withArgs(operatorOwner.address, operatorIds[0], declareBlock!.number, newFee);
      const pendingFee = await views.getOperatorDeclaredFee(operatorIds[0]);
      expect(pendingFee[0]).to.equal(true, "Fee change should be active");
      expect(pendingFee[1]).to.equal(newFee, "Pending fee value incorrect");
      await connection.networkHelpers.time.increase(DECLARE_OPERATOR_FEE_PERIOD + 1n);
      await connection.networkHelpers.mine();
      const executeTx = await network.executeOperatorFee(operatorIds[0]);
      await expect(executeTx).to.emit(network, Events.OPERATOR_FEE_EXECUTED);
      expect(await views.getOperatorFee(operatorIds[0])).to.equal(newFee);
      const blocksBefore = 50n;
      const earningsBefore = await views.getOperatorEarnings(operatorIds[0]);
      
      await connection.networkHelpers.mine(blocksBefore);
      
      const earningsAfter = await views.getOperatorEarnings(operatorIds[0]);
      const expectedIncrease = blocksBefore * newFee;
      
      expect(earningsAfter - earningsBefore).to.equal(
        expectedIncrease,
        "Earnings should accrue at new fee rate"
      );
    });
  });

  describe("Edge Cases and Error Conditions", async function() {

    it("Cannot withdraw more than available earnings", async function() {
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

      await connection.networkHelpers.mine(10n);

      const currentEarnings = await views.getOperatorEarnings(operatorIds[0]);
      const excessiveAmount = currentEarnings * 2n;

      await expect(network.withdrawOperatorEarnings(operatorIds[0], excessiveAmount))
        .to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
    });

    it("Operator with zero fee earns nothing", async function() {
      const { network, views } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const op1Key = makeOperatorKey(1);
      const op2Key = makeOperatorKey(2);
      const op3Key = makeOperatorKey(3);
      const op4Key = makeOperatorKey(4);

      await network.registerOperator(op1Key, MINIMAL_OPERATOR_ETH_FEE, true);
      await network.registerOperator(op2Key, MINIMAL_OPERATOR_ETH_FEE, true);
      await network.registerOperator(op3Key, MINIMAL_OPERATOR_ETH_FEE, true);
      await network.registerOperator(op4Key, 0n, true);

      const operatorIds = [1n, 2n, 3n, 4n];
      await network.setOperatorsWhitelists(operatorIds, [clusterOwner.address]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE }
      );

      await connection.networkHelpers.mine(100n);
      for (let i = 0; i < 3; i++) {
        const earnings = await views.getOperatorEarnings(operatorIds[i]);
        expect(earnings).to.be.greaterThan(0n, `Operator ${i+1} should have earnings`);
      }
      const zeroFeeEarnings = await views.getOperatorEarnings(operatorIds[3]);
      expect(zeroFeeEarnings).to.equal(0n, "Zero-fee operator should have no earnings");
    });

    it("executeOperatorFee reverts before declare period ends", async function() {
      const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 1);
      await network.declareOperatorFee(operatorIds[0], MINIMAL_OPERATOR_ETH_FEE * 2n);
      await expect(network.executeOperatorFee(operatorIds[0]))
        .to.be.revertedWithCustomError(network, Errors.APPROVAL_NOT_WITHIN_TIMEFRAME);
    });

    it("executeOperatorFee reverts after execute period expires", async function() {
      const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 1);
      await network.declareOperatorFee(operatorIds[0], MINIMAL_OPERATOR_ETH_FEE * 2n);
      await connection.networkHelpers.time.increase(
        DECLARE_OPERATOR_FEE_PERIOD + EXECUTE_OPERATOR_FEE_PERIOD + 100n
      );
      await connection.networkHelpers.mine();

      await expect(network.executeOperatorFee(operatorIds[0]))
        .to.be.revertedWithCustomError(network, Errors.APPROVAL_NOT_WITHIN_TIMEFRAME);
    });

    it("Cannot increase fee from zero (must use reduceOperatorFee)", async function() {
      const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorKey = makeOperatorKey(1);
      await network.registerOperator(operatorKey, 0n, true);

      await expect(network.declareOperatorFee(1n, MINIMAL_OPERATOR_ETH_FEE))
        .to.be.revertedWithCustomError(network, Errors.FEE_INCREASE_NOT_ALLOWED);
    });

    it("Removed operator cannot have earnings withdrawn", async function() {
      const { network } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 1);
      await network.removeOperator(operatorIds[0]);

      await expect(network.withdrawOperatorEarnings(operatorIds[0], 1n))
        .to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });
  });
});

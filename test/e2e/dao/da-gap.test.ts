import { expect } from "chai";
import { ethers } from "ethers";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { SSVModules } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  makeOperatorKey,
  whitelistAddresses,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  SMALL_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
  NETWORK_FEE,
  MAXIMUM_OPERATORS_FEE,
  ETH_DEDUCTED_DIGITS,
  DEDUCTED_DIGITS,
  MINIMAL_LIQUIDATION_THRESHOLD,
  DECLARE_OPERATOR_FEE_PERIOD,
  STAKE_AMOUNT,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import {
  mineBlocks,
  getBlockNumber,
  setAccountBalance,
  parseClusterFromEvent,
  setupOracles,
  commitEBRoot,
  computeClusterId,
  computeEBRoot,
} from "../../helpers/index.ts";

const UINT64_MAX = 2n ** 64n - 1n;

describe("W7-J: DA DAO Governance Gap Tests", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let owner: HardhatEthersSigner;
  let nonOwner: HardhatEthersSigner;
  let opOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let staker: HardhatEthersSigner;
  let oracle1: HardhatEthersSigner;
  let oracle2: HardhatEthersSigner;
  let oracle3: HardhatEthersSigner;
  let oracle4: HardhatEthersSigner;

  before(async function () {
    ({
      connection,
      networkHelpers,
      signers: [owner, nonOwner, opOwner, clusterOwner, staker, oracle1, oracle2, oracle3, oracle4],
    } = await setupTestContext());
  });

  const deployFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  // ═══════════════════════════════════════════════════════════
  // Precision & Packing Reverts
  // ═══════════════════════════════════════════════════════════

  describe("Precision & Packing Reverts", () => {
    it("DA-079/DA-096: ETH network fee non-divisible by ETH_DEDUCTED_DIGITS reverts MaxPrecisionExceeded", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      await expect(
        network.updateNetworkFee(ETH_DEDUCTED_DIGITS + 1n),
      ).to.be.revertedWithCustomError(network, Errors.MAX_PRECISION_EXCEEDED);
    });

    it("DA-080: SSV network fee non-divisible by DEDUCTED_DIGITS reverts MaxPrecisionExceeded", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      await expect(
        network.updateNetworkFeeSSV(DEDUCTED_DIGITS + 1n),
      ).to.be.revertedWithCustomError(network, Errors.MAX_PRECISION_EXCEEDED);
    });

    it("DA-081: max operator fee non-divisible reverts MaxPrecisionExceeded", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      // Must be >= current min fee (1778800000) to pass range check first
      await expect(
        network.updateMaximumOperatorFee(MINIMAL_OPERATOR_ETH_FEE + 1n),
      ).to.be.revertedWithCustomError(network, Errors.MAX_PRECISION_EXCEEDED);
    });

    it("DA-082: min operator fee non-divisible reverts MaxPrecisionExceeded", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      await expect(
        network.updateMinimumOperatorEthFee(ETH_DEDUCTED_DIGITS + 1n),
      ).to.be.revertedWithCustomError(network, Errors.MAX_PRECISION_EXCEEDED);
    });

    it("DA-085/DA-097: ETH network fee exceeding uint64 max after packing reverts MaxValueExceeded", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const overflowValue = (UINT64_MAX + 1n) * ETH_DEDUCTED_DIGITS;
      await expect(
        network.updateNetworkFee(overflowValue),
      ).to.be.revertedWithCustomError(network, Errors.MAX_VALUE_EXCEEDED);
    });

    it("DA-083: ETH minimum liquidation collateral overflow reverts MaxValueExceeded", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const overflowValue = (UINT64_MAX + 1n) * ETH_DEDUCTED_DIGITS;
      await expect(
        network.updateMinimumLiquidationCollateral(overflowValue),
      ).to.be.revertedWithCustomError(network, Errors.MAX_VALUE_EXCEEDED);
    });

    it("DA-084: SSV minimum liquidation collateral overflow reverts MaxValueExceeded", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const overflowValue = (UINT64_MAX + 1n) * DEDUCTED_DIGITS;
      await expect(
        network.updateMinimumLiquidationCollateralSSV(overflowValue),
      ).to.be.revertedWithCustomError(network, Errors.MAX_VALUE_EXCEEDED);
    });

    it("DA-095: max operator fee overflow reverts MaxValueExceeded", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const overflowValue = (UINT64_MAX + 1n) * ETH_DEDUCTED_DIGITS;
      await expect(
        network.updateMaximumOperatorFee(overflowValue),
      ).to.be.revertedWithCustomError(network, Errors.MAX_VALUE_EXCEEDED);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Fee Isolation
  // ═══════════════════════════════════════════════════════════

  describe("Fee Isolation", () => {
    it("DA-086: SSV fee update does not affect ETH fee", async () => {
      const { network, views } = await networkHelpers.loadFixture(deployFixture);
      const ethFeeBefore = await views.getNetworkFee();
      const newSSVFee = NETWORK_FEE * 2n;
      await network.updateNetworkFeeSSV(newSSVFee);
      const ethFeeAfter = await views.getNetworkFee();
      expect(ethFeeAfter).to.equal(ethFeeBefore);
    });

    it("DA-087: ETH fee update does not affect SSV fee", async () => {
      const { network, views } = await networkHelpers.loadFixture(deployFixture);
      const ssvFeeBefore = await views.getNetworkFeeSSV();
      const newETHFee = NETWORK_FEE * 2n;
      await network.updateNetworkFee(newETHFee);
      const ssvFeeAfter = await views.getNetworkFeeSSV();
      expect(ssvFeeAfter).to.equal(ssvFeeBefore);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Access Control
  // ═══════════════════════════════════════════════════════════

  describe("Access Control", () => {
    it("DA-057/DA-092: non-owner updateMinBlocksBetweenUpdates reverts", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      await expect(network.connect(nonOwner).updateMinBlocksBetweenUpdates(100)).to.be.revertedWith("Ownable: caller is not the owner");
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Boundary & Edge Cases
  // ═══════════════════════════════════════════════════════════

  describe("Boundary & Edge Cases", () => {
    it("DA-037: updateMaximumOperatorFee equal to minimumOperatorEthFee succeeds", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      await expect(network.updateMaximumOperatorFee(MINIMAL_OPERATOR_ETH_FEE))
        .to.emit(network, Events.OPERATOR_MAXIMUM_FEE_UPDATED)
        .withArgs(MINIMAL_OPERATOR_ETH_FEE);
    });

    it("DA-040: updateMinimumOperatorEthFee equal to operatorMaxFee succeeds", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      await expect(network.updateMinimumOperatorEthFee(MAXIMUM_OPERATORS_FEE))
        .to.emit(network, Events.MINIMUM_OPERATOR_ETH_FEE_UPDATED)
        .withArgs(MAXIMUM_OPERATORS_FEE);
    });

    it("DA-070: updateLiquidationThresholdPeriod to max uint64 succeeds", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      await expect(network.updateLiquidationThresholdPeriod(UINT64_MAX))
        .to.emit(network, Events.LIQUIDATION_THRESHOLD_PERIOD_UPDATED)
        .withArgs(UINT64_MAX);
    });

    it("DA-093: withdrawNetworkSSVEarnings with 0 amount succeeds (no-op)", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      // No SSV clusters → daoValidatorCount = 0, earnings = 0
      // Withdrawing 0 should succeed and emit event
      await expect(network.withdrawNetworkSSVEarnings(0n))
        .to.emit(network, Events.NETWORK_EARNINGS_WITHDRAWN)
        .withArgs(0n, owner.address);
    });

    it("DA-013: withdrawNetworkSSVEarnings with amount > 0 when no clusters reverts InsufficientBalance", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      // No SSV clusters registered → daoValidatorCount = 0, earnings = 0
      // Any withdrawal > 0 should revert
      await expect(
        network.withdrawNetworkSSVEarnings(DEDUCTED_DIGITS),
      ).to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
    });

    it("DA-059: setFeeRecipientAddress to zero address emits event", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      await expect(network.connect(nonOwner).setFeeRecipientAddress(ethers.ZeroAddress))
        .to.emit(network, Events.FEE_RECIPIENT_ADDRESS_UPDATED)
        .withArgs(nonOwner.address, ethers.ZeroAddress);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Module Updates
  // ═══════════════════════════════════════════════════════════

  describe("Module Updates", () => {
    it("DA-060: updateModule to valid contract address succeeds", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      // Deploy a fresh SSVClusters module
      const factory = await connection.ethers.getContractFactory("SSVClusters");
      const newModule = await factory.deploy();
      await newModule.waitForDeployment();
      const newAddress = await newModule.getAddress();

      await expect(network.updateModule(SSVModules.SSVClusters, newAddress))
        .to.emit(network, "ModuleUpgraded")
        .withArgs(SSVModules.SSVClusters, newAddress);
    });

    it("DA-061: updateModule to EOA address reverts TargetModuleDoesNotExistWithData", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      await expect(
        network.updateModule(SSVModules.SSVClusters, nonOwner.address),
      ).to.be.revertedWithCustomError(network, "TargetModuleDoesNotExistWithData");
    });

    it("DA-090: updateModule to zero address reverts TargetModuleDoesNotExistWithData", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      await expect(
        network.updateModule(SSVModules.SSVClusters, ethers.ZeroAddress),
      ).to.be.revertedWithCustomError(network, "TargetModuleDoesNotExistWithData");
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Oracle Management
  // ═══════════════════════════════════════════════════════════

  describe("Oracle Management", () => {
    it("DA-088: replaceOracle into empty slot (first assignment) succeeds", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      // All oracle slots start empty after fixture deploy
      await expect(network.replaceOracle(1, oracle1.address))
        .to.emit(network, Events.ORACLE_REPLACED)
        .withArgs(1, ethers.ZeroAddress, oracle1.address);
    });

    it("DA-107: replaceOracle into empty slot, then evicted address becomes reusable", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      // Assign oracle1 to slot 1
      await network.replaceOracle(1, oracle1.address);

      // Assign oracle2 to slot 2
      await network.replaceOracle(2, oracle2.address);

      // Evict oracle1 by replacing slot 1 with oracle3
      await expect(network.replaceOracle(1, oracle3.address))
        .to.emit(network, Events.ORACLE_REPLACED)
        .withArgs(1, oracle1.address, oracle3.address);

      // oracle1 was evicted — now assign it to slot 2 (replacing oracle2)
      // This should succeed because oracle1's oracleIdOf was cleared
      await expect(network.replaceOracle(2, oracle1.address))
        .to.emit(network, Events.ORACLE_REPLACED)
        .withArgs(2, oracle2.address, oracle1.address);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // SSV Fee Settlement
  // ═══════════════════════════════════════════════════════════

  describe("SSV Fee Settlement", () => {
    it("DA-007: SSV fee increase — event emits correct old and new fee, index updated", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const oldFee = NETWORK_FEE;
      const newFee = NETWORK_FEE * 2n;

      // Mine blocks to advance the fee index
      await mineBlocks(provider, 100);

      const tx = await network.updateNetworkFeeSSV(newFee);
      await expect(tx)
        .to.emit(network, Events.NETWORK_FEE_UPDATED_SSV)
        .withArgs(oldFee, newFee);

      // Mine more blocks and update again to verify continuity
      await mineBlocks(provider, 50);
      const newerFee = NETWORK_FEE * 3n;
      await expect(network.updateNetworkFeeSSV(newerFee))
        .to.emit(network, Events.NETWORK_FEE_UPDATED_SSV)
        .withArgs(newFee, newerFee);
    });

    it("DA-108: SSV fee continuity — successive updates settle correctly", async () => {
      const { network, views } = await networkHelpers.loadFixture(deployFixture);

      // Verify initial SSV fee
      const initialFee = await views.getNetworkFeeSSV();
      expect(initialFee).to.equal(NETWORK_FEE);

      // Update fee
      const newFee = NETWORK_FEE * 2n;
      await network.updateNetworkFeeSSV(newFee);

      // Verify updated fee via views
      const updatedFee = await views.getNetworkFeeSSV();
      expect(updatedFee).to.equal(newFee);

      // Update back to original
      await network.updateNetworkFeeSSV(NETWORK_FEE);
      const restoredFee = await views.getNetworkFeeSSV();
      expect(restoredFee).to.equal(NETWORK_FEE);
    });
  });

  // ═══════════════════════════════════════════════════════════
  // Downstream Governance Interactions
  // ═══════════════════════════════════════════════════════════

  describe("Downstream Governance Interactions", () => {
    it("DA-063: ETH network fee change mid-cluster produces correct two-phase fee accrual", async () => {
      const { network, views } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register operators and cluster
      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);

      await setAccountBalance(provider, clusterOwner.address, DEFAULT_ETH_REGISTER_VALUE + ethers.parseEther("2"));
      const regTx = await network
        .connect(clusterOwner)
        .registerValidator(makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, {
          value: DEFAULT_ETH_REGISTER_VALUE,
        });
      const regReceipt = await regTx.wait();
      const cluster = parseClusterFromEvent(network, regReceipt, Events.VALIDATOR_ADDED);

      // Phase 1: mine 100 blocks at original fee F1
      const F1 = await views.getNetworkFee();
      await mineBlocks(provider, 100);

      // Snapshot balance after phase 1 (before fee change)
      const balAfterPhase1 = await views.getBalance(clusterOwner.address, operatorIds, cluster);

      // Change fee to F2 = F1 * 3
      const F2 = F1 * 3n;
      await network.updateNetworkFee(F2);

      // Phase 2: mine 100 blocks at new (tripled) fee
      await mineBlocks(provider, 100);

      // Snapshot balance after phase 2
      const balAfterPhase2 = await views.getBalance(clusterOwner.address, operatorIds, cluster);

      // Phase 1 fee drain: balance dropped by some amount D1 over ~100 blocks
      const drain1 = DEFAULT_ETH_REGISTER_VALUE - balAfterPhase1;
      // Phase 2 fee drain: balance dropped by D2 over ~100 blocks
      const drain2 = balAfterPhase1 - balAfterPhase2;

      // The network fee tripled → per-block network fee contribution tripled.
      // Operator fee stayed the same. So total burn rate increased but not 3x overall.
      // Key assertion: drain2 > drain1 (higher fee in phase 2 ⇒ faster drain)
      expect(drain2).to.be.greaterThan(drain1);
      // And specifically the network fee component tripled, so drain2 should be
      // significantly more than drain1 (at least 1.5x given operator fees are constant)
      expect(drain2).to.be.greaterThan((drain1 * 3n) / 2n);
    });

    it("DA-064: threshold increase retroactively makes existing cluster liquidatable", async () => {
      const { network, views } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register operators and cluster with small deposit
      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);
      await setAccountBalance(provider, clusterOwner.address, SMALL_ETH_REGISTER_VALUE + ethers.parseEther("1"));

      const regTx = await network
        .connect(clusterOwner)
        .registerValidator(makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, {
          value: SMALL_ETH_REGISTER_VALUE,
        });
      const regReceipt = await regTx.wait();
      const cluster = parseClusterFromEvent(network, regReceipt, Events.VALIDATOR_ADDED);

      // Verify NOT liquidatable at current threshold (21480 blocks)
      const isLiqBefore = await views.isLiquidatable(clusterOwner.address, operatorIds, cluster);
      expect(isLiqBefore).to.be.false;

      // Increase threshold to 3,000,000 blocks (~1.169 ETH threshold > 1 ETH deposit)
      await network.updateLiquidationThresholdPeriod(3_000_000n);

      // Verify IS NOW liquidatable (same cluster, same balance, different threshold)
      const isLiqAfter = await views.isLiquidatable(clusterOwner.address, operatorIds, cluster);
      expect(isLiqAfter).to.be.true;

      // Liquidation succeeds
      await expect(network.connect(nonOwner).liquidate(clusterOwner.address, operatorIds, cluster))
        .to.emit(network, Events.CLUSTER_LIQUIDATED);
    });

    it("DA-065: minimum collateral increase blocks reactivation with insufficient deposit", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register operators and cluster
      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);
      await setAccountBalance(provider, clusterOwner.address, ethers.parseEther("100"));

      const regTx = await network
        .connect(clusterOwner)
        .registerValidator(makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, {
          value: SMALL_ETH_REGISTER_VALUE,
        });
      const regReceipt = await regTx.wait();
      const cluster = parseClusterFromEvent(network, regReceipt, Events.VALIDATOR_ADDED);

      // Increase threshold to make it liquidatable
      await network.updateLiquidationThresholdPeriod(3_000_000n);

      // Liquidate
      const liqTx = await network.connect(nonOwner).liquidate(clusterOwner.address, operatorIds, cluster);
      const liqReceipt = await liqTx.wait();
      const liquidatedCluster = parseClusterFromEvent(network, liqReceipt, Events.CLUSTER_LIQUIDATED);

      // Reset threshold to normal
      await network.updateLiquidationThresholdPeriod(MINIMAL_LIQUIDATION_THRESHOLD);

      // Increase minimum collateral to 5 ETH
      const highCollateral = ethers.parseEther("5");
      await network.updateMinimumLiquidationCollateral(highCollateral);

      // Try to reactivate with 2 ETH → should fail (2 < 5 collateral)
      await expect(
        network.connect(clusterOwner).reactivate(operatorIds, liquidatedCluster, { value: ethers.parseEther("2") }),
      ).to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);

      // Reactivate with 10 ETH → should succeed
      await expect(
        network.connect(clusterOwner).reactivate(operatorIds, liquidatedCluster, { value: ethers.parseEther("10") }),
      ).to.emit(network, Events.CLUSTER_REACTIVATED);
    });

    it("DA-066: lowered max operator fee blocks pending declared fee execution", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register operator
      const operatorIds = await registerOperators(network, opOwner, 1);
      const operatorId = operatorIds[0];

      // Declare a fee increase: current fee * 2 (within 100% increase limit)
      const declaredFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
      await network.connect(opOwner).declareOperatorFee(operatorId, declaredFee);

      // Advance past declare period into execution window
      await provider.send("evm_increaseTime", [Number(DECLARE_OPERATOR_FEE_PERIOD) + 1]);
      await provider.send("evm_mine", []);

      // Lower max fee to below declared fee
      const newMaxFee = MINIMAL_OPERATOR_ETH_FEE + ETH_DEDUCTED_DIGITS * 2n; // slightly above min
      await network.updateMaximumOperatorFee(newMaxFee);

      // Try to execute declared fee → should revert
      await expect(
        network.connect(opOwner).executeOperatorFee(operatorId),
      ).to.be.revertedWithCustomError(network, Errors.FEE_TOO_HIGH);
    });

    it("DA-067: increased min operator fee blocks new operator registration below new min", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      // Increase minimum fee to 3x current
      const newMinFee = MINIMAL_OPERATOR_ETH_FEE * 3n;
      await network.updateMinimumOperatorEthFee(newMinFee);

      // Try to register operator with fee = 2x current (below new min)
      const belowMinFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
      await expect(
        network.connect(opOwner).registerOperator(makeOperatorKey(99), belowMinFee, true),
      ).to.be.revertedWithCustomError(network, Errors.FEE_TOO_LOW);

      // Registration with fee >= new min succeeds
      await expect(network.connect(opOwner).registerOperator(makeOperatorKey(100), newMinFee, true)).to.emit(
        network,
        Events.OPERATOR_ADDED,
      );
    });

    it("DA-104: fee increase limit 0 blocks any positive fee increase declaration", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      // Set fee increase limit to 0 (freeze)
      await network.updateOperatorFeeIncreaseLimit(0);

      // Register operator
      const operatorIds = await registerOperators(network, opOwner, 1);
      const operatorId = operatorIds[0];

      // Try to declare even the smallest fee increase
      const minIncrease = MINIMAL_OPERATOR_ETH_FEE + ETH_DEDUCTED_DIGITS;
      await expect(
        network.connect(opOwner).declareOperatorFee(operatorId, minIncrease),
      ).to.be.revertedWithCustomError(network, Errors.FEE_EXCEEDS_INCREASE_LIMIT);
    });

    it("DA-105: zero declare+execute periods enable same-block declare+execute", async () => {
      const { network, views } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Set both periods to 0
      await network.updateDeclareOperatorFeePeriod(0);
      await network.updateExecuteOperatorFeePeriod(0);

      // Register operator
      const operatorIds = await registerOperators(network, opOwner, 1);
      const operatorId = operatorIds[0];

      // Declare fee increase
      const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;

      // With both periods = 0, approval window is [T, T]. Must execute same block.
      await provider.send("evm_setAutomine", [false]);
      await network.connect(opOwner).declareOperatorFee(operatorId, newFee);
      await network.connect(opOwner).executeOperatorFee(operatorId);
      await provider.send("evm_mine", []);
      await provider.send("evm_setAutomine", [true]);

      // Verify fee was updated by checking operator fee via views
      const opFee = await views.getOperatorFee(operatorId);
      expect(opFee).to.equal(newFee);
    });

    it("DA-106: period change does not retroactively affect stored fee declaration windows", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register operator
      const operatorIds = await registerOperators(network, opOwner, 1);
      const operatorId = operatorIds[0];

      // Declare fee with original periods (DECLARE_OPERATOR_FEE_PERIOD + EXECUTE_OPERATOR_FEE_PERIOD)
      const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
      await network.connect(opOwner).declareOperatorFee(operatorId, newFee);

      // Advance into execution window
      await provider.send("evm_increaseTime", [Number(DECLARE_OPERATOR_FEE_PERIOD) + 1]);
      await provider.send("evm_mine", []);

      // Change declare period to much longer value (shouldn't affect stored window)
      await network.updateDeclareOperatorFeePeriod(Number(DECLARE_OPERATOR_FEE_PERIOD) * 10);

      // Execute should still succeed — stored window uses original period
      await expect(network.connect(opOwner).executeOperatorFee(operatorId))
        .to.emit(network, Events.OPERATOR_FEE_EXECUTED);
    });

    it("DA-109: ETH threshold change does not affect SSV threshold", async () => {
      const { network, views } = await networkHelpers.loadFixture(deployFixture);

      // Set SSV threshold to a known value
      const ssvThreshold = 30000n;
      await network.updateLiquidationThresholdPeriodSSV(ssvThreshold);

      // Read SSV threshold
      const ssvBefore = await views.getLiquidationThresholdPeriodSSV();
      expect(ssvBefore).to.equal(ssvThreshold);

      // Change ETH threshold to a very different value
      await network.updateLiquidationThresholdPeriod(100_000n);

      // SSV threshold should be unchanged
      const ssvAfter = await views.getLiquidationThresholdPeriodSSV();
      expect(ssvAfter).to.equal(ssvThreshold);

      // Also verify ETH threshold actually changed
      const ethAfter = await views.getLiquidationThresholdPeriod();
      expect(ethAfter).to.equal(100_000n);
    });

    it("DA-110: cooldown duration change feeds into SSVStaking requestUnstake", async () => {
      const { network, ssvToken } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;
      const networkAddress = await network.getAddress();

      // Mint SSV and stake
      const totalStake = STAKE_AMOUNT * 4n;
      await ssvToken.mint(staker.address, totalStake);
      await ssvToken.connect(staker).approve(networkAddress, totalStake);
      await network.connect(staker).stake(STAKE_AMOUNT);

      // Request unstake with default cooldown
      const unstakeAmount = STAKE_AMOUNT / 2n;
      const tx1 = await network.connect(staker).requestUnstake(unstakeAmount);
      const receipt1 = await tx1.wait();
      const block1 = await provider.getBlock(receipt1!.blockNumber);
      const expectedUnlock1 = BigInt(block1!.timestamp) + 604800n; // DEFAULT_UNSTAKE_COOLDOWN = 7 days

      await expect(tx1)
        .to.emit(network, Events.UNSTAKE_REQUESTED)
        .withArgs(staker.address, unstakeAmount, expectedUnlock1);

      // Update cooldown to much shorter (1000 seconds)
      const newCooldown = 1000n;
      await network.updateUnstakeCooldownDuration(newCooldown);

      // Stake more and request unstake again
      await network.connect(staker).stake(STAKE_AMOUNT);
      const tx2 = await network.connect(staker).requestUnstake(unstakeAmount);
      const receipt2 = await tx2.wait();
      const block2 = await provider.getBlock(receipt2!.blockNumber);
      const expectedUnlock2 = BigInt(block2!.timestamp) + newCooldown;

      await expect(tx2)
        .to.emit(network, Events.UNSTAKE_REQUESTED)
        .withArgs(staker.address, unstakeAmount, expectedUnlock2);

      // The new unlock time should use the new (shorter) cooldown
      expect(expectedUnlock2 - BigInt(block2!.timestamp)).to.equal(newCooldown);
      expect(expectedUnlock1 - BigInt(block1!.timestamp)).to.equal(604800n);
    });

    it("DA-111: minBlocksBetweenUpdates change feeds into SSVClusters updateClusterBalance", async () => {
      const { network, ssvToken } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register operators and cluster
      const operatorIds = await registerOperators(network, opOwner, 4);
      await whitelistAddresses(network, opOwner, operatorIds, [clusterOwner.address]);
      await setAccountBalance(provider, clusterOwner.address, DEFAULT_ETH_REGISTER_VALUE + ethers.parseEther("2"));

      const regTx = await network
        .connect(clusterOwner)
        .registerValidator(makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, {
          value: DEFAULT_ETH_REGISTER_VALUE,
        });
      const regReceipt = await regTx.wait();
      let cluster = parseClusterFromEvent(network, regReceipt, Events.VALIDATOR_ADDED);

      // Setup oracles (need cSSV supply for quorum)
      await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

      // Compute cluster ID and first EB root
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const blockNum1 = await getBlockNumber(provider);
      const root1 = computeEBRoot(clusterId, 32);
      await commitEBRoot(network, root1, blockNum1, [oracle1, oracle2, oracle3]);

      // First updateClusterBalance — should succeed
      const update1Tx = await network.updateClusterBalance(
        blockNum1,
        clusterOwner.address,
        operatorIds,
        cluster,
        32,
        [],
      );
      const update1Receipt = await update1Tx.wait();
      cluster = parseClusterFromEvent(network, update1Receipt, Events.CLUSTER_BALANCE_UPDATED);

      // Set minBlocksBetweenUpdates to 100
      await network.updateMinBlocksBetweenUpdates(100);

      // Commit second root at a higher block
      await mineBlocks(provider, 5);
      const blockNum2 = await getBlockNumber(provider);
      const root2 = computeEBRoot(clusterId, 33);
      await commitEBRoot(network, root2, blockNum2, [oracle1, oracle2, oracle3]);

      // Second update should fail — too frequent
      await expect(
        network.updateClusterBalance(blockNum2, clusterOwner.address, operatorIds, cluster, 33, []),
      ).to.be.revertedWithCustomError(network, "UpdateTooFrequent");

      // Set minBlocksBetweenUpdates to 0 (no restriction)
      await network.updateMinBlocksBetweenUpdates(0);

      // Now the update should succeed
      await expect(
        network.updateClusterBalance(blockNum2, clusterOwner.address, operatorIds, cluster, 33, []),
      ).to.emit(network, Events.CLUSTER_BALANCE_UPDATED);
    });
  });
});

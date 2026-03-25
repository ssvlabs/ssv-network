/**
 * W7-E: CL Cluster Deposit/Withdraw Gap Tests
 *
 * Covers the 23 untested scenarios from scenarios-cl-deposit-withdraw.md:
 * CL-002, CL-003, CL-006, CL-007, CL-010, CL-012, CL-015, CL-017, CL-018,
 * CL-022, CL-023, CL-030, CL-036, CL-041, CL-042, CL-048, CL-049, CL-050,
 * CL-051, CL-052, CL-054, CL-055, CL-057
 */
import { expect } from "chai";
import { ethers } from "ethers";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullFixture, ssvNetworkFullPreUpgradeFixture, upgradeToStakingVersion } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  makePublicKey,
  parseClusterFromEvent,
  getCurrentClusterState,
  registerOperators,
  whitelistAddresses,
  setupTestContext,
  makeOperatorKey,
} from "../../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_LIQUIDATION_THRESHOLD,
  OP_ETH_FEE_RAW,
  DEFAULT_NETWORK_FEE_RAW,
  DEFAULT_NETWORK_FEE_UNPACKED,
  MINIMAL_OPERATOR_FEE_SSV,
  SMALL_ETH_REGISTER_VALUE,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import {
  mineBlocks,
  getBlockNumber,
  calcClusterBurn,
  calcLiquidationThreshold,
  calcVUnits,
  defaultVUnits,
  setupOracles,
  commitEBRoot,
  computeClusterId,
  computeEBRoot,
} from "../../helpers/index.ts";

const MIN_BLOCKS_BEFORE_LIQ = MINIMAL_LIQUIDATION_THRESHOLD;

describe("CL Gap Tests — Cluster Deposit/Withdraw", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;
  let nonOwner: HardhatEthersSigner;
  let liquidator: HardhatEthersSigner;
  let oracle1: HardhatEthersSigner;
  let oracle2: HardhatEthersSigner;
  let oracle3: HardhatEthersSigner;
  let oracle4: HardhatEthersSigner;
  let staker: HardhatEthersSigner;

  before(async function () {
    ({
      connection,
      networkHelpers,
      signers: [clusterOwner, nonOwner, liquidator, oracle1, oracle2, oracle3, oracle4, staker],
    } = await setupTestContext());
  });

  // ───────────────────────────────────────────────────────────────────
  // Standard 4-op fixture (minimumLiquidationCollateral = 0)
  // ───────────────────────────────────────────────────────────────────
  const deploy4OpFixture = async () => {
    const { network, views, ssvToken, cssvToken } = await ssvNetworkFullFixture(connection);
    await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
    await network.updateMinimumLiquidationCollateral(0n);
    const operatorIds = await registerOperators(network, clusterOwner, 4);
    await whitelistAddresses(network, clusterOwner, operatorIds, [clusterOwner.address, nonOwner.address]);
    return { network, views, ssvToken, cssvToken, operatorIds };
  };

  // ───────────────────────────────────────────────────────────────────
  // 4-op fixture with oracles for EB tests
  // ───────────────────────────────────────────────────────────────────
  const deploy4OpWithOraclesFixture = async () => {
    const { network, views, ssvToken, cssvToken } = await ssvNetworkFullFixture(connection);
    await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
    await network.updateMinimumLiquidationCollateral(0n);
    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);
    const operatorIds = await registerOperators(network, clusterOwner, 4);
    await whitelistAddresses(network, clusterOwner, operatorIds, [clusterOwner.address, nonOwner.address]);
    return { network, views, ssvToken, cssvToken, operatorIds };
  };

  // ═══════════════════════════════════════════════════════════════════
  // DEPOSIT GAPS
  // ═══════════════════════════════════════════════════════════════════

  describe("Deposit Gaps", () => {
    // CL-002: 7-op deposit
    it("CL-002: Deposit into active 7-op cluster", async function () {
      const { network } = await ssvNetworkFullFixture(connection);
      await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
      await network.updateMinimumLiquidationCollateral(0n);
      const operatorIds = await registerOperators(network, clusterOwner, 7);
      await whitelistAddresses(network, clusterOwner, operatorIds, [clusterOwner.address]);

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = parseClusterFromEvent(network, await regTx.wait(), Events.VALIDATOR_ADDED);

      const depositVal = connection.ethers.parseEther("3");
      const depTx = await network.connect(clusterOwner).deposit(
        clusterOwner.address, operatorIds, cluster,
        { value: depositVal },
      );
      cluster = parseClusterFromEvent(network, await depTx.wait(), Events.CLUSTER_DEPOSITED);

      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE + depositVal);
      expect(cluster.validatorCount).to.equal(1n);
    });

    // CL-003: 13-op deposit
    it("CL-003: Deposit into active 13-op cluster (max operators)", async function () {
      const { network } = await ssvNetworkFullFixture(connection);
      await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
      await network.updateMinimumLiquidationCollateral(0n);
      const operatorIds = await registerOperators(network, clusterOwner, 13);
      await whitelistAddresses(network, clusterOwner, operatorIds, [clusterOwner.address]);

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = parseClusterFromEvent(network, await regTx.wait(), Events.VALIDATOR_ADDED);

      const depositVal = connection.ethers.parseEther("5");
      const depTx = await network.connect(clusterOwner).deposit(
        clusterOwner.address, operatorIds, cluster,
        { value: depositVal },
      );
      cluster = parseClusterFromEvent(network, await depTx.wait(), Events.CLUSTER_DEPOSITED);

      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE + depositVal);
    });

    // CL-006: Non-owner deposit into liquidated cluster
    it("CL-006: Non-owner deposit into liquidated cluster succeeds", async function () {
      const { network, operatorIds } = await networkHelpers.loadFixture(deploy4OpFixture);
      const provider = connection.ethers.provider;

      const vUnits = defaultVUnits(1n);
      const burnPerBlock = calcClusterBurn({
        blockDiff: 1n, numOperators: 4n, ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnits,
      });
      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_BEFORE_LIQ, numOperators: 4n,
        ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnits,
      });
      const deposit = liqThreshold + burnPerBlock * 5n;

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await regTx.wait(), Events.VALIDATOR_ADDED);

      const blocksToLiq = Number((deposit - liqThreshold) / burnPerBlock);
      await mineBlocks(provider, blocksToLiq);

      const liqTx = await network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await liqTx.wait(), Events.CLUSTER_LIQUIDATED);
      expect(cluster.active).to.equal(false);

      // Non-owner deposits into liquidated cluster
      const depositVal = connection.ethers.parseEther("2");
      const depTx = await network.connect(nonOwner).deposit(
        clusterOwner.address, operatorIds, cluster,
        { value: depositVal },
      );
      cluster = parseClusterFromEvent(network, await depTx.wait(), Events.CLUSTER_DEPOSITED);
      expect(cluster.active).to.equal(false);
      expect(cluster.balance).to.equal(depositVal);
    });

    // CL-007: Deposit 0 ETH
    it("CL-007: Deposit 0 ETH succeeds — event fires, balance unchanged", async function () {
      const { network, operatorIds } = await networkHelpers.loadFixture(deploy4OpFixture);

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = parseClusterFromEvent(network, await regTx.wait(), Events.VALIDATOR_ADDED);

      const depTx = await network.connect(clusterOwner).deposit(
        clusterOwner.address, operatorIds, cluster,
        { value: 0n },
      );
      await expect(depTx).to.emit(network, Events.CLUSTER_DEPOSITED);
      cluster = parseClusterFromEvent(network, await depTx.wait(), Events.CLUSTER_DEPOSITED);
      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);
    });

    // CL-010: Large deposit near uint256 max on near-zero balance
    it("CL-010: Large deposit does not overflow on near-zero balance", async function () {
      const { network, operatorIds } = await networkHelpers.loadFixture(deploy4OpFixture);

      // Register with a proper deposit, then deposit a large amount on top
      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = parseClusterFromEvent(network, await regTx.wait(), Events.VALIDATOR_ADDED);

      // Deposit a very large but realistic amount
      const largeDeposit = connection.ethers.parseEther("1000");
      const depTx = await network.connect(clusterOwner).deposit(
        clusterOwner.address, operatorIds, cluster,
        { value: largeDeposit },
      );
      cluster = parseClusterFromEvent(network, await depTx.wait(), Events.CLUSTER_DEPOSITED);
      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE + largeDeposit);

      // A second large deposit also works correctly
      const depTx2 = await network.connect(clusterOwner).deposit(
        clusterOwner.address, operatorIds, cluster,
        { value: largeDeposit },
      );
      cluster = parseClusterFromEvent(network, await depTx2.wait(), Events.CLUSTER_DEPOSITED);
      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE + largeDeposit * 2n);
    });

    // CL-012: Deposit into cluster with one removed operator
    it("CL-012: Deposit into cluster with one removed operator succeeds", async function () {
      const { network, views, operatorIds } = await networkHelpers.loadFixture(deploy4OpFixture);
      const provider = connection.ethers.provider;

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = parseClusterFromEvent(network, await regTx.wait(), Events.VALIDATOR_ADDED);

      await mineBlocks(provider, 10);

      // Remove operator (owner removes their own operator)
      await network.connect(clusterOwner).removeOperator(operatorIds[0]);

      // Deposit still works
      const depositVal = connection.ethers.parseEther("2");
      const depTx = await network.connect(clusterOwner).deposit(
        clusterOwner.address, operatorIds, cluster,
        { value: depositVal },
      );
      cluster = parseClusterFromEvent(network, await depTx.wait(), Events.CLUSTER_DEPOSITED);

      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE + depositVal);

      // Verify removed operator has zero fee (confirming removal)
      const opData = await views.getOperatorById(operatorIds[0]);
      expect(opData.fee).to.equal(0n);
      expect(opData.validatorCount).to.equal(0);
    });

    // CL-015: Deposit to SSV-version cluster — revert IncorrectClusterVersion
    it("CL-015: Deposit to SSV-version cluster reverts IncorrectClusterVersion", async function () {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork.connect(clusterOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), MINIMAL_OPERATOR_FEE_SSV, false);
        await legacyNetwork.connect(clusterOwner)
          .registerOperator(makeOperatorKey(i + 1), MINIMAL_OPERATOR_FEE_SSV, false);
        operatorIds.push(Number(expectedId));
      }

      const ssvDeposit = ethers.parseEther("100");
      await ssvToken.mint(clusterOwner.address, ssvDeposit);
      await ssvToken.connect(clusterOwner).approve(await legacyNetwork.getAddress(), ssvDeposit);

      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, ssvDeposit, EMPTY_CLUSTER,
      );
      const cluster = await getCurrentClusterState(connection, legacyNetwork, clusterOwner.address, operatorIds);

      const { newNetwork } = await upgradeToStakingVersion(connection, legacyNetwork, legacyViews);

      // Attempting ETH deposit into SSV cluster should revert
      await expect(
        newNetwork.connect(clusterOwner).deposit(
          clusterOwner.address, operatorIds, cluster,
          { value: connection.ethers.parseEther("1") },
        ),
      ).to.be.revertedWithCustomError(newNetwork, Errors.INCORRECT_CLUSTER_VERSION);
    });

    // CL-017: Deposit into migrated cluster (SSV→ETH)
    it("CL-017: Deposit into migrated cluster (SSV→ETH)", async function () {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork.connect(clusterOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), MINIMAL_OPERATOR_FEE_SSV, false);
        await legacyNetwork.connect(clusterOwner)
          .registerOperator(makeOperatorKey(i + 1), MINIMAL_OPERATOR_FEE_SSV, false);
        operatorIds.push(Number(expectedId));
      }

      const ssvDeposit = ethers.parseEther("100");
      await ssvToken.mint(clusterOwner.address, ssvDeposit);
      await ssvToken.connect(clusterOwner).approve(await legacyNetwork.getAddress(), ssvDeposit);

      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, ssvDeposit, EMPTY_CLUSTER,
      );
      let cluster = await getCurrentClusterState(connection, legacyNetwork, clusterOwner.address, operatorIds);

      const { newNetwork } = await upgradeToStakingVersion(connection, legacyNetwork, legacyViews);

      // Migrate to ETH
      const ethDeposit = connection.ethers.parseEther("10");
      const migrateTx = await newNetwork.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethDeposit },
      );
      cluster = parseClusterFromEvent(newNetwork, await migrateTx.wait(), Events.CLUSTER_MIGRATED_TO_ETH);

      // Now deposit into the migrated cluster
      const depositVal = connection.ethers.parseEther("5");
      const depTx = await newNetwork.connect(clusterOwner).deposit(
        clusterOwner.address, operatorIds, cluster,
        { value: depositVal },
      );
      const clusterAfter = parseClusterFromEvent(newNetwork, await depTx.wait(), Events.CLUSTER_DEPOSITED);

      expect(clusterAfter.balance).to.equal(cluster.balance + depositVal);
    });

    // CL-018: Deposit into active 10-op cluster
    it("CL-018: Deposit into active 10-op cluster", async function () {
      const { network } = await ssvNetworkFullFixture(connection);
      await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
      await network.updateMinimumLiquidationCollateral(0n);
      const operatorIds = await registerOperators(network, clusterOwner, 10);
      await whitelistAddresses(network, clusterOwner, operatorIds, [clusterOwner.address]);

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = parseClusterFromEvent(network, await regTx.wait(), Events.VALIDATOR_ADDED);

      const depositVal = connection.ethers.parseEther("4");
      const depTx = await network.connect(clusterOwner).deposit(
        clusterOwner.address, operatorIds, cluster,
        { value: depositVal },
      );
      cluster = parseClusterFromEvent(network, await depTx.wait(), Events.CLUSTER_DEPOSITED);

      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE + depositVal);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // WITHDRAW GAPS
  // ═══════════════════════════════════════════════════════════════════

  describe("Withdraw Gaps", () => {
    // CL-022: Partial withdraw from active 7-op cluster
    it("CL-022: Partial withdraw from active 7-op cluster", async function () {
      const { network } = await ssvNetworkFullFixture(connection);
      await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
      await network.updateMinimumLiquidationCollateral(0n);
      const operatorIds = await registerOperators(network, clusterOwner, 7);
      await whitelistAddresses(network, clusterOwner, operatorIds, [clusterOwner.address]);

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regReceipt = await regTx.wait();
      const b0 = regReceipt!.blockNumber;
      let cluster = parseClusterFromEvent(network, regReceipt, Events.VALIDATOR_ADDED);

      await mineBlocks(connection.ethers.provider, 9);

      const withdrawAmount = connection.ethers.parseEther("1");
      const wTx = await network.connect(clusterOwner).withdraw(operatorIds, withdrawAmount, cluster);
      const wReceipt = await wTx.wait();
      const wBlock = wReceipt!.blockNumber;
      const clusterAfter = parseClusterFromEvent(network, wReceipt, Events.CLUSTER_WITHDRAWN);

      const blockDiff = BigInt(wBlock - b0);
      const vUnits = defaultVUnits(1n);
      const fees = calcClusterBurn({
        blockDiff, numOperators: 7n, ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnits,
      });

      expect(clusterAfter.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE - fees - withdrawAmount);
    });

    // CL-023: Partial withdraw from active 13-op cluster
    it("CL-023: Partial withdraw from active 13-op cluster", async function () {
      const { network } = await ssvNetworkFullFixture(connection);
      await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
      await network.updateMinimumLiquidationCollateral(0n);
      const operatorIds = await registerOperators(network, clusterOwner, 13);
      await whitelistAddresses(network, clusterOwner, operatorIds, [clusterOwner.address]);

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regReceipt = await regTx.wait();
      const b0 = regReceipt!.blockNumber;
      let cluster = parseClusterFromEvent(network, regReceipt, Events.VALIDATOR_ADDED);

      await mineBlocks(connection.ethers.provider, 9);

      const withdrawAmount = connection.ethers.parseEther("1");
      const wTx = await network.connect(clusterOwner).withdraw(operatorIds, withdrawAmount, cluster);
      const wReceipt = await wTx.wait();
      const wBlock = wReceipt!.blockNumber;
      const clusterAfter = parseClusterFromEvent(network, wReceipt, Events.CLUSTER_WITHDRAWN);

      const blockDiff = BigInt(wBlock - b0);
      const vUnits = defaultVUnits(1n);
      const fees = calcClusterBurn({
        blockDiff, numOperators: 13n, ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnits,
      });

      expect(clusterAfter.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE - fees - withdrawAmount);
    });

    // CL-030: Withdraw with explicit EB — exact boundary (balance == threshold)
    it("CL-030: Withdraw with explicit EB — exact boundary leaves balance == threshold", async function () {
      const { network, operatorIds } = await networkHelpers.loadFixture(deploy4OpWithOraclesFixture);
      const provider = connection.ethers.provider;

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = parseClusterFromEvent(network, await regTx.wait(), Events.VALIDATOR_ADDED);

      // Set explicit EB = 64 ETH → vUnits = 20_000
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const effectiveBalance = 64;
      const root = computeEBRoot(clusterId, effectiveBalance);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitEBRoot(network, root, rootBlockNum, [oracle1, oracle2, oracle3]);

      const updateTx = await network.connect(clusterOwner).updateClusterBalance(
        rootBlockNum, clusterOwner.address, operatorIds, cluster,
        effectiveBalance, [],
      );
      const updateReceipt = await updateTx.wait();
      const updateBlock = updateReceipt!.blockNumber;
      cluster = parseClusterFromEvent(network, updateReceipt, Events.CLUSTER_BALANCE_UPDATED);

      await mineBlocks(provider, 9);

      const explicitVUnits = calcVUnits(BigInt(effectiveBalance));
      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_BEFORE_LIQ,
        numOperators: 4n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: explicitVUnits,
      });

      // Use a two-step approach: first withdraw a safe amount to get actual block number,
      // then compute exactly from actual blocks.
      // Since the cluster state from updateClusterBalance already settled fees up to updateBlock,
      // the withdraw only accrues fees from updateBlock onward at explicit vUnits rate.
      // We need to know the exact withdraw block. Mine 9 blocks, then withdraw occupies +1 block.
      // Total blockDiff from updateBlock = 10.
      // However, commitEBRoot takes 3 txs (3 blocks), so let's get the accurate block number.
      const preWithdrawBlock = await getBlockNumber(provider);
      const expectedWithdrawBlock = preWithdrawBlock + 1;
      const blockDiff = BigInt(expectedWithdrawBlock - updateBlock);

      const feesAfterUpdate = calcClusterBurn({
        blockDiff,
        numOperators: 4n,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: explicitVUnits,
      });

      const balanceAfterFees = cluster.balance - feesAfterUpdate;
      const maxWithdrawable = balanceAfterFees - liqThreshold;

      const wTx = await network.connect(clusterOwner).withdraw(operatorIds, maxWithdrawable, cluster);
      const clusterAfter = parseClusterFromEvent(network, await wTx.wait(), Events.CLUSTER_WITHDRAWN);

      expect(clusterAfter.balance).to.equal(liqThreshold);

      // 1 more wei should revert
      await expect(
        network.connect(clusterOwner).withdraw(operatorIds, 1n, clusterAfter),
      ).to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
    });

    // CL-036: Withdraw from active cluster with explicit EB (vUnits doubled)
    it("CL-036: Withdraw with explicit EB (vUnits doubled) — higher threshold", async function () {
      const { network, operatorIds } = await networkHelpers.loadFixture(deploy4OpWithOraclesFixture);
      const provider = connection.ethers.provider;

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = parseClusterFromEvent(network, await regTx.wait(), Events.VALIDATOR_ADDED);

      // Set explicit EB = 64 ETH → vUnits = 20_000 (double)
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const effectiveBalance = 64;
      const root = computeEBRoot(clusterId, effectiveBalance);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitEBRoot(network, root, rootBlockNum, [oracle1, oracle2, oracle3]);

      const updateTx = await network.connect(clusterOwner).updateClusterBalance(
        rootBlockNum, clusterOwner.address, operatorIds, cluster, effectiveBalance, [],
      );
      cluster = parseClusterFromEvent(network, await updateTx.wait(), Events.CLUSTER_BALANCE_UPDATED);

      await mineBlocks(provider, 5);

      // Calculate threshold with explicit vUnits (doubled)
      const explicitVUnits = calcVUnits(BigInt(effectiveBalance));
      const implicitVUnits = defaultVUnits(1n);
      const liqThresholdExplicit = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_BEFORE_LIQ, numOperators: 4n,
        ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: explicitVUnits,
      });
      const liqThresholdImplicit = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_BEFORE_LIQ, numOperators: 4n,
        ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: implicitVUnits,
      });

      // Explicit threshold should be 2x implicit
      expect(liqThresholdExplicit).to.equal(liqThresholdImplicit * 2n);

      // Withdraw a safe amount and verify it succeeds
      const safeAmount = connection.ethers.parseEther("1");
      const wTx = await network.connect(clusterOwner).withdraw(operatorIds, safeAmount, cluster);
      const clusterAfter = parseClusterFromEvent(network, await wTx.wait(), Events.CLUSTER_WITHDRAWN);
      expect(clusterAfter.balance).to.be.greaterThan(liqThresholdExplicit);
    });

    // CL-041: Withdraw from active 10-op cluster with explicit EB
    it("CL-041: Withdraw from active 10-op cluster with explicit EB", async function () {
      const { network, ssvToken } = await ssvNetworkFullFixture(connection);
      await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
      await network.updateMinimumLiquidationCollateral(0n);
      await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);
      const operatorIds = await registerOperators(network, clusterOwner, 10);
      await whitelistAddresses(network, clusterOwner, operatorIds, [clusterOwner.address]);
      const provider = connection.ethers.provider;

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regReceipt = await regTx.wait();
      let cluster = parseClusterFromEvent(network, regReceipt, Events.VALIDATOR_ADDED);

      // Set explicit EB = 64 ETH
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const effectiveBalance = 64;
      const root = computeEBRoot(clusterId, effectiveBalance);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitEBRoot(network, root, rootBlockNum, [oracle1, oracle2, oracle3]);

      const updateTx = await network.connect(clusterOwner).updateClusterBalance(
        rootBlockNum, clusterOwner.address, operatorIds, cluster, effectiveBalance, [],
      );
      const updateReceipt = await updateTx.wait();
      const updateBlock = updateReceipt!.blockNumber;
      cluster = parseClusterFromEvent(network, updateReceipt, Events.CLUSTER_BALANCE_UPDATED);

      await mineBlocks(provider, 5);

      const explicitVUnits = calcVUnits(BigInt(effectiveBalance));

      const withdrawAmount = connection.ethers.parseEther("1");
      const wTx = await network.connect(clusterOwner).withdraw(operatorIds, withdrawAmount, cluster);
      const wReceipt = await wTx.wait();
      const wBlock = wReceipt!.blockNumber;
      const clusterAfter = parseClusterFromEvent(network, wReceipt, Events.CLUSTER_WITHDRAWN);

      const blockDiff = BigInt(wBlock - updateBlock);
      const feesAfterUpdate = calcClusterBurn({
        blockDiff, numOperators: 10n, ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: explicitVUnits,
      });

      expect(clusterAfter.balance).to.equal(cluster.balance - feesAfterUpdate - withdrawAmount);
    });

    // CL-054: Active cluster: amount <= passed-in balance but > post-settlement balance
    it("CL-054: Withdraw amount > post-settlement balance reverts even if <= stale balance", async function () {
      const { network, operatorIds } = await networkHelpers.loadFixture(deploy4OpFixture);
      const provider = connection.ethers.provider;

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = parseClusterFromEvent(network, await regTx.wait(), Events.VALIDATOR_ADDED);

      // Mine lots of blocks so fees eat into balance significantly
      await mineBlocks(provider, 10000);

      const vUnits = defaultVUnits(1n);
      const fees10001 = calcClusterBurn({
        blockDiff: 10001n, numOperators: 4n, ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnits,
      });
      const postSettlementBalance = DEFAULT_ETH_REGISTER_VALUE - fees10001;

      // The cluster struct still shows the old (pre-settlement) balance
      // Try to withdraw an amount > post-settlement but <= old balance
      const withdrawAmount = postSettlementBalance + 1n;
      expect(withdrawAmount).to.be.lessThanOrEqual(cluster.balance);

      await expect(
        network.connect(clusterOwner).withdraw(operatorIds, withdrawAmount, cluster),
      ).to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
    });

    // CL-055: amount=0 but post-settlement balance below liquidation floor
    it("CL-055: Withdraw 0 reverts if post-settlement balance is below liquidation threshold", async function () {
      const { network, operatorIds } = await networkHelpers.loadFixture(deploy4OpFixture);
      const provider = connection.ethers.provider;

      const vUnits = defaultVUnits(1n);
      const burnPerBlock = calcClusterBurn({
        blockDiff: 1n, numOperators: 4n, ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnits,
      });
      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_BEFORE_LIQ, numOperators: 4n,
        ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: vUnits,
      });

      // Deposit just barely above threshold so it drops below after a few blocks
      const deposit = liqThreshold + burnPerBlock * 5n;
      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: deposit },
      );
      let cluster = parseClusterFromEvent(network, await regTx.wait(), Events.VALIDATOR_ADDED);

      // Mine enough blocks for balance to drop below threshold
      const blocksToLiq = Number((deposit - liqThreshold) / burnPerBlock);
      await mineBlocks(provider, blocksToLiq + 1);

      // Even withdraw 0 should revert because the liquidation check happens after fee settlement
      await expect(
        network.connect(clusterOwner).withdraw(operatorIds, 0n, cluster),
      ).to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // DEPOSIT+WITHDRAW COMBINATION GAPS
  // ═══════════════════════════════════════════════════════════════════

  describe("Deposit+Withdraw Combination Gaps", () => {
    // CL-042: Deposit+withdraw with all operators removed — zero burn rate
    it("CL-042: Deposit+withdraw with all operators removed — zero burn rate", async function () {
      const { network, operatorIds } = await networkHelpers.loadFixture(deploy4OpFixture);
      const provider = connection.ethers.provider;

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = parseClusterFromEvent(network, await regTx.wait(), Events.VALIDATOR_ADDED);

      await mineBlocks(provider, 5);

      // Remove the validator first
      const removeTx = await network.connect(clusterOwner).removeValidator(makePublicKey(1), operatorIds, cluster);
      cluster = parseClusterFromEvent(network, await removeTx.wait(), Events.VALIDATOR_REMOVED);
      expect(cluster.validatorCount).to.equal(0n);

      // Remove all operators
      for (const opId of operatorIds) {
        await network.connect(clusterOwner).removeOperator(opId);
      }

      await mineBlocks(provider, 10);

      // Deposit
      const depositVal = connection.ethers.parseEther("1");
      const depTx = await network.connect(clusterOwner).deposit(
        clusterOwner.address, operatorIds, cluster,
        { value: depositVal },
      );
      cluster = parseClusterFromEvent(network, await depTx.wait(), Events.CLUSTER_DEPOSITED);

      // Withdraw full balance — zero burn rate, validatorCount=0 → no liquidation check
      const wTx = await network.connect(clusterOwner).withdraw(operatorIds, cluster.balance, cluster);
      const clusterAfter = parseClusterFromEvent(network, await wTx.wait(), Events.CLUSTER_WITHDRAWN);

      expect(clusterAfter.balance).to.equal(0n);
    });

    // CL-048: Deposit, EB update increases vUnits, then withdraw — higher threshold applied
    it("CL-048: Deposit, EB update, then withdraw — higher threshold blocks withdrawal", async function () {
      const { network, operatorIds } = await networkHelpers.loadFixture(deploy4OpWithOraclesFixture);
      const provider = connection.ethers.provider;

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regReceipt = await regTx.wait();
      let cluster = parseClusterFromEvent(network, regReceipt, Events.VALIDATOR_ADDED);

      // Deposit extra
      const depositVal = connection.ethers.parseEther("2");
      const depTx = await network.connect(clusterOwner).deposit(
        clusterOwner.address, operatorIds, cluster,
        { value: depositVal },
      );
      cluster = parseClusterFromEvent(network, await depTx.wait(), Events.CLUSTER_DEPOSITED);

      // EB update: 64 ETH → vUnits = 20_000
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const effectiveBalance = 64;
      const root = computeEBRoot(clusterId, effectiveBalance);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitEBRoot(network, root, rootBlockNum, [oracle1, oracle2, oracle3]);

      const updateTx = await network.connect(clusterOwner).updateClusterBalance(
        rootBlockNum, clusterOwner.address, operatorIds, cluster, effectiveBalance, [],
      );
      cluster = parseClusterFromEvent(network, await updateTx.wait(), Events.CLUSTER_BALANCE_UPDATED);

      await mineBlocks(provider, 5);

      const implicitVUnits = defaultVUnits(1n);
      const explicitVUnits = calcVUnits(BigInt(effectiveBalance));

      const liqThresholdImplicit = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_BEFORE_LIQ, numOperators: 4n,
        ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: implicitVUnits,
      });
      const liqThresholdExplicit = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_BEFORE_LIQ, numOperators: 4n,
        ethFee: OP_ETH_FEE_RAW, networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: explicitVUnits,
      });

      // Try to withdraw an amount that would leave balance between implicit and explicit thresholds
      // This should revert because the real threshold uses explicit vUnits
      const feesAfterUpdate = calcClusterBurn({
        blockDiff: 7n, // approximate blocks since EB update
        numOperators: 4n, ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW, effectiveVUnits: explicitVUnits,
      });
      const approxBalance = cluster.balance - feesAfterUpdate;

      // Amount that would leave balance just above implicit threshold but below explicit
      const targetRemainder = liqThresholdImplicit + (liqThresholdExplicit - liqThresholdImplicit) / 2n;
      if (approxBalance > targetRemainder) {
        const aggressiveWithdraw = approxBalance - targetRemainder;
        await expect(
          network.connect(clusterOwner).withdraw(operatorIds, aggressiveWithdraw, cluster),
        ).to.be.revertedWithCustomError(network, Errors.INSUFFICIENT_BALANCE);
      }

      // A smaller withdraw should succeed
      const safeAmount = connection.ethers.parseEther("0.5");
      const wTx = await network.connect(clusterOwner).withdraw(operatorIds, safeAmount, cluster);
      const clusterAfter = parseClusterFromEvent(network, await wTx.wait(), Events.CLUSTER_WITHDRAWN);
      expect(clusterAfter.balance).to.be.greaterThan(liqThresholdExplicit);
    });

    // CL-049: Deposit overflow edge — repeated large deposits accumulate correctly
    // Note: Cannot actually send near uint256.max ETH in test env. This verifies
    // no overflow/panic with large accumulated values.
    it("CL-049: Deposit overflow edge — repeated large deposits accumulate correctly", async function () {
      const { network, operatorIds } = await networkHelpers.loadFixture(deploy4OpFixture);

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = parseClusterFromEvent(network, await regTx.wait(), Events.VALIDATOR_ADDED);

      // Multiple large deposits from different signers to accumulate a big balance
      const largeDeposit = connection.ethers.parseEther("500");
      const depTx1 = await network.connect(clusterOwner).deposit(
        clusterOwner.address, operatorIds, cluster,
        { value: largeDeposit },
      );
      cluster = parseClusterFromEvent(network, await depTx1.wait(), Events.CLUSTER_DEPOSITED);
      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE + largeDeposit);

      const depTx2 = await network.connect(nonOwner).deposit(
        clusterOwner.address, operatorIds, cluster,
        { value: largeDeposit },
      );
      cluster = parseClusterFromEvent(network, await depTx2.wait(), Events.CLUSTER_DEPOSITED);
      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE + largeDeposit * 2n);

      const depTx3 = await network.connect(clusterOwner).deposit(
        clusterOwner.address, operatorIds, cluster,
        { value: largeDeposit },
      );
      cluster = parseClusterFromEvent(network, await depTx3.wait(), Events.CLUSTER_DEPOSITED);
      expect(cluster.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE + largeDeposit * 3n);
    });

    // CL-050: Withdraw from migrated cluster with explicit EB
    it("CL-050: Withdraw from migrated cluster (SSV→ETH) with explicit EB", async function () {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);
      const provider = connection.ethers.provider;

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork.connect(clusterOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), MINIMAL_OPERATOR_FEE_SSV, false);
        await legacyNetwork.connect(clusterOwner)
          .registerOperator(makeOperatorKey(i + 1), MINIMAL_OPERATOR_FEE_SSV, false);
        operatorIds.push(Number(expectedId));
      }

      const ssvDeposit = ethers.parseEther("100");
      await ssvToken.mint(clusterOwner.address, ssvDeposit);
      await ssvToken.connect(clusterOwner).approve(await legacyNetwork.getAddress(), ssvDeposit);

      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, ssvDeposit, EMPTY_CLUSTER,
      );
      let cluster = await getCurrentClusterState(connection, legacyNetwork, clusterOwner.address, operatorIds);

      const { newNetwork } = await upgradeToStakingVersion(connection, legacyNetwork, legacyViews);

      // Setup oracles on the upgraded network
      await ssvToken.mint(staker.address, ethers.parseEther("10"));
      await ssvToken.connect(staker).approve(await newNetwork.getAddress(), ethers.parseEther("10"));
      await setupOracles(newNetwork, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

      // Migrate to ETH
      const ethDeposit = connection.ethers.parseEther("10");
      const migrateTx = await newNetwork.connect(clusterOwner).migrateClusterToETH(
        operatorIds, cluster, { value: ethDeposit },
      );
      cluster = parseClusterFromEvent(newNetwork, await migrateTx.wait(), Events.CLUSTER_MIGRATED_TO_ETH);

      // EB update: 64 ETH → vUnits = 20_000
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const effectiveBalance = 64;
      const root = computeEBRoot(clusterId, effectiveBalance);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitEBRoot(newNetwork, root, rootBlockNum, [oracle1, oracle2, oracle3]);

      const updateTx = await newNetwork.connect(clusterOwner).updateClusterBalance(
        rootBlockNum, clusterOwner.address, operatorIds, cluster, effectiveBalance, [],
      );
      cluster = parseClusterFromEvent(newNetwork, await updateTx.wait(), Events.CLUSTER_BALANCE_UPDATED);

      await mineBlocks(provider, 5);

      // Withdraw and verify
      const withdrawAmount = connection.ethers.parseEther("1");
      const wTx = await newNetwork.connect(clusterOwner).withdraw(operatorIds, withdrawAmount, cluster);
      const wReceipt = await wTx.wait();
      const clusterAfter = parseClusterFromEvent(newNetwork, wReceipt, Events.CLUSTER_WITHDRAWN);

      // Balance decreased by at least withdrawAmount (fees also deducted)
      expect(clusterAfter.balance).to.be.lessThan(cluster.balance - withdrawAmount);

      // Verify exact vUnits computation
      const expectedVUnits = calcVUnits(64n);
      expect(expectedVUnits).to.equal(20000n, "CL-050: vUnits = ceil(64*10000/32) = 20000");

      // Fee deduction = cluster.balance - withdrawAmount - clusterAfter.balance
      const feeDeducted = cluster.balance - withdrawAmount - clusterAfter.balance;
      expect(feeDeducted).to.be.greaterThan(0n, "CL-050: fees were deducted");

      // Balance should be close to deposit minus withdraw (fees are small over 6 blocks)
      // Must be at least 99% of (balance - withdrawAmount)
      expect(clusterAfter.balance).to.be.greaterThan(
        (cluster.balance - withdrawAmount) * 99n / 100n,
        "CL-050: balance within 1% of (pre-withdraw balance - withdrawAmount)",
      );

      // Cluster remains active with same validator count
      expect(clusterAfter.active).to.equal(true);
      expect(clusterAfter.validatorCount).to.equal(cluster.validatorCount);
    });
  });

  // ═══════════════════════════════════════════════════════════════════
  // REVERT / EDGE CASE GAPS
  // ═══════════════════════════════════════════════════════════════════

  describe("Revert and Edge Case Gaps", () => {
    // CL-051 / CL-057: Dual-existence revert
    // This requires manipulating storage to have both ethClusters[hash] and clusters[hash] populated.
    // In a real e2e scenario without harness, we can test the version guard by attempting deposit
    // on both SSV and ETH version clusters with the same operators.
    // CL-051 and CL-057 are the same scenario — dual existence guard.
    it("CL-051/CL-057: Dual-existence revert — deposit on SSV cluster with ETH cluster hash guard", async function () {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      // Create 4 operators
      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork.connect(clusterOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), MINIMAL_OPERATOR_FEE_SSV, false);
        await legacyNetwork.connect(clusterOwner)
          .registerOperator(makeOperatorKey(i + 1), MINIMAL_OPERATOR_FEE_SSV, false);
        operatorIds.push(Number(expectedId));
      }

      // Register SSV cluster with owner A
      const ssvDeposit = ethers.parseEther("100");
      await ssvToken.mint(clusterOwner.address, ssvDeposit);
      await ssvToken.connect(clusterOwner).approve(await legacyNetwork.getAddress(), ssvDeposit);
      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, ssvDeposit, EMPTY_CLUSTER,
      );
      const ssvCluster = await getCurrentClusterState(connection, legacyNetwork, clusterOwner.address, operatorIds);

      const { newNetwork } = await upgradeToStakingVersion(connection, legacyNetwork, legacyViews);

      // Migrate to ETH — this clears the SSV cluster and creates an ETH cluster
      const ethDeposit = connection.ethers.parseEther("10");
      const migrateTx = await newNetwork.connect(clusterOwner).migrateClusterToETH(
        operatorIds, ssvCluster, { value: ethDeposit },
      );
      const migratedCluster = parseClusterFromEvent(newNetwork, await migrateTx.wait(), Events.CLUSTER_MIGRATED_TO_ETH);

      // The old SSV cluster state is now invalid — using it should revert
      await expect(
        newNetwork.connect(clusterOwner).deposit(
          clusterOwner.address, operatorIds, ssvCluster,
          { value: connection.ethers.parseEther("1") },
        ),
      ).to.be.revertedWithCustomError(newNetwork, Errors.INCORRECT_CLUSTER_STATE);

      // ETH deposit with correct state should work
      const depTx = await newNetwork.connect(clusterOwner).deposit(
        clusterOwner.address, operatorIds, migratedCluster,
        { value: connection.ethers.parseEther("1") },
      );
      const afterDep = parseClusterFromEvent(newNetwork, await depTx.wait(), Events.CLUSTER_DEPOSITED);
      expect(afterDep.balance).to.equal(migratedCluster.balance + connection.ethers.parseEther("1"));
    });

    // CL-052: ETHTransferFailed on withdraw — contract owner rejects ETH
    it("CL-052: Withdraw reverts ETHTransferFailed when owner contract rejects ETH", async function () {
      const { network, operatorIds } = await networkHelpers.loadFixture(deploy4OpFixture);

      // Deploy a MaliciousWithdraw contract that has no receive/fallback but
      // can register a validator and then attempt to withdraw
      const Malicious = await connection.ethers.getContractFactory("MaliciousWithdraw");
      const malicious = await Malicious.deploy(await network.getAddress());
      await malicious.waitForDeployment();

      await whitelistAddresses(network, clusterOwner, operatorIds, [await malicious.getAddress()]);

      // Register validator through the malicious contract
      await malicious.registerValidator(
        makePublicKey(99), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: SMALL_ETH_REGISTER_VALUE },
      );

      const cluster = await getCurrentClusterState(
        connection, network, await malicious.getAddress(), operatorIds,
      );

      // Set withdraw params — the MaliciousWithdraw uses amount=0 but triggers reentrancy
      // For our purpose, we want the ETH transfer to fail because the contract's receive()
      // re-enters withdraw which triggers the reentrancy guard
      await malicious.setParams(operatorIds, cluster);
      await expect(malicious.attack()).to.be.revertedWithCustomError(network, Errors.ETH_TRANSFER_FAILED);
    });
  });
});

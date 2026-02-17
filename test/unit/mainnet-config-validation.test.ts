/**
 * TEST-33: Mainnet Governance Config Validation & Edge-Case Tests
 *
 * Uses exact mainnet deployment parameters (from deployments/hoodi-upgrade.config.json)
 * to validate system behavior at the boundaries implied by those values.
 *
 * Deployment Config (exact on-chain values — all fees are already packable):
 * | Param                          | Value                              | Raw               |
 * |--------------------------------|------------------------------------|-------------------|
 * | networkFeeEth                  | 3,550,900,000 wei/block            | 3,550,900,000     |
 * | minimumLiquidationCollateralEth| 940,000,000,000,000 wei (0.00094)  | 940,000,000,000,000|
 * | liquidationThresholdPeriod     | 35,800 blocks (~5 days)            | 35,800            |
 * | minOperatorEthFee              | 1,065,200,000 wei/block            | 1,065,200,000     |
 * | maxOperatorEthFee              | 5,326,300,000 wei/block            | 5,326,300,000     |
 * | defaultOperatorEthFee          | 1,775,464,912 wei/block            | 1,775,464,912     |
 * | quorumBps                      | 75%                                | 7,500             |
 * | cooldownDuration               | 604,800 seconds (7 days)           | 604,800           |
 *
 * Note: defaultOperatorEthFee (1,775,464,912) is NOT packable (remainder 64,912).
 * The closest packable value is 1,775,400,000 and is used wherever on-chain packing
 * is required. Other fee parameters in the deployment config are already packable.
 */
import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../setup/connection.ts";
import {
  ssvClustersHarnessFixture,
  ssvDAOHarnessFixture,
  ssvOperatorsHarnessFixture,
  ssvStakingHarnessFixture,
} from "../setup/fixtures.ts";
import type { NetworkHelpersType } from "../common/types.ts";
import { createCluster, makePublicKey, makeOperatorKey, parseClusterFromEvent } from "../common/helpers.ts";
import {
  DEFAULT_SHARES,
  ETH_DEDUCTED_DIGITS,
  VUNITS_PRECISION,
  STAKE_AMOUNT,
} from "../common/constants.ts";
import { Events } from "../common/events.ts";
import { Errors } from "../common/errors.ts";
import { ethers } from "ethers";

// =========================================================================
// Mainnet deployment config (from deployments/hoodi-upgrade.config.json)
//
// These are the EXACT values that go on-chain. Fees are already packable
// (divisible by ETH_DEDUCTED_DIGITS = 100,000) except defaultOperatorEthFee.
// =========================================================================
const CONFIG = {
  networkFeeEth: 3_550_900_000n,                   // packable
  minimumLiquidationCollateralEth: 940_000_000_000_000n, // 0.00094 ETH, packable
  liquidationThresholdPeriod: 35_800n,              // blocks
  minOperatorEthFee: 1_065_200_000n,                // packable
  maxOperatorEthFee: 5_326_300_000n,                // packable
  defaultOperatorEthFee: 1_775_464_912n,            // NOT packable (remainder 64,912)
  quorumBps: 7_500n,                                // 75%
  cooldownDuration: 604_800n,                       // seconds (7 days)
  defaultOracleIds: [1, 2, 3, 4],
};

// Closest packable equivalent for defaultOperatorEthFee
// 1,775,464,912 % 100,000 = 64,912 → floor to 1,775,400,000
const PACKABLE_DEFAULT_OP_FEE = 1_775_400_000n;

// =========================================================================
// Original spreadsheet values (raw wei, some NOT packable). Kept for
// the packability documentation test.
// =========================================================================
const SPREADSHEET = {
  ethNetworkFee: 3_550_929_823n,
  operatorMinFee: 1_065_278_947n,
  operatorMaxFee: 5_326_394_735n,
  defaultOperatorETHFee: 1_775_464_912n,
  minimumLiquidationCollateral: 940_000_000_000n, // original spreadsheet value (smaller scale)
};

describe("Mainnet Governance Config Validation", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
  });

  // =======================================================================
  // 1. Packability — verify fee values survive pack/unpack round-trip
  // =======================================================================
  describe("1. Packability", () => {
    let harness: any;

    const deployPackedLibFixture = async () => {
      const contract = await connection.ethers.deployContract("PackedLibHarness");
      await contract.waitForDeployment();
      return { harness: contract };
    };

    it("Documents which original spreadsheet values are NOT packable", async function () {
      // ethNetworkFee: 3,550,929,823 % 100,000 = 29,823 → NOT packable
      expect(SPREADSHEET.ethNetworkFee % ETH_DEDUCTED_DIGITS).to.equal(29_823n);

      // operatorMinFee: 1,065,278,947 % 100,000 = 78,947 → NOT packable
      expect(SPREADSHEET.operatorMinFee % ETH_DEDUCTED_DIGITS).to.equal(78_947n);

      // operatorMaxFee: 5,326,394,735 % 100,000 = 94,735 → NOT packable
      expect(SPREADSHEET.operatorMaxFee % ETH_DEDUCTED_DIGITS).to.equal(94_735n);

      // defaultOperatorETHFee: 1,775,464,912 % 100,000 = 64,912 → NOT packable
      expect(SPREADSHEET.defaultOperatorETHFee % ETH_DEDUCTED_DIGITS).to.equal(64_912n);
    });

    it("Verifies deployment config values (except defaultOperatorEthFee) ARE packable", async function () {
      // The deployment config uses packable versions for on-chain storage
      expect(CONFIG.networkFeeEth % ETH_DEDUCTED_DIGITS).to.equal(0n);
      expect(CONFIG.minimumLiquidationCollateralEth % ETH_DEDUCTED_DIGITS).to.equal(0n);
      expect(CONFIG.minOperatorEthFee % ETH_DEDUCTED_DIGITS).to.equal(0n);
      expect(CONFIG.maxOperatorEthFee % ETH_DEDUCTED_DIGITS).to.equal(0n);

      // defaultOperatorEthFee is NOT packable
      expect(CONFIG.defaultOperatorEthFee % ETH_DEDUCTED_DIGITS).to.equal(64_912n);
      // Its closest packable floor
      expect(PACKABLE_DEFAULT_OP_FEE % ETH_DEDUCTED_DIGITS).to.equal(0n);
      expect(CONFIG.defaultOperatorEthFee - PACKABLE_DEFAULT_OP_FEE).to.be.lessThan(ETH_DEDUCTED_DIGITS);
    });

    it("Verifies all packable config values survive pack/unpack round-trip", async function () {
      ({ harness } = await networkHelpers.loadFixture(deployPackedLibFixture));

      const packableValues: Record<string, bigint> = {
        networkFeeEth: CONFIG.networkFeeEth,
        minimumLiquidationCollateralEth: CONFIG.minimumLiquidationCollateralEth,
        minOperatorEthFee: CONFIG.minOperatorEthFee,
        maxOperatorEthFee: CONFIG.maxOperatorEthFee,
        packableDefaultOpFee: PACKABLE_DEFAULT_OP_FEE,
      };

      for (const [key, value] of Object.entries(packableValues)) {
        const packed = await harness.ethPack(value);
        const unpacked = await harness.ethUnpack(packed);
        expect(unpacked).to.equal(value, `${key}: pack/unpack round-trip failed`);
      }
    });

    it("Verifies non-packable spreadsheet values are rejected by the packing library", async function () {
      ({ harness } = await networkHelpers.loadFixture(deployPackedLibFixture));

      const nonPackable = [
        SPREADSHEET.ethNetworkFee,
        SPREADSHEET.operatorMinFee,
        SPREADSHEET.operatorMaxFee,
        SPREADSHEET.defaultOperatorETHFee,
      ];

      for (const value of nonPackable) {
        await expect(harness.ethPack(value))
          .to.be.revertedWithCustomError(harness, Errors.MAX_PRECISION_EXCEEDED);
      }
    });

    it("Verifies minimumLiquidationCollateralEth (940,000,000,000,000) packs correctly", async function () {
      ({ harness } = await networkHelpers.loadFixture(deployPackedLibFixture));

      const packed = await harness.ethPack(CONFIG.minimumLiquidationCollateralEth);
      const unpacked = await harness.ethUnpack(packed);
      expect(unpacked).to.equal(CONFIG.minimumLiquidationCollateralEth);
    });
  });

  // =======================================================================
  // 2. Liquidation threshold math
  // =======================================================================
  describe("2. Liquidation threshold math", () => {
    const deployClustersFixture = async () => {
      // Deploy clusters with 4 operators at ZERO fee.
      // ethNetworkFee left at 0 to avoid auto-accrual from block advancement
      // (currentNetworkFeeIndex = ethNetworkFeeIndex + (block.number - ethNetworkFeeIndexBlockNumber) × ethNetworkFee).
      // We use mockCurrentNetworkFeeIndex to directly control the stored index.
      const result = await ssvClustersHarnessFixture(connection, 4, 0n);
      const clusters = result.clusters;

      // Set liquidation parameters (but NOT ethNetworkFee — leave at 0)
      await clusters.mockMinimumBlocksBeforeLiquidation(CONFIG.liquidationThresholdPeriod);
      await clusters.mockMinimumLiquidationCollateral(
        CONFIG.minimumLiquidationCollateralEth / ETH_DEDUCTED_DIGITS
      );

      return result;
    };

    it("Calculates liquidation threshold and verifies isLiquidatable agrees", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersFixture);
      const [owner, liquidator] = await connection.ethers.getSigners();

      // ---------------------------------------------------------------
      // Pure arithmetic: theoretical burn rate with mainnet operator fees
      // ---------------------------------------------------------------
      // Per-operator packed fee = 1,775,400,000 / 100,000 = 17,754
      // Total operator fee (packed, per validator) = 4 × 17,754 = 71,016
      // Network fee (packed) = 3,550,900,000 / 100,000 = 35,509
      // Burn rate per validator per block (packed) = 71,016 + 35,509 = 106,525
      //
      // Liquidation threshold (wei) = 35,800 × 106,525 × 100,000 = 381,359,500,000,000
      // minimumLiquidationCollateral = 940,000,000,000,000 > threshold
      // → the collateral floor dominates

      const perOperatorPacked = PACKABLE_DEFAULT_OP_FEE / ETH_DEDUCTED_DIGITS;
      const totalOperatorFeePacked = perOperatorPacked * 4n;
      const networkFeePacked = CONFIG.networkFeeEth / ETH_DEDUCTED_DIGITS;
      const burnRatePacked = totalOperatorFeePacked + networkFeePacked;
      const thresholdPacked = CONFIG.liquidationThresholdPeriod * burnRatePacked;
      const thresholdWei = thresholdPacked * ETH_DEDUCTED_DIGITS;

      expect(perOperatorPacked).to.equal(17_754n);
      expect(totalOperatorFeePacked).to.equal(71_016n);
      expect(networkFeePacked).to.equal(35_509n);
      expect(burnRatePacked).to.equal(106_525n);
      expect(thresholdWei).to.equal(381_359_500_000_000n);

      // The minimumLiquidationCollateral (940,000,000,000,000) is LARGER than the
      // burn-rate-based threshold (381,359,500,000,000), so the collateral check
      // dominates. A cluster needs at least 0.00094 ETH to avoid liquidation.
      expect(CONFIG.minimumLiquidationCollateralEth).to.be.greaterThan(thresholdWei);

      // ---------------------------------------------------------------
      // On-chain boundary test: operators at fee=0, drain via network fee index
      // ---------------------------------------------------------------
      // Register validator with a large deposit (3× collateral)
      const largeDeposit = CONFIG.minimumLiquidationCollateralEth * 3n;
      const registerTx = await clusters.registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        createCluster(),
        { value: largeDeposit }
      );
      const receipt = await registerTx.wait();
      const cluster = parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);

      // Cluster with large deposit — NOT liquidatable
      await expect(
        clusters.connect(liquidator).liquidate(owner.address, operatorIds, cluster)
      ).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_NOT_LIQUIDATABLE);

      // Consume balance via network fee index to bring it exactly to the collateral threshold
      // Balance consumed per network-fee-index unit (1 validator):
      //   1 × ETH_DEDUCTED_DIGITS = 100,000 wei
      const toConsume = largeDeposit - CONFIG.minimumLiquidationCollateralEth;
      const netFeeIndexDelta = toConsume / ETH_DEDUCTED_DIGITS;
      await clusters.mockCurrentNetworkFeeIndex(netFeeIndexDelta);

      // Balance = minimumLiquidationCollateralEth exactly → NOT liquidatable
      // (contract checks: balance < minimumLiquidationCollateral, strict less-than)
      await expect(
        clusters.connect(liquidator).liquidate(owner.address, operatorIds, cluster)
      ).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_NOT_LIQUIDATABLE);

      // Consume 1 more unit (100,000 wei) to drop below threshold
      await clusters.mockCurrentNetworkFeeIndex(netFeeIndexDelta + 1n);

      // Now balance < minimumLiquidationCollateral → liquidatable
      const liquidateTx = await clusters.connect(liquidator).liquidate(
        owner.address, operatorIds, cluster
      );
      const liquidateReceipt = await liquidateTx.wait();
      const liquidatedCluster = parseClusterFromEvent(
        clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED
      );
      expect(liquidatedCluster.active).to.equal(false);
    });
  });

  // =======================================================================
  // 3. Operator fee boundaries
  // =======================================================================
  describe("3. Operator fee boundaries", () => {
    const deployOperatorsFixture = async () => {
      return ssvOperatorsHarnessFixture(
        connection,
        CONFIG.maxOperatorEthFee,  // max fee
        604_800n,                  // declare period (7 days)
        604_800n,                  // execute period (7 days)
        10_000n                    // max increase 100%
      );
    };

    it("Accepts operator fee at minOperatorEthFee (1,065,200,000)", async function () {
      const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
      await operators.mockSetMinimumOperatorEthFee(CONFIG.minOperatorEthFee);

      await expect(
        operators.registerOperator(makeOperatorKey(1), Number(CONFIG.minOperatorEthFee), false)
      ).to.emit(operators, Events.OPERATOR_ADDED);
    });

    it("Accepts operator fee at maxOperatorEthFee (5,326,300,000)", async function () {
      const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
      await operators.mockSetMinimumOperatorEthFee(CONFIG.minOperatorEthFee);

      await expect(
        operators.registerOperator(makeOperatorKey(1), Number(CONFIG.maxOperatorEthFee), false)
      ).to.emit(operators, Events.OPERATOR_ADDED);
    });

    it("Rejects fee at minOperatorEthFee - ETH_DEDUCTED_DIGITS via declareOperatorFee", async function () {
      const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
      await operators.mockSetMinimumOperatorEthFee(CONFIG.minOperatorEthFee);

      // Fee one packable step below minimum:
      // 1,065,200,000 - 100,000 = 1,065,100,000
      const feeBelowMin = CONFIG.minOperatorEthFee - ETH_DEDUCTED_DIGITS;

      // Register at min fee, then try to declare below-min
      await operators.registerOperator(makeOperatorKey(1), Number(CONFIG.minOperatorEthFee), false);

      await expect(
        operators.declareOperatorFee(1, Number(feeBelowMin))
      ).to.be.revertedWithCustomError(operators, Errors.FEE_TOO_LOW);
    });

    it("Rejects fee at maxOperatorEthFee + ETH_DEDUCTED_DIGITS via declareOperatorFee", async function () {
      const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
      await operators.mockSetMinimumOperatorEthFee(CONFIG.minOperatorEthFee);

      // Fee one packable step above maximum:
      // 5,326,300,000 + 100,000 = 5,326,400,000
      const feeAboveMax = CONFIG.maxOperatorEthFee + ETH_DEDUCTED_DIGITS;

      // Register at max fee, then try to declare above-max
      await operators.registerOperator(
        makeOperatorKey(1), Number(CONFIG.maxOperatorEthFee), false
      );

      await expect(
        operators.declareOperatorFee(1, Number(feeAboveMax))
      ).to.be.revertedWithCustomError(operators, Errors.FEE_TOO_HIGH);
    });
  });

  // =======================================================================
  // 4. Cluster burn rate
  // =======================================================================
  describe("4. Cluster burn rate", () => {
    it("Computes correct burn rate for 1, 4, and 13 validators", async function () {
      // Per-operator packed fee = 1,775,400,000 / 100,000 = 17,754
      // Network fee packed     = 3,550,900,000 / 100,000 = 35,509
      // Per-validator burn rate (packed) = (4 × 17,754) + 35,509 = 71,016 + 35,509 = 106,525
      //
      // Burn per block (wei) = burn_rate_packed × (vUnits / VUNITS_PRECISION) × ETH_DEDUCTED_DIGITS
      //
      // For N validators (no EB set), vUnits = N × 10,000, so vUnits/VUNITS_PRECISION = N
      // Burn per block per validator (wei) = 106,525 × 100,000 = 10,652,500,000

      const perOperatorPacked = PACKABLE_DEFAULT_OP_FEE / ETH_DEDUCTED_DIGITS;
      const networkFeePacked = CONFIG.networkFeeEth / ETH_DEDUCTED_DIGITS;
      const perValidatorBurnRate = (perOperatorPacked * 4n) + networkFeePacked;
      expect(perValidatorBurnRate).to.equal(106_525n);

      const N_BLOCKS = 1000n;

      for (const validatorCount of [1n, 4n, 13n]) {
        // Total burn for N_BLOCKS (wei) = perValidatorBurnRate × validatorCount × N_BLOCKS × ETH_DEDUCTED_DIGITS
        const expectedBurnWei = perValidatorBurnRate * validatorCount * N_BLOCKS * ETH_DEDUCTED_DIGITS;

        // Verify math with comments:
        //   1 validator:  106,525 × 1  × 1,000 × 100,000 =  10,652,500,000,000 wei
        //   4 validators: 106,525 × 4  × 1,000 × 100,000 =  42,610,000,000,000 wei
        //   13 validators:106,525 × 13 × 1,000 × 100,000 = 138,482,500,000,000 wei
        if (validatorCount === 1n) expect(expectedBurnWei).to.equal(10_652_500_000_000n);
        if (validatorCount === 4n) expect(expectedBurnWei).to.equal(42_610_000_000_000n);
        if (validatorCount === 13n) expect(expectedBurnWei).to.equal(138_482_500_000_000n);
      }
    });

    it("Verifies on-chain balance decreases correctly after N blocks (network fee)", async function () {
      // Deploy cluster with zero-fee operators.
      // ethNetworkFee left at 0 to avoid auto-accrual from block advancement.
      // We use mockCurrentNetworkFeeIndex to directly set the stored index.
      const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, 4, 0n);
      const networkFeePacked = CONFIG.networkFeeEth / ETH_DEDUCTED_DIGITS;

      const N_BLOCKS = 1000n;
      const initialDeposit = ethers.parseEther("1");

      const registerTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: initialDeposit }
      );
      const receipt = await registerTx.wait();
      const cluster = parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);
      expect(cluster.balance).to.equal(initialDeposit);

      // Advance network fee index to simulate N_BLOCKS of network fee consumption
      // Balance consumed = networkFeePacked × N_BLOCKS × ETH_DEDUCTED_DIGITS
      //                  = 35,509 × 1,000 × 100,000 = 3,550,900,000,000 wei
      const netFeeIndexDelta = networkFeePacked * N_BLOCKS;
      await clusters.mockCurrentNetworkFeeIndex(netFeeIndexDelta);

      // Trigger balance recalculation via withdraw (deposit does NOT recalculate balance)
      const withdrawAmount = 1n;
      const withdrawTx = await clusters.withdraw(operatorIds, withdrawAmount, cluster);
      const withdrawReceipt = await withdrawTx.wait();
      const clusterAfter = parseClusterFromEvent(clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

      const networkFeeBurn = netFeeIndexDelta * ETH_DEDUCTED_DIGITS;
      // 35,509 × 1,000 × 100,000 = 3,550,900,000,000 wei
      expect(networkFeeBurn).to.equal(3_550_900_000_000n);

      const expectedBalance = initialDeposit - networkFeeBurn - withdrawAmount;
      expect(clusterAfter.balance).to.equal(expectedBalance);
    });
  });

  // =======================================================================
  // 5. Cooldown duration
  // =======================================================================
  describe("5. Cooldown duration", () => {
    // The SSVStaking module uses block.timestamp (seconds) for cooldown:
    //   unlockTime = block.timestamp + cooldownDuration
    // cooldownDuration = 604,800 seconds = 7 days

    const deployStakingFixture = async () => {
      return ssvStakingHarnessFixture(connection, CONFIG.cooldownDuration);
    };

    it("Cannot claim before 604,800 seconds (7 days) elapse", async function () {
      const { staking, ssvToken } = await networkHelpers.loadFixture(deployStakingFixture);

      await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.stake(STAKE_AMOUNT);
      await staking.requestUnstake(STAKE_AMOUNT);

      // Advance time to half the cooldown (302,400 seconds = 3.5 days)
      // Using half ensures the gap is large enough even with block timestamp advances
      await networkHelpers.time.increase(CONFIG.cooldownDuration / 2n);

      await expect(staking.withdrawUnlocked())
        .to.be.revertedWithCustomError(staking, Errors.NOTHING_TO_WITHDRAW);
    });

    it("Can claim after 604,800 seconds (7 days) elapse", async function () {
      const { staking, ssvToken } = await networkHelpers.loadFixture(deployStakingFixture);
      const [staker] = await connection.ethers.getSigners();

      await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.stake(STAKE_AMOUNT);
      await staking.requestUnstake(STAKE_AMOUNT);

      // Advance past cooldown
      await networkHelpers.time.increase(CONFIG.cooldownDuration + 1n);

      const balanceBefore = await ssvToken.balanceOf(staker.address);
      const tx = await staking.withdrawUnlocked();
      await expect(tx)
        .to.emit(staking, Events.UNSTAKE_WITHDRAWN)
        .withArgs(staker.address, STAKE_AMOUNT);

      const balanceAfter = await ssvToken.balanceOf(staker.address);
      expect(balanceAfter - balanceBefore).to.equal(STAKE_AMOUNT);
    });

    it("Verifies cooldownDuration is stored as 604,800 (seconds, not blocks)", async function () {
      const { staking } = await networkHelpers.loadFixture(deployStakingFixture);
      const storedCooldown = await staking.getCooldownDuration();
      // Implementation uses block.timestamp, so this value represents seconds
      expect(storedCooldown).to.equal(604_800n);
    });
  });

  // =======================================================================
  // 6. Quorum — 4 oracles, quorumBps=7500, need 3 of 4 votes
  // =======================================================================
  describe("6. Quorum", () => {
    let oracle1: HardhatEthersSigner;
    let oracle2: HardhatEthersSigner;
    let oracle3: HardhatEthersSigner;
    let oracle4: HardhatEthersSigner;
    let owner: HardhatEthersSigner;

    const totalSupply = ethers.parseEther("1000");

    before(async function () {
      [owner, oracle1, oracle2, oracle3, oracle4] = await connection.ethers.getSigners();
    });

    const deployDAOWithMainnetQuorumFixture = async () => {
      const { dao, cssv } = await ssvDAOHarnessFixture(connection);

      // Set up 4 oracles with mainnet quorum (75%)
      await dao.mockSetOracle(1, oracle1.address);
      await dao.mockSetOracle(2, oracle2.address);
      await dao.mockSetOracle(3, oracle3.address);
      await dao.mockSetOracle(4, oracle4.address);
      await dao.mockSetQuorumBps(Number(CONFIG.quorumBps));

      // Mint cSSV to give oracles weight (each oracle gets totalSupply/4 = 250 ETH weight)
      await cssv.mint(owner.address, totalSupply);

      return { dao, cssv };
    };

    it("2 votes out of 4 should NOT reach quorum (50% < 75%)", async function () {
      // Each oracle has weight = totalSupply / 4 = 25%
      // 2 votes = 50% < 75% quorum threshold
      const { dao } = await networkHelpers.loadFixture(deployDAOWithMainnetQuorumFixture);

      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("mainnet-quorum-test"));
      const blockNum = await connection.ethers.provider.getBlockNumber();

      // First vote — emits WeightedRootProposed, not RootCommitted
      const tx1 = await dao.connect(oracle1).commitRoot(merkleRoot, blockNum);
      await expect(tx1).to.emit(dao, Events.WEIGHTED_ROOT_PROPOSED);
      await expect(tx1).to.not.emit(dao, Events.ROOT_COMMITTED);

      // Second vote — still below quorum
      const tx2 = await dao.connect(oracle2).commitRoot(merkleRoot, blockNum);
      await expect(tx2).to.emit(dao, Events.WEIGHTED_ROOT_PROPOSED);
      await expect(tx2).to.not.emit(dao, Events.ROOT_COMMITTED);

      // Root NOT committed
      expect(await dao.getEBRoot(blockNum)).to.equal(ethers.ZeroHash);
    });

    it("3 votes out of 4 should reach quorum (75% >= 75%)", async function () {
      // 3 votes = 75% >= 75% quorum threshold → root committed
      const { dao } = await networkHelpers.loadFixture(deployDAOWithMainnetQuorumFixture);

      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("mainnet-quorum-test-2"));
      const blockNum = await connection.ethers.provider.getBlockNumber();

      // First two votes — below quorum
      await dao.connect(oracle1).commitRoot(merkleRoot, blockNum);
      await dao.connect(oracle2).commitRoot(merkleRoot, blockNum);

      // Third vote — reaches quorum
      const tx3 = await dao.connect(oracle3).commitRoot(merkleRoot, blockNum);
      await expect(tx3).to.emit(dao, Events.ROOT_COMMITTED).withArgs(merkleRoot, blockNum);

      // Root committed
      expect(await dao.getEBRoot(blockNum)).to.equal(merkleRoot);
    });
  });

  // =======================================================================
  // 7. Liquidation collateral
  // =======================================================================
  describe("7. Liquidation collateral", () => {
    const deployClustersFixture = async () => {
      // Deploy with ZERO operator fee AND no ethNetworkFee (leave at 0).
      // This isolates the minimumLiquidationCollateral boundary test from
      // block-based fee accrual. We use mockCurrentNetworkFeeIndex to drain balance.
      const result = await ssvClustersHarnessFixture(connection, 4, 0n);
      const clusters = result.clusters;

      await clusters.mockMinimumBlocksBeforeLiquidation(CONFIG.liquidationThresholdPeriod);
      await clusters.mockMinimumLiquidationCollateral(
        CONFIG.minimumLiquidationCollateralEth / ETH_DEDUCTED_DIGITS
      );

      return result;
    };

    it("Cluster with deposit >= minimumLiquidationCollateral is NOT liquidatable", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersFixture);
      const [clusterOwner, liquidator] = await connection.ethers.getSigners();

      // minimumLiquidationCollateral = 940,000,000,000,000 wei = 0.00094 ETH
      // Deposit 2× to be safely above all thresholds
      const depositAmount = CONFIG.minimumLiquidationCollateralEth * 2n;

      const registerTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: depositAmount }
      );
      const receipt = await registerTx.wait();
      const cluster = parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);

      // NOT liquidatable — balance is well above collateral threshold
      await expect(
        clusters.connect(liquidator).liquidate(clusterOwner.address, operatorIds, cluster)
      ).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_NOT_LIQUIDATABLE);
    });

    it("Cluster IS liquidatable when balance drops below minimumLiquidationCollateral", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersFixture);
      const [clusterOwner, liquidator] = await connection.ethers.getSigners();

      // Deposit enough to register
      const depositAmount = CONFIG.minimumLiquidationCollateralEth * 2n;
      const registerTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: depositAmount }
      );
      const receipt = await registerTx.wait();
      const cluster = parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);

      // Consume balance via network fee index to drop below collateral threshold
      //
      // Balance consumed per network-fee-index unit (1 validator):
      //   1 × ETH_DEDUCTED_DIGITS = 100,000 wei
      //
      // Consume = depositAmount - minimumLiquidationCollateral + 1 unit
      //         = 2 × 940,000,000,000,000 - 940,000,000,000,000 + 100,000
      //         = 940,000,000,100,000
      // Index units = 940,000,000,100,000 / 100,000 = 9,400,000,001
      const balanceToConsume = depositAmount - CONFIG.minimumLiquidationCollateralEth + ETH_DEDUCTED_DIGITS;
      const indexUnits = balanceToConsume / ETH_DEDUCTED_DIGITS;
      await clusters.mockCurrentNetworkFeeIndex(indexUnits);

      // Balance is now below minimumLiquidationCollateral → liquidatable
      const liquidateTx = await clusters.connect(liquidator).liquidate(
        clusterOwner.address, operatorIds, cluster
      );
      const liquidateReceipt = await liquidateTx.wait();
      const liquidatedCluster = parseClusterFromEvent(
        clusters, liquidateReceipt, Events.CLUSTER_LIQUIDATED
      );
      expect(liquidatedCluster.active).to.equal(false);
    });
  });

  // =======================================================================
  // 8. Long-running clusters — 1 year (~2,628,000 blocks)
  // =======================================================================
  describe("8. Long-running clusters (1 year simulation)", () => {
    it("No overflow in fee index calculations after 1 year (~2,628,000 blocks)", async function () {
      const ONE_YEAR_BLOCKS = 2_628_000n;
      const networkFeePacked = CONFIG.networkFeeEth / ETH_DEDUCTED_DIGITS; // 35,509
      const perOperatorPacked = PACKABLE_DEFAULT_OP_FEE / ETH_DEDUCTED_DIGITS; // 17,754

      // ---------------------------------------------------------------
      // Pure arithmetic: verify fee index deltas fit in uint64 (max ~1.8 × 10^19)
      // ---------------------------------------------------------------
      const operatorIndexDelta = perOperatorPacked * ONE_YEAR_BLOCKS;
      const networkFeeIndexDelta = networkFeePacked * ONE_YEAR_BLOCKS;
      const maxUint64 = (1n << 64n) - 1n;

      // 17,754 × 2,628,000 = 46,657,512,000
      expect(operatorIndexDelta).to.equal(46_657_512_000n);
      expect(networkFeeIndexDelta).to.equal(93_317_652_000n);
      expect(operatorIndexDelta).to.be.lessThan(maxUint64);
      expect(networkFeeIndexDelta).to.be.lessThan(maxUint64);

      // Total burn per year for 1 validator (packed) =
      //   (4 × 17,754 + 35,509) × 2,628,000 = 106,525 × 2,628,000 = 279,947,700,000
      // Total burn (wei) = 279,947,700,000 × 100,000 = 27,994,770,000,000,000 ≈ 0.028 ETH
      const totalBurnPacked = 106_525n * ONE_YEAR_BLOCKS;
      const totalBurnWei = totalBurnPacked * ETH_DEDUCTED_DIGITS;
      expect(totalBurnWei).to.equal(27_994_770_000_000_000n);

      // ---------------------------------------------------------------
      // On-chain: verify no overflow with network fee over 1 year
      // Operators at fee=0, ethNetworkFee left at 0 to avoid block-based auto-accrual.
      // We use mockCurrentNetworkFeeIndex to directly set the stored index.
      // ---------------------------------------------------------------
      const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, 4, 0n);

      // Network fee burn (1 year) = 35,509 × 2,628,000 × 100,000 = 9,331,765,200,000,000 wei
      const networkFeeBurnWei = networkFeeIndexDelta * ETH_DEDUCTED_DIGITS;
      expect(networkFeeBurnWei).to.equal(9_331_765_200_000_000n);

      const initialDeposit = networkFeeBurnWei * 2n; // 2× for headroom

      const registerTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: initialDeposit }
      );
      const receipt = await registerTx.wait();
      const cluster = parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);

      // Simulate 1 year of network fee index advancement
      await clusters.mockCurrentNetworkFeeIndex(networkFeeIndexDelta);

      // Trigger balance recalculation via withdraw — if overflow occurred this would revert
      // (deposit does NOT recalculate balance)
      const withdrawAmount = 1n;
      const withdrawTx = await clusters.withdraw(operatorIds, withdrawAmount, cluster);
      const withdrawReceipt = await withdrawTx.wait();
      const clusterAfterYear = parseClusterFromEvent(
        clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN
      );

      // Cluster still active — no overflow
      expect(clusterAfterYear.active).to.equal(true);
    });

    it("Balance accounting remains correct after 1 year", async function () {
      const ONE_YEAR_BLOCKS = 2_628_000n;
      const networkFeePacked = CONFIG.networkFeeEth / ETH_DEDUCTED_DIGITS; // 35,509

      // Deploy cluster with zero-fee operators, ethNetworkFee left at 0.
      // We use mockCurrentNetworkFeeIndex to directly set the stored index.
      const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, 4, 0n);

      // Network fee burn for 1 year (1 validator):
      //   networkFeePacked × ONE_YEAR_BLOCKS × ETH_DEDUCTED_DIGITS
      //   = 35,509 × 2,628,000 × 100,000 = 9,331,765,200,000,000 wei ≈ 0.00933 ETH
      const networkFeeBurn = networkFeePacked * ONE_YEAR_BLOCKS * ETH_DEDUCTED_DIGITS;
      expect(networkFeeBurn).to.equal(9_331_765_200_000_000n);

      // Deposit 15× the burn for headroom
      const initialDeposit = networkFeeBurn * 15n;

      const registerTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: initialDeposit }
      );
      const receipt = await registerTx.wait();
      const cluster = parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);
      expect(cluster.balance).to.equal(initialDeposit);

      // Advance network fee index by 1 year
      const netFeeIndexDelta = networkFeePacked * ONE_YEAR_BLOCKS;
      await clusters.mockCurrentNetworkFeeIndex(netFeeIndexDelta);

      // Trigger balance recalculation via withdraw (deposit does NOT recalculate balance)
      const withdrawAmount = 1n;
      const withdrawTx = await clusters.withdraw(operatorIds, withdrawAmount, cluster);
      const withdrawReceipt = await withdrawTx.wait();
      const clusterAfter = parseClusterFromEvent(
        clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN
      );

      // Expected balance = initialDeposit - networkFeeBurn - withdrawAmount
      const expectedBalance = initialDeposit - networkFeeBurn - withdrawAmount;
      expect(clusterAfter.balance).to.equal(expectedBalance);
      expect(clusterAfter.active).to.equal(true);
    });
  });
});

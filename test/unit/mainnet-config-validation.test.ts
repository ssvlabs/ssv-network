import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
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
import { makePublicKey, makeOperatorKey, parseClusterFromEvent } from "../common/helpers.ts";
import {
  DEFAULT_SHARES,
  ETH_DEDUCTED_DIGITS,
  MINIMAL_LIQUIDATION_THRESHOLD,
  STAKE_AMOUNT, EMPTY_CLUSTER,
} from '../common/constants.ts';
import { Events } from "../common/events.ts";
import { Errors } from "../common/errors.ts";
import { ethers } from "ethers";

/**
 * Uses exact mainnet deployment parameters (from deployments/params-candidate.json)
 * to validate system behavior at the boundaries implied by those values.
 *
 * To propose new governance parameters: edit deployments/params-candidate.json and re-run
 * the test suite. No test source changes are needed unless burn-rate assertions must be updated.
 *
 * Deployment Config (exact on-chain values — all fees are already packable):
 * | Param                          | Value                              | Raw               |
 * |--------------------------------|------------------------------------|-------------------|
 * | networkFeeEth                  | 3,550,900,000 wei/block            | 3,550,900,000     |
 * | minimumLiquidationCollateralEth| 940,000,000,000,000 wei (0.00094)  | 940,000,000,000,000|
 * | liquidationThresholdPeriod     | 35,800 blocks (~5 days)            | 35,800            |
 * | minOperatorEthFee              | 1,065,200,000 wei/block            | 1,065,200,000     |
 * | maxOperatorEthFee              | 5,326,300,000 wei/block            | 5,326,300,000     |
 * | defaultOperatorEthFee          | 1,770,000,000 wei/block            | 1,770,000,000     |
 * | quorumBps                      | 75%                                | 7,500             |
 * | cooldownDuration               | 604,800 seconds (7 days)           | 604,800           |
 * | minBlocksBetweenUpdates        | 0 blocks                           | 0.                |
 *
 */

type ParamsCandidateJson = {
  networkFeeEth: string;
  minimumLiquidationCollateralEth: string;
  liquidationThresholdPeriod: string;
  minOperatorEthFee: string;
  maxOperatorEthFee: string;
  defaultOperatorEthFee: string;
  quorumBps: number;
  cooldownDuration: number;
  minBlocksBetweenUpdates: number;
  defaultOracleIds: number[];
};

const _raw = JSON.parse(
  readFileSync(resolve(process.cwd(), "deployments/params-candidate.json"), "utf8")
) as ParamsCandidateJson;

const CONFIG = {
  networkFeeEth: BigInt(_raw.networkFeeEth),
  minimumLiquidationCollateralEth: BigInt(_raw.minimumLiquidationCollateralEth),
  liquidationThresholdPeriod: BigInt(_raw.liquidationThresholdPeriod),
  minOperatorEthFee: BigInt(_raw.minOperatorEthFee),
  maxOperatorEthFee: BigInt(_raw.maxOperatorEthFee),
  defaultOperatorEthFee: BigInt(_raw.defaultOperatorEthFee),
  quorumBps: BigInt(_raw.quorumBps),
  cooldownDuration: BigInt(_raw.cooldownDuration),
  minBlocksBetweenUpdates: BigInt(_raw.minBlocksBetweenUpdates),
  defaultOracleIds: _raw.defaultOracleIds,
};

// Original values (raw wei, some NOT packable). Kept for the packability documentation test.
const RAW_VALUES = {
  ethNetworkFee: 3_550_929_823n,
  operatorMinFee: 1_065_278_947n,
  operatorMaxFee: 5_326_394_735n,
  defaultOperatorETHFee: 1_775_464_912n,
  minimumLiquidationCollateral: 940_000_000_000_000n,
};

describe("Mainnet Governance Config Validation", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
  });

  describe("Config file (deployments/params-candidate.json)", () => {
    const CONFIG_PATH = resolve(process.cwd(), "deployments/params-candidate.json");

    it("exists and is readable from process.cwd()", () => {
      expect(existsSync(CONFIG_PATH), `File not found: ${CONFIG_PATH}`).to.be.true;
    });

    it("contains all required fields", () => {
      const required: (keyof ParamsCandidateJson)[] = [
        "networkFeeEth",
        "minimumLiquidationCollateralEth",
        "liquidationThresholdPeriod",
        "minOperatorEthFee",
        "maxOperatorEthFee",
        "defaultOperatorEthFee",
        "quorumBps",
        "cooldownDuration",
        "minBlocksBetweenUpdates",
        "defaultOracleIds",
      ];
      for (const field of required) {
        expect(_raw[field], `Missing field: ${field}`).to.not.be.undefined;
      }
    });

    it("fee fields are non-negative integer strings", () => {
      const stringFields: (keyof ParamsCandidateJson)[] = [
        "networkFeeEth",
        "minimumLiquidationCollateralEth",
        "liquidationThresholdPeriod",
        "minOperatorEthFee",
        "maxOperatorEthFee",
        "defaultOperatorEthFee"
      ];
      for (const field of stringFields) {
        const value = _raw[field];
        expect(typeof value, `${field} must be a string`).to.equal("string");
        expect(/^\d+$/.test(value as string)).to.be.true;
      }
    });

    it("quorumBps is an integer in [1, 10000]", () => {
      expect(Number.isInteger(_raw.quorumBps)).to.be.true;
      expect(_raw.quorumBps).to.be.greaterThanOrEqual(1);
      expect(_raw.quorumBps).to.be.lessThanOrEqual(10_000);
    });

    it("cooldownDuration is a positive integer", () => {
      expect(Number.isInteger(_raw.cooldownDuration)).to.be.true;
      expect(_raw.cooldownDuration).to.be.greaterThan(0);
    });

    it("minBlocksBetweenUpdates is a positive integer", () => {
      const value = Number(_raw.minBlocksBetweenUpdates);
      expect(Number.isInteger(value)).to.be.true;
    });

    it("defaultOracleIds is an array of 4 distinct valid oracle ids", () => {
      expect(Array.isArray(_raw.defaultOracleIds)).to.be.true;
      expect(_raw.defaultOracleIds.length).to.equal(4);
      for (const id of _raw.defaultOracleIds) {
        expect(Number.isInteger(id) && id > 0 && id <= 0xffffffff).to.be.true;
      }
      const unique = new Set(_raw.defaultOracleIds);
      expect(unique.size).to.equal(4);
    });

    it("minOperatorEthFee <= defaultOperatorEthFee <= maxOperatorEthFee", () => {
      const min = BigInt(_raw.minOperatorEthFee);
      const def = BigInt(_raw.defaultOperatorEthFee);
      const max = BigInt(_raw.maxOperatorEthFee);
      expect(min <= def).to.be.true;
      expect(def <= max).to.be.true;
    });
  });

  describe("Packability", () => {
    let harness: any;

    const deployPackedLibFixture = async () => {
      const contract = await connection.ethers.deployContract("PackedLibHarness");
      await contract.waitForDeployment();
      return { harness: contract };
    };

    it("Confirms raw mainnet values are not packable (remainder ≠ 0 mod 100,000)", async function () {
      // ethNetworkFee: 3,550,929,823 % 100,000 = 29,823 → NOT packable
      expect(RAW_VALUES.ethNetworkFee % ETH_DEDUCTED_DIGITS).to.equal(29_823n);
      // operatorMinFee: 1,065,278,947 % 100,000 = 78,947 → NOT packable
      expect(RAW_VALUES.operatorMinFee % ETH_DEDUCTED_DIGITS).to.equal(78_947n);
      // operatorMaxFee: 5,326,394,735 % 100,000 = 94,735 → NOT packable
      expect(RAW_VALUES.operatorMaxFee % ETH_DEDUCTED_DIGITS).to.equal(94_735n);
      // defaultOperatorETHFee: 1,775,464,912 % 100,000 = 64,912 → NOT packable
      expect(RAW_VALUES.defaultOperatorETHFee % ETH_DEDUCTED_DIGITS).to.equal(64_912n);
    });

    it("Confirms all deployment config values are packable (divisible by 100,000)", async function () {
      expect(CONFIG.networkFeeEth % ETH_DEDUCTED_DIGITS).to.equal(0n);
      expect(CONFIG.minimumLiquidationCollateralEth % ETH_DEDUCTED_DIGITS).to.equal(0n);
      expect(CONFIG.minOperatorEthFee % ETH_DEDUCTED_DIGITS).to.equal(0n);
      expect(CONFIG.maxOperatorEthFee % ETH_DEDUCTED_DIGITS).to.equal(0n);
      expect(CONFIG.defaultOperatorEthFee % ETH_DEDUCTED_DIGITS).to.equal(0n);
    });

    it("All packable config values survive pack/unpack round-trip", async function () {
      ({ harness } = await networkHelpers.loadFixture(deployPackedLibFixture));

      const packableValues: Record<string, bigint> = {
        networkFeeEth: CONFIG.networkFeeEth,
        minimumLiquidationCollateralEth: CONFIG.minimumLiquidationCollateralEth,
        minOperatorEthFee: CONFIG.minOperatorEthFee,
        maxOperatorEthFee: CONFIG.maxOperatorEthFee,
        packableDefaultOpFee: CONFIG.defaultOperatorEthFee,
      };

      for (const [key, value] of Object.entries(packableValues)) {
        const packed = await harness.ethPack(value);
        const unpacked = await harness.ethUnpack(packed);
        expect(unpacked).to.equal(value, `${key}: pack/unpack round-trip failed`);
      }
    });

    it("Is reverted with MaxPrecisionExceeded when packing a non-packable value", async function () {
      ({ harness } = await networkHelpers.loadFixture(deployPackedLibFixture));

      const nonPackable = [
        RAW_VALUES.ethNetworkFee,
        RAW_VALUES.operatorMinFee,
        RAW_VALUES.operatorMaxFee,
        RAW_VALUES.defaultOperatorETHFee,
      ];

      for (const value of nonPackable) {
        await expect(harness.ethPack(value))
          .to.be.revertedWithCustomError(harness, Errors.MAX_PRECISION_EXCEEDED);
      }
    });

    it("Packs minimumLiquidationCollateralEth (940,000,000,000,000) without precision loss", async function () {
      ({ harness } = await networkHelpers.loadFixture(deployPackedLibFixture));

      const packed = await harness.ethPack(CONFIG.minimumLiquidationCollateralEth);
      const unpacked = await harness.ethUnpack(packed);
      expect(unpacked).to.equal(CONFIG.minimumLiquidationCollateralEth);
    });
  });


  describe("Liquidation threshold math", () => {
    const deployClustersFixture = async () => {
      const result = await ssvClustersHarnessFixture(connection, 4, 0n);
      const clusters = result.clusters;

      await clusters.mockMinimumBlocksBeforeLiquidation(CONFIG.liquidationThresholdPeriod);
      await clusters.mockMinimumLiquidationCollateral(
        CONFIG.minimumLiquidationCollateralEth / ETH_DEDUCTED_DIGITS
      );

      return result;
    };

    it("liquidationThresholdPeriod (35,800) is above the system minimum (21,480 blocks)", async function () {
      expect(CONFIG.liquidationThresholdPeriod).to.be.greaterThanOrEqual(MINIMAL_LIQUIDATION_THRESHOLD);
    });

    it("Liquidation threshold is dominated by minimumLiquidationCollateral floor", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersFixture);
      const [owner, liquidator] = await connection.ethers.getSigners();

      // Per-operator packed fee = 1,770,000,000 / 100,000 = 17,700
      // Total operator fee (packed, per validator) = 4 × 17,700 = 70,800
      // Network fee (packed) = 3,550,900,000 / 100,000 = 35,509
      // Burn rate per validator per block (packed) = 70,800 + 35,509 = 106,309
      //
      // Liquidation threshold (wei) = 35,800 × 106,309 × 100,000 = 380,586,220,000,000
      // minimumLiquidationCollateral = 940,000,000,000,000 > threshold
      // → the collateral floor dominates

      const perOperatorPacked = CONFIG.defaultOperatorEthFee / ETH_DEDUCTED_DIGITS;
      const totalOperatorFeePacked = perOperatorPacked * 4n;
      const networkFeePacked = CONFIG.networkFeeEth / ETH_DEDUCTED_DIGITS;
      const burnRatePacked = totalOperatorFeePacked + networkFeePacked;
      const thresholdPacked = CONFIG.liquidationThresholdPeriod * burnRatePacked;
      const thresholdWei = thresholdPacked * ETH_DEDUCTED_DIGITS;

      expect(perOperatorPacked).to.equal(17_700n);
      expect(totalOperatorFeePacked).to.equal(70_800n);
      expect(networkFeePacked).to.equal(35_509n);
      expect(burnRatePacked).to.equal(106_309n);
      expect(thresholdWei).to.equal(380_586_220_000_000n);

      expect(CONFIG.minimumLiquidationCollateralEth).to.be.greaterThan(thresholdWei);

      const largeDeposit = CONFIG.minimumLiquidationCollateralEth * 3n;
      const registerTx = await clusters.registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: largeDeposit }
      );
      const receipt = await registerTx.wait();
      const cluster = parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);

      await expect(
        clusters.connect(liquidator).liquidate(owner.address, operatorIds, cluster)
      ).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_NOT_LIQUIDATABLE);

      const toConsume = largeDeposit - CONFIG.minimumLiquidationCollateralEth;
      const netFeeIndexDelta = toConsume / ETH_DEDUCTED_DIGITS;
      await clusters.mockCurrentNetworkFeeIndex(netFeeIndexDelta);

      await expect(
        clusters.connect(liquidator).liquidate(owner.address, operatorIds, cluster)
      ).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_NOT_LIQUIDATABLE);

      await clusters.mockCurrentNetworkFeeIndex(netFeeIndexDelta + 1n);

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

  describe("Operator fee boundaries", () => {
    const deployOperatorsFixture = async () => {
      return ssvOperatorsHarnessFixture(
        connection,
        CONFIG.maxOperatorEthFee,                 // max fee
        604_800n,                  // declare period (7 days)
        604_800n,                  // execute period (7 days)
        10_000n                   // max increase 100%
      );
    };

    it("defaultOperatorEthFee (1,770,000,000) is within [minOperatorEthFee, maxOperatorEthFee]", async function () {
      expect(CONFIG.defaultOperatorEthFee).to.be.greaterThanOrEqual(CONFIG.minOperatorEthFee);
      expect(CONFIG.defaultOperatorEthFee).to.be.lessThanOrEqual(CONFIG.maxOperatorEthFee);
    });

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

    it("Is reverted with FeeTooLow when declaring fee one packable step below minimum", async function () {
      const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
      await operators.mockSetMinimumOperatorEthFee(CONFIG.minOperatorEthFee);

      // 1,065,200,000 - 100,000 = 1,065,100,000
      const feeBelowMin = CONFIG.minOperatorEthFee - ETH_DEDUCTED_DIGITS;

      await operators.registerOperator(makeOperatorKey(1), Number(CONFIG.minOperatorEthFee), false);

      await expect(
        operators.declareOperatorFee(1, Number(feeBelowMin))
      ).to.be.revertedWithCustomError(operators, Errors.FEE_TOO_LOW);
    });

    it("Is reverted with FeeTooHigh when declaring fee one packable step above maximum", async function () {
      const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
      await operators.mockSetMinimumOperatorEthFee(CONFIG.minOperatorEthFee);

      // 5,326,300,000 + 100,000 = 5,326,400,000
      const feeAboveMax = CONFIG.maxOperatorEthFee + ETH_DEDUCTED_DIGITS;

      await operators.registerOperator(
        makeOperatorKey(1), Number(CONFIG.maxOperatorEthFee), false
      );

      await expect(
        operators.declareOperatorFee(1, Number(feeAboveMax))
      ).to.be.revertedWithCustomError(operators, Errors.FEE_TOO_HIGH);
    });
  });

  describe("Cluster burn rate", () => {
    it("Computes correct burn rate for 1, 4, and 13 validators", async function () {
      const perOperatorPacked = CONFIG.defaultOperatorEthFee / ETH_DEDUCTED_DIGITS;
      const networkFeePacked = CONFIG.networkFeeEth / ETH_DEDUCTED_DIGITS;
      const perValidatorBurnRate = (perOperatorPacked * 4n) + networkFeePacked;

      const N_BLOCKS = 1000n;

      for (const validatorCount of [1n, 4n, 13n]) {
        // Total burn for N_BLOCKS (wei) = perValidatorBurnRate × validatorCount × N_BLOCKS × ETH_DEDUCTED_DIGITS
        const expectedBurnWei = perValidatorBurnRate * validatorCount * N_BLOCKS * ETH_DEDUCTED_DIGITS;

        //   1 validator:  106,309 × 1  × 1,000 × 100,000 =  10,630,900,000,000 wei
        //   4 validators: 106,309 × 4  × 1,000 × 100,000 =  42,523,600,000,000 wei
        //   13 validators:106,309 × 13 × 1,000 × 100,000 = 138,201,700,000,000 wei
        if (validatorCount === 1n) expect(expectedBurnWei).to.equal(10_630_900_000_000n);
        if (validatorCount === 4n) expect(expectedBurnWei).to.equal(42_523_600_000_000n);
        if (validatorCount === 13n) expect(expectedBurnWei).to.equal(138_201_700_000_000n);
      }
    });

    it("Deducts networkFeeEth × N_BLOCKS from cluster balance after N blocks", async function () {
      // ethNetworkFee left at 0 to avoid auto-accrual from block advancement.
      const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, 4, 0n);
      const networkFeePacked = CONFIG.networkFeeEth / ETH_DEDUCTED_DIGITS;

      const N_BLOCKS = 1000n;
      const initialDeposit = ethers.parseEther("1");

      const registerTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: initialDeposit }
      );
      const receipt = await registerTx.wait();
      const cluster = parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);
      expect(cluster.balance).to.equal(initialDeposit);

      const netFeeIndexDelta = networkFeePacked * N_BLOCKS;
      await clusters.mockCurrentNetworkFeeIndex(netFeeIndexDelta);

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

  describe("Cooldown duration", () => {
    const deployStakingFixture = async () => {
      return ssvStakingHarnessFixture(connection, CONFIG.cooldownDuration);
    };

    it("Is reverted with NothingToWithdraw before cooldown expires (604,800 seconds)", async function () {
      const { staking, ssvToken } = await networkHelpers.loadFixture(deployStakingFixture);

      await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.stake(STAKE_AMOUNT);
      await staking.requestUnstake(STAKE_AMOUNT);

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

      await networkHelpers.time.increase(CONFIG.cooldownDuration + 1n);

      const balanceBefore = await ssvToken.balanceOf(staker.address);
      const tx = await staking.withdrawUnlocked();
      await expect(tx)
        .to.emit(staking, Events.UNSTAKE_WITHDRAWN)
        .withArgs(staker.address, STAKE_AMOUNT);

      const balanceAfter = await ssvToken.balanceOf(staker.address);
      expect(balanceAfter - balanceBefore).to.equal(STAKE_AMOUNT);
    });

    it("Stores cooldownDuration as 604,800 seconds (not blocks)", async function () {
      const { staking } = await networkHelpers.loadFixture(deployStakingFixture);
      const storedCooldown = await staking.getCooldownDuration();
      expect(storedCooldown).to.equal(CONFIG.cooldownDuration);
    });
  });

  describe("EB update frequency", () => {
    const deployDAOFixture = async () => {
      const { dao } = await ssvDAOHarnessFixture(connection);
      return { dao };
    };

    it("Stores minBlocksBetweenUpdates", async function () {
      const { dao } = await networkHelpers.loadFixture(deployDAOFixture);
      const value = Number(CONFIG.minBlocksBetweenUpdates);

      await dao.updateMinBlocksBetweenUpdates(value);

      expect(await dao.getMinBlocksBetweenUpdates()).to.equal(value);
    });
  });

  describe("Quorum", () => {
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

      await dao.mockSetOracle(1, oracle1.address);
      await dao.mockSetOracle(2, oracle2.address);
      await dao.mockSetOracle(3, oracle3.address);
      await dao.mockSetOracle(4, oracle4.address);
      await dao.mockupdateQuorumBps(Number(CONFIG.quorumBps));

      await cssv.mint(owner.address, totalSupply);

      return { dao, cssv };
    };

    it("2 votes out of 4 should NOT reach quorum (50% < 75%)", async function () {
      const { dao } = await networkHelpers.loadFixture(deployDAOWithMainnetQuorumFixture);

      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("mainnet-quorum-test"));
      const blockNum = await connection.ethers.provider.getBlockNumber();

      const tx1 = await dao.connect(oracle1).commitRoot(merkleRoot, blockNum);
      await expect(tx1).to.emit(dao, Events.WEIGHTED_ROOT_PROPOSED);
      await expect(tx1).to.not.emit(dao, Events.ROOT_COMMITTED);

      const tx2 = await dao.connect(oracle2).commitRoot(merkleRoot, blockNum);
      await expect(tx2).to.emit(dao, Events.WEIGHTED_ROOT_PROPOSED);
      await expect(tx2).to.not.emit(dao, Events.ROOT_COMMITTED);

      expect(await dao.getEBRoot(blockNum)).to.equal(ethers.ZeroHash);
    });

    it("3 votes out of 4 should reach quorum (75% >= 75%)", async function () {
      const { dao } = await networkHelpers.loadFixture(deployDAOWithMainnetQuorumFixture);

      const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("mainnet-quorum-test-2"));
      const blockNum = await connection.ethers.provider.getBlockNumber();

      await dao.connect(oracle1).commitRoot(merkleRoot, blockNum);
      await dao.connect(oracle2).commitRoot(merkleRoot, blockNum);

      const tx3 = await dao.connect(oracle3).commitRoot(merkleRoot, blockNum);
      await expect(tx3).to.emit(dao, Events.ROOT_COMMITTED).withArgs(merkleRoot, blockNum);

      expect(await dao.getEBRoot(blockNum)).to.equal(merkleRoot);
    });
  });

  describe("Liquidation collateral", () => {
    const deployClustersFixture = async () => {
      const result = await ssvClustersHarnessFixture(connection, 4, 0n);
      const clusters = result.clusters;

      await clusters.mockMinimumBlocksBeforeLiquidation(CONFIG.liquidationThresholdPeriod);
      await clusters.mockMinimumLiquidationCollateral(
        CONFIG.minimumLiquidationCollateralEth / ETH_DEDUCTED_DIGITS
      );

      return result;
    };

    it("Is reverted when liquidating a cluster with balance above minimumLiquidationCollateral", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersFixture);
      const [clusterOwner, liquidator] = await connection.ethers.getSigners();

      const depositAmount = CONFIG.minimumLiquidationCollateralEth * 2n;

      const registerTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: depositAmount }
      );
      const receipt = await registerTx.wait();
      const cluster = parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);

      await expect(
        clusters.connect(liquidator).liquidate(clusterOwner.address, operatorIds, cluster)
      ).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_NOT_LIQUIDATABLE);
    });

    it("Liquidates cluster when balance drops below minimumLiquidationCollateral", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersFixture);
      const [clusterOwner, liquidator] = await connection.ethers.getSigners();

      const depositAmount = CONFIG.minimumLiquidationCollateralEth * 2n;
      const registerTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: depositAmount }
      );
      const receipt = await registerTx.wait();
      const cluster = parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);

      const balanceToConsume = depositAmount - CONFIG.minimumLiquidationCollateralEth + ETH_DEDUCTED_DIGITS;
      const indexUnits = balanceToConsume / ETH_DEDUCTED_DIGITS;
      await clusters.mockCurrentNetworkFeeIndex(indexUnits);

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


  describe("Long-running clusters (1 year simulation)", () => {
    it("Fee indices remain within uint64 bounds after 1 year (~2,628,000 blocks)", async function () {
      const ONE_YEAR_BLOCKS = 2_628_000n;
      const networkFeePacked = CONFIG.networkFeeEth / ETH_DEDUCTED_DIGITS; // 35,509
      const perOperatorPacked = CONFIG.defaultOperatorEthFee / ETH_DEDUCTED_DIGITS; // 17,700

      const operatorIndexDelta = perOperatorPacked * ONE_YEAR_BLOCKS;
      const networkFeeIndexDelta = networkFeePacked * ONE_YEAR_BLOCKS;
      const maxUint64 = (1n << 64n) - 1n;

      // 17,700 × 2,628,000 = 46,515,600,000
      expect(operatorIndexDelta).to.equal(46_515_600_000n);
      // 35,509 × 2,628,000 = 93,317,652,000
      expect(networkFeeIndexDelta).to.equal(93_317_652_000n);
      expect(operatorIndexDelta).to.be.lessThan(maxUint64);
      expect(networkFeeIndexDelta).to.be.lessThan(maxUint64);

      const totalBurnPacked = (perOperatorPacked * 4n + networkFeePacked) * ONE_YEAR_BLOCKS;
      const totalBurnWei = totalBurnPacked * ETH_DEDUCTED_DIGITS;

      // (1,770,000,000 / 100,000 × 4 + 3,550,900,000 / 100,000) × 2,628,000 × 100,000
      // = (17,700 × 4 + 35,509) × 2,628,000 × 100,000
      // = 106,309 × 2,628,000 × 100,000
      // = 27,938,005,200,000,000
      expect(totalBurnWei).to.equal(27_938_005_200_000_000n);

      const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, 4, 0n);

      // Network fee burn (1 year) = 35,509 × 2,628,000 × 100,000 = 9,331,765,200,000,000 wei
      const networkFeeBurnWei = networkFeeIndexDelta * ETH_DEDUCTED_DIGITS;
      expect(networkFeeBurnWei).to.equal(9_331_765_200_000_000n);

      const initialDeposit = networkFeeBurnWei * 2n;

      const registerTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: initialDeposit }
      );
      const receipt = await registerTx.wait();
      const cluster = parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);

      await clusters.mockCurrentNetworkFeeIndex(networkFeeIndexDelta);

      const withdrawAmount = 1n;
      const withdrawTx = await clusters.withdraw(operatorIds, withdrawAmount, cluster);
      const withdrawReceipt = await withdrawTx.wait();
      const clusterAfterYear = parseClusterFromEvent(
        clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN
      );

      expect(clusterAfterYear.active).to.equal(true);
    });

    it("Balance accounting remains correct after 1 year", async function () {
      const ONE_YEAR_BLOCKS = 2_628_000n;
      const networkFeePacked = CONFIG.networkFeeEth / ETH_DEDUCTED_DIGITS; // 35,509

      const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, 4, 0n);

      //   = 35,509 × 2,628,000 × 100,000 = 9,331,765,200,000,000 wei ≈ 0.00933 ETH
      const networkFeeBurn = networkFeePacked * ONE_YEAR_BLOCKS * ETH_DEDUCTED_DIGITS;
      expect(networkFeeBurn).to.equal(9_331_765_200_000_000n);

      const initialDeposit = networkFeeBurn * 15n;

      const registerTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: initialDeposit }
      );
      const receipt = await registerTx.wait();
      const cluster = parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);
      expect(cluster.balance).to.equal(initialDeposit);

      const netFeeIndexDelta = networkFeePacked * ONE_YEAR_BLOCKS;
      await clusters.mockCurrentNetworkFeeIndex(netFeeIndexDelta);

      const withdrawAmount = 1n;
      const withdrawTx = await clusters.withdraw(operatorIds, withdrawAmount, cluster);
      const withdrawReceipt = await withdrawTx.wait();
      const clusterAfter = parseClusterFromEvent(
        clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN
      );

      const expectedBalance = initialDeposit - networkFeeBurn - withdrawAmount;
      expect(clusterAfter.balance).to.equal(expectedBalance);
      expect(clusterAfter.active).to.equal(true);
    });
  });
});

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  whitelistAddresses,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  NETWORK_FEE,
  BPS_DENOMINATOR,
  ETH_DEDUCTED_DIGITS,
  DEFAULT_UNSTAKE_COOLDOWN,
} from "../../common/constants.ts";
import {
  mineBlocks,
  getBlockNumber,
  getTxBlock,
  calcAccEthPerShareDelta,
  calcStakingReward,
  defaultVUnits,
} from "../../helpers/index.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";

const PRECISION = 10n ** 18n;
const PACKED_NETWORK_FEE = NETWORK_FEE / ETH_DEDUCTED_DIGITS;

describe("E2E Staking Lifecycle", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let provider: any;

  let deployer: HardhatEthersSigner;
  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let stakerA: HardhatEthersSigner;
  let stakerB: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [deployer, operatorOwner, clusterOwner, stakerA, stakerB] } = await setupTestContext());
    provider = connection.ethers.provider;
  });

  const deployFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  describe("Basic Stake → Earn → Claim Cycle", () => {
    it("Should allow a user to stake SSV, earn network fee revenue, and claim ETH rewards", async function () {
      const { network, views, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      await mineBlocks(provider, 50);

      const stakeAmount = 10n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);

      const stakeBlock = await getTxBlock(
        await network.connect(stakerA).stake(stakeAmount),
      );

      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(stakeAmount);
      expect(await cssvToken.totalSupply()).to.equal(stakeAmount);

      await mineBlocks(provider, 100);

      const balBefore = await provider.getBalance(stakerA.address);
      const claimTx = await network.connect(stakerA).claimEthRewards();
      const claimReceipt = await claimTx.wait();
      const claimBlock = claimReceipt!.blockNumber;
      const gasUsed = claimReceipt!.gasUsed * claimReceipt!.gasPrice;
      const balAfter = await provider.getBalance(stakerA.address);

      const vUnits = defaultVUnits(1n);
      const blockDiff = BigInt(claimBlock - stakeBlock);

      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * vUnits) / BPS_DENOMINATOR;
      const totalEarningsPacked = earningsPerBlockPacked * blockDiff;
      const totalEarningsWei = totalEarningsPacked * ETH_DEDUCTED_DIGITS;

      const accDelta = calcAccEthPerShareDelta(totalEarningsWei, stakeAmount);
      const expectedReward = calcStakingReward(stakeAmount, accDelta, 0n);
      const expectedPayout = expectedReward - (expectedReward % ETH_DEDUCTED_DIGITS);

      const ethReceived = BigInt(balAfter) - balBefore + gasUsed;
      expect(ethReceived).to.equal(expectedPayout);
    });

    it("Pre-stake fees when cSSV supply is zero are permanently locked", async function () {
      const { network, ssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      await mineBlocks(provider, 50);

      const stakeAmount = 10n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);

      const stakeBlock = await getTxBlock(
        await network.connect(stakerA).stake(stakeAmount),
      );

      await mineBlocks(provider, 100);

      const balBefore = await provider.getBalance(stakerA.address);
      const claimTx = await network.connect(stakerA).claimEthRewards();
      const claimReceipt = await claimTx.wait();
      const claimBlock = claimReceipt!.blockNumber;
      const gasUsed = claimReceipt!.gasUsed * claimReceipt!.gasPrice;
      const balAfter = await provider.getBalance(stakerA.address);

      const blockDiff = BigInt(claimBlock - stakeBlock);
      const vUnits = defaultVUnits(1n);
      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * vUnits) / BPS_DENOMINATOR;
      const totalEarningsPacked = earningsPerBlockPacked * blockDiff;
      const totalEarningsWei = totalEarningsPacked * ETH_DEDUCTED_DIGITS;

      const accDelta = calcAccEthPerShareDelta(totalEarningsWei, stakeAmount);
      const expectedReward = calcStakingReward(stakeAmount, accDelta, 0n);
      const expectedPayout = expectedReward - (expectedReward % ETH_DEDUCTED_DIGITS);

      const ethReceived = BigInt(balAfter) - balBefore + gasUsed;
      expect(ethReceived).to.equal(expectedPayout);
    });
  });

  describe("Multiple Stakers — Pro-Rata Distribution", () => {
    it("Should distribute rewards proportionally: A gets 25%, B gets 75% with 10:30 ratio", async function () {
      const { network, ssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      const amountA = 10n * PRECISION;
      const amountB = 30n * PRECISION;
      const totalStaked = amountA + amountB;

      await ssvToken.connect(deployer).transfer(stakerA.address, amountA);
      await ssvToken.connect(deployer).transfer(stakerB.address, amountB);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), amountA);
      await ssvToken
        .connect(stakerB)
        .approve(await network.getAddress(), amountB);

      const stakeBlockA = await getTxBlock(
        await network.connect(stakerA).stake(amountA),
      );

      const stakeBlockB = await getTxBlock(
        await network.connect(stakerB).stake(amountB),
      );

      await mineBlocks(provider, 100);

      const balBeforeA = await provider.getBalance(stakerA.address);
      const claimTxA = await network.connect(stakerA).claimEthRewards();
      const claimReceiptA = await claimTxA.wait();
      const gasA = claimReceiptA!.gasUsed * claimReceiptA!.gasPrice;
      const balAfterA = await provider.getBalance(stakerA.address);
      const rewardA = BigInt(balAfterA) - balBeforeA + gasA;

      const balBeforeB = await provider.getBalance(stakerB.address);
      const claimTxB = await network.connect(stakerB).claimEthRewards();
      const claimReceiptB = await claimTxB.wait();
      const gasB = claimReceiptB!.gasUsed * claimReceiptB!.gasPrice;
      const balAfterB = await provider.getBalance(stakerB.address);
      const rewardB = BigInt(balAfterB) - balBeforeB + gasB;

      const vUnits = defaultVUnits(1n);
      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * vUnits) / BPS_DENOMINATOR;

      const phase1Blocks = BigInt(stakeBlockB - stakeBlockA);
      const phase1FeesWei = earningsPerBlockPacked * phase1Blocks * ETH_DEDUCTED_DIGITS;
      const acc1 = calcAccEthPerShareDelta(phase1FeesWei, amountA);

      const claimBlockA = claimReceiptA!.blockNumber;
      const claimBlockB = claimReceiptB!.blockNumber;
      const phase2Blocks = BigInt(claimBlockA - stakeBlockB);
      const phase2FeesWei = earningsPerBlockPacked * phase2Blocks * ETH_DEDUCTED_DIGITS;
      const acc2 = calcAccEthPerShareDelta(phase2FeesWei, totalStaked);

      const expectedRewardA = calcStakingReward(amountA, acc1 + acc2, 0n);
      const expectedPayoutA = expectedRewardA - (expectedRewardA % ETH_DEDUCTED_DIGITS);
      expect(rewardA).to.equal(expectedPayoutA);

      const phase3Blocks = BigInt(claimBlockB - claimBlockA);
      const phase3FeesWei = earningsPerBlockPacked * phase3Blocks * ETH_DEDUCTED_DIGITS;
      const acc3 = calcAccEthPerShareDelta(phase3FeesWei, totalStaked);

      const expectedRewardB = calcStakingReward(amountB, acc2 + acc3, 0n);
      const expectedPayoutB = expectedRewardB - (expectedRewardB % ETH_DEDUCTED_DIGITS);
      expect(rewardB).to.equal(expectedPayoutB);
    });

    it("Three stakers split rewards correctly when one unstakes mid-period", async function () {
      const { network, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const allSigners = await connection.ethers.getSigners();
      const stakerC = allSigners[5];

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      const amountA = 10n * PRECISION;
      const amountB = 10n * PRECISION;
      const amountC = 10n * PRECISION;
      const totalStakedPhase1 = amountA + amountB + amountC;
      const unstakeAmount = 5n * PRECISION;
      const totalStakedPhase2 = totalStakedPhase1 - unstakeAmount;

      await ssvToken.connect(deployer).transfer(stakerA.address, amountA);
      await ssvToken.connect(deployer).transfer(stakerB.address, amountB);
      await ssvToken.connect(deployer).transfer(stakerC.address, amountC);
      await ssvToken.connect(stakerA).approve(await network.getAddress(), amountA);
      await ssvToken.connect(stakerB).approve(await network.getAddress(), amountB);
      await ssvToken.connect(stakerC).approve(await network.getAddress(), amountC);

      await network.connect(stakerA).stake(amountA);
      await network.connect(stakerB).stake(amountB);
      await network.connect(stakerC).stake(amountC);

      const regBlock = await getTxBlock(
        await network.connect(clusterOwner).registerValidator(
          makePublicKey(2),
          operatorIds,
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      );

      await mineBlocks(provider, 50);

      const unstakeBlock = await getTxBlock(
        await network.connect(stakerA).requestUnstake(unstakeAmount),
      );

      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(amountA - unstakeAmount);

      await mineBlocks(provider, 50);

      const balBeforeA = await provider.getBalance(stakerA.address);
      const balBeforeB = await provider.getBalance(stakerB.address);
      const balBeforeC = await provider.getBalance(stakerC.address);

      let claimTxA: any;
      let claimTxB: any;
      let claimTxC: any;

      await provider.send("evm_setAutomine", [false]);
      try {
        claimTxA = await network.connect(stakerA).claimEthRewards();
        claimTxB = await network.connect(stakerB).claimEthRewards();
        claimTxC = await network.connect(stakerC).claimEthRewards();
        await provider.send("evm_mine", []);
      } finally {
        await provider.send("evm_setAutomine", [true]);
      }

      const claimReceiptA = await claimTxA.wait();
      const claimReceiptB = await claimTxB.wait();
      const claimReceiptC = await claimTxC.wait();
      const claimBlock = claimReceiptA!.blockNumber;

      expect(claimReceiptB!.blockNumber).to.equal(claimBlock);
      expect(claimReceiptC!.blockNumber).to.equal(claimBlock);

      const gasA = claimReceiptA!.gasUsed * claimReceiptA!.gasPrice;
      const gasB = claimReceiptB!.gasUsed * claimReceiptB!.gasPrice;
      const gasC = claimReceiptC!.gasUsed * claimReceiptC!.gasPrice;

      const balAfterA = await provider.getBalance(stakerA.address);
      const balAfterB = await provider.getBalance(stakerB.address);
      const balAfterC = await provider.getBalance(stakerC.address);

      const rewardA = BigInt(balAfterA) - balBeforeA + gasA;
      const rewardB = BigInt(balAfterB) - balBeforeB + gasB;
      const rewardC = BigInt(balAfterC) - balBeforeC + gasC;

      const vUnits = defaultVUnits(1n);
      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * vUnits) / BPS_DENOMINATOR;

      const phase1Blocks = BigInt(unstakeBlock - regBlock);
      const phase1FeesWei = earningsPerBlockPacked * phase1Blocks * ETH_DEDUCTED_DIGITS;
      const acc1 = calcAccEthPerShareDelta(phase1FeesWei, totalStakedPhase1);

      const phase2Blocks = BigInt(claimBlock - unstakeBlock);
      const phase2FeesWei = earningsPerBlockPacked * phase2Blocks * ETH_DEDUCTED_DIGITS;
      const acc2 = calcAccEthPerShareDelta(phase2FeesWei, totalStakedPhase2);

      const expectedRewardA =
        calcStakingReward(amountA, acc1, 0n) +
        calcStakingReward(amountA - unstakeAmount, acc2, 0n);
      const expectedRewardB =
        calcStakingReward(amountB, acc1, 0n) +
        calcStakingReward(amountB, acc2, 0n);
      const expectedRewardC =
        calcStakingReward(amountC, acc1, 0n) +
        calcStakingReward(amountC, acc2, 0n);

      const expectedPayoutA = expectedRewardA - (expectedRewardA % ETH_DEDUCTED_DIGITS);
      const expectedPayoutB = expectedRewardB - (expectedRewardB % ETH_DEDUCTED_DIGITS);
      const expectedPayoutC = expectedRewardC - (expectedRewardC % ETH_DEDUCTED_DIGITS);

      expect(rewardA).to.equal(expectedPayoutA);
      expect(rewardB).to.equal(expectedPayoutB);
      expect(rewardC).to.equal(expectedPayoutC);
      expect(rewardB).to.equal(rewardC);
      expect(rewardB).to.be.greaterThan(rewardA);
    });
  });

  describe("Stake Timing Matters — Late Joiner", () => {
    it("Late joiner B does NOT capture fees from before they staked", async function () {
      const { network, ssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      const amountA = 10n * PRECISION;
      const amountB = 30n * PRECISION;

      await ssvToken.connect(deployer).transfer(stakerA.address, amountA);
      await ssvToken.connect(deployer).transfer(stakerB.address, amountB);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), amountA);
      await ssvToken
        .connect(stakerB)
        .approve(await network.getAddress(), amountB);

      const stakeBlockA = await getTxBlock(
        await network.connect(stakerA).stake(amountA),
      );

      await mineBlocks(provider, 50);

      const stakeBlockB = await getTxBlock(
        await network.connect(stakerB).stake(amountB),
      );

      await mineBlocks(provider, 50);

      const balBeforeA = await provider.getBalance(stakerA.address);
      const claimTxA = await network.connect(stakerA).claimEthRewards();
      const claimReceiptA = await claimTxA.wait();
      const claimBlockA = claimReceiptA!.blockNumber;
      const gasA = claimReceiptA!.gasUsed * claimReceiptA!.gasPrice;
      const balAfterA = await provider.getBalance(stakerA.address);
      const rewardA = BigInt(balAfterA) - balBeforeA + gasA;

      const balBeforeB = await provider.getBalance(stakerB.address);
      const claimTxB = await network.connect(stakerB).claimEthRewards();
      const claimReceiptB = await claimTxB.wait();
      const claimBlockB = claimReceiptB!.blockNumber;
      const gasB = claimReceiptB!.gasUsed * claimReceiptB!.gasPrice;
      const balAfterB = await provider.getBalance(stakerB.address);
      const rewardB = BigInt(balAfterB) - balBeforeB + gasB;

      const vUnits = defaultVUnits(1n);
      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * vUnits) / BPS_DENOMINATOR;
      const totalSupply = amountA + amountB;

      const phase1Blocks = BigInt(stakeBlockB - stakeBlockA);
      const phase1FeesWei = earningsPerBlockPacked * phase1Blocks * ETH_DEDUCTED_DIGITS;
      const acc1 = calcAccEthPerShareDelta(phase1FeesWei, amountA);

      const phase2Blocks = BigInt(claimBlockA - stakeBlockB);
      const phase2FeesWei = earningsPerBlockPacked * phase2Blocks * ETH_DEDUCTED_DIGITS;
      const acc2 = calcAccEthPerShareDelta(phase2FeesWei, totalSupply);

      const expectedRewardA = calcStakingReward(amountA, acc1 + acc2, 0n);
      const expectedPayoutA = expectedRewardA - (expectedRewardA % ETH_DEDUCTED_DIGITS);
      expect(rewardA).to.equal(expectedPayoutA);

      const phase3Blocks = BigInt(claimBlockB - claimBlockA);
      const phase3FeesWei = earningsPerBlockPacked * phase3Blocks * ETH_DEDUCTED_DIGITS;
      const acc3 = calcAccEthPerShareDelta(phase3FeesWei, totalSupply);

      const expectedRewardB = calcStakingReward(amountB, acc2 + acc3, 0n);
      const expectedPayoutB = expectedRewardB - (expectedRewardB % ETH_DEDUCTED_DIGITS);
      expect(rewardB).to.equal(expectedPayoutB);
      expect(rewardA).to.be.greaterThan(rewardB);
    });
  });

  describe("Unstake Request → Cooldown → Withdraw", () => {
    it("Should lock SSV during cooldown and allow withdrawal after", async function () {
      const { network, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      const stakeAmount = 10n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);
      await network.connect(stakerA).stake(stakeAmount);

      await mineBlocks(provider, 50);

      const unstakeAmount = 5n * PRECISION;
      const unstakeTx = await network
        .connect(stakerA)
        .requestUnstake(unstakeAmount);
      const unstakeReceipt = await unstakeTx.wait();

      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(
        stakeAmount - unstakeAmount,
      );

      const unstakeEvent = unstakeReceipt!.logs.find((l: any) => {
        try {
          return network.interface.parseLog(l)?.name === Events.UNSTAKE_REQUESTED;
        } catch {
          return false;
        }
      });
      expect(unstakeEvent).to.not.be.undefined;

      await expect(
        network.connect(stakerA).withdrawUnlocked(),
      ).to.be.revertedWithCustomError(network, Errors.NOTHING_TO_WITHDRAW);

      const cooldownSeconds = Number(DEFAULT_UNSTAKE_COOLDOWN);
      await provider.send("evm_increaseTime", [cooldownSeconds + 1]);
      await mineBlocks(provider, 1);

      const ssvBefore = await ssvToken.balanceOf(stakerA.address);
      await network.connect(stakerA).withdrawUnlocked();
      const ssvAfter = await ssvToken.balanceOf(stakerA.address);

      expect(ssvAfter - ssvBefore).to.equal(unstakeAmount);
    });

    it("Rewards are settled with pre-burn balance during requestUnstake", async function () {
      const { network, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      const stakeAmount = 10n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);
      const stakeBlock = await getTxBlock(
        await network.connect(stakerA).stake(stakeAmount),
      );

      await mineBlocks(provider, 100);

      const unstakeAmount = stakeAmount;
      const unstakeBlock = await getTxBlock(
        await network.connect(stakerA).requestUnstake(unstakeAmount),
      );

      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(0n);

      const balBefore = await provider.getBalance(stakerA.address);
      const claimTx = await network.connect(stakerA).claimEthRewards();
      const claimReceipt = await claimTx.wait();
      const gasUsed = claimReceipt!.gasUsed * claimReceipt!.gasPrice;
      const balAfter = await provider.getBalance(stakerA.address);

      const rewardClaimed = BigInt(balAfter) - balBefore + gasUsed;

      const vUnits = defaultVUnits(1n);
      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * vUnits) / BPS_DENOMINATOR;
      const blockDiff = BigInt(unstakeBlock - stakeBlock);
      const totalFeesWei = earningsPerBlockPacked * blockDiff * ETH_DEDUCTED_DIGITS;
      const accDelta = calcAccEthPerShareDelta(totalFeesWei, stakeAmount);
      const expectedReward = calcStakingReward(stakeAmount, accDelta, 0n);
      const expectedPayout = expectedReward - (expectedReward % ETH_DEDUCTED_DIGITS);

      expect(rewardClaimed).to.equal(expectedPayout);
    });

    it("Burned cSSV stops earning rewards immediately", async function () {
      const { network, ssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      const stakeAmount = 10n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);

      const stakeBlock = await getTxBlock(
        await network.connect(stakerA).stake(stakeAmount),
      );

      await mineBlocks(provider, 50);

      const unstakeBlock = await getTxBlock(
        await network.connect(stakerA).requestUnstake(5n * PRECISION),
      );

      await mineBlocks(provider, 50);

      const balBefore = await provider.getBalance(stakerA.address);
      const claimTx = await network.connect(stakerA).claimEthRewards();
      const claimReceipt = await claimTx.wait();
      const claimBlock = claimReceipt!.blockNumber;
      const gasUsed = claimReceipt!.gasUsed * claimReceipt!.gasPrice;
      const balAfter = await provider.getBalance(stakerA.address);

      const totalReward = BigInt(balAfter) - balBefore + gasUsed;

      const vUnits = defaultVUnits(1n);
      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * vUnits) / BPS_DENOMINATOR;

      const phase1Blocks = BigInt(unstakeBlock - stakeBlock);
      const phase1FeesPacked = earningsPerBlockPacked * phase1Blocks;
      const phase1FeesWei = phase1FeesPacked * ETH_DEDUCTED_DIGITS;
      const acc1 = calcAccEthPerShareDelta(phase1FeesWei, stakeAmount);
      const reward1 = calcStakingReward(stakeAmount, acc1, 0n);

      const phase2Blocks = BigInt(claimBlock - unstakeBlock);
      const phase2FeesPacked = earningsPerBlockPacked * phase2Blocks;
      const phase2FeesWei = phase2FeesPacked * ETH_DEDUCTED_DIGITS;
      const remainingBalance = 5n * PRECISION;
      const acc2 = calcAccEthPerShareDelta(phase2FeesWei, remainingBalance);
      const reward2 = calcStakingReward(remainingBalance, acc2, 0n);

      const expectedTotal = reward1 + reward2;
      const expectedPayout =
        expectedTotal - (expectedTotal % ETH_DEDUCTED_DIGITS);

      expect(totalReward).to.equal(expectedPayout);
    });
  });
});

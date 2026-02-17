/**
 * ES-15: Basic Stake → Earn → Claim Cycle
 * ES-16: Multiple Stakers — Pro-Rata Distribution
 * ES-17: Stake Timing Matters — Late Joiner
 * ES-18: Unstake Request → Cooldown → Withdraw
 */

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  whitelistAddresses,
} from "../../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
  NETWORK_FEE,
  VUNITS_PRECISION,
  ETH_DEDUCTED_DIGITS,
  STAKE_AMOUNT,
  DEFAULT_UNSTAKE_COOLDOWN,
} from "../../common/constants.ts";
import {
  mineBlocks,
  getBlockNumber,
  getTxBlock,
  calcClusterBurn,
  calcAccEthPerShareDelta,
  calcStakingReward,
  defaultVUnits,
} from "../helpers/index.ts";

const PRECISION = 10n ** 18n;
// The fixture sets updateNetworkFee(NETWORK_FEE), so the packed ETH network fee is NETWORK_FEE / ETH_DEDUCTED_DIGITS
const PACKED_NETWORK_FEE = NETWORK_FEE / ETH_DEDUCTED_DIGITS;

describe("E2E Staking Lifecycle (ES-15, ES-16, ES-17, ES-18)", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let provider: any;

  let deployer: HardhatEthersSigner;
  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let stakerA: HardhatEthersSigner;
  let stakerB: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [deployer, operatorOwner, clusterOwner, stakerA, stakerB] =
      await connection.ethers.getSigners();
    provider = connection.ethers.provider;
  });

  const deployFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  // ───────────────────────────────────────────────────────────────────
  // ES-15: Basic Stake → Earn → Claim Cycle
  // ───────────────────────────────────────────────────────────────────
  describe("ES-15: Basic Stake → Earn → Claim Cycle", () => {
    it("should allow a user to stake SSV, earn network fee revenue, and claim ETH rewards", async function () {
      const { network, views, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      // 1. Register 4 operators and create a cluster with 1 validator
      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n).toString(16),
      ]);

      // Record block before registering validator
      const preRegBlock = await getBlockNumber(provider);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // At this point, network fees are accruing. Let some blocks pass
      // before staking so we can verify pre-stake fees are NOT claimable.
      await mineBlocks(provider, 50);

      // 2. Fund staker and stake SSV
      const stakeAmount = 10n * PRECISION; // 10e18 SSV
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);

      const stakeBlock = await getTxBlock(
        await network.connect(stakerA).stake(stakeAmount),
      );

      // Verify cSSV minted
      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(stakeAmount);
      expect(await cssvToken.totalSupply()).to.equal(stakeAmount);

      // 3. Advance 100 blocks to accrue more fees
      await mineBlocks(provider, 100);

      // 4. Claim rewards
      const balBefore = await provider.getBalance(stakerA.address);
      const claimTx = await network.connect(stakerA).claimEthRewards();
      const claimReceipt = await claimTx.wait();
      const claimBlock = claimReceipt.blockNumber;
      const gasUsed = claimReceipt.gasUsed * claimReceipt.gasPrice;
      const balAfter = await provider.getBalance(stakerA.address);

      // Calculate expected fees for the blocks staker was active
      // daoTotalEthVUnits = 1 validator * VUNITS_PRECISION = 10_000
      const vUnits = defaultVUnits(1n);
      const blockDiff = BigInt(claimBlock - stakeBlock);

      // DAO earnings per block (packed) = (networkFee * daoTotalEthVUnits) / VUNITS_PRECISION
      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * vUnits) / VUNITS_PRECISION;
      const totalEarningsPacked = earningsPerBlockPacked * blockDiff;
      const totalEarningsWei = totalEarningsPacked * ETH_DEDUCTED_DIGITS;

      // accEthPerShare delta
      const accDelta = calcAccEthPerShareDelta(totalEarningsWei, stakeAmount);
      // reward
      const expectedReward = calcStakingReward(stakeAmount, accDelta, 0n);
      // Payout truncated to nearest ETH_DEDUCTED_DIGITS
      const expectedPayout = expectedReward - (expectedReward % ETH_DEDUCTED_DIGITS);

      const ethReceived = balAfter - balBefore + gasUsed;
      expect(ethReceived).to.equal(expectedPayout);

      // 5. Verify pre-stake fees are NOT included (accEthPerShare was 0 when user staked
      //    because totalSupply was 0 before stake → no accEthPerShare update)
      // The staker only gets fees from stakeBlock to claimBlock
    });

    it("pre-stake fees when cSSV supply is zero are permanently locked", async function () {
      const { network, views, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n).toString(16),
      ]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // Let fees accrue for 50 blocks with 0 cSSV supply
      await mineBlocks(provider, 50);

      // Now stake
      const stakeAmount = 10n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);

      const stakeBlock = await getTxBlock(
        await network.connect(stakerA).stake(stakeAmount),
      );

      // Let 100 more blocks pass
      await mineBlocks(provider, 100);

      // Claim
      const balBefore = await provider.getBalance(stakerA.address);
      const claimTx = await network.connect(stakerA).claimEthRewards();
      const claimReceipt = await claimTx.wait();
      const claimBlock = claimReceipt.blockNumber;
      const gasUsed = claimReceipt.gasUsed * claimReceipt.gasPrice;
      const balAfter = await provider.getBalance(stakerA.address);

      // User should only get fees for blocks stakeBlock to claimBlock
      const blockDiff = BigInt(claimBlock - stakeBlock);
      const vUnits = defaultVUnits(1n);
      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * vUnits) / VUNITS_PRECISION;
      const totalEarningsPacked = earningsPerBlockPacked * blockDiff;
      const totalEarningsWei = totalEarningsPacked * ETH_DEDUCTED_DIGITS;

      const accDelta = calcAccEthPerShareDelta(totalEarningsWei, stakeAmount);
      const expectedReward = calcStakingReward(stakeAmount, accDelta, 0n);
      const expectedPayout = expectedReward - (expectedReward % ETH_DEDUCTED_DIGITS);

      const ethReceived = balAfter - balBefore + gasUsed;
      expect(ethReceived).to.equal(expectedPayout);

      // The pre-stake fees (50 blocks worth) are NOT included in the payout.
      // Verify by computing total fees (pre + post) and checking received < total.
      const preStakeBlocks = BigInt(stakeBlock) - BigInt(stakeBlock - 50); // rough
      // This is implicit from the fact we only earned post-stake blocks
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // ES-16: Multiple Stakers — Pro-Rata Distribution
  // ───────────────────────────────────────────────────────────────────
  describe("ES-16: Multiple Stakers — Pro-Rata Distribution", () => {
    it("should distribute rewards proportionally: A gets 25%, B gets 75% with 10:30 ratio", async function () {
      const { network, views, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n).toString(16),
      ]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // Both stake in the same block to get clean pro-rata
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

      // Stake A
      const stakeBlockA = await getTxBlock(
        await network.connect(stakerA).stake(amountA),
      );

      // Stake B (next block, but _syncFees delta is ~0 since only 1 block passed)
      const stakeBlockB = await getTxBlock(
        await network.connect(stakerB).stake(amountB),
      );

      // Advance 100 blocks
      await mineBlocks(provider, 100);

      // Claim A
      const balBeforeA = await provider.getBalance(stakerA.address);
      const claimTxA = await network.connect(stakerA).claimEthRewards();
      const claimReceiptA = await claimTxA.wait();
      const gasA = claimReceiptA.gasUsed * claimReceiptA.gasPrice;
      const balAfterA = await provider.getBalance(stakerA.address);
      const rewardA = balAfterA - balBeforeA + gasA;

      // Claim B
      const balBeforeB = await provider.getBalance(stakerB.address);
      const claimTxB = await network.connect(stakerB).claimEthRewards();
      const claimReceiptB = await claimTxB.wait();
      const gasB = claimReceiptB.gasUsed * claimReceiptB.gasPrice;
      const balAfterB = await provider.getBalance(stakerB.address);
      const rewardB = balAfterB - balBeforeB + gasB;

      // Exact calculation with 3 phases:
      // Phase 1: stakeBlockA → stakeBlockB, supply = amountA (only A)
      // Phase 2: stakeBlockB → claimBlockA, supply = totalStaked (A + B)
      // Phase 3: claimBlockA → claimBlockB (1 block), supply = totalStaked (A + B)
      const vUnits = defaultVUnits(1n);
      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * vUnits) / VUNITS_PRECISION;

      // Phase 1: A is sole staker
      const phase1Blocks = BigInt(stakeBlockB - stakeBlockA);
      const phase1FeesWei = earningsPerBlockPacked * phase1Blocks * ETH_DEDUCTED_DIGITS;
      const acc1 = calcAccEthPerShareDelta(phase1FeesWei, amountA);

      // Phase 2: both staked, from stakeBlockB to claimBlockA
      const claimBlockA = claimReceiptA.blockNumber;
      const claimBlockB = claimReceiptB.blockNumber;
      const phase2Blocks = BigInt(claimBlockA - stakeBlockB);
      const phase2FeesWei = earningsPerBlockPacked * phase2Blocks * ETH_DEDUCTED_DIGITS;
      const acc2 = calcAccEthPerShareDelta(phase2FeesWei, totalStaked);

      // A's total accEthPerShare = acc1 + acc2, userIndex = 0
      const expectedRewardA = calcStakingReward(amountA, acc1 + acc2, 0n);
      const expectedPayoutA = expectedRewardA - (expectedRewardA % ETH_DEDUCTED_DIGITS);
      expect(rewardA).to.equal(expectedPayoutA);

      // Phase 3: claimBlockA → claimBlockB (1 block), for B
      const phase3Blocks = BigInt(claimBlockB - claimBlockA);
      const phase3FeesWei = earningsPerBlockPacked * phase3Blocks * ETH_DEDUCTED_DIGITS;
      const acc3 = calcAccEthPerShareDelta(phase3FeesWei, totalStaked);

      // B's accEthPerShare = acc2 + acc3 (B's userIndex = acc1, set at stakeBlockB)
      // B joined when accEthPerShare = acc1, so B's reward = amountB * (acc1+acc2+acc3 - acc1) / 1e18
      const expectedRewardB = calcStakingReward(amountB, acc2 + acc3, 0n);
      const expectedPayoutB = expectedRewardB - (expectedRewardB % ETH_DEDUCTED_DIGITS);
      expect(rewardB).to.equal(expectedPayoutB);
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // ES-17: Stake Timing Matters — Late Joiner
  // ───────────────────────────────────────────────────────────────────
  describe("ES-17: Stake Timing Matters — Late Joiner", () => {
    it("late joiner B does NOT capture fees from before they staked", async function () {
      const { network, views, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n).toString(16),
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

      // Phase 1: User A stakes at block 0 (relative)
      const stakeBlockA = await getTxBlock(
        await network.connect(stakerA).stake(amountA),
      );

      // Phase 1: 50 blocks pass with only A staked
      await mineBlocks(provider, 50);

      // Phase 2: User B stakes at block ~50
      const stakeBlockB = await getTxBlock(
        await network.connect(stakerB).stake(amountB),
      );

      // Phase 2: 50 more blocks pass with both staked
      await mineBlocks(provider, 50);

      // Both claim
      const balBeforeA = await provider.getBalance(stakerA.address);
      const claimTxA = await network.connect(stakerA).claimEthRewards();
      const claimReceiptA = await claimTxA.wait();
      const claimBlockA = claimReceiptA.blockNumber;
      const gasA = claimReceiptA.gasUsed * claimReceiptA.gasPrice;
      const balAfterA = await provider.getBalance(stakerA.address);
      const rewardA = balAfterA - balBeforeA + gasA;

      const balBeforeB = await provider.getBalance(stakerB.address);
      const claimTxB = await network.connect(stakerB).claimEthRewards();
      const claimReceiptB = await claimTxB.wait();
      const claimBlockB = claimReceiptB.blockNumber;
      const gasB = claimReceiptB.gasUsed * claimReceiptB.gasPrice;
      const balAfterB = await provider.getBalance(stakerB.address);
      const rewardB = balAfterB - balBeforeB + gasB;

      // Exact calculation:
      // Phase 1: stakeBlockA → stakeBlockB, supply = amountA (only A)
      // Phase 2: stakeBlockB → claimBlockA, supply = amountA + amountB
      // Phase 3: claimBlockA → claimBlockB (1 block), supply = amountA + amountB
      const vUnits = defaultVUnits(1n);
      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * vUnits) / VUNITS_PRECISION;
      const totalSupply = amountA + amountB;

      // Phase 1: A is sole staker
      const phase1Blocks = BigInt(stakeBlockB - stakeBlockA);
      const phase1FeesWei = earningsPerBlockPacked * phase1Blocks * ETH_DEDUCTED_DIGITS;
      const acc1 = calcAccEthPerShareDelta(phase1FeesWei, amountA);

      // Phase 2: both staked, from stakeBlockB to claimBlockA
      const phase2Blocks = BigInt(claimBlockA - stakeBlockB);
      const phase2FeesWei = earningsPerBlockPacked * phase2Blocks * ETH_DEDUCTED_DIGITS;
      const acc2 = calcAccEthPerShareDelta(phase2FeesWei, totalSupply);

      // A's reward: accEthPerShare = acc1 + acc2, userIndex = 0
      const expectedRewardA = calcStakingReward(amountA, acc1 + acc2, 0n);
      const expectedPayoutA = expectedRewardA - (expectedRewardA % ETH_DEDUCTED_DIGITS);
      expect(rewardA).to.equal(expectedPayoutA);

      // Phase 3: claimBlockA → claimBlockB (1 block)
      const phase3Blocks = BigInt(claimBlockB - claimBlockA);
      const phase3FeesWei = earningsPerBlockPacked * phase3Blocks * ETH_DEDUCTED_DIGITS;
      const acc3 = calcAccEthPerShareDelta(phase3FeesWei, totalSupply);

      // B's reward: B joined when accEthPerShare = acc1, so B's accumulated = acc2 + acc3
      const expectedRewardB = calcStakingReward(amountB, acc2 + acc3, 0n);
      const expectedPayoutB = expectedRewardB - (expectedRewardB % ETH_DEDUCTED_DIGITS);
      expect(rewardB).to.equal(expectedPayoutB);

      // A should earn more than B despite having 10 vs 30 SSV staked
      // because A was solo for first ~50 blocks
      expect(rewardA).to.be.greaterThan(rewardB);
    });
  });

  // ───────────────────────────────────────────────────────────────────
  // ES-18: Unstake Request → Cooldown → Withdraw
  // ───────────────────────────────────────────────────────────────────
  describe("ES-18: Unstake Request → Cooldown → Withdraw", () => {
    it("should lock SSV during cooldown and allow withdrawal after", async function () {
      const { network, views, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n).toString(16),
      ]);

      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );

      // Stake
      const stakeAmount = 10n * PRECISION;
      await ssvToken.connect(deployer).transfer(stakerA.address, stakeAmount);
      await ssvToken
        .connect(stakerA)
        .approve(await network.getAddress(), stakeAmount);
      await network.connect(stakerA).stake(stakeAmount);

      // Let some blocks pass to accrue rewards
      await mineBlocks(provider, 50);

      // Request unstake for half
      const unstakeAmount = 5n * PRECISION;
      const unstakeTx = await network
        .connect(stakerA)
        .requestUnstake(unstakeAmount);
      const unstakeReceipt = await unstakeTx.wait();

      // Verify cSSV burned
      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(
        stakeAmount - unstakeAmount,
      );

      // Verify event
      const unstakeEvent = unstakeReceipt.logs.find((l: any) => {
        try {
          return network.interface.parseLog(l)?.name === "UnstakeRequested";
        } catch {
          return false;
        }
      });
      expect(unstakeEvent).to.not.be.undefined;

      // Try to withdraw immediately — should get nothing (cooldown active)
      await expect(
        network.connect(stakerA).withdrawUnlocked(),
      ).to.be.revertedWithCustomError(network, "NothingToWithdraw");

      // Advance past cooldown (DEFAULT_UNSTAKE_COOLDOWN is in seconds)
      const cooldownSeconds = Number(DEFAULT_UNSTAKE_COOLDOWN);
      await provider.send("evm_increaseTime", [cooldownSeconds + 1]);
      await mineBlocks(provider, 1);

      // Now withdraw should succeed
      const ssvBefore = await ssvToken.balanceOf(stakerA.address);
      await network.connect(stakerA).withdrawUnlocked();
      const ssvAfter = await ssvToken.balanceOf(stakerA.address);

      expect(ssvAfter - ssvBefore).to.equal(unstakeAmount);
    });

    it("rewards are settled with pre-burn balance during requestUnstake", async function () {
      const { network, views, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n).toString(16),
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

      // Request unstake for ALL (tests _settleWithBalance with full amount)
      const unstakeAmount = stakeAmount;
      const unstakeBlock = await getTxBlock(
        await network.connect(stakerA).requestUnstake(unstakeAmount),
      );

      // cSSV should be 0 now
      expect(await cssvToken.balanceOf(stakerA.address)).to.equal(0n);

      // Claim rewards should still work (accrued during the settle before burn)
      const balBefore = await provider.getBalance(stakerA.address);
      const claimTx = await network.connect(stakerA).claimEthRewards();
      const claimReceipt = await claimTx.wait();
      const claimBlock = claimReceipt.blockNumber;
      const gasUsed = claimReceipt.gasUsed * claimReceipt.gasPrice;
      const balAfter = await provider.getBalance(stakerA.address);

      const rewardClaimed = balAfter - balBefore + gasUsed;

      // Exact calculation: fees accrued from stakeBlock → unstakeBlock
      // (requestUnstake settled with pre-burn balance of 10e18)
      // After burn, cSSV = 0, so claimBlock → unstakeBlock earns nothing extra
      // But claimEthRewards does _syncFees for 1 block (unstakeBlock → claimBlock),
      // and with totalSupply = 0 the accEthPerShare doesn't change.
      // So the claim only pays out the accrued amount from requestUnstake settlement.
      const vUnits = defaultVUnits(1n);
      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * vUnits) / VUNITS_PRECISION;
      const blockDiff = BigInt(unstakeBlock - stakeBlock);
      const totalFeesWei = earningsPerBlockPacked * blockDiff * ETH_DEDUCTED_DIGITS;
      const accDelta = calcAccEthPerShareDelta(totalFeesWei, stakeAmount);
      const expectedReward = calcStakingReward(stakeAmount, accDelta, 0n);
      const expectedPayout = expectedReward - (expectedReward % ETH_DEDUCTED_DIGITS);

      expect(rewardClaimed).to.equal(expectedPayout);
    });

    it("burned cSSV stops earning rewards immediately", async function () {
      const { network, views, ssvToken, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 4);
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwner.address,
      ]);
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n).toString(16),
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

      // Unstake half
      const unstakeBlock = await getTxBlock(
        await network.connect(stakerA).requestUnstake(5n * PRECISION),
      );

      // Advance 50 more blocks — only 5e18 cSSV earns
      await mineBlocks(provider, 50);

      // Claim
      const balBefore = await provider.getBalance(stakerA.address);
      const claimTx = await network.connect(stakerA).claimEthRewards();
      const claimReceipt = await claimTx.wait();
      const claimBlock = claimReceipt.blockNumber;
      const gasUsed = claimReceipt.gasUsed * claimReceipt.gasPrice;
      const balAfter = await provider.getBalance(stakerA.address);

      const totalReward = balAfter - balBefore + gasUsed;

      // Calculate expected:
      // Phase 1 (stakeBlock to unstakeBlock): 10e18 cSSV earning on all fees
      // Phase 2 (unstakeBlock to claimBlock): 5e18 cSSV earning on all fees
      // Both phases have totalSupply changing at unstakeBlock
      const vUnits = defaultVUnits(1n);
      const earningsPerBlockPacked = (PACKED_NETWORK_FEE * vUnits) / VUNITS_PRECISION;

      // Phase 1: blocks stakeBlock → unstakeBlock, totalSupply = 10e18
      const phase1Blocks = BigInt(unstakeBlock - stakeBlock);
      const phase1FeesPacked = earningsPerBlockPacked * phase1Blocks;
      const phase1FeesWei = phase1FeesPacked * ETH_DEDUCTED_DIGITS;
      const acc1 = calcAccEthPerShareDelta(phase1FeesWei, stakeAmount);
      const reward1 = calcStakingReward(stakeAmount, acc1, 0n);

      // Phase 2: blocks unstakeBlock → claimBlock, totalSupply = 5e18
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

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { defaultStakingFixture } from "../../helpers/fixture-presets.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext } from "../../common/helpers.ts";
import { ssvStakingHarnessFixture } from "../../setup/fixtures.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { STAKE_AMOUNT, ETH_DEDUCTED_DIGITS } from "../../common/constants.ts";
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVStaking function `claimEthRewards()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let staker: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [staker] } = await setupTestContext());
  });

  const stakeAndAccrueRewards = async () => {
    const { staking, ssvToken, cssvToken } = await defaultStakingFixture(connection);
    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await trackGas(
      staking.stake(STAKE_AMOUNT),
      [GasGroup.STAKE_SSV]
    );

    const rewardAmount = 10_000_000_000n;
    await staking.mockSetStakingEthPoolBalance(0);
    await staking.mockSetEthDaoBalance(rewardAmount);

    const stakingAddress = await staking.getAddress();
    await staker.sendTransaction({
      to: stakingAddress,
      value: connection.ethers.parseEther("1"),
    });

    return { staking, ssvToken, cssvToken, rewardAmount };
  };

  it("Claims accrued ETH rewards and emits RewardsClaimed event with correct args", async function () {
    const { staking } = await networkHelpers.loadFixture(stakeAndAccrueRewards);
  
    const accruedAmount = connection.ethers.parseEther("0.1");
    await staking.mockSetUserAccrued(staker.address, accruedAmount);
    const expectedPayout = accruedAmount - (accruedAmount % ETH_DEDUCTED_DIGITS);
    const expectedPayoutShrunk = expectedPayout / ETH_DEDUCTED_DIGITS;
    await staking.mockSetStakingEthPoolBalance(expectedPayoutShrunk + 1_000_000n);
    await staking.mockSetEthDaoBalance(expectedPayoutShrunk + 1_000_000n);
  
    const ethBalanceBefore = await connection.ethers.provider.getBalance(staker.address);
    const poolBalanceBefore = await staking.getStakingEthPoolBalance();
    const daoBalanceBefore = await staking.getEthDaoBalance();
  
    const tx = await trackGas(
      staking.claimEthRewards(),
      [GasGroup.CLAIM_ETH_REWARDS, GasGroup.SYNC_FEES]
    );
  
    await expect(tx)
      .to.emit(staking, Events.REWARDS_CLAIMED)
      .withArgs(staker.address, expectedPayout);
    const ethBalanceAfter = await connection.ethers.provider.getBalance(staker.address);
    const gasUsed = BigInt(tx.gasUsed) * BigInt(tx.gasPrice);
    expect(ethBalanceAfter + gasUsed - ethBalanceBefore).to.equal(expectedPayout);
    const poolBalanceAfter = await staking.getStakingEthPoolBalance();
    const daoBalanceAfter = await staking.getEthDaoBalance();
    expect(poolBalanceBefore - poolBalanceAfter).to.equal(expectedPayoutShrunk);
    expect(daoBalanceBefore - daoBalanceAfter).to.equal(expectedPayoutShrunk);
  });

  it("Keeps remainder in accrued when user still holds cSSV (precision handling)", async function () {
    const { staking } = await networkHelpers.loadFixture(stakeAndAccrueRewards);
    const accruedAmount = 123_456_789n;
    await staking.mockSetUserAccrued(staker.address, accruedAmount);
    await staking.mockSetStakingEthPoolBalance(100_000_000_000n);
    await staking.mockSetEthDaoBalance(100_000_000_000n);

    await trackGas(
      staking.claimEthRewards(),
      [GasGroup.CLAIM_ETH_REWARDS, GasGroup.SYNC_FEES]
    );

    const expectedRemainder = accruedAmount % ETH_DEDUCTED_DIGITS; 
    const accruedAfter = await staking.getUserAccrued(staker.address);
    expect(accruedAfter).to.equal(expectedRemainder);
  });

  it("Zeros dust in accrued when user holds 0 cSSV after full transfer (SEC-16b)", async function () {
    const { staking, ssvToken, cssvToken } = await ssvStakingHarnessFixture(connection);
    const [, receiver] = await connection.ethers.getSigners();

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    await cssvToken.transfer(receiver.address, STAKE_AMOUNT);
    expect(await cssvToken.balanceOf(staker.address)).to.equal(0n);

    const accruedWithDust = 1_234_599_999n; // payout = 1_234_500_000, dust = 99_999
    const packedPayout = accruedWithDust / ETH_DEDUCTED_DIGITS; // 12345
    await staking.mockSetUserAccrued(staker.address, accruedWithDust);
    await staking.mockSetStakingEthPoolBalance(packedPayout + 1_000_000n);
    await staking.mockSetEthDaoBalance(packedPayout + 1_000_000n);

    const stakingAddress = await staking.getAddress();
    await staker.sendTransaction({ to: stakingAddress, value: connection.ethers.parseEther("1") });

    await staking.claimEthRewards();

    const accruedAfter = await staking.getUserAccrued(staker.address);
    expect(accruedAfter).to.equal(0n);
  });

  it("Keeps remainder when user still holds cSSV despite dust (SEC-16b no false positive)", async function () {
    const { staking, ssvToken, cssvToken } = await ssvStakingHarnessFixture(connection);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    expect(await cssvToken.balanceOf(staker.address)).to.equal(STAKE_AMOUNT);

    const accruedWithDust = 1_234_599_999n;
    const packedPayout = accruedWithDust / ETH_DEDUCTED_DIGITS;
    await staking.mockSetUserAccrued(staker.address, accruedWithDust);
    await staking.mockSetStakingEthPoolBalance(packedPayout + 1_000_000n);
    await staking.mockSetEthDaoBalance(packedPayout + 1_000_000n);

    const stakingAddress = await staking.getAddress();
    await staker.sendTransaction({ to: stakingAddress, value: connection.ethers.parseEther("1") });

    await staking.claimEthRewards();

    const expectedRemainder = accruedWithDust % ETH_DEDUCTED_DIGITS;
    const accruedAfter = await staking.getUserAccrued(staker.address);
    expect(accruedAfter).to.equal(expectedRemainder);
  });

  it("Is reverted with 'NothingToClaim' when there are no rewards", async function () {
    const { staking, ssvToken } = await defaultStakingFixture(connection);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    await expect(staking.claimEthRewards()).to.be.revertedWithCustomError(
      staking,
      Errors.NOTHING_TO_CLAIM
    );
  });

  it("Is reverted with 'NothingToClaim' when accrued amount is too small to payout", async function () {
    const { staking, ssvToken } = await defaultStakingFixture(connection);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    await staking.mockSetStakingEthPoolBalance(0n);
    await staking.mockSetEthDaoBalance(0n);

    const tinyAmount = 99_999n;
    await staking.mockSetUserAccrued(staker.address, tinyAmount);

    await expect(staking.claimEthRewards()).to.be.revertedWithCustomError(
      staking,
      Errors.NOTHING_TO_CLAIM
    );
  });

  it("Is reverted with 'InsufficientBalance' when staking pool has insufficient balance", async function () {
    const { staking } = await networkHelpers.loadFixture(stakeAndAccrueRewards);

    const accruedAmount = connection.ethers.parseEther("0.1");
    await staking.mockSetUserAccrued(staker.address, accruedAmount);
    await staking.mockSetStakingEthPoolBalance(1n);
    await staking.mockSetEthDaoBalance(1n);

    await expect(staking.claimEthRewards()).to.be.revertedWithCustomError(
      staking,
      Errors.INSUFFICIENT_BALANCE
    );
  });

  it("Syncs fees before claiming", async function () {
    const { staking, ssvToken } = await defaultStakingFixture(connection);
    
    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await trackGas(
      staking.stake(STAKE_AMOUNT),
      [GasGroup.STAKE_SSV]
    );
    
    const stakingAddress = await staking.getAddress();
    await staker.sendTransaction({
      to: stakingAddress,
      value: connection.ethers.parseEther("1"),
    });
    const newFees = 1_000n;
    await staking.mockSetUserAccrued(staker.address, 0n);
    await staking.mockSetStakingEthPoolBalance(0n);
    await staking.mockSetEthDaoBalance(newFees);
    
    const tx = await trackGas(
      staking.claimEthRewards(),
      [GasGroup.CLAIM_ETH_REWARDS, GasGroup.SYNC_FEES]
    );
    
    await expect(tx).to.emit(staking, Events.FEES_SYNCED);
  });

  it("Stores updated accrued balance in storage after claiming", async function () {
    const { staking } = await networkHelpers.loadFixture(stakeAndAccrueRewards);
  
    const accruedBefore = connection.ethers.parseEther("0.1");
    await staking.mockSetUserAccrued(staker.address, accruedBefore);
    const packedPayout = accruedBefore / ETH_DEDUCTED_DIGITS;
    await staking.mockSetStakingEthPoolBalance(packedPayout + 1n);
    await staking.mockSetEthDaoBalance(packedPayout + 1n);
  
    await staking.claimEthRewards();
  
    const accruedAfter = await staking.getUserAccrued(staker.address);
    expect(accruedAfter).to.equal(0n);
  });

  it("Is reverted with 'InsufficientBalance' when ethDaoBalance is insufficient", async function () {
    const { staking } = await networkHelpers.loadFixture(stakeAndAccrueRewards);

    const accruedAmount = connection.ethers.parseEther("0.1");
    await staking.mockSetUserAccrued(staker.address, accruedAmount);
    await staking.mockSetStakingEthPoolBalance(100_000_000_000n);
    await staking.mockSetEthDaoBalance(1n);

    await expect(staking.claimEthRewards()).to.be.revertedWithCustomError(
      staking,
      Errors.INSUFFICIENT_BALANCE
    );
  });

  it("Allows multiple claims as rewards continue to accrue", async function () {
    const { staking, ssvToken } = await defaultStakingFixture(connection);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    const stakingAddress = await staking.getAddress();
    await staker.sendTransaction({
      to: stakingAddress,
      value: connection.ethers.parseEther("10"),
    });
    const firstAccrued = 100_000_000n;
    await staking.mockSetUserAccrued(staker.address, firstAccrued * ETH_DEDUCTED_DIGITS);
    await staking.mockSetStakingEthPoolBalance(firstAccrued);
    await staking.mockSetEthDaoBalance(firstAccrued);

    const tx1 = await staking.claimEthRewards();
    await expect(tx1).to.emit(staking, Events.REWARDS_CLAIMED);
    const secondAccrued = 200_000_000n;
    await staking.mockSetUserAccrued(staker.address, secondAccrued * ETH_DEDUCTED_DIGITS);
    await staking.mockSetStakingEthPoolBalance(secondAccrued);
    await staking.mockSetEthDaoBalance(secondAccrued);
    const tx2 = await staking.claimEthRewards();
    await expect(tx2).to.emit(staking, Events.REWARDS_CLAIMED);
  });

  it("Settles pending rewards before claiming", async function () {
    const { staking, ssvToken } = await defaultStakingFixture(connection);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    const stakingAddress = await staking.getAddress();
    await staker.sendTransaction({
      to: stakingAddress,
      value: connection.ethers.parseEther("10"),
    });
    const newFees = 1_000_000_000n;
    await staking.mockSetStakingEthPoolBalance(0n);
    await staking.mockSetEthDaoBalance(newFees);

    const userIndexBefore = await staking.getUserIndex(staker.address);
    const tx = await staking.claimEthRewards();

    await expect(tx).to.emit(staking, Events.REWARDS_CLAIMED);

    const userIndexAfter = await staking.getUserIndex(staker.address);
    expect(userIndexAfter).to.be.greaterThan(userIndexBefore);
  });

  it("Does not affect other users' accrued balances", async function () {
    const { staking, ssvToken } = await defaultStakingFixture(connection);
    const [, otherUser] = await connection.ethers.getSigners();
    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    await ssvToken.transfer(otherUser.address, STAKE_AMOUNT);
    await ssvToken.connect(otherUser).approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.connect(otherUser).stake(STAKE_AMOUNT);

    const stakingAddress = await staking.getAddress();
    await staker.sendTransaction({
      to: stakingAddress,
      value: connection.ethers.parseEther("10"),
    });
    const stakerAccrued = 100_000_000_000n;
    const otherAccrued = 200_000_000_000n;
    await staking.mockSetUserAccrued(staker.address, stakerAccrued);
    await staking.mockSetUserAccrued(otherUser.address, otherAccrued);
    await staking.mockSetStakingEthPoolBalance(50_000_000_000n);
    await staking.mockSetEthDaoBalance(50_000_000_000n);
    await staking.claimEthRewards();
    const otherAccruedAfter = await staking.getUserAccrued(otherUser.address);
    expect(otherAccruedAfter).to.equal(otherAccrued);
  });

  it("Zeros dust when user unstakes all cSSV then claims (SEC-16b unstake flow)", async function () {
    const { staking, ssvToken, cssvToken } = await ssvStakingHarnessFixture(connection);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    // Accrue sub-dust rewards
    const dustAmount = 50_000n; // Sub-ETH_DEDUCTED_DIGITS
    await staking.mockSetUserAccrued(staker.address, dustAmount);

    // Unstake ALL cSSV
    await staking.requestUnstake(STAKE_AMOUNT);
    expect(await cssvToken.balanceOf(staker.address)).to.equal(0n);

    // Claim should succeed with zero payout and zero dust (SEC-16b fix)
    const tx = await staking.claimEthRewards();
    await expect(tx)
      .to.emit(staking, Events.REWARDS_CLAIMED)
      .withArgs(staker.address, 0n); // Zero payout event

    // Verify dust was zeroed
    const accruedAfter = await staking.getUserAccrued(staker.address);
    expect(accruedAfter).to.equal(0n);
  });

  it("Zeros exactly 99,999 wei dust (max) when bal == 0 after full unstake (SEC-16b boundary)", async function () {
    const { staking, ssvToken, cssvToken } = await ssvStakingHarnessFixture(connection);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    const maxDust = ETH_DEDUCTED_DIGITS - 1n; // 99,999 wei
    await staking.mockSetUserAccrued(staker.address, maxDust);

    // Unstake ALL cSSV
    await staking.requestUnstake(STAKE_AMOUNT);
    expect(await cssvToken.balanceOf(staker.address)).to.equal(0n);

    // Claim should succeed with zero payout (SEC-16b fix)
    const tx = await staking.claimEthRewards();
    await expect(tx)
      .to.emit(staking, Events.REWARDS_CLAIMED)
      .withArgs(staker.address, 0n);

    const accruedAfter = await staking.getUserAccrued(staker.address);
    expect(accruedAfter).to.equal(0n);
  });

  it("Keeps remainder when user unstakes partial cSSV and claims (SEC-16b partial unstake)", async function () {
    const { staking, ssvToken, cssvToken } = await ssvStakingHarnessFixture(connection);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    // Unstake HALF cSSV
    await staking.requestUnstake(STAKE_AMOUNT / 2n);
    expect(await cssvToken.balanceOf(staker.address)).to.equal(STAKE_AMOUNT / 2n);

    // Accrue 150K wei (payout = 100K, remainder = 50K)
    const accruedWithRemainder = 150_000n;
    const expectedPayout = 100_000n;
    const expectedRemainder = 50_000n;

    await staking.mockSetUserAccrued(staker.address, accruedWithRemainder);
    await staking.mockSetStakingEthPoolBalance(expectedPayout / ETH_DEDUCTED_DIGITS + 1n);
    await staking.mockSetEthDaoBalance(expectedPayout / ETH_DEDUCTED_DIGITS + 1n);

    const stakingAddress = await staking.getAddress();
    await staker.sendTransaction({ to: stakingAddress, value: connection.ethers.parseEther("1") });

    await staking.claimEthRewards();

    // Should keep remainder (bal > 0)
    const accruedAfter = await staking.getUserAccrued(staker.address);
    expect(accruedAfter).to.equal(expectedRemainder);
  });

  it("Zeros dust after multiple partial cSSV transfers resulting in bal == 0 (SEC-16b multi-transfer)", async function () {
    const { staking, ssvToken, cssvToken } = await ssvStakingHarnessFixture(connection);
    const [, receiver] = await connection.ethers.getSigners();

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    // Transfer 25% cSSV
    await cssvToken.transfer(receiver.address, STAKE_AMOUNT / 4n);
    expect(await cssvToken.balanceOf(staker.address)).to.equal(STAKE_AMOUNT * 3n / 4n);

    // Transfer another 25% cSSV
    await cssvToken.transfer(receiver.address, STAKE_AMOUNT / 4n);
    expect(await cssvToken.balanceOf(staker.address)).to.equal(STAKE_AMOUNT / 2n);

    // Transfer remaining 50% cSSV
    await cssvToken.transfer(receiver.address, STAKE_AMOUNT / 2n);
    expect(await cssvToken.balanceOf(staker.address)).to.equal(0n);

    // Set sub-dust accrued
    await staking.mockSetUserAccrued(staker.address, 75_000n);

    // Claim should succeed with zero payout (SEC-16b fix)
    const tx = await staking.claimEthRewards();
    await expect(tx)
      .to.emit(staking, Events.REWARDS_CLAIMED)
      .withArgs(staker.address, 0n);

    const accruedAfter = await staking.getUserAccrued(staker.address);
    expect(accruedAfter).to.equal(0n);
  });

  it("Zeros exactly 99,999 wei remainder when bal == 0 but keeps it when bal > 0 (SEC-16b max dust)", async function () {
    const { staking, ssvToken, cssvToken } = await ssvStakingHarnessFixture(connection);
    const [, receiver] = await connection.ethers.getSigners();

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    // Scenario 1: User has cSSV, accrues 199,999 wei (payout = 100K, remainder = 99,999)
    const accruedAmount = 199_999n;
    const expectedPayout = 100_000n;
    const maxDust = ETH_DEDUCTED_DIGITS - 1n; // 99,999 wei

    await staking.mockSetUserAccrued(staker.address, accruedAmount);
    await staking.mockSetStakingEthPoolBalance(expectedPayout / ETH_DEDUCTED_DIGITS + 1n);
    await staking.mockSetEthDaoBalance(expectedPayout / ETH_DEDUCTED_DIGITS + 1n);

    const stakingAddress = await staking.getAddress();
    await staker.sendTransaction({ to: stakingAddress, value: connection.ethers.parseEther("1") });

    // Claim while bal > 0
    await staking.claimEthRewards();

    // Should keep max dust (bal > 0)
    let accruedAfter = await staking.getUserAccrued(staker.address);
    expect(accruedAfter).to.equal(maxDust);

    // Scenario 2: User transfers all cSSV, then claims with max dust
    await cssvToken.transfer(receiver.address, STAKE_AMOUNT);
    expect(await cssvToken.balanceOf(staker.address)).to.equal(0n);

    // Try to claim max dust with bal == 0 (should succeed with zero payout - SEC-16b fix)
    const tx2 = await staking.claimEthRewards();
    await expect(tx2)
      .to.emit(staking, Events.REWARDS_CLAIMED)
      .withArgs(staker.address, 0n);

    accruedAfter = await staking.getUserAccrued(staker.address);
    expect(accruedAfter).to.equal(0n);
  });

  it("Allows new accrual after dust was zeroed when user receives cSSV back (SEC-16b re-stake)", async function () {
    const { staking, ssvToken, cssvToken } = await ssvStakingHarnessFixture(connection);
    const [, receiver] = await connection.ethers.getSigners();

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    // Transfer all cSSV → dust zeroed scenario
    await cssvToken.transfer(receiver.address, STAKE_AMOUNT);
    expect(await cssvToken.balanceOf(staker.address)).to.equal(0n);

    await staking.mockSetUserAccrued(staker.address, 50_000n);

    // Claim should succeed with zero payout (SEC-16b fix)
    const firstClaim = await staking.claimEthRewards();
    await expect(firstClaim)
      .to.emit(staking, Events.REWARDS_CLAIMED)
      .withArgs(staker.address, 0n);
    expect(await staking.getUserAccrued(staker.address)).to.equal(0n);

    // Receive cSSV back
    await cssvToken.connect(receiver).transfer(staker.address, STAKE_AMOUNT);
    expect(await cssvToken.balanceOf(staker.address)).to.equal(STAKE_AMOUNT);

    // Accrue new rewards
    const newReward = 200_000_000n; // 200M wei
    await staking.mockSetUserAccrued(staker.address, newReward);
    await staking.mockSetStakingEthPoolBalance(newReward / ETH_DEDUCTED_DIGITS);
    await staking.mockSetEthDaoBalance(newReward / ETH_DEDUCTED_DIGITS);

    const stakingAddress = await staking.getAddress();
    await staker.sendTransaction({ to: stakingAddress, value: connection.ethers.parseEther("1") });

    // Claim should work (bal > 0, new rewards)
    const tx = await staking.claimEthRewards();
    await expect(tx).to.emit(staking, Events.REWARDS_CLAIMED);

    // Verify new accrual worked correctly (no interference from previous forfeit)
    const accruedAfter = await staking.getUserAccrued(staker.address);
    expect(accruedAfter).to.equal(0n); // All claimed (200M is exact multiple)
  });

  it("Storage state is clean after dust is zeroed (SEC-16b view consistency)", async function () {
    const { staking, ssvToken, cssvToken } = await ssvStakingHarnessFixture(connection);
    const [, receiver] = await connection.ethers.getSigners();

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    // Get initial user index after stake
    const initialIndex = await staking.getUserIndex(staker.address);

    await cssvToken.transfer(receiver.address, STAKE_AMOUNT);
    await staking.mockSetUserAccrued(staker.address, 50_000n);

    // Before claim: accrued should show dust
    const accruedBefore = await staking.getUserAccrued(staker.address);
    expect(accruedBefore).to.equal(50_000n);

    // Claim should succeed with zero payout (SEC-16b fix)
    const tx = await staking.claimEthRewards();
    await expect(tx)
      .to.emit(staking, Events.REWARDS_CLAIMED)
      .withArgs(staker.address, 0n);

    // After dust zeroed, accrued storage should be 0
    // This ensures view functions like previewClaimableEth return 0
    const accruedAfter = await staking.getUserAccrued(staker.address);
    expect(accruedAfter).to.equal(0n);

    // User index should still be synced (not reset)
    const userIndexAfter = await staking.getUserIndex(staker.address);
    expect(userIndexAfter).to.equal(initialIndex); // Index preserved, not reset to 0
  });

  it("Handles exact ETH_DEDUCTED_DIGITS boundary (100,000 wei) correctly (SEC-16b boundary)", async function () {
    const { staking, ssvToken } = await ssvStakingHarnessFixture(connection);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    const exactBoundary = ETH_DEDUCTED_DIGITS; // 100,000 wei
    await staking.mockSetUserAccrued(staker.address, exactBoundary);
    await staking.mockSetStakingEthPoolBalance(1n); // 1 packed unit
    await staking.mockSetEthDaoBalance(1n);

    const stakingAddress = await staking.getAddress();
    await staker.sendTransaction({ to: stakingAddress, value: connection.ethers.parseEther("1") });

    await staking.claimEthRewards();

    // Should have 0 remainder (exact payout, no dust)
    const accruedAfter = await staking.getUserAccrued(staker.address);
    expect(accruedAfter).to.equal(0n);
  });
});

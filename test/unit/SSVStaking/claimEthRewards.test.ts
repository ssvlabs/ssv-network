import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvStakingHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { STAKE_AMOUNT } from "../../common/constants.ts";
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVStaking function `claimEthRewards()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let staker: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [staker] = await connection.ethers.getSigners();
  });

  const stakeAndAccrueRewards = async () => {
    const { staking, ssvToken, cssvToken } = await ssvStakingHarnessFixture(connection);
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
    await staking.mockSetStakingEthPoolBalance(10_000_000_000n);
    await staking.mockSetEthDaoBalance(10_000_000_000n);

    const ethBalanceBefore = await connection.ethers.provider.getBalance(staker.address);
    const poolBalanceBefore = await staking.getStakingEthPoolBalance();
    const daoBalanceBefore = await staking.getEthDaoBalance();

    const tx = await trackGas(
      staking.claimEthRewards(),
      [GasGroup.CLAIM_ETH_REWARDS, GasGroup.SYNC_FEES]
    );

    // Payout is accrued rounded down to DEDUCTED_DIGITS (1e7)
    const expectedPayout = accruedAmount - (accruedAmount % 10_000_000n);
    const expectedPayoutShrunk = expectedPayout / 10_000_000n;

    await expect(tx)
      .to.emit(staking, Events.REWARDS_CLAIMED)
      .withArgs(staker.address, expectedPayout);

    // Verify ETH received (accounting for gas)
    const ethBalanceAfter = await connection.ethers.provider.getBalance(staker.address);
    const gasUsed = BigInt(tx.gasUsed) * BigInt(tx.gasPrice);
    expect(ethBalanceAfter + gasUsed - ethBalanceBefore).to.equal(expectedPayout);

    // Verify pool balances decreased
    const poolBalanceAfter = await staking.getStakingEthPoolBalance();
    const daoBalanceAfter = await staking.getEthDaoBalance();
    expect(poolBalanceBefore - poolBalanceAfter).to.equal(expectedPayoutShrunk);
    expect(daoBalanceBefore - daoBalanceAfter).to.equal(expectedPayoutShrunk);
  });

  it("Keeps remainder in accrued balance after claiming (precision handling)", async function () {
    const { staking } = await networkHelpers.loadFixture(stakeAndAccrueRewards);

    // Use an amount with a remainder when divided by DEDUCTED_DIGITS (1e7)
    const accruedAmount = 123_456_789n; // Payout = 120_000_000, remainder = 3_456_789
    await staking.mockSetUserAccrued(staker.address, accruedAmount);
    await staking.mockSetStakingEthPoolBalance(100_000_000_000n);
    await staking.mockSetEthDaoBalance(100_000_000_000n);

    await trackGas(
      staking.claimEthRewards(),
      [GasGroup.CLAIM_ETH_REWARDS, GasGroup.SYNC_FEES]
    );

    const expectedRemainder = accruedAmount % 10_000_000n; // 3_456_789
    const accruedAfter = await staking.getUserAccrued(staker.address);
    expect(accruedAfter).to.equal(expectedRemainder);
  });

  it("Is reverted with 'NothingToClaim' when there are no rewards", async function () {
    const { staking, ssvToken } = await ssvStakingHarnessFixture(connection);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    await expect(staking.claimEthRewards()).to.be.revertedWithCustomError(
      staking,
      Errors.NOTHING_TO_CLAIM
    );
  });

  it("Is reverted with 'NothingToClaim' when accrued amount is too small to payout", async function () {
    const { staking, ssvToken } = await ssvStakingHarnessFixture(connection);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    await staking.mockSetStakingEthPoolBalance(0n);
    await staking.mockSetEthDaoBalance(0n);

    const tinyAmount = 9_999_999n;
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
    const { staking, ssvToken } = await ssvStakingHarnessFixture(connection);

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

    const accruedAmount = connection.ethers.parseEther("0.01");
    await staking.mockSetUserAccrued(staker.address, accruedAmount);

    const sufficientBalance = 2_000_000_000n;
    await staking.mockSetStakingEthPoolBalance(sufficientBalance);
    await staking.mockSetEthDaoBalance(sufficientBalance + 1_000_000_000n);

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
    await staking.mockSetStakingEthPoolBalance(10_000_000_000n);
    await staking.mockSetEthDaoBalance(10_000_000_000n);

    await staking.claimEthRewards();

    const accruedAfter = await staking.getUserAccrued(staker.address);
    // 0.1 ETH is divisible by 1e7, so remainder should be 0
    expect(accruedAfter).to.equal(0n);
  });

  it("Is reverted with 'InsufficientBalance' when ethDaoBalance is insufficient", async function () {
    const { staking } = await networkHelpers.loadFixture(stakeAndAccrueRewards);

    const accruedAmount = connection.ethers.parseEther("0.1");
    await staking.mockSetUserAccrued(staker.address, accruedAmount);
    // stakingEthPoolBalance is sufficient, but ethDaoBalance is not
    await staking.mockSetStakingEthPoolBalance(100_000_000_000n);
    await staking.mockSetEthDaoBalance(1n);

    await expect(staking.claimEthRewards()).to.be.revertedWithCustomError(
      staking,
      Errors.INSUFFICIENT_BALANCE
    );
  });

  it("Allows multiple claims as rewards continue to accrue", async function () {
    const { staking, ssvToken } = await ssvStakingHarnessFixture(connection);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    const stakingAddress = await staking.getAddress();
    await staker.sendTransaction({
      to: stakingAddress,
      value: connection.ethers.parseEther("10"),
    });

    // First claim
    const firstAccrued = 100_000_000n; // 0.1 shrunk units = 1e9 wei
    await staking.mockSetUserAccrued(staker.address, firstAccrued * 10_000_000n);
    await staking.mockSetStakingEthPoolBalance(firstAccrued);
    await staking.mockSetEthDaoBalance(firstAccrued);

    const tx1 = await staking.claimEthRewards();
    await expect(tx1).to.emit(staking, Events.REWARDS_CLAIMED);

    // Accrue more rewards
    const secondAccrued = 200_000_000n;
    await staking.mockSetUserAccrued(staker.address, secondAccrued * 10_000_000n);
    await staking.mockSetStakingEthPoolBalance(secondAccrued);
    await staking.mockSetEthDaoBalance(secondAccrued);

    // Second claim
    const tx2 = await staking.claimEthRewards();
    await expect(tx2).to.emit(staking, Events.REWARDS_CLAIMED);
  });

  it("Settles pending rewards before claiming", async function () {
    const { staking, ssvToken } = await ssvStakingHarnessFixture(connection);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    const stakingAddress = await staking.getAddress();
    await staker.sendTransaction({
      to: stakingAddress,
      value: connection.ethers.parseEther("10"),
    });

    // Set up fees that will accrue rewards when synced
    const newFees = 1_000_000_000n;
    await staking.mockSetStakingEthPoolBalance(0n);
    await staking.mockSetEthDaoBalance(newFees);

    const userIndexBefore = await staking.getUserIndex(staker.address);

    // Claim should sync fees and settle, accruing rewards
    // Even with 0 pre-existing accrued, the sync+settle should accrue new rewards
    // Then the claim will process those rewards
    const tx = await staking.claimEthRewards();

    await expect(tx).to.emit(staking, Events.REWARDS_CLAIMED);

    const userIndexAfter = await staking.getUserIndex(staker.address);
    expect(userIndexAfter).to.be.greaterThan(userIndexBefore);
  });

  it("Does not affect other users' accrued balances", async function () {
    const { staking, ssvToken } = await ssvStakingHarnessFixture(connection);
    const [, otherUser] = await connection.ethers.getSigners();

    // Both users stake
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

    // Set up accrued balances for both
    const stakerAccrued = 100_000_000_000n;
    const otherAccrued = 200_000_000_000n;
    await staking.mockSetUserAccrued(staker.address, stakerAccrued);
    await staking.mockSetUserAccrued(otherUser.address, otherAccrued);
    await staking.mockSetStakingEthPoolBalance(50_000_000_000n);
    await staking.mockSetEthDaoBalance(50_000_000_000n);

    // First user claims
    await staking.claimEthRewards();

    // Other user's accrued balance should be unchanged
    const otherAccruedAfter = await staking.getUserAccrued(otherUser.address);
    expect(otherAccruedAfter).to.equal(otherAccrued);
  });
});

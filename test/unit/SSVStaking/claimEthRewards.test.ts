import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { defaultStakingFixture } from "../../helpers/fixture-presets.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext } from "../../common/helpers.ts";
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

  it("Keeps remainder in accrued balance after claiming (precision handling)", async function () {
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
});

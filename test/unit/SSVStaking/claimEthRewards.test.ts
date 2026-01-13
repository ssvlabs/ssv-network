import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvStakingHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { STAKE_AMOUNT } from "../../common/constants.ts";

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
    await staking.stake(STAKE_AMOUNT);

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

  it("Claims accrued ETH rewards and emits RewardsClaimed event", async function () {
    const { staking } = await networkHelpers.loadFixture(stakeAndAccrueRewards);

    const accruedAmount = connection.ethers.parseEther("0.1");
    await staking.mockSetUserAccrued(staker.address, accruedAmount);
    await staking.mockSetStakingEthPoolBalance(10_000_000_000n);
    await staking.mockSetEthDaoBalance(10_000_000_000n);

    const tx = await staking.claimEthRewards();

    await expect(tx).to.emit(staking, Events.REWARDS_CLAIMED);
  });

  it("Reduces accrued balance after claiming", async function () {
    const { staking } = await networkHelpers.loadFixture(stakeAndAccrueRewards);

    const accruedAmount = connection.ethers.parseEther("0.1");
    await staking.mockSetUserAccrued(staker.address, accruedAmount);
    await staking.mockSetStakingEthPoolBalance(10_000_000_000n);
    await staking.mockSetEthDaoBalance(10_000_000_000n);

    await staking.claimEthRewards();

    const accruedAfter = await staking.getUserAccrued(staker.address);
    expect(accruedAfter).to.be.lessThan(accruedAmount);
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
    await staking.stake(STAKE_AMOUNT);

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

    const tx = await staking.claimEthRewards();

    await expect(tx).to.emit(staking, Events.FEES_SYNCED);
  });
});

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvStakingHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { STAKE_AMOUNT, DEFAULT_UNSTAKE_COOLDOWN } from "../../common/constants.ts";

describe("SSVStaking function `withdrawUnlocked()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let staker: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [staker] = await connection.ethers.getSigners();
  });

  const stakeAndRequestUnstake = async () => {
    const { staking, ssvToken, cssvToken } = await ssvStakingHarnessFixture(connection);
    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);
    await staking.requestUnstake(STAKE_AMOUNT);
    return { staking, ssvToken, cssvToken };
  };

  it("Withdraws unlocked tokens after cooldown and emits UnstakedWithdrawn event", async function () {
    const { staking, ssvToken } = await networkHelpers.loadFixture(stakeAndRequestUnstake);

    await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + 1n);

    const balanceBefore = await ssvToken.balanceOf(staker.address);
    const tx = await staking.withdrawUnlocked();

    await expect(tx)
      .to.emit(staking, Events.UNSTAKE_WITHDRAWN)
      .withArgs(staker.address, STAKE_AMOUNT);

    const balanceAfter = await ssvToken.balanceOf(staker.address);
    expect(balanceAfter - balanceBefore).to.equal(STAKE_AMOUNT);
  });

  it("Clears the withdrawal request after successful withdrawal", async function () {
    const { staking } = await networkHelpers.loadFixture(stakeAndRequestUnstake);

    await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + 1n);
    await staking.withdrawUnlocked();

    const [amount, unlockTime] = await staking.getWithdrawal(staker.address);
    expect(amount).to.equal(0n);
    expect(unlockTime).to.equal(0n);
  });

  it("Is reverted with 'NothingToWithdraw' when there is no pending withdrawal", async function () {
    const { staking } = await ssvStakingHarnessFixture(connection);

    await expect(staking.withdrawUnlocked()).to.be.revertedWithCustomError(
      staking,
      Errors.NOTHING_TO_WITHDRAW
    );
  });

  it("Is reverted with 'CooldownNotFinished' when cooldown has not passed", async function () {
    const { staking } = await networkHelpers.loadFixture(stakeAndRequestUnstake);

    await expect(staking.withdrawUnlocked()).to.be.revertedWithCustomError(
      staking,
      Errors.COOLDOWN_NOT_FINISHED
    );
  });

  it("Is reverted with 'CooldownNotFinished' when partially through cooldown", async function () {
    const { staking } = await networkHelpers.loadFixture(stakeAndRequestUnstake);

    await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN / 2n);

    await expect(staking.withdrawUnlocked()).to.be.revertedWithCustomError(
      staking,
      Errors.COOLDOWN_NOT_FINISHED
    );
  });

  it("Allows withdrawal exactly at unlock time", async function () {
    const { staking, ssvToken } = await networkHelpers.loadFixture(stakeAndRequestUnstake);

    await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN);

    const balanceBefore = await ssvToken.balanceOf(staker.address);
    await staking.withdrawUnlocked();
    const balanceAfter = await ssvToken.balanceOf(staker.address);

    expect(balanceAfter - balanceBefore).to.equal(STAKE_AMOUNT);
  });
});

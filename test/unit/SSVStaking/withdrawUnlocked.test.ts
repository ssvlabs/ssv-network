import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvStakingHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { STAKE_AMOUNT, DEFAULT_UNSTAKE_COOLDOWN } from "../../common/constants.ts";
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";

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
    await trackGas(
      staking.stake(STAKE_AMOUNT),
      [GasGroup.STAKE_SSV]
    );
    await trackGas(
      staking.requestUnstake(STAKE_AMOUNT),
      [GasGroup.REQUEST_UNSTAKE]
    );
    return { staking, ssvToken, cssvToken };
  };

  it("Withdraws unlocked tokens after cooldown and emits UnstakedWithdrawn event", async function () {
    const { staking, ssvToken } = await networkHelpers.loadFixture(stakeAndRequestUnstake);

    await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + 1n);

    const balanceBefore = await ssvToken.balanceOf(staker.address);
    const tx = await trackGas(
      staking.withdrawUnlocked(),
      [GasGroup.WITHDRAW_UNSTAKE]
    );

    await expect(tx)
      .to.emit(staking, Events.UNSTAKE_WITHDRAWN)
      .withArgs(staker.address, STAKE_AMOUNT);

    const balanceAfter = await ssvToken.balanceOf(staker.address);
    expect(balanceAfter - balanceBefore).to.equal(STAKE_AMOUNT);
  });

  it("Clears the withdrawal request after successful withdrawal", async function () {
    const { staking } = await networkHelpers.loadFixture(stakeAndRequestUnstake);

    await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + 1n);
    await trackGas(
      staking.withdrawUnlocked(),
      [GasGroup.WITHDRAW_UNSTAKE]
    );

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

  it("Allows withdrawal exactly at unlock time", async function () {
    const { staking, ssvToken } = await networkHelpers.loadFixture(stakeAndRequestUnstake);

    await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN);

    const balanceBefore = await ssvToken.balanceOf(staker.address);
    await trackGas(
      staking.withdrawUnlocked(),
      [GasGroup.WITHDRAW_UNSTAKE]
    );
    const balanceAfter = await ssvToken.balanceOf(staker.address);

    expect(balanceAfter - balanceBefore).to.equal(STAKE_AMOUNT);
  });

  it("Clears withdrawal request from storage after withdrawal", async function () {
    const { staking } = await networkHelpers.loadFixture(stakeAndRequestUnstake);

    const [amountBefore, unlockTimeBefore] = await staking.getWithdrawal(staker.address);
    expect(amountBefore).to.equal(STAKE_AMOUNT);
    expect(unlockTimeBefore).to.be.greaterThan(0n);

    await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + 1n);
    await staking.withdrawUnlocked();

    const [amountAfter, unlockTimeAfter] = await staking.getWithdrawal(staker.address);
    expect(amountAfter).to.equal(0n);
    expect(unlockTimeAfter).to.equal(0n);
  });
});

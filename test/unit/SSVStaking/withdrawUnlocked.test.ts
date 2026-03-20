import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { defaultStakingFixture } from "../../helpers/fixture-presets.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext } from "../../common/helpers.ts";
import { ssvStakingHarnessFixture } from "../../setup/fixtures.ts";
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
    ({ connection, networkHelpers, signers: [staker] } = await setupTestContext());
  });

  const stakeAndRequestUnstake = async () => {
    const { staking, ssvToken, cssvToken } = await defaultStakingFixture(connection);
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

    const stakerBalanceBefore = await ssvToken.balanceOf(staker.address);
    const contractBalanceBefore = await ssvToken.balanceOf(await staking.getAddress());

    const tx = await trackGas(
      staking.withdrawUnlocked(),
      [GasGroup.WITHDRAW_UNSTAKE]
    );

    await expect(tx)
      .to.emit(staking, Events.UNSTAKE_WITHDRAWN)
      .withArgs(staker.address, STAKE_AMOUNT);
    const stakerBalanceAfter = await ssvToken.balanceOf(staker.address);
    expect(stakerBalanceAfter - stakerBalanceBefore).to.equal(STAKE_AMOUNT);
    const contractBalanceAfter = await ssvToken.balanceOf(await staking.getAddress());
    expect(contractBalanceBefore - contractBalanceAfter).to.equal(STAKE_AMOUNT);
  });

  it("Clears the withdrawal request after successful withdrawal", async function () {
    const { staking } = await networkHelpers.loadFixture(stakeAndRequestUnstake);

    await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + 1n);
    await trackGas(
      staking.withdrawUnlocked(),
      [GasGroup.WITHDRAW_UNSTAKE]
    );

    const requestCount = await staking.getWithdrawalRequestsCount(staker.address);
    expect(requestCount).to.equal(0n);
  });

  it("Is reverted with 'NothingToWithdraw' when there is no pending withdrawal", async function () {
    const { staking } = await defaultStakingFixture(connection);

    await expect(staking.withdrawUnlocked()).to.be.revertedWithCustomError(
      staking,
      Errors.NOTHING_TO_WITHDRAW
    );
  });

  it("Is reverted with 'NothingToWithdraw' when cooldown has not passed", async function () {
    const { staking } = await networkHelpers.loadFixture(stakeAndRequestUnstake);

    await expect(staking.withdrawUnlocked()).to.be.revertedWithCustomError(
      staking,
      Errors.NOTHING_TO_WITHDRAW
    );
  });

  it("Is reverted with 'NothingToWithdraw' when partially through cooldown", async function () {
    const { staking } = await networkHelpers.loadFixture(stakeAndRequestUnstake);

    await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN / 2n);

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

    const requestCountBefore = await staking.getWithdrawalRequestsCount(staker.address);
    expect(requestCountBefore).to.equal(1n);

    const [amountBefore, unlockTimeBefore] = await staking.getWithdrawalRequest(staker.address, 0);
    expect(amountBefore).to.equal(STAKE_AMOUNT);
    expect(unlockTimeBefore).to.be.greaterThan(0n);

    await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + 1n);
    await staking.withdrawUnlocked();

    const requestCountAfter = await staking.getWithdrawalRequestsCount(staker.address);
    expect(requestCountAfter).to.equal(0n);
  });

  it("Withdraws multiple unlocked requests in a single call", async function () {
    const { staking, ssvToken, cssvToken } = await defaultStakingFixture(connection);
    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    const amount1 = STAKE_AMOUNT / 4n;
    const amount2 = STAKE_AMOUNT / 4n;
    const amount3 = STAKE_AMOUNT / 4n;

    await staking.requestUnstake(amount1);
    await staking.requestUnstake(amount2);
    await staking.requestUnstake(amount3);

    const requestCount = await staking.getWithdrawalRequestsCount(staker.address);
    expect(requestCount).to.equal(3n);
    await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + 1n);

    const balanceBefore = await ssvToken.balanceOf(staker.address);
    const tx = await trackGas(
      staking.withdrawUnlocked(),
      [GasGroup.WITHDRAW_UNSTAKE]
    );

    const totalWithdrawn = amount1 + amount2 + amount3;
    await expect(tx)
      .to.emit(staking, Events.UNSTAKE_WITHDRAWN)
      .withArgs(staker.address, totalWithdrawn);

    const balanceAfter = await ssvToken.balanceOf(staker.address);
    expect(balanceAfter - balanceBefore).to.equal(totalWithdrawn);
    const requestCountAfter = await staking.getWithdrawalRequestsCount(staker.address);
    expect(requestCountAfter).to.equal(0n);
  });

  it("Withdraws only unlocked requests, leaving locked ones pending", async function () {
    const { staking, ssvToken, cssvToken } = await defaultStakingFixture(connection);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    const amount1 = STAKE_AMOUNT / 4n;
    const amount2 = STAKE_AMOUNT / 4n;
    await staking.requestUnstake(amount1);
    await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN / 2n);
    await staking.requestUnstake(amount2);
    await networkHelpers.time.increase((DEFAULT_UNSTAKE_COOLDOWN / 2n) + 1n);

    const balanceBefore = await ssvToken.balanceOf(staker.address);
    const tx = await trackGas(
      staking.withdrawUnlocked(),
      [GasGroup.WITHDRAW_UNSTAKE]
    );
    await expect(tx)
      .to.emit(staking, Events.UNSTAKE_WITHDRAWN)
      .withArgs(staker.address, amount1);

    const balanceAfter = await ssvToken.balanceOf(staker.address);
    expect(balanceAfter - balanceBefore).to.equal(amount1);
    const requestCountAfter = await staking.getWithdrawalRequestsCount(staker.address);
    expect(requestCountAfter).to.equal(1n);
    const [remainingAmount] = await staking.getWithdrawalRequest(staker.address, 0);
    expect(remainingAmount).to.equal(amount2);
  });

  it("Allows second withdrawal after remaining requests unlock", async function () {
    const { staking, ssvToken, cssvToken } = await defaultStakingFixture(connection);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    const amount1 = STAKE_AMOUNT / 4n;
    const amount2 = STAKE_AMOUNT / 4n;

    await staking.requestUnstake(amount1);
    await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN / 2n);
    await staking.requestUnstake(amount2);
    await networkHelpers.time.increase((DEFAULT_UNSTAKE_COOLDOWN / 2n) + 1n);
    await staking.withdrawUnlocked();
    await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN / 2n);

    const balanceBefore = await ssvToken.balanceOf(staker.address);
    const tx = await staking.withdrawUnlocked();

    await expect(tx)
      .to.emit(staking, Events.UNSTAKE_WITHDRAWN)
      .withArgs(staker.address, amount2);

    const balanceAfter = await ssvToken.balanceOf(staker.address);
    expect(balanceAfter - balanceBefore).to.equal(amount2);
    const requestCountFinal = await staking.getWithdrawalRequestsCount(staker.address);
    expect(requestCountFinal).to.equal(0n);
  });

  it("Withdraws full amount one year after maturity", async function () {
    const { staking, ssvToken } = await networkHelpers.loadFixture(stakeAndRequestUnstake);

    const oneYear = 365n * 24n * 60n * 60n;
    await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + oneYear);

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

    const requestCount = await staking.getWithdrawalRequestsCount(staker.address);
    expect(requestCount).to.equal(0n);
  });

  it("Does not change cSSV supply on withdrawal", async function () {
    const { staking, cssvToken } = await networkHelpers.loadFixture(stakeAndRequestUnstake);

    await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + 1n);

    const supplyBefore = await cssvToken.totalSupply();
    await trackGas(
      staking.withdrawUnlocked(),
      [GasGroup.WITHDRAW_UNSTAKE]
    );
    const supplyAfter = await cssvToken.totalSupply();

    expect(supplyAfter).to.equal(supplyBefore);
  });

  it("Does not allow one user to withdraw another user's tokens", async function () {
    const { staking, ssvToken } = await networkHelpers.loadFixture(stakeAndRequestUnstake);
    const [, otherUser] = await connection.ethers.getSigners();

    await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + 1n);
    await expect(staking.connect(otherUser).withdrawUnlocked()).to.be.revertedWithCustomError(
      staking,
      Errors.NOTHING_TO_WITHDRAW
    );
    const balanceBefore = await ssvToken.balanceOf(staker.address);
    await staking.withdrawUnlocked();
    const balanceAfter = await ssvToken.balanceOf(staker.address);
    expect(balanceAfter - balanceBefore).to.equal(STAKE_AMOUNT);
  });

  describe("Cooldown duration changes and existing pending requests", () => {
    it("Does not unlock an existing request earlier when cooldown is reduced after request creation", async function () {
      const { staking, ssvToken } = await networkHelpers.loadFixture(stakeAndRequestUnstake);

      const [, originalUnlockTime] = await staking.getWithdrawalRequest(staker.address, 0);
      const reducedCooldown = 1n;
      await staking.mockSetCooldownDuration(reducedCooldown);

      await networkHelpers.time.increase((DEFAULT_UNSTAKE_COOLDOWN / 2n) + 1n);

      await expect(staking.withdrawUnlocked()).to.be.revertedWithCustomError(
        staking,
        Errors.NOTHING_TO_WITHDRAW,
      );

      const [, unlockTimeAfterUpdate] = await staking.getWithdrawalRequest(staker.address, 0);
      expect(unlockTimeAfterUpdate).to.equal(originalUnlockTime);

      await networkHelpers.time.increase((DEFAULT_UNSTAKE_COOLDOWN / 2n) + 1n);
      const balanceBefore = await ssvToken.balanceOf(staker.address);
      await staking.withdrawUnlocked();
      const balanceAfter = await ssvToken.balanceOf(staker.address);
      expect(balanceAfter - balanceBefore).to.equal(STAKE_AMOUNT);
    });

    it("Uses the updated cooldown duration for new requests created after a cooldown change", async function () {
      const { staking, ssvToken } = await ssvStakingHarnessFixture(connection);

      await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
      await staking.stake(STAKE_AMOUNT);

      const firstAmount = STAKE_AMOUNT / 4n;
      const secondAmount = STAKE_AMOUNT / 4n;

      const firstTx = await staking.requestUnstake(firstAmount);
      const firstReceipt = await firstTx.wait();
      const firstBlock = await connection.ethers.provider.getBlock(firstReceipt!.blockNumber);
      const expectedFirstUnlockTime = BigInt(firstBlock!.timestamp) + DEFAULT_UNSTAKE_COOLDOWN;

      const increasedCooldown = DEFAULT_UNSTAKE_COOLDOWN * 2n;
      await staking.mockSetCooldownDuration(increasedCooldown);

      const secondTx = await staking.requestUnstake(secondAmount);
      const secondReceipt = await secondTx.wait();
      const secondBlock = await connection.ethers.provider.getBlock(secondReceipt!.blockNumber);
      const expectedSecondUnlockTime = BigInt(secondBlock!.timestamp) + increasedCooldown;

      const [storedFirstAmount, firstUnlockTime] = await staking.getWithdrawalRequest(staker.address, 0);
      const [storedSecondAmount, secondUnlockTime] = await staking.getWithdrawalRequest(staker.address, 1);

      expect(storedFirstAmount).to.equal(firstAmount);
      expect(firstUnlockTime).to.equal(expectedFirstUnlockTime);
      expect(storedSecondAmount).to.equal(secondAmount);
      expect(secondUnlockTime).to.equal(expectedSecondUnlockTime);
      expect(secondUnlockTime).to.be.greaterThan(firstUnlockTime);

      await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + 1n);

      const balanceBeforeFirstWithdrawal = await ssvToken.balanceOf(staker.address);
      await staking.withdrawUnlocked();
      const balanceAfterFirstWithdrawal = await ssvToken.balanceOf(staker.address);

      expect(balanceAfterFirstWithdrawal - balanceBeforeFirstWithdrawal).to.equal(firstAmount);
      expect(await staking.getWithdrawalRequestsCount(staker.address)).to.equal(1n);

      const [remainingAmount, remainingUnlockTime] = await staking.getWithdrawalRequest(staker.address, 0);
      expect(remainingAmount).to.equal(secondAmount);
      expect(remainingUnlockTime).to.equal(secondUnlockTime);

      await networkHelpers.time.increase(increasedCooldown + 1n);

      const balanceBeforeSecondWithdrawal = await ssvToken.balanceOf(staker.address);
      await staking.withdrawUnlocked();
      const balanceAfterSecondWithdrawal = await ssvToken.balanceOf(staker.address);

      expect(balanceAfterSecondWithdrawal - balanceBeforeSecondWithdrawal).to.equal(secondAmount);
      expect(await staking.getWithdrawalRequestsCount(staker.address)).to.equal(0n);
    });

    it("Keeps original unlock time for existing request when cooldown is increased after request creation", async function () {
      const { staking, ssvToken } = await networkHelpers.loadFixture(stakeAndRequestUnstake);

      const [, originalUnlockTime] = await staking.getWithdrawalRequest(staker.address, 0);
      const increasedCooldown = DEFAULT_UNSTAKE_COOLDOWN * 2n;
      await staking.mockSetCooldownDuration(increasedCooldown);

      const [, unlockTimeAfterUpdate] = await staking.getWithdrawalRequest(staker.address, 0);
      expect(unlockTimeAfterUpdate).to.equal(originalUnlockTime);

      await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN);
      const balanceBefore = await ssvToken.balanceOf(staker.address);
      await staking.withdrawUnlocked();
      const balanceAfter = await ssvToken.balanceOf(staker.address);
      expect(balanceAfter - balanceBefore).to.equal(STAKE_AMOUNT);
    });
  });
});

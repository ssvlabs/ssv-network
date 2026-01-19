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

describe("SSVStaking function `requestUnstake()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let staker: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [staker] = await connection.ethers.getSigners();
  });

  const stakeFirst = async () => {
    const { staking, ssvToken, cssvToken } = await ssvStakingHarnessFixture(connection);
    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await trackGas(
      staking.stake(STAKE_AMOUNT),
      [GasGroup.STAKE_SSV]
    );
    return { staking, ssvToken, cssvToken };
  };

  it("Requests unstake, burns cSSV and emits UnstakeRequested event", async function () {
    const { staking, cssvToken } = await networkHelpers.loadFixture(stakeFirst);

    const unstakeAmount = STAKE_AMOUNT / 2n;
    const tx = await trackGas(
      staking.requestUnstake(unstakeAmount),
      [GasGroup.REQUEST_UNSTAKE]
    );

    await expect(tx).to.emit(staking, Events.UNSTAKE_REQUESTED);

    const cssvBalance = await cssvToken.balanceOf(staker.address);
    expect(cssvBalance).to.equal(STAKE_AMOUNT - unstakeAmount);
  });

  it("Creates a withdrawal request with correct unlock time", async function () {
    const { staking } = await networkHelpers.loadFixture(stakeFirst);

    const unstakeAmount = STAKE_AMOUNT / 2n;
    const receipt = await trackGas(
      staking.requestUnstake(unstakeAmount),
      [GasGroup.REQUEST_UNSTAKE]
    );

    const requestCount = await staking.getWithdrawalRequestsCount(staker.address);
    expect(requestCount).to.equal(1n);

    const [amount, unlockTime] = await staking.getWithdrawalRequest(staker.address, 0);
    expect(amount).to.equal(unstakeAmount);

    const receiptBlock = await connection.ethers.provider.getBlock(receipt.blockNumber);
    const expectedUnlockTime = BigInt(receiptBlock!.timestamp) + DEFAULT_UNSTAKE_COOLDOWN;
    expect(unlockTime).to.equal(expectedUnlockTime);
  });

  it("Removes delegation proportionally", async function () {
    const { staking } = await networkHelpers.loadFixture(stakeFirst);

    const weightBefore = await staking.getOracleWeight(1);
    const unstakeAmount = STAKE_AMOUNT / 2n;

    await trackGas(
      staking.requestUnstake(unstakeAmount),
      [GasGroup.REQUEST_UNSTAKE]
    );

    const weightAfter = await staking.getOracleWeight(1);
    expect(weightAfter).to.be.lessThan(weightBefore);
  });

  it("Is reverted with 'ZeroAmount' when requesting unstake of zero amount", async function () {
    const { staking } = await networkHelpers.loadFixture(stakeFirst);

    await expect(staking.requestUnstake(0n)).to.be.revertedWithCustomError(
      staking,
      Errors.ZERO_AMOUNT
    );
  });

  it("Is reverted with 'MaxRequestsAmountReached' when pending requests limit is reached", async function () {
    const { staking } = await networkHelpers.loadFixture(stakeFirst);

    const unstakeAmount = STAKE_AMOUNT / 20n;
    for (let i = 0; i < 10; i += 1) {
      await (await staking.requestUnstake(unstakeAmount)).wait();
    }

    await expect(staking.requestUnstake(unstakeAmount)).to.be.revertedWithCustomError(
      staking,
      Errors.MAX_REQUESTS_AMOUNT_REACHED
    );
  });

  it("Is reverted with 'UnstakeAmountExceedsBalance' when requesting more than balance", async function () {
    const { staking } = await networkHelpers.loadFixture(stakeFirst);

    const excessAmount = STAKE_AMOUNT + 1n;

    await expect(staking.requestUnstake(excessAmount)).to.be.revertedWithCustomError(
      staking,
      Errors.UNSTAKE_AMOUNT_EXCEEDS_BALANCE
    );
  });

  it("Allows unstaking full balance", async function () {
    const { staking, cssvToken } = await networkHelpers.loadFixture(stakeFirst);

    await trackGas(
      staking.requestUnstake(STAKE_AMOUNT),
      [GasGroup.REQUEST_UNSTAKE]
    );

    const cssvBalance = await cssvToken.balanceOf(staker.address);
    expect(cssvBalance).to.equal(0n);

    const requestCount = await staking.getWithdrawalRequestsCount(staker.address);
    expect(requestCount).to.equal(1n);

    const [amount] = await staking.getWithdrawalRequest(staker.address, 0);
    expect(amount).to.equal(STAKE_AMOUNT);
  });

  it("Stores withdrawal request in storage", async function () {
    const { staking } = await networkHelpers.loadFixture(stakeFirst);

    const unstakeAmount = STAKE_AMOUNT / 2n;
    const tx = await staking.requestUnstake(unstakeAmount);
    const receipt = await tx.wait();

    const requestCount = await staking.getWithdrawalRequestsCount(staker.address);
    expect(requestCount).to.equal(1n);

    const [storedAmount, storedUnlockTime] = await staking.getWithdrawalRequest(staker.address, 0);

    expect(storedAmount).to.equal(unstakeAmount);
    expect(storedUnlockTime).to.be.greaterThan(0n);

    const receiptBlock = await connection.ethers.provider.getBlock(receipt.blockNumber);
    const expectedUnlockTime = BigInt(receiptBlock!.timestamp) + DEFAULT_UNSTAKE_COOLDOWN;
    expect(storedUnlockTime).to.equal(expectedUnlockTime);
  });
});

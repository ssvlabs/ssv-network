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

  it("Requests unstake, burns cSSV and emits UnstakeRequested event with correct args", async function () {
    const { staking, cssvToken } = await networkHelpers.loadFixture(stakeFirst);

    const totalSupplyBefore = await cssvToken.totalSupply();
    const cssvBalanceBefore = await cssvToken.balanceOf(staker.address);

    const unstakeAmount = STAKE_AMOUNT / 2n;
    const receipt = await trackGas(
      staking.requestUnstake(unstakeAmount),
      [GasGroup.REQUEST_UNSTAKE]
    );
    const block = await connection.ethers.provider.getBlock(receipt.blockNumber);
    const expectedUnlockTime = BigInt(block!.timestamp) + DEFAULT_UNSTAKE_COOLDOWN;

    await expect(receipt)
      .to.emit(staking, Events.UNSTAKE_REQUESTED)
      .withArgs(staker.address, unstakeAmount, expectedUnlockTime);

    // Verify cSSV burned from user
    const cssvBalanceAfter = await cssvToken.balanceOf(staker.address);
    expect(cssvBalanceAfter).to.equal(cssvBalanceBefore - unstakeAmount);

    // Verify totalSupply decreased
    const totalSupplyAfter = await cssvToken.totalSupply();
    expect(totalSupplyAfter).to.equal(totalSupplyBefore - unstakeAmount);
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

  it("Removes delegation proportionally from all oracles and emits DelegationUpdated", async function () {
    const { staking } = await networkHelpers.loadFixture(stakeFirst);

    // Get weights for all 4 default oracles before unstaking
    const weightsBefore = await Promise.all([
      staking.getOracleWeight(1),
      staking.getOracleWeight(2),
      staking.getOracleWeight(3),
      staking.getOracleWeight(4),
    ]);

    const unstakeAmount = STAKE_AMOUNT / 2n;

    const tx = await trackGas(
      staking.requestUnstake(unstakeAmount),
      [GasGroup.REQUEST_UNSTAKE]
    );

    // Verify DelegationUpdated event is emitted
    await expect(tx).to.emit(staking, Events.DELEGATION_UPDATED);

    // Get weights for all 4 oracles after unstaking
    const weightsAfter = await Promise.all([
      staking.getOracleWeight(1),
      staking.getOracleWeight(2),
      staking.getOracleWeight(3),
      staking.getOracleWeight(4),
    ]);

    // Each oracle should have reduced weight
    for (let i = 0; i < 4; i++) {
      expect(weightsAfter[i]).to.be.lessThan(weightsBefore[i]);
    }

    // Total weight reduction should equal unstakeAmount
    const totalWeightBefore = weightsBefore.reduce((a, b) => a + b, 0n);
    const totalWeightAfter = weightsAfter.reduce((a, b) => a + b, 0n);
    expect(totalWeightBefore - totalWeightAfter).to.equal(unstakeAmount);
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

  it("Allows unstaking full balance and clears all delegation", async function () {
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

    // All oracle weights should be zero after full unstake
    const weightsAfter = await Promise.all([
      staking.getOracleWeight(1),
      staking.getOracleWeight(2),
      staking.getOracleWeight(3),
      staking.getOracleWeight(4),
    ]);
    for (const weight of weightsAfter) {
      expect(weight).to.equal(0n);
    }
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

  it("Allows multiple sequential unstake requests with different unlock times", async function () {
    const { staking, cssvToken } = await networkHelpers.loadFixture(stakeFirst);

    const firstAmount = STAKE_AMOUNT / 4n;
    const secondAmount = STAKE_AMOUNT / 4n;

    // First request
    const tx1 = await staking.requestUnstake(firstAmount);
    const receipt1 = await tx1.wait();
    const block1 = await connection.ethers.provider.getBlock(receipt1.blockNumber);
    const expectedUnlock1 = BigInt(block1!.timestamp) + DEFAULT_UNSTAKE_COOLDOWN;

    // Advance time slightly
    await networkHelpers.time.increase(100n);

    // Second request
    const tx2 = await staking.requestUnstake(secondAmount);
    const receipt2 = await tx2.wait();
    const block2 = await connection.ethers.provider.getBlock(receipt2.blockNumber);
    const expectedUnlock2 = BigInt(block2!.timestamp) + DEFAULT_UNSTAKE_COOLDOWN;

    const requestCount = await staking.getWithdrawalRequestsCount(staker.address);
    expect(requestCount).to.equal(2n);

    const [amount1, unlock1] = await staking.getWithdrawalRequest(staker.address, 0);
    const [amount2, unlock2] = await staking.getWithdrawalRequest(staker.address, 1);

    expect(amount1).to.equal(firstAmount);
    expect(unlock1).to.equal(expectedUnlock1);
    expect(amount2).to.equal(secondAmount);
    expect(unlock2).to.equal(expectedUnlock2);
    expect(unlock2).to.be.greaterThan(unlock1);

    // Verify cSSV balance reduced by both amounts
    const cssvBalance = await cssvToken.balanceOf(staker.address);
    expect(cssvBalance).to.equal(STAKE_AMOUNT - firstAmount - secondAmount);
  });

  it("Settles pending rewards before unstaking when fees have accrued", async function () {
    const { staking, cssvToken } = await networkHelpers.loadFixture(stakeFirst);

    // Simulate fee accrual
    const newFees = 1_000_000_000n;
    await staking.mockSetStakingEthPoolBalance(0n);
    await staking.mockSetEthDaoBalance(newFees);

    const userIndexBefore = await staking.getUserIndex(staker.address);
    const accruedBefore = await staking.getUserAccrued(staker.address);

    await trackGas(
      staking.requestUnstake(STAKE_AMOUNT / 2n),
      [GasGroup.REQUEST_UNSTAKE]
    );

    const userIndexAfter = await staking.getUserIndex(staker.address);
    const accruedAfter = await staking.getUserAccrued(staker.address);

    // User index should be updated to current accEthPerShare
    expect(userIndexAfter).to.be.greaterThan(userIndexBefore);

    // User should have accrued some rewards
    expect(accruedAfter).to.be.greaterThan(accruedBefore);
  });

  it("Updates user delegation amounts correctly after partial unstake", async function () {
    const { staking } = await networkHelpers.loadFixture(stakeFirst);

    const [oracleIdsBefore, amountsBefore] = await staking.getUserDelegation(staker.address);
    const totalDelegationBefore = amountsBefore.reduce((a: bigint, b: bigint) => a + b, 0n);
    expect(totalDelegationBefore).to.equal(STAKE_AMOUNT);

    const unstakeAmount = STAKE_AMOUNT / 2n;
    await staking.requestUnstake(unstakeAmount);

    const [oracleIdsAfter, amountsAfter] = await staking.getUserDelegation(staker.address);
    const totalDelegationAfter = amountsAfter.reduce((a: bigint, b: bigint) => a + b, 0n);

    // Oracle IDs should remain the same
    expect(oracleIdsAfter).to.deep.equal(oracleIdsBefore);

    // Total delegation should be reduced by unstake amount
    expect(totalDelegationAfter).to.equal(totalDelegationBefore - unstakeAmount);
  });
});

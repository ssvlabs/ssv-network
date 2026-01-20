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

describe("SSVStaking function `stake()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let staker: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [staker] = await connection.ethers.getSigners();
  });

  const deployStakingFixture = async () => ssvStakingHarnessFixture(connection);

  it("Stakes SSV tokens, mints cSSV and emits Staked event", async function () {
    const { staking, ssvToken, cssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);

    const tx = await trackGas(
      staking.stake(STAKE_AMOUNT),
      [GasGroup.STAKE_SSV]
    );

    await expect(tx)
      .to.emit(staking, Events.STAKED)
      .withArgs(staker.address, STAKE_AMOUNT);

    const cssvBalance = await cssvToken.balanceOf(staker.address);
    expect(cssvBalance).to.equal(STAKE_AMOUNT);
  });

  it("Updates user index after staking", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await trackGas(
      staking.stake(STAKE_AMOUNT),
      [GasGroup.STAKE_SSV]
    );

    const userIndex = await staking.getUserIndex(staker.address);
    const accEthPerShare = await staking.getAccEthPerShare();
    expect(userIndex).to.equal(accEthPerShare);
  });

  it("Creates delegation to default oracles", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);

    const tx = await trackGas(
      staking.stake(STAKE_AMOUNT),
      [GasGroup.STAKE_SSV]
    );

    await expect(tx).to.emit(staking, Events.DELEGATION_UPDATED);

    const weight1 = await staking.getOracleWeight(1);
    const weight2 = await staking.getOracleWeight(2);
    const weight3 = await staking.getOracleWeight(3);
    const weight4 = await staking.getOracleWeight(4);

    expect(weight1 + weight2 + weight3 + weight4).to.equal(STAKE_AMOUNT);
  });

  it("Is reverted with 'ZeroAmount' when staking zero amount", async function () {
    const { staking } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await expect(staking.stake(0n)).to.be.revertedWithCustomError(
      staking,
      Errors.ZERO_AMOUNT
    );
  });

  it("Is reverted with 'StakeTooLow' when staking below minimum", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const tooLowAmount = 999_999_999n;
    await ssvToken.approve(await staking.getAddress(), tooLowAmount);

    await expect(staking.stake(tooLowAmount)).to.be.revertedWithCustomError(
      staking,
      Errors.STAKE_TOO_LOW
    );
  });

  it("Allows multiple stakes from the same user", async function () {
    const { staking, ssvToken, cssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const firstStake = STAKE_AMOUNT;
    const secondStake = STAKE_AMOUNT * 2n;

    await ssvToken.approve(await staking.getAddress(), firstStake + secondStake);

    await trackGas(
      staking.stake(firstStake),
      [GasGroup.INITIAL_STAKE_SSV]
    );
    await trackGas(
      staking.stake(secondStake),
      [GasGroup.POST_INITIAL_STAKE_SSV]
    );

    const cssvBalance = await cssvToken.balanceOf(staker.address);
    expect(cssvBalance).to.equal(firstStake + secondStake);
  });

  it("Transfers SSV tokens to the staking contract", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const stakingAddress = await staking.getAddress();
    const balanceBefore = await ssvToken.balanceOf(stakingAddress);

    await ssvToken.approve(stakingAddress, STAKE_AMOUNT);
    await trackGas(
      staking.stake(STAKE_AMOUNT),
      [GasGroup.STAKE_SSV]
    );

    const balanceAfter = await ssvToken.balanceOf(stakingAddress);
    expect(balanceAfter - balanceBefore).to.equal(STAKE_AMOUNT);
  });

  it("Stores delegation data in storage", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    const [oracleIds, amounts] = await staking.getUserDelegation(staker.address);

    expect(oracleIds[0]).to.equal(1);
    expect(oracleIds[1]).to.equal(2);
    expect(oracleIds[2]).to.equal(3);
    expect(oracleIds[3]).to.equal(4);

    const totalDelegated = amounts[0] + amounts[1] + amounts[2] + amounts[3];
    expect(totalDelegated).to.equal(STAKE_AMOUNT);
  });
});

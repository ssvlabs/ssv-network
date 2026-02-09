import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvStakingHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { STAKE_AMOUNT, ETH_DEDUCTED_DIGITS } from "../../common/constants.ts";
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVStaking function `stake()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let staker: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [staker, other] = await connection.ethers.getSigners();
  });

  const deployStakingFixture = async () => ssvStakingHarnessFixture(connection);

  it("Stakes SSV tokens, mints cSSV and emits Staked event", async function () {
    const { staking, ssvToken, cssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const stakingAddress = await staking.getAddress();
    const stakerSsvBalanceBefore = await ssvToken.balanceOf(staker.address);
    const stakingSsvBalanceBefore = await ssvToken.balanceOf(stakingAddress);
    const cssvSupplyBefore = await cssvToken.totalSupply();

    await ssvToken.approve(stakingAddress, STAKE_AMOUNT);

    const tx = await trackGas(
      staking.stake(STAKE_AMOUNT),
      [GasGroup.STAKE_SSV]
    );

    await expect(tx)
      .to.emit(staking, Events.STAKED)
      .withArgs(staker.address, STAKE_AMOUNT);

    const cssvBalance = await cssvToken.balanceOf(staker.address);
    expect(cssvBalance).to.equal(STAKE_AMOUNT);

    const stakerSsvBalanceAfter = await ssvToken.balanceOf(staker.address);
    const stakingSsvBalanceAfter = await ssvToken.balanceOf(stakingAddress);
    const cssvSupplyAfter = await cssvToken.totalSupply();

    expect(stakerSsvBalanceBefore - stakerSsvBalanceAfter).to.equal(STAKE_AMOUNT);
    expect(stakingSsvBalanceAfter - stakingSsvBalanceBefore).to.equal(STAKE_AMOUNT);
    expect(cssvSupplyAfter - cssvSupplyBefore).to.equal(STAKE_AMOUNT);

    const allowanceAfter = await ssvToken.allowance(staker.address, stakingAddress);
    expect(allowanceAfter).to.equal(0n);
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

    const expectedShare = STAKE_AMOUNT / 4n;
    await expect(tx)
      .to.emit(staking, Events.DELEGATION_UPDATED)
      .withArgs(staker.address, [1, 2, 3, 4], [expectedShare, expectedShare, expectedShare, expectedShare]);

    const weight1 = await staking.getOracleWeight(1);
    const weight2 = await staking.getOracleWeight(2);
    const weight3 = await staking.getOracleWeight(3);
    const weight4 = await staking.getOracleWeight(4);

    expect(weight1 + weight2 + weight3 + weight4).to.equal(STAKE_AMOUNT);
    expect(weight1).to.equal(expectedShare);
    expect(weight2).to.equal(expectedShare);
    expect(weight3).to.equal(expectedShare);
    expect(weight4).to.equal(expectedShare);
  });

  it("Distributes delegation remainder starting from the first active oracle", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const amount = 1_000_000_001n;
    await ssvToken.approve(await staking.getAddress(), amount);

    const tx = await staking.stake(amount);

    const baseShare = amount / 4n;
    await expect(tx)
      .to.emit(staking, Events.DELEGATION_UPDATED)
      .withArgs(staker.address, [1, 2, 3, 4], [baseShare + 1n, baseShare, baseShare, baseShare]);

    expect(await staking.getOracleWeight(1)).to.equal(baseShare + 1n);
    expect(await staking.getOracleWeight(2)).to.equal(baseShare);
    expect(await staking.getOracleWeight(3)).to.equal(baseShare);
    expect(await staking.getOracleWeight(4)).to.equal(baseShare);
  });

  it("Preserves existing delegation ('sticky') on subsequent stakes", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    // 1. Setup custom delegation
    await staking.mockSetUserDelegation(
      staker.address,
      [1, 2, 0, 0],
      [STAKE_AMOUNT / 2n, STAKE_AMOUNT / 2n, 0n, 0n]
    );
    await staking.mockSetOracleWeight(1, STAKE_AMOUNT / 2n);
    await staking.mockSetOracleWeight(2, STAKE_AMOUNT / 2n);

    // 2. Stake more
    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    const tx = await staking.stake(STAKE_AMOUNT);

    // 3. Verify it added to existing delegation [1, 2] instead of defaults [1, 2, 3, 4]
    const expectedShare = STAKE_AMOUNT / 2n;
    await expect(tx)
      .to.emit(staking, Events.DELEGATION_UPDATED)
      .withArgs(
        staker.address,
        [1, 2, 0, 0],
        [STAKE_AMOUNT / 2n + expectedShare, STAKE_AMOUNT / 2n + expectedShare, 0n, 0n]
      );

    expect(await staking.getOracleWeight(1)).to.equal(STAKE_AMOUNT);
    expect(await staking.getOracleWeight(2)).to.equal(STAKE_AMOUNT);
    expect(await staking.getOracleWeight(3)).to.equal(0n);
    expect(await staking.getOracleWeight(4)).to.equal(0n);
  });

  it("Succeeds with no delegation if no default oracles are set", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await staking.mockSetDefaultOracleIds([0, 0, 0, 0]);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    const tx = await staking.stake(STAKE_AMOUNT);

    await expect(tx).to.not.emit(staking, Events.DELEGATION_UPDATED);

    const [oracleIds, amounts] = await staking.getUserDelegation(staker.address);
    expect(oracleIds).to.deep.equal([0, 0, 0, 0]);
    expect(amounts).to.deep.equal([0n, 0n, 0n, 0n]);
  });

  it("Accepts exactly the minimum stake amount", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const minAmount = 1_000_000_000n; // MINIMAL_STAKING_AMOUNT
    await ssvToken.approve(await staking.getAddress(), minAmount);

    await expect(staking.stake(minAmount))
      .to.emit(staking, Events.STAKED)
      .withArgs(staker.address, minAmount);
  });

  it("Preserves existing delegation ('sticky') on subsequent stakes", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    // 1. Setup custom delegation
    await staking.mockSetUserDelegation(
      staker.address,
      [1, 2, 0, 0],
      [STAKE_AMOUNT / 2n, STAKE_AMOUNT / 2n, 0n, 0n]
    );
    await staking.mockSetOracleWeight(1, STAKE_AMOUNT / 2n);
    await staking.mockSetOracleWeight(2, STAKE_AMOUNT / 2n);

    // 2. Stake more
    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    const tx = await staking.stake(STAKE_AMOUNT);

    // 3. Verify it added to existing delegation [1, 2] instead of defaults [1, 2, 3, 4]
    const expectedShare = STAKE_AMOUNT / 2n;
    await expect(tx)
      .to.emit(staking, Events.DELEGATION_UPDATED)
      .withArgs(
        staker.address,
        [1, 2, 0, 0],
        [STAKE_AMOUNT / 2n + expectedShare, STAKE_AMOUNT / 2n + expectedShare, 0n, 0n]
      );

    expect(await staking.getOracleWeight(1)).to.equal(STAKE_AMOUNT);
    expect(await staking.getOracleWeight(2)).to.equal(STAKE_AMOUNT);
    expect(await staking.getOracleWeight(3)).to.equal(0n);
    expect(await staking.getOracleWeight(4)).to.equal(0n);
  });

  it("Succeeds with no delegation if no default oracles are set", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await staking.mockSetDefaultOracleIds([0, 0, 0, 0]);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    const tx = await staking.stake(STAKE_AMOUNT);

    await expect(tx).to.not.emit(staking, Events.DELEGATION_UPDATED);

    const [oracleIds, amounts] = await staking.getUserDelegation(staker.address);
    expect(oracleIds).to.deep.equal([0, 0, 0, 0]);
    expect(amounts).to.deep.equal([0n, 0n, 0n, 0n]);
  });

  it("Accepts exactly the minimum stake amount", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const minAmount = 1_000_000_000n; // MINIMAL_STAKING_AMOUNT
    await ssvToken.approve(await staking.getAddress(), minAmount);

    await expect(staking.stake(minAmount))
      .to.emit(staking, Events.STAKED)
      .withArgs(staker.address, minAmount);
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

  it("Is reverted when allowance is insufficient", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const amount = STAKE_AMOUNT;
    await ssvToken.approve(await staking.getAddress(), amount - 1n);

    await expect(staking.stake(amount)).to.be.revertedWith("ERC20: insufficient allowance");
  });

  it("Is reverted when token balance is insufficient", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await ssvToken.connect(other).approve(await staking.getAddress(), STAKE_AMOUNT);

    await expect(staking.connect(other).stake(STAKE_AMOUNT))
      .to.be.revertedWith("ERC20: transfer amount exceeds balance");
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

  it("Respects existing custom delegation oracleIds and distributes only across active ones", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await staking.mockSetUserDelegation(
      staker.address,
      [1, 2, 0, 0],
      [0n, 0n, 0n, 0n]
    );

    const amount = 1_000_000_001n;
    await ssvToken.approve(await staking.getAddress(), amount);

    const tx = await staking.stake(amount);

    const baseShare = amount / 2n;
    await expect(tx)
      .to.emit(staking, Events.DELEGATION_UPDATED)
      .withArgs(staker.address, [1, 2, 0, 0], [baseShare + 1n, baseShare, 0n, 0n]);

    expect(await staking.getOracleWeight(1)).to.equal(baseShare + 1n);
    expect(await staking.getOracleWeight(2)).to.equal(baseShare);
  });

  it("Settles pending rewards for existing stake when fees accrue before staking again", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    const stake1 = await staking.stake(STAKE_AMOUNT);
    const receipt1 = await stake1.wait();

    const accruedBefore = await staking.getUserAccrued(staker.address);
    expect(accruedBefore).to.equal(0n);

    await staking.mockSetDaoTotalEthVUnits(10_000n);
    await staking.mockSetEthNetworkFee(1n);

    await connection.ethers.provider.send("hardhat_mine", ["0xA"]);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    const stake2 = await staking.stake(STAKE_AMOUNT);
    const receipt2 = await stake2.wait();

    const accruedAfter = await staking.getUserAccrued(staker.address);
    const blocksElapsed = BigInt(receipt2.blockNumber - receipt1.blockNumber);
    expect(accruedAfter).to.equal(blocksElapsed * ETH_DEDUCTED_DIGITS);

    const userIndex = await staking.getUserIndex(staker.address);
    const accEthPerShare = await staking.getAccEthPerShare();
    expect(userIndex).to.equal(accEthPerShare);
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

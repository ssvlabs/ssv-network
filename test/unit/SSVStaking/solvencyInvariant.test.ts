import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvStakingHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { DEFAULT_UNSTAKE_COOLDOWN, STAKE_AMOUNT } from "../../common/constants.ts";

describe("SSVStaking solvency invariant (cSSV supply <= SSV backing)", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let staker1: HardhatEthersSigner;
  let staker2: HardhatEthersSigner;
  let staker3: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [staker1, staker2, staker3] = await connection.ethers.getSigners();
  });

  const deployStakingFixture = async () => ssvStakingHarnessFixture(connection);

  const expectStakingSolvent = async (
    staking: any,
    ssvToken: any,
    cssvToken: any
  ) => {
    const stakingAddress = await staking.getAddress();
    const cssvSupply = await cssvToken.totalSupply();
    const ssvBacking = await ssvToken.balanceOf(stakingAddress);
    expect(cssvSupply).to.be.lte(
      ssvBacking,
      "Invariant violated: cSSV totalSupply exceeds SSV balance held by staking contract"
    );
  };

  const mintAndApprove = async (
    ssvToken: any,
    staking: any,
    user: HardhatEthersSigner,
    amount: bigint
  ) => {
    await ssvToken.mint(user.address, amount);
    await ssvToken.connect(user).approve(await staking.getAddress(), amount);
  };

  it("holds before and after stake/requestUnstake ordering for a single user", async function () {
    const { staking, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployStakingFixture);

    await expectStakingSolvent(staking, ssvToken, cssvToken);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);
    await expectStakingSolvent(staking, ssvToken, cssvToken);

    const partial = STAKE_AMOUNT / 3n;
    await staking.requestUnstake(partial);
    await expectStakingSolvent(staking, ssvToken, cssvToken);

    const remainingCssv = await cssvToken.balanceOf(staker1.address);
    expect(remainingCssv).to.equal(STAKE_AMOUNT - partial);
  });

  it("holds for multiple users with partial unstake requests", async function () {
    const { staking, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployStakingFixture);

    const stake2 = STAKE_AMOUNT * 2n;
    const stake3 = STAKE_AMOUNT / 2n;

    await mintAndApprove(ssvToken, staking, staker2, stake2);
    await mintAndApprove(ssvToken, staking, staker3, stake3);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);

    await staking.stake(STAKE_AMOUNT);
    await expectStakingSolvent(staking, ssvToken, cssvToken);

    await staking.connect(staker2).stake(stake2);
    await expectStakingSolvent(staking, ssvToken, cssvToken);

    await staking.connect(staker3).stake(stake3);
    await expectStakingSolvent(staking, ssvToken, cssvToken);

    await staking.requestUnstake(STAKE_AMOUNT / 4n);
    await expectStakingSolvent(staking, ssvToken, cssvToken);

    await staking.connect(staker2).requestUnstake(stake2 / 3n);
    await expectStakingSolvent(staking, ssvToken, cssvToken);

    await staking.connect(staker2).requestUnstake(stake2 / 6n);
    await expectStakingSolvent(staking, ssvToken, cssvToken);

    await staking.connect(staker3).requestUnstake(stake3 / 2n);
    await expectStakingSolvent(staking, ssvToken, cssvToken);
  });

  it("holds through full unstake plus withdraw cycle with mixed unlocked requests", async function () {
    const { staking, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployStakingFixture);

    await mintAndApprove(ssvToken, staking, staker2, STAKE_AMOUNT);
    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);

    await staking.stake(STAKE_AMOUNT);
    await staking.connect(staker2).stake(STAKE_AMOUNT);
    await expectStakingSolvent(staking, ssvToken, cssvToken);

    const user1Full = STAKE_AMOUNT;
    const user2PartA = STAKE_AMOUNT / 4n;
    const user2PartB = STAKE_AMOUNT / 4n;

    await staking.requestUnstake(user1Full);
    await expectStakingSolvent(staking, ssvToken, cssvToken);

    await staking.connect(staker2).requestUnstake(user2PartA);
    await expectStakingSolvent(staking, ssvToken, cssvToken);

    await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN / 2n);
    await staking.connect(staker2).requestUnstake(user2PartB);
    await expectStakingSolvent(staking, ssvToken, cssvToken);

    await networkHelpers.time.increase((DEFAULT_UNSTAKE_COOLDOWN / 2n) + 1n);

    await staking.withdrawUnlocked();
    await expectStakingSolvent(staking, ssvToken, cssvToken);

    await staking.connect(staker2).withdrawUnlocked();
    await expectStakingSolvent(staking, ssvToken, cssvToken);

    await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN / 2n);
    await staking.connect(staker2).withdrawUnlocked();
    await expectStakingSolvent(staking, ssvToken, cssvToken);
  });
});

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvStakingHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { DEFAULT_UNSTAKE_COOLDOWN, STAKE_AMOUNT, ETH_DEDUCTED_DIGITS } from "../../common/constants.ts";

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

    const users = [staker1.address, staker2.address, staker3.address];
    let pendingUnstakes = 0n;
    for (const user of users) {
      const count = await staking.getWithdrawalRequestsCount(user);
      for (let i = 0n; i < count; i++) {
        const [amount] = await staking.getWithdrawalRequest(user, i);
        pendingUnstakes += amount;
      }
    }

    expect(
      ssvBacking,
      "Invariant violated: staking SSV backing must equal cSSV supply plus pending unstakes"
    ).to.equal(cssvSupply + pendingUnstakes);
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

  const impersonate = async (address: string) => {
    await connection.ethers.provider.send("hardhat_impersonateAccount", [address]);
    await connection.ethers.provider.send("hardhat_setBalance", [address, "0x1000000000000000000"]);
    return connection.ethers.getSigner(address);
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

  it("holds through fee sync and ETH reward claims", async function () {
    const { staking, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployStakingFixture);

    await mintAndApprove(ssvToken, staking, staker2, STAKE_AMOUNT);
    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);

    await staking.stake(STAKE_AMOUNT);
    await staking.connect(staker2).stake(STAKE_AMOUNT);
    await expectStakingSolvent(staking, ssvToken, cssvToken);

    // Keep sync deterministic for this test and fund ETH payouts.
    await staking.mockSetDaoTotalEthVUnits(0n);
    await staking.mockSetEthNetworkFee(0n);
    await staker1.sendTransaction({
      to: await staking.getAddress(),
      value: connection.ethers.parseEther("1"),
    });

    // Set rewards and matching packed pool/DAO balances.
    const user1Accrued = 6n * ETH_DEDUCTED_DIGITS;
    const user2Accrued = 9n * ETH_DEDUCTED_DIGITS;
    await staking.mockSetUserAccrued(staker1.address, user1Accrued);
    await staking.mockSetUserAccrued(staker2.address, user2Accrued);
    await staking.mockSetStakingEthPoolBalance(100n);
    await staking.mockSetEthDaoBalance(100n);
    const expectedUser1PayoutShrunk = user1Accrued / ETH_DEDUCTED_DIGITS;
    const expectedUser2PayoutShrunk = user2Accrued / ETH_DEDUCTED_DIGITS;

    const poolBeforeUser1 = await staking.getStakingEthPoolBalance();
    const daoBeforeUser1 = await staking.getEthDaoBalance();
    await staking.claimEthRewards();
    expect(await staking.getUserAccrued(staker1.address)).to.equal(0n);
    expect(await staking.getStakingEthPoolBalance()).to.equal(poolBeforeUser1 - expectedUser1PayoutShrunk);
    expect(await staking.getEthDaoBalance()).to.equal(daoBeforeUser1 - expectedUser1PayoutShrunk);
    await expectStakingSolvent(staking, ssvToken, cssvToken);

    const poolBeforeUser2 = await staking.getStakingEthPoolBalance();
    const daoBeforeUser2 = await staking.getEthDaoBalance();
    await staking.connect(staker2).claimEthRewards();
    expect(await staking.getUserAccrued(staker2.address)).to.equal(0n);
    expect(await staking.getStakingEthPoolBalance()).to.equal(poolBeforeUser2 - expectedUser2PayoutShrunk);
    expect(await staking.getEthDaoBalance()).to.equal(daoBeforeUser2 - expectedUser2PayoutShrunk);
    await expectStakingSolvent(staking, ssvToken, cssvToken);
  });

  it("holds during cSSV transfer settlement path", async function () {
    const { staking, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployStakingFixture);

    await mintAndApprove(ssvToken, staking, staker2, STAKE_AMOUNT);
    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);

    await staking.stake(STAKE_AMOUNT);
    await staking.connect(staker2).stake(STAKE_AMOUNT);
    await expectStakingSolvent(staking, ssvToken, cssvToken);

    // Model cSSV transfer hook settlement as called by the cSSV contract.
    const cssvSigner = await impersonate(await cssvToken.getAddress());
    await staking.mockSetDaoTotalEthVUnits(0n);
    await staking.mockSetEthNetworkFee(0n);
    await staking.mockSetAccEthPerShare(2n * 10n ** 18n);
    await staking.mockSetUserIndex(staker1.address, 10n ** 18n);
    await staking.mockSetUserIndex(staker2.address, 10n ** 18n);

    await staking.connect(cssvSigner).onCSSVTransfer(
      staker1.address,
      staker2.address,
      STAKE_AMOUNT / 2n
    );
    // pending = balance * (accEthPerShare - userIndex) / PRECISION
    //         = STAKE_AMOUNT * (2e18 - 1e18) / 1e18 = STAKE_AMOUNT
    expect(await staking.getUserAccrued(staker1.address)).to.equal(STAKE_AMOUNT);
    expect(await staking.getUserAccrued(staker2.address)).to.equal(STAKE_AMOUNT);
    expect(await staking.getUserIndex(staker1.address)).to.equal(2n * 10n ** 18n);
    expect(await staking.getUserIndex(staker2.address)).to.equal(2n * 10n ** 18n);
    await expectStakingSolvent(staking, ssvToken, cssvToken);

    // Apply the ERC20 transfer in the harness token to complete the flow.
    await cssvToken.transfer(staker2.address, STAKE_AMOUNT / 2n);
    await expectStakingSolvent(staking, ssvToken, cssvToken);
  });

  it("holds when all users fully unstake and withdraw", async function () {
    const { staking, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployStakingFixture);

    await mintAndApprove(ssvToken, staking, staker2, STAKE_AMOUNT);
    await mintAndApprove(ssvToken, staking, staker3, STAKE_AMOUNT);
    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);

    await staking.stake(STAKE_AMOUNT);
    await staking.connect(staker2).stake(STAKE_AMOUNT);
    await staking.connect(staker3).stake(STAKE_AMOUNT);
    await expectStakingSolvent(staking, ssvToken, cssvToken);

    await staking.requestUnstake(STAKE_AMOUNT);
    await staking.connect(staker2).requestUnstake(STAKE_AMOUNT);
    await staking.connect(staker3).requestUnstake(STAKE_AMOUNT);
    await expectStakingSolvent(staking, ssvToken, cssvToken);

    await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + 1n);

    await staking.withdrawUnlocked();
    await staking.connect(staker2).withdrawUnlocked();
    await staking.connect(staker3).withdrawUnlocked();
    await expectStakingSolvent(staking, ssvToken, cssvToken);

    expect(await cssvToken.totalSupply()).to.equal(0n);
    expect(await ssvToken.balanceOf(await staking.getAddress())).to.equal(0n);
  });
});

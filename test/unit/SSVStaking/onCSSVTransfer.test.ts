import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { defaultStakingFixture } from "../../helpers/fixture-presets.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext } from "../../common/helpers.ts";
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";

const PRECISION = 10n ** 18n;
const MIN_STAKE = 1_000_000_000n;

describe("SSVStaking function `onCSSVTransfer()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let staker: HardhatEthersSigner;
  let receiver: HardhatEthersSigner;
  let thirdUser: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [staker, receiver, thirdUser] } = await setupTestContext());
  });

  const deployStakingFixture = async () => defaultStakingFixture(connection);

  async function impersonate(address: string) {
    await connection.ethers.provider.send("hardhat_impersonateAccount", [address]);
    await connection.ethers.provider.send("hardhat_setBalance", [address, "0x1000000000000000000"]);
    return connection.ethers.getSigner(address);
  }

  async function freezeSync(staking: any) {
    await staking.mockSetDaoTotalEthVUnits(0n);
    await staking.mockSetEthNetworkFee(0n);
  }

  async function stakeFor(staking: any, ssvToken: any, user: HardhatEthersSigner, amount: bigint) {
    await ssvToken.connect(user).approve(await staking.getAddress(), amount);
    await staking.connect(user).stake(amount);
  }

  async function simulateCssvTransfer(
    staking: any,
    cssvToken: any,
    cssvSigner: any,
    fromSigner: HardhatEthersSigner,
    to: string,
    amount: bigint
  ) {
    await staking.connect(cssvSigner).onCSSVTransfer(fromSigner.address, to, amount);
    await cssvToken.connect(fromSigner).transfer(to, amount);
  }

  it("Is reverted with 'NotCSSV' when caller is not the cSSV token", async function () {
    const { staking } = await networkHelpers.loadFixture(deployStakingFixture);

    await expect(
      staking.onCSSVTransfer(staker.address, receiver.address, 1n)
    ).to.be.revertedWithCustomError(staking, Errors.NOT_CSSV);
  });

  it("Settles rewards for sender and receiver and updates user indexes", async function () {
    const { staking, cssvToken } = await networkHelpers.loadFixture(deployStakingFixture);

    const cssvAddress = await cssvToken.getAddress();
    const cssvSigner = await impersonate(cssvAddress);
    await staking.mockSetDaoTotalEthVUnits(0n);
    await staking.mockSetEthNetworkFee(0n);

    const accEthPerShare = 2n * PRECISION;
    await staking.mockSetAccEthPerShare(accEthPerShare);
    await staking.mockSetUserIndex(staker.address, PRECISION);
    await staking.mockSetUserIndex(receiver.address, PRECISION);

    const stakerBalance = 100n;
    const receiverBalance = 200n;
    await cssvToken.mint(staker.address, stakerBalance);
    await cssvToken.mint(receiver.address, receiverBalance);

    const tx = await staking.connect(cssvSigner).onCSSVTransfer(
      staker.address,
      receiver.address,
      1n
    );

    const stakerAccrued = await staking.getUserAccrued(staker.address);
    const receiverAccrued = await staking.getUserAccrued(receiver.address);
    expect(stakerAccrued).to.equal(stakerBalance);
    expect(receiverAccrued).to.equal(receiverBalance);

    const stakerIndex = await staking.getUserIndex(staker.address);
    const receiverIndex = await staking.getUserIndex(receiver.address);
    expect(stakerIndex).to.equal(accEthPerShare);
    expect(receiverIndex).to.equal(accEthPerShare);

    await expect(tx)
      .to.emit(staking, Events.REWARDS_SETTLED)
      .withArgs(staker.address, stakerBalance, stakerBalance, accEthPerShare);
    await expect(tx)
      .to.emit(staking, Events.REWARDS_SETTLED)
      .withArgs(receiver.address, receiverBalance, receiverBalance, accEthPerShare);
  });

  it("Distributes rewards proportionally across 3 stakers with different balances", async function () {
    const { staking, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployStakingFixture);

    const amountA = MIN_STAKE;
    const amountB = 2n * MIN_STAKE;
    const amountC = 7n * MIN_STAKE;

    await ssvToken.transfer(receiver.address, amountB);
    await ssvToken.transfer(thirdUser.address, amountC);

    await stakeFor(staking, ssvToken, staker, amountA);
    await stakeFor(staking, ssvToken, receiver, amountB);
    await stakeFor(staking, ssvToken, thirdUser, amountC);

    await freezeSync(staking);
    const accEthPerShare = 5n * PRECISION;
    await staking.mockSetAccEthPerShare(accEthPerShare);

    const cssvSigner = await impersonate(await cssvToken.getAddress());
    await staking.connect(cssvSigner).onCSSVTransfer(staker.address, receiver.address, 0n);
    await staking.connect(cssvSigner).onCSSVTransfer(thirdUser.address, staker.address, 0n);

    const accruedA = await staking.getUserAccrued(staker.address);
    const accruedB = await staking.getUserAccrued(receiver.address);
    const accruedC = await staking.getUserAccrued(thirdUser.address);

    expect(accruedA).to.equal(amountA * 5n);
    expect(accruedB).to.equal(amountB * 5n);
    expect(accruedC).to.equal(amountC * 5n);
  });

  it("Allocates rewards by staking time (A early, B late)", async function () {
    const { staking, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployStakingFixture);

    const amountA = 4n * MIN_STAKE;
    const amountB = 6n * MIN_STAKE;

    await ssvToken.transfer(receiver.address, amountB);

    await stakeFor(staking, ssvToken, staker, amountA);

    await freezeSync(staking);
    await staking.mockSetAccEthPerShare(2n * PRECISION);

    await stakeFor(staking, ssvToken, receiver, amountB);
    await staking.mockSetAccEthPerShare(5n * PRECISION);

    const cssvSigner = await impersonate(await cssvToken.getAddress());
    await staking.connect(cssvSigner).onCSSVTransfer(staker.address, receiver.address, 0n);

    const accruedA = await staking.getUserAccrued(staker.address);
    const accruedB = await staking.getUserAccrued(receiver.address);

    expect(accruedA).to.equal(amountA * 5n);
    expect(accruedB).to.equal(amountB * 3n);
  });

  it("Settles A->B transfer rewards and applies higher future rate to receiver balance", async function () {
    const { staking, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployStakingFixture);

    const amountA = 10n * MIN_STAKE;
    const transferAmount = 4n * MIN_STAKE;

    await stakeFor(staking, ssvToken, staker, amountA);

    await freezeSync(staking);
    await staking.mockSetAccEthPerShare(2n * PRECISION);
    const cssvSigner = await impersonate(await cssvToken.getAddress());

    await simulateCssvTransfer(staking, cssvToken, cssvSigner, staker, receiver.address, transferAmount);

    await staking.mockSetAccEthPerShare(5n * PRECISION);
    await staking.connect(cssvSigner).onCSSVTransfer(staker.address, receiver.address, 0n);

    const accruedA = await staking.getUserAccrued(staker.address);
    const accruedB = await staking.getUserAccrued(receiver.address);

    const expectedA = (amountA * 2n) + ((amountA - transferAmount) * 3n);
    const expectedB = transferAmount * 3n;

    expect(accruedA).to.equal(expectedA);
    expect(accruedB).to.equal(expectedB);
  });

  it("Accrues future rewards for a receiver holding exactly 1 wei cSSV", async function () {
    const { staking, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployStakingFixture);

    const amountA = MIN_STAKE;
    const transferAmount = 1n;

    await stakeFor(staking, ssvToken, staker, amountA);

    await freezeSync(staking);
    const cssvSigner = await impersonate(await cssvToken.getAddress());

    await staking.mockSetAccEthPerShare(2n * PRECISION);
    await simulateCssvTransfer(staking, cssvToken, cssvSigner, staker, receiver.address, transferAmount);

    expect(await cssvToken.balanceOf(receiver.address)).to.equal(transferAmount);
    expect(await staking.getUserAccrued(receiver.address)).to.equal(0n);

    await staking.mockSetAccEthPerShare(3n * PRECISION);
    await staking.connect(cssvSigner).onCSSVTransfer(staker.address, receiver.address, 0n);

    const accruedA = await staking.getUserAccrued(staker.address);
    const accruedB = await staking.getUserAccrued(receiver.address);

    expect(accruedA).to.equal((amountA * 2n) + (amountA - transferAmount));
    expect(accruedB).to.equal(1n);
  });

  it("Handles sequential transfer chain A->B->C with correct per-period reward accumulation", async function () {
    const { staking, ssvToken, cssvToken } = await networkHelpers.loadFixture(deployStakingFixture);

    const amountA = 9n * MIN_STAKE;
    const transferAB = 3n * MIN_STAKE;
    const transferBC = 2n * MIN_STAKE;

    await stakeFor(staking, ssvToken, staker, amountA);

    await freezeSync(staking);
    const cssvSigner = await impersonate(await cssvToken.getAddress());
    await staking.mockSetAccEthPerShare(2n * PRECISION);
    await simulateCssvTransfer(staking, cssvToken, cssvSigner, staker, receiver.address, transferAB);

    await staking.mockSetAccEthPerShare(5n * PRECISION);
    await simulateCssvTransfer(staking, cssvToken, cssvSigner, receiver, thirdUser.address, transferBC);

    await staking.mockSetAccEthPerShare(9n * PRECISION);
    await staking.connect(cssvSigner).onCSSVTransfer(staker.address, receiver.address, 0n);
    await staking.connect(cssvSigner).onCSSVTransfer(thirdUser.address, staker.address, 0n);

    const accruedA = await staking.getUserAccrued(staker.address);
    const accruedB = await staking.getUserAccrued(receiver.address);
    const accruedC = await staking.getUserAccrued(thirdUser.address);

    const expectedA = (9n * MIN_STAKE * 2n) + (6n * MIN_STAKE * 3n) + (6n * MIN_STAKE * 4n);
    const expectedB = (3n * MIN_STAKE * 3n) + (1n * MIN_STAKE * 4n);
    const expectedC = 2n * MIN_STAKE * 4n;

    expect(accruedA).to.equal(expectedA);
    expect(accruedB).to.equal(expectedB);
    expect(accruedC).to.equal(expectedC);
  });

  it("Settles transfer after fee accrual for A=100, B=200 using pendingReward formula", async function () {
    const { staking, cssvToken } = await networkHelpers.loadFixture(deployStakingFixture);

    const cssvSigner = await impersonate(await cssvToken.getAddress());
    await freezeSync(staking);

    const amountA = 100n;
    const amountB = 200n;
    const transferAmount = 50n;
    const userIndexA = 1n * PRECISION;
    const userIndexB = 1n * PRECISION;
    const accEthPerShare = 3n * PRECISION;

    await cssvToken.mint(staker.address, amountA);
    await cssvToken.mint(receiver.address, amountB);
    await staking.mockSetUserIndex(staker.address, userIndexA);
    await staking.mockSetUserIndex(receiver.address, userIndexB);
    await staking.mockSetAccEthPerShare(accEthPerShare);

    await simulateCssvTransfer(staking, cssvToken, cssvSigner, staker, receiver.address, transferAmount);

    const expectedAccruedA = (amountA * (accEthPerShare - userIndexA)) / PRECISION;
    const expectedAccruedB = (amountB * (accEthPerShare - userIndexB)) / PRECISION;

    expect(await staking.getUserAccrued(staker.address)).to.equal(expectedAccruedA);
    expect(await staking.getUserAccrued(receiver.address)).to.equal(expectedAccruedB);
    expect(await staking.getUserIndex(staker.address)).to.equal(accEthPerShare);
    expect(await staking.getUserIndex(receiver.address)).to.equal(accEthPerShare);

    expect(await cssvToken.balanceOf(staker.address)).to.equal(amountA - transferAmount);
    expect(await cssvToken.balanceOf(receiver.address)).to.equal(amountB + transferAmount);
  });

  it("Handles multi-transfer sequence A->B->C with exact settlement at each phase", async function () {
    const { staking, cssvToken } = await networkHelpers.loadFixture(deployStakingFixture);

    const cssvSigner = await impersonate(await cssvToken.getAddress());
    await freezeSync(staking);

    const amountA = 300n;
    const amountB = 200n;
    const amountC = 100n;
    const transferAB = 60n;
    const transferBC = 40n;

    await cssvToken.mint(staker.address, amountA);
    await cssvToken.mint(receiver.address, amountB);
    await cssvToken.mint(thirdUser.address, amountC);
    await staking.mockSetUserIndex(staker.address, 1n * PRECISION);
    await staking.mockSetUserIndex(receiver.address, 1n * PRECISION);
    await staking.mockSetUserIndex(thirdUser.address, 1n * PRECISION);

    await staking.mockSetAccEthPerShare(2n * PRECISION);
    await simulateCssvTransfer(staking, cssvToken, cssvSigner, staker, receiver.address, transferAB);

    const expectedAfterFirstA = (amountA * (2n * PRECISION - 1n * PRECISION)) / PRECISION;
    const expectedAfterFirstB = (amountB * (2n * PRECISION - 1n * PRECISION)) / PRECISION;

    expect(await staking.getUserAccrued(staker.address)).to.equal(expectedAfterFirstA);
    expect(await staking.getUserAccrued(receiver.address)).to.equal(expectedAfterFirstB);
    expect(await staking.getUserAccrued(thirdUser.address)).to.equal(0n);
    expect(await staking.getUserIndex(staker.address)).to.equal(2n * PRECISION);
    expect(await staking.getUserIndex(receiver.address)).to.equal(2n * PRECISION);
    expect(await staking.getUserIndex(thirdUser.address)).to.equal(1n * PRECISION);
    expect(await cssvToken.balanceOf(staker.address)).to.equal(amountA - transferAB);
    expect(await cssvToken.balanceOf(receiver.address)).to.equal(amountB + transferAB);
    expect(await cssvToken.balanceOf(thirdUser.address)).to.equal(amountC);

    await staking.mockSetAccEthPerShare(4n * PRECISION);
    await simulateCssvTransfer(staking, cssvToken, cssvSigner, receiver, thirdUser.address, transferBC);

    const balanceAAfterFirst = amountA - transferAB;
    const balanceBAfterFirst = amountB + transferAB;
    const balanceBAfterSecond = balanceBAfterFirst - transferBC;
    const balanceCAfterSecond = amountC + transferBC;
    const expectedAfterSecondA = expectedAfterFirstA;
    const expectedAfterSecondB =
      expectedAfterFirstB + ((balanceBAfterFirst * (4n * PRECISION - 2n * PRECISION)) / PRECISION);
    const expectedAfterSecondC = (amountC * (4n * PRECISION - 1n * PRECISION)) / PRECISION;

    expect(await staking.getUserAccrued(staker.address)).to.equal(expectedAfterSecondA);
    expect(await staking.getUserAccrued(receiver.address)).to.equal(expectedAfterSecondB);
    expect(await staking.getUserAccrued(thirdUser.address)).to.equal(expectedAfterSecondC);
    expect(await staking.getUserIndex(staker.address)).to.equal(2n * PRECISION);
    expect(await staking.getUserIndex(receiver.address)).to.equal(4n * PRECISION);
    expect(await staking.getUserIndex(thirdUser.address)).to.equal(4n * PRECISION);
    expect(await cssvToken.balanceOf(staker.address)).to.equal(balanceAAfterFirst);
    expect(await cssvToken.balanceOf(receiver.address)).to.equal(balanceBAfterSecond);
    expect(await cssvToken.balanceOf(thirdUser.address)).to.equal(balanceCAfterSecond);

    await staking.mockSetAccEthPerShare(5n * PRECISION);
    await staking.connect(cssvSigner).onCSSVTransfer(thirdUser.address, staker.address, 0n);
    await staking.connect(cssvSigner).onCSSVTransfer(receiver.address, staker.address, 0n);

    const expectedAccruedA =
      expectedAfterSecondA + ((balanceAAfterFirst * (5n * PRECISION - 2n * PRECISION)) / PRECISION);
    const expectedAccruedB =
      expectedAfterSecondB + ((balanceBAfterSecond * (5n * PRECISION - 4n * PRECISION)) / PRECISION);
    const expectedAccruedC =
      expectedAfterSecondC + ((balanceCAfterSecond * (5n * PRECISION - 4n * PRECISION)) / PRECISION);

    expect(await staking.getUserAccrued(staker.address)).to.equal(expectedAccruedA);
    expect(await staking.getUserAccrued(receiver.address)).to.equal(expectedAccruedB);
    expect(await staking.getUserAccrued(thirdUser.address)).to.equal(expectedAccruedC);

    expect(await staking.getUserIndex(staker.address)).to.equal(5n * PRECISION);
    expect(await staking.getUserIndex(receiver.address)).to.equal(5n * PRECISION);
    expect(await staking.getUserIndex(thirdUser.address)).to.equal(5n * PRECISION);
  });

  it("Settles both users' pending rewards before transfer and applies later rewards to post-transfer balances", async function () {
    const { staking, cssvToken } = await networkHelpers.loadFixture(deployStakingFixture);

    const cssvSigner = await impersonate(await cssvToken.getAddress());
    await freezeSync(staking);

    const amountA = 150n;
    const amountB = 250n;
    const transferAmount = 100n;
    const userIndexA = PRECISION / 2n;
    const userIndexB = 1n * PRECISION;
    const accBeforeTransfer = 3n * PRECISION;
    const accAfterTransfer = 4n * PRECISION;

    await cssvToken.mint(staker.address, amountA);
    await cssvToken.mint(receiver.address, amountB);
    await staking.mockSetUserIndex(staker.address, userIndexA);
    await staking.mockSetUserIndex(receiver.address, userIndexB);

    await staking.mockSetAccEthPerShare(accBeforeTransfer);
    await simulateCssvTransfer(staking, cssvToken, cssvSigner, staker, receiver.address, transferAmount);

    await staking.mockSetAccEthPerShare(accAfterTransfer);
    await staking.connect(cssvSigner).onCSSVTransfer(staker.address, receiver.address, 0n);

    const expectedInitialA = (amountA * (accBeforeTransfer - userIndexA)) / PRECISION; // 375
    const expectedInitialB = (amountB * (accBeforeTransfer - userIndexB)) / PRECISION; // 500
    const expectedAdditionalA = ((amountA - transferAmount) * (accAfterTransfer - accBeforeTransfer)) / PRECISION; // 50
    const expectedAdditionalB = ((amountB + transferAmount) * (accAfterTransfer - accBeforeTransfer)) / PRECISION; // 350

    expect(await staking.getUserAccrued(staker.address)).to.equal(expectedInitialA + expectedAdditionalA);
    expect(await staking.getUserAccrued(receiver.address)).to.equal(expectedInitialB + expectedAdditionalB);
    expect(await staking.getUserIndex(staker.address)).to.equal(accAfterTransfer);
    expect(await staking.getUserIndex(receiver.address)).to.equal(accAfterTransfer);
  });
});

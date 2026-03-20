import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { defaultStakingFixture } from "../../helpers/fixture-presets.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext } from "../../common/helpers.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { STAKE_AMOUNT, ETH_DEDUCTED_DIGITS, DEFAULT_UNSTAKE_COOLDOWN } from "../../common/constants.ts";
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";
import { deployMultisig, multisigExec } from "../../helpers/multisig.ts";

describe("SSVStaking function `stake()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let staker: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [staker, other] } = await setupTestContext());
  });

  const deployStakingFixture = async () => defaultStakingFixture(connection);

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

  it("Accepts exactly the minimum stake amount", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const minAmount = 1_000_000_000n;
    await ssvToken.approve(await staking.getAddress(), minAmount);

    await expect(staking.stake(minAmount))
      .to.emit(staking, Events.STAKED)
      .withArgs(staker.address, minAmount);
  });

  it("Accepts a stake amount exactly 1 above the minimum", async function () {
    const { staking, ssvToken, cssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const aboveMinimum = 1_000_000_001n;
    await ssvToken.approve(await staking.getAddress(), aboveMinimum);

    await expect(staking.stake(aboveMinimum))
      .to.emit(staking, Events.STAKED)
      .withArgs(staker.address, aboveMinimum);

    expect(await cssvToken.balanceOf(staker.address)).to.equal(aboveMinimum);
  });

  it("Is reverted with 'StakeTooLow' when staking zero amount", async function () {
    const { staking } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await expect(staking.stake(0n)).to.be.revertedWithCustomError(
      staking,
      Errors.STAKE_TOO_LOW
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

  it("Is reverted when staking without approval", async function () {
    const { staking } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await expect(staking.stake(STAKE_AMOUNT)).to.be.revertedWith("ERC20: insufficient allowance");
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

  it("Settles rewards correctly when staking again after a partial unstake", async function () {
    const { staking, ssvToken, cssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const firstStake = STAKE_AMOUNT;
    const partialUnstake = STAKE_AMOUNT / 2n;
    const secondStake = STAKE_AMOUNT / 2n;

    await ssvToken.approve(
      await staking.getAddress(),
      firstStake + secondStake,
    );

    const stake1 = await staking.stake(firstStake);
    const receipt1 = await stake1.wait();

    await staking.mockSetDaoTotalEthVUnits(10_000n);
    await staking.mockSetEthNetworkFee(1n);

    await connection.ethers.provider.send("hardhat_mine", ["0xA"]);

    const unstakeTx = await staking.requestUnstake(partialUnstake);
    const unstakeReceipt = await unstakeTx.wait();

    const phase1Blocks = BigInt(unstakeReceipt.blockNumber - receipt1.blockNumber);
    const phase1ExpectedRewards = phase1Blocks * ETH_DEDUCTED_DIGITS;
    expect(await staking.getUserAccrued(staker.address)).to.equal(
      phase1ExpectedRewards,
    );
    expect(await cssvToken.balanceOf(staker.address)).to.equal(
      firstStake - partialUnstake,
    );

    await connection.ethers.provider.send("hardhat_mine", ["0xA"]);

    const stake2 = await staking.stake(secondStake);
    const receipt2 = await stake2.wait();

    const phase2Blocks = BigInt(receipt2.blockNumber - unstakeReceipt.blockNumber);
    const phase2ExpectedRewards = phase2Blocks * ETH_DEDUCTED_DIGITS;
    const expectedAccruedAfterRestake =
      phase1ExpectedRewards + phase2ExpectedRewards;

    expect(await staking.getUserAccrued(staker.address)).to.equal(
      expectedAccruedAfterRestake,
    );
    expect(await cssvToken.balanceOf(staker.address)).to.equal(firstStake);

    const userIndex = await staking.getUserIndex(staker.address);
    const accEthPerShare = await staking.getAccEthPerShare();
    expect(userIndex).to.equal(accEthPerShare);
  });

  it("Multisig contract stakes SSV tokens", async function () {
    const { staking, ssvToken, cssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const multisig = await deployMultisig(connection.ethers);
    const multisigAddress = await multisig.getAddress();
    const stakingAddress = await staking.getAddress();

    await ssvToken.mint(multisigAddress, STAKE_AMOUNT);
    await multisigExec(multisig, ssvToken, "approve", [stakingAddress, STAKE_AMOUNT]);

    const ssvBefore = await ssvToken.balanceOf(multisigAddress);
    const cssvBefore = await cssvToken.balanceOf(multisigAddress);
    const contractSsvBefore = await ssvToken.balanceOf(stakingAddress);

    const tx = await multisigExec(multisig, staking, "stake", [STAKE_AMOUNT]);

    await expect(tx)
      .to.emit(staking, Events.STAKED)
      .withArgs(multisigAddress, STAKE_AMOUNT);

    expect(await ssvToken.balanceOf(multisigAddress)).to.equal(ssvBefore - STAKE_AMOUNT);
    expect(await cssvToken.balanceOf(multisigAddress)).to.equal(cssvBefore + STAKE_AMOUNT);
    expect(await ssvToken.balanceOf(stakingAddress)).to.equal(contractSsvBefore + STAKE_AMOUNT);
  });

  it("Multisig contract stakes multiple times", async function () {
    const { staking, ssvToken, cssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const multisig = await deployMultisig(connection.ethers);
    const multisigAddress = await multisig.getAddress();
    const stakingAddress = await staking.getAddress();

    const totalAmount = STAKE_AMOUNT * 3n;
    await ssvToken.mint(multisigAddress, totalAmount);
    await multisigExec(multisig, ssvToken, "approve", [stakingAddress, totalAmount]);

    await multisigExec(multisig, staking, "stake", [STAKE_AMOUNT]);
    expect(await cssvToken.balanceOf(multisigAddress)).to.equal(STAKE_AMOUNT);

    await multisigExec(multisig, staking, "stake", [STAKE_AMOUNT]);
    expect(await cssvToken.balanceOf(multisigAddress)).to.equal(STAKE_AMOUNT * 2n);

    await multisigExec(multisig, staking, "stake", [STAKE_AMOUNT]);
    expect(await cssvToken.balanceOf(multisigAddress)).to.equal(STAKE_AMOUNT * 3n);

    expect(await ssvToken.balanceOf(multisigAddress)).to.equal(0n);
    expect(await ssvToken.balanceOf(stakingAddress)).to.equal(totalAmount);
  });

  it("Multisig earns rewards after staking", async function () {
    const { staking, ssvToken, cssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const multisig = await deployMultisig(connection.ethers);
    const multisigAddress = await multisig.getAddress();
    const stakingAddress = await staking.getAddress();

    const totalMint = STAKE_AMOUNT * 2n;
    await ssvToken.mint(multisigAddress, totalMint);
    await multisigExec(multisig, ssvToken, "approve", [stakingAddress, totalMint]);
    await multisigExec(multisig, staking, "stake", [STAKE_AMOUNT]);

    const packedReward = 10_000_000_000n;
    await staking.mockSetStakingEthPoolBalance(0n);
    await staking.mockSetEthDaoBalance(packedReward);

    await multisigExec(multisig, staking, "stake", [STAKE_AMOUNT]);

    const accrued = await staking.getUserAccrued(multisigAddress);
    expect(accrued).to.equal(packedReward * ETH_DEDUCTED_DIGITS);
  });

  it("Multisig claims ETH rewards", async function () {
    const { staking, ssvToken, cssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const multisig = await deployMultisig(connection.ethers);
    const multisigAddress = await multisig.getAddress();
    const stakingAddress = await staking.getAddress();

    await ssvToken.mint(multisigAddress, STAKE_AMOUNT);
    await multisigExec(multisig, ssvToken, "approve", [stakingAddress, STAKE_AMOUNT]);
    await multisigExec(multisig, staking, "stake", [STAKE_AMOUNT]);

    const packedReward = 10_000_000_000n;
    await staking.mockSetStakingEthPoolBalance(packedReward);
    await staking.mockSetEthDaoBalance(packedReward);

    await staker.sendTransaction({
      to: stakingAddress,
      value: connection.ethers.parseEther("1"),
    });

    await staking.mockSetUserAccrued(multisigAddress, packedReward * ETH_DEDUCTED_DIGITS);

    const ethBefore = await connection.ethers.provider.getBalance(multisigAddress);
    const tx = await multisigExec(multisig, staking, "claimEthRewards", []);

    const expectedPayout = packedReward * ETH_DEDUCTED_DIGITS;
    await expect(tx)
      .to.emit(staking, Events.REWARDS_CLAIMED)
      .withArgs(multisigAddress, expectedPayout);

    const ethAfter = await connection.ethers.provider.getBalance(multisigAddress);
    expect(ethAfter - ethBefore).to.equal(expectedPayout);
  });

  it("Multisig claims with dust — remainder preserved in accrued", async function () {
    const { staking, ssvToken, cssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const multisig = await deployMultisig(connection.ethers);
    const multisigAddress = await multisig.getAddress();
    const stakingAddress = await staking.getAddress();

    await ssvToken.mint(multisigAddress, STAKE_AMOUNT);
    await multisigExec(multisig, ssvToken, "approve", [stakingAddress, STAKE_AMOUNT]);
    await multisigExec(multisig, staking, "stake", [STAKE_AMOUNT]);

    const accruedWithDust = 123_456_789n;
    const expectedPayout = accruedWithDust - (accruedWithDust % ETH_DEDUCTED_DIGITS);
    const expectedDust = accruedWithDust % ETH_DEDUCTED_DIGITS;

    await staking.mockSetStakingEthPoolBalance(100_000_000_000n);
    await staking.mockSetEthDaoBalance(100_000_000_000n);
    await staking.mockSetUserAccrued(multisigAddress, accruedWithDust);

    await staker.sendTransaction({
      to: stakingAddress,
      value: connection.ethers.parseEther("1"),
    });

    const tx = await multisigExec(multisig, staking, "claimEthRewards", []);

    await expect(tx)
      .to.emit(staking, Events.REWARDS_CLAIMED)
      .withArgs(multisigAddress, expectedPayout);

    const accruedAfter = await staking.getUserAccrued(multisigAddress);
    expect(accruedAfter).to.equal(expectedDust);
  });

  it("Multisig transfers cSSV to EOA", async function () {
    const { staking, ssvToken, cssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const multisig = await deployMultisig(connection.ethers);
    const multisigAddress = await multisig.getAddress();
    const stakingAddress = await staking.getAddress();

    await ssvToken.mint(multisigAddress, STAKE_AMOUNT);
    await multisigExec(multisig, ssvToken, "approve", [stakingAddress, STAKE_AMOUNT]);
    await multisigExec(multisig, staking, "stake", [STAKE_AMOUNT]);

    const transferAmount = STAKE_AMOUNT / 2n;
    await multisigExec(multisig, cssvToken, "transfer", [other.address, transferAmount]);

    expect(await cssvToken.balanceOf(multisigAddress)).to.equal(STAKE_AMOUNT - transferAmount);
    expect(await cssvToken.balanceOf(other.address)).to.equal(transferAmount);
  });

  it("EOA transfers cSSV to multisig", async function () {
    const { staking, ssvToken, cssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const multisig = await deployMultisig(connection.ethers);
    const multisigAddress = await multisig.getAddress();
    const stakingAddress = await staking.getAddress();

    await ssvToken.approve(stakingAddress, STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    const transferAmount = STAKE_AMOUNT / 2n;
    await cssvToken.connect(staker).transfer(multisigAddress, transferAmount);

    expect(await cssvToken.balanceOf(staker.address)).to.equal(STAKE_AMOUNT - transferAmount);
    expect(await cssvToken.balanceOf(multisigAddress)).to.equal(transferAmount);
  });

  it("Multisig transfers cSSV to another multisig", async function () {
    const { staking, ssvToken, cssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const multisig1 = await deployMultisig(connection.ethers);
    const multisig2 = await deployMultisig(connection.ethers);
    const ms1Address = await multisig1.getAddress();
    const ms2Address = await multisig2.getAddress();
    const stakingAddress = await staking.getAddress();

    await ssvToken.mint(ms1Address, STAKE_AMOUNT);
    await multisigExec(multisig1, ssvToken, "approve", [stakingAddress, STAKE_AMOUNT]);
    await multisigExec(multisig1, staking, "stake", [STAKE_AMOUNT]);

    const transferAmount = STAKE_AMOUNT / 2n;
    await multisigExec(multisig1, cssvToken, "transfer", [ms2Address, transferAmount]);

    expect(await cssvToken.balanceOf(ms1Address)).to.equal(STAKE_AMOUNT - transferAmount);
    expect(await cssvToken.balanceOf(ms2Address)).to.equal(transferAmount);
  });

  it("Multisig requests unstake", async function () {
    const { staking, ssvToken, cssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const multisig = await deployMultisig(connection.ethers);
    const multisigAddress = await multisig.getAddress();
    const stakingAddress = await staking.getAddress();

    await ssvToken.mint(multisigAddress, STAKE_AMOUNT);
    await multisigExec(multisig, ssvToken, "approve", [stakingAddress, STAKE_AMOUNT]);
    await multisigExec(multisig, staking, "stake", [STAKE_AMOUNT]);

    const unstakeAmount = STAKE_AMOUNT / 2n;
    const tx = await multisigExec(multisig, staking, "requestUnstake", [unstakeAmount]);
    const block = await connection.ethers.provider.getBlock(tx.blockNumber);
    const expectedUnlockTime = BigInt(block!.timestamp) + DEFAULT_UNSTAKE_COOLDOWN;

    await expect(tx)
      .to.emit(staking, Events.UNSTAKE_REQUESTED)
      .withArgs(multisigAddress, unstakeAmount, expectedUnlockTime);

    expect(await cssvToken.balanceOf(multisigAddress)).to.equal(STAKE_AMOUNT - unstakeAmount);

    const requestCount = await staking.getWithdrawalRequestsCount(multisigAddress);
    expect(requestCount).to.equal(1n);

    const [amount, unlockTime] = await staking.getWithdrawalRequest(multisigAddress, 0);
    expect(amount).to.equal(unstakeAmount);
    expect(unlockTime).to.equal(expectedUnlockTime);
  });

  it("Multisig creates multiple unstake requests", async function () {
    const { staking, ssvToken, cssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const multisig = await deployMultisig(connection.ethers);
    const multisigAddress = await multisig.getAddress();
    const stakingAddress = await staking.getAddress();

    await ssvToken.mint(multisigAddress, STAKE_AMOUNT);
    await multisigExec(multisig, ssvToken, "approve", [stakingAddress, STAKE_AMOUNT]);
    await multisigExec(multisig, staking, "stake", [STAKE_AMOUNT]);

    const amount1 = STAKE_AMOUNT / 4n;
    const amount2 = STAKE_AMOUNT / 4n;
    const amount3 = STAKE_AMOUNT / 4n;

    const tx1 = await multisigExec(multisig, staking, "requestUnstake", [amount1]);
    await networkHelpers.time.increase(100n);
    const tx2 = await multisigExec(multisig, staking, "requestUnstake", [amount2]);
    await networkHelpers.time.increase(100n);
    const tx3 = await multisigExec(multisig, staking, "requestUnstake", [amount3]);

    const requestCount = await staking.getWithdrawalRequestsCount(multisigAddress);
    expect(requestCount).to.equal(3n);

    const [a1] = await staking.getWithdrawalRequest(multisigAddress, 0);
    const [a2] = await staking.getWithdrawalRequest(multisigAddress, 1);
    const [a3] = await staking.getWithdrawalRequest(multisigAddress, 2);
    expect(a1).to.equal(amount1);
    expect(a2).to.equal(amount2);
    expect(a3).to.equal(amount3);

    expect(await cssvToken.balanceOf(multisigAddress)).to.equal(STAKE_AMOUNT - amount1 - amount2 - amount3);
  });

  it("Multisig requests unstake after earning rewards", async function () {
    const { staking, ssvToken, cssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const multisig = await deployMultisig(connection.ethers);
    const multisigAddress = await multisig.getAddress();
    const stakingAddress = await staking.getAddress();

    await ssvToken.mint(multisigAddress, STAKE_AMOUNT);
    await multisigExec(multisig, ssvToken, "approve", [stakingAddress, STAKE_AMOUNT]);
    await multisigExec(multisig, staking, "stake", [STAKE_AMOUNT]);

    const packedReward = 10_000_000_000n;
    await staking.mockSetStakingEthPoolBalance(0n);
    await staking.mockSetEthDaoBalance(packedReward);

    const accruedBefore = await staking.getUserAccrued(multisigAddress);
    expect(accruedBefore).to.equal(0n);

    await multisigExec(multisig, staking, "requestUnstake", [STAKE_AMOUNT / 2n]);

    const accruedAfter = await staking.getUserAccrued(multisigAddress);
    expect(accruedAfter).to.equal(packedReward * ETH_DEDUCTED_DIGITS);
    expect(await cssvToken.balanceOf(multisigAddress)).to.equal(STAKE_AMOUNT / 2n);
  });

  it("Multisig withdraws unlocked SSV", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const multisig = await deployMultisig(connection.ethers);
    const multisigAddress = await multisig.getAddress();
    const stakingAddress = await staking.getAddress();

    await ssvToken.mint(multisigAddress, STAKE_AMOUNT);
    await multisigExec(multisig, ssvToken, "approve", [stakingAddress, STAKE_AMOUNT]);
    await multisigExec(multisig, staking, "stake", [STAKE_AMOUNT]);
    await multisigExec(multisig, staking, "requestUnstake", [STAKE_AMOUNT]);

    await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + 1n);

    const ssvBefore = await ssvToken.balanceOf(multisigAddress);
    const tx = await multisigExec(multisig, staking, "withdrawUnlocked", []);

    await expect(tx)
      .to.emit(staking, Events.UNSTAKE_WITHDRAWN)
      .withArgs(multisigAddress, STAKE_AMOUNT);

    expect(await ssvToken.balanceOf(multisigAddress)).to.equal(ssvBefore + STAKE_AMOUNT);
    expect(await staking.getWithdrawalRequestsCount(multisigAddress)).to.equal(0n);
  });

  it("Multisig withdraws multiple matured requests", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const multisig = await deployMultisig(connection.ethers);
    const multisigAddress = await multisig.getAddress();
    const stakingAddress = await staking.getAddress();

    await ssvToken.mint(multisigAddress, STAKE_AMOUNT);
    await multisigExec(multisig, ssvToken, "approve", [stakingAddress, STAKE_AMOUNT]);
    await multisigExec(multisig, staking, "stake", [STAKE_AMOUNT]);

    const amount1 = STAKE_AMOUNT / 4n;
    const amount2 = STAKE_AMOUNT / 4n;
    const amount3 = STAKE_AMOUNT / 4n;

    await multisigExec(multisig, staking, "requestUnstake", [amount1]);
    await multisigExec(multisig, staking, "requestUnstake", [amount2]);
    await multisigExec(multisig, staking, "requestUnstake", [amount3]);

    expect(await staking.getWithdrawalRequestsCount(multisigAddress)).to.equal(3n);

    await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + 1n);

    const ssvBefore = await ssvToken.balanceOf(multisigAddress);
    const totalWithdrawn = amount1 + amount2 + amount3;
    const tx = await multisigExec(multisig, staking, "withdrawUnlocked", []);

    await expect(tx)
      .to.emit(staking, Events.UNSTAKE_WITHDRAWN)
      .withArgs(multisigAddress, totalWithdrawn);

    expect(await ssvToken.balanceOf(multisigAddress)).to.equal(ssvBefore + totalWithdrawn);
    expect(await staking.getWithdrawalRequestsCount(multisigAddress)).to.equal(0n);
  });

  it("Multisig complete flow: stake -> earn -> claim -> unstake -> withdraw", async function () {
    const { staking, ssvToken, cssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const multisig = await deployMultisig(connection.ethers);
    const multisigAddress = await multisig.getAddress();
    const stakingAddress = await staking.getAddress();

    await ssvToken.mint(multisigAddress, STAKE_AMOUNT);
    await multisigExec(multisig, ssvToken, "approve", [stakingAddress, STAKE_AMOUNT]);
    await multisigExec(multisig, staking, "stake", [STAKE_AMOUNT]);
    expect(await cssvToken.balanceOf(multisigAddress)).to.equal(STAKE_AMOUNT);

    const packedReward = 10_000_000_000n;
    const rewardWei = packedReward * ETH_DEDUCTED_DIGITS;
    await staking.mockSetStakingEthPoolBalance(packedReward);
    await staking.mockSetEthDaoBalance(packedReward);
    await staking.mockSetUserAccrued(multisigAddress, rewardWei);
    await staker.sendTransaction({
      to: stakingAddress,
      value: connection.ethers.parseEther("1"),
    });

    const ethBefore = await connection.ethers.provider.getBalance(multisigAddress);
    await multisigExec(multisig, staking, "claimEthRewards", []);
    const ethAfter = await connection.ethers.provider.getBalance(multisigAddress);
    expect(ethAfter - ethBefore).to.equal(rewardWei);

    await multisigExec(multisig, staking, "requestUnstake", [STAKE_AMOUNT]);
    expect(await cssvToken.balanceOf(multisigAddress)).to.equal(0n);

    await networkHelpers.time.increase(DEFAULT_UNSTAKE_COOLDOWN + 1n);

    const ssvBefore = await ssvToken.balanceOf(multisigAddress);
    await multisigExec(multisig, staking, "withdrawUnlocked", []);
    expect(await ssvToken.balanceOf(multisigAddress)).to.equal(ssvBefore + STAKE_AMOUNT);
    expect(await staking.getWithdrawalRequestsCount(multisigAddress)).to.equal(0n);
  });

  it("Mixed EOA and multisig: EOA stakes, transfers cSSV to multisig, multisig claims rewards", async function () {
    const { staking, ssvToken, cssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const multisig = await deployMultisig(connection.ethers);
    const multisigAddress = await multisig.getAddress();
    const stakingAddress = await staking.getAddress();

    await ssvToken.approve(stakingAddress, STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    const packedReward = 10_000_000_000n;
    const rewardWei = packedReward * ETH_DEDUCTED_DIGITS;
    await staking.mockSetStakingEthPoolBalance(packedReward);
    await staking.mockSetEthDaoBalance(packedReward);
    await staker.sendTransaction({
      to: stakingAddress,
      value: connection.ethers.parseEther("1"),
    });

    await cssvToken.connect(staker).transfer(multisigAddress, STAKE_AMOUNT);
    expect(await cssvToken.balanceOf(multisigAddress)).to.equal(STAKE_AMOUNT);
    expect(await cssvToken.balanceOf(staker.address)).to.equal(0n);

    await staking.mockSetUserAccrued(multisigAddress, rewardWei);

    const ethBefore = await connection.ethers.provider.getBalance(multisigAddress);
    const tx = await multisigExec(multisig, staking, "claimEthRewards", []);

    await expect(tx)
      .to.emit(staking, Events.REWARDS_CLAIMED)
      .withArgs(multisigAddress, rewardWei);

    const ethAfter = await connection.ethers.provider.getBalance(multisigAddress);
    expect(ethAfter - ethBefore).to.equal(rewardWei);
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
});

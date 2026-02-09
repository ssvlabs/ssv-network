import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvStakingHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { STAKE_AMOUNT, ETH_DEDUCTED_DIGITS } from "../../common/constants.ts";
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVStaking function `syncFees()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let staker: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [staker] = await connection.ethers.getSigners();
  });

  const deployStakingFixture = async () => ssvStakingHarnessFixture(connection);

  it("Updates staking pool balance and emits FeesSynced event", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await trackGas(
      staking.stake(STAKE_AMOUNT),
      [GasGroup.STAKE_SSV]
    );

    const newFees = 1_000_000_000n;
    await staking.mockSetStakingEthPoolBalance(0n);
    await staking.mockSetEthDaoBalance(newFees);

    const tx = await trackGas(
      staking.syncFees(),
      [GasGroup.SYNC_FEES]
    );

    // newFeesWei = newFees * 1e7 = 1e16
    // totalStaked = 10 ETH = 10e18
    // accDelta = (1e16 * 1e18) / 10e18 = 1e16 / 10 = 1e15
    await expect(tx).to.emit(staking, Events.FEES_SYNCED).withArgs(newFees * ETH_DEDUCTED_DIGITS, 10_000_000_000_000n);

    const poolBalance = await staking.getStakingEthPoolBalance();
    expect(poolBalance).to.equal(newFees);
  });

  it("Updates accEthPerShare when new fees are available and total staked is non-zero", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await trackGas(
      staking.stake(STAKE_AMOUNT),
      [GasGroup.STAKE_SSV]
    );

    const accBefore = await staking.getAccEthPerShare();

    const newFees = 1_000_000_000n;
    await staking.mockSetStakingEthPoolBalance(0n);
    await staking.mockSetEthDaoBalance(newFees);

    await trackGas(
      staking.syncFees(),
      [GasGroup.SYNC_FEES]
    );

    const accAfter = await staking.getAccEthPerShare();
    
    // Calculation: newFeesWei = newFees * 1e7 = 1e16
    // accDelta = (1e16 * 1e18) / STAKE_AMOUNT (10 * 1e18) = 1e16 / 10 = 1e15
    const expectedDelta = (newFees * ETH_DEDUCTED_DIGITS * 1_000_000_000_000_000_000n) / STAKE_AMOUNT;
    expect(accAfter - accBefore).to.equal(expectedDelta);
  });

  it("Calculates and syncs fees based on network usage (natural accrual)", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    // Initial sync to set baseline
    await staking.mockSetStakingEthPoolBalance(0n);
    await staking.mockSetEthDaoBalance(0n);
    await staking.syncFees();

    const accBefore = await staking.getAccEthPerShare();
    const poolBalanceBefore = await staking.getStakingEthPoolBalance();

    // Setup network parameters for accrual
    const vUnits = 10_000n; // 1 validator * 10000 precision
    const fee = 500n; // 500 wei per block per validator
    await staking.mockSetDaoTotalEthVUnits(vUnits);
    await staking.mockSetEthNetworkFee(fee);
    // Reset index block to current
    const setDaoTx = await staking.mockSetEthDaoBalance(0n); 
    const setDaoReceipt = await setDaoTx.wait();

    // Mine blocks
    const blocksToMine = 10;
    await connection.ethers.provider.send("hardhat_mine", ["0xA"]); // 10 blocks

    const receipt = await trackGas(
      staking.syncFees(),
      [GasGroup.SYNC_FEES]
    );
    
    const blocksElapsed = BigInt(receipt.blockNumber - setDaoReceipt!.blockNumber);
    // earnings = (blocks * fee * vUnits) / VUNITS_PRECISION
    // vUnits = 10000, PRECISION = 10000 -> factor is 1
    // fee = 500
    // earnings = blocks * 500
    const expectedEarnings = blocksElapsed * fee;
    const expectedEarningsWei = expectedEarnings * ETH_DEDUCTED_DIGITS; // expand

    const accAfter = await staking.getAccEthPerShare();
    
    // delta = (earningsWei * 1e18) / STAKE_AMOUNT
    const expectedDelta = (expectedEarningsWei * 1_000_000_000_000_000_000n) / STAKE_AMOUNT;
    expect(accAfter - accBefore).to.equal(expectedDelta);

    const poolBalanceAfter = await staking.getStakingEthPoolBalance();
    expect(poolBalanceAfter).to.equal(expectedEarnings);
  });

  it("Does not emit FeesSynced or update accEthPerShare when no new fees (current == previous)", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await trackGas(
      staking.stake(STAKE_AMOUNT),
      [GasGroup.STAKE_SSV]
    );

    const currentBalance = 1_000_000_000n;
    await staking.mockSetStakingEthPoolBalance(currentBalance);
    await staking.mockSetEthDaoBalance(currentBalance);

    const accBefore = await staking.getAccEthPerShare();

    const tx = await trackGas(
      staking.syncFees(),
      [GasGroup.SYNC_FEES]
    );

    await expect(tx).to.not.emit(staking, Events.FEES_SYNCED);

    const accAfter = await staking.getAccEthPerShare();
    expect(accAfter).to.equal(accBefore);

    const poolBalance = await staking.getStakingEthPoolBalance();
    expect(poolBalance).to.equal(currentBalance);
  });

  it("Updates pool balance without emitting FeesSynced when current < previous (inconsistent state)", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    const highBalance = 2_000_000_000n;
    const lowBalance = 1_000_000_000n;

    // Set pool balance higher than DAO balance (simulating inconsistency or deflation)
    await staking.mockSetStakingEthPoolBalance(highBalance);
    await staking.mockSetEthDaoBalance(lowBalance);

    const accBefore = await staking.getAccEthPerShare();

    const tx = await staking.syncFees();

    await expect(tx).to.not.emit(staking, Events.FEES_SYNCED);

    const accAfter = await staking.getAccEthPerShare();
    expect(accAfter).to.equal(accBefore);

    // Should update pool balance to current (low)
    const poolBalance = await staking.getStakingEthPoolBalance();
    expect(poolBalance).to.equal(lowBalance);
  });

  it("Does not change accEthPerShare but updates pool balance when total staked is zero", async function () {
    const { staking } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const accBefore = await staking.getAccEthPerShare();

    const newFees = 1_000_000_000n;
    await staking.mockSetStakingEthPoolBalance(0n);
    await staking.mockSetEthDaoBalance(newFees);

    await trackGas(
      staking.syncFees(),
      [GasGroup.SYNC_FEES]
    );

    const accAfter = await staking.getAccEthPerShare();
    expect(accAfter).to.equal(accBefore);

    const poolBalance = await staking.getStakingEthPoolBalance();
    expect(poolBalance).to.equal(newFees);
  });

  it("Syncs DAO balance correctly", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await trackGas(
      staking.stake(STAKE_AMOUNT),
      [GasGroup.STAKE_SSV]
    );

    const newBalance = 5_000_000_000n;
    await staking.mockSetEthDaoBalance(newBalance);

    await trackGas(
      staking.syncFees(),
      [GasGroup.SYNC_FEES]
    );

    const ethDaoBalance = await staking.getEthDaoBalance();
    expect(ethDaoBalance).to.equal(newBalance);
  });

  it("Can be called multiple times", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await trackGas(
      staking.stake(STAKE_AMOUNT),
      [GasGroup.STAKE_SSV]
    );

    await staking.mockSetStakingEthPoolBalance(0n);
    await staking.mockSetEthDaoBalance(1_000_000_000n);
    await trackGas(
      staking.syncFees(),
      [GasGroup.SYNC_FEES]
    );

    const accAfterFirst = await staking.getAccEthPerShare();

    await staking.mockSetEthDaoBalance(2_000_000_000n);
    await trackGas(
      staking.syncFees(),
      [GasGroup.SYNC_FEES]
    );

    const accAfterSecond = await staking.getAccEthPerShare();
    expect(accAfterSecond).to.be.greaterThan(accAfterFirst);
  });

  it("Stores updated pool balance in storage", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await trackGas(
      staking.stake(STAKE_AMOUNT),
      [GasGroup.STAKE_SSV]
    );

    const newFees = 5_000_000_000n;
    await staking.mockSetStakingEthPoolBalance(0n);
    await staking.mockSetEthDaoBalance(newFees);

    await trackGas(
      staking.syncFees(),
      [GasGroup.SYNC_FEES]
    );

    const storedPoolBalance = await staking.getStakingEthPoolBalance();
    expect(storedPoolBalance).to.equal(newFees);
  });

  it("Stores updated accEthPerShare in storage", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await trackGas(
      staking.stake(STAKE_AMOUNT),
      [GasGroup.STAKE_SSV]
    );

    const accBefore = await staking.getAccEthPerShare();

    const newFees = 1_000_000_000n;
    await staking.mockSetStakingEthPoolBalance(0n);
    await staking.mockSetEthDaoBalance(newFees);
    await trackGas(
      staking.syncFees(),
      [GasGroup.SYNC_FEES]
    );

    const accAfter = await staking.getAccEthPerShare();
    expect(accAfter).to.be.greaterThan(accBefore);
  });
});

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { ssvStakingHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext } from "../../common/helpers.ts";
import { Events } from "../../common/events.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { STAKE_AMOUNT, ETH_DEDUCTED_DIGITS } from "../../common/constants.ts";
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVStaking function `syncFees()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let staker: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [staker] } = await setupTestContext());
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
    const expectedDelta = (newFees * ETH_DEDUCTED_DIGITS * 1_000_000_000_000_000_000n) / STAKE_AMOUNT;
    expect(accAfter - accBefore).to.equal(expectedDelta);
  });

  it("Calculates and syncs fees based on network usage (natural accrual)", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);
    await staking.mockSetStakingEthPoolBalance(0n);
    await staking.mockSetEthDaoBalance(0n);
    await staking.syncFees();

    const accBefore = await staking.getAccEthPerShare();
    const poolBalanceBefore = await staking.getStakingEthPoolBalance();
    const vUnits = 10_000n;
    const fee = 500n;
    await staking.mockSetDaoTotalEthVUnits(vUnits);
    await staking.mockSetEthNetworkFee(fee);
    const setDaoTx = await staking.mockSetEthDaoBalance(0n); 
    const setDaoReceipt = await setDaoTx.wait();
    const blocksToMine = 10;
    await connection.ethers.provider.send("hardhat_mine", ["0xA"]);

    const receipt = await trackGas(
      staking.syncFees(),
      [GasGroup.SYNC_FEES]
    );
    
    const blocksElapsed = BigInt(receipt.blockNumber - setDaoReceipt!.blockNumber);
    const expectedEarnings = blocksElapsed * fee;
    const expectedEarningsWei = expectedEarnings * ETH_DEDUCTED_DIGITS;

    const accAfter = await staking.getAccEthPerShare();
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
    await staking.mockSetStakingEthPoolBalance(highBalance);
    await staking.mockSetEthDaoBalance(lowBalance);

    const accBefore = await staking.getAccEthPerShare();

    const tx = await staking.syncFees();

    await expect(tx).to.not.emit(staking, Events.FEES_SYNCED);

    const accAfter = await staking.getAccEthPerShare();
    expect(accAfter).to.equal(accBefore);
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
    const secondSyncNewFees = 1_000_000_000n;
    const expectedSecondDelta = (secondSyncNewFees * ETH_DEDUCTED_DIGITS * 1_000_000_000_000_000_000n) / STAKE_AMOUNT;
    expect(accAfterSecond - accAfterFirst).to.equal(expectedSecondDelta);
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
    const expectedDelta = (newFees * ETH_DEDUCTED_DIGITS * 1_000_000_000_000_000_000n) / STAKE_AMOUNT;
    expect(accAfter - accBefore).to.equal(expectedDelta);
  });

  it("Produces non-zero accEthPerShare update with minimum possible fee (1 packed unit) and standard stake", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await trackGas(
      staking.stake(STAKE_AMOUNT),
      [GasGroup.STAKE_SSV]
    );

    const accBefore = await staking.getAccEthPerShare();

    await staking.mockSetStakingEthPoolBalance(0n);
    await staking.mockSetEthDaoBalance(1n);

    await trackGas(
      staking.syncFees(),
      [GasGroup.SYNC_FEES]
    );

    const accAfter = await staking.getAccEthPerShare();

    const PRECISION = 1_000_000_000_000_000_000n;
    const expectedDelta = (1n * ETH_DEDUCTED_DIGITS * PRECISION) / STAKE_AMOUNT;
    expect(accAfter - accBefore).to.equal(expectedDelta);
  });

  it("Calling syncFees twice in the same block does not double-count fees", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await trackGas(
      staking.stake(STAKE_AMOUNT),
      [GasGroup.STAKE_SSV]
    );

    await staking.mockSetStakingEthPoolBalance(0n);
    const newFees = 1_000_000_000n;
    await staking.mockSetEthDaoBalance(newFees);

    const accBefore = await staking.getAccEthPerShare();
    const provider = connection.ethers.provider;
    await provider.send("evm_setAutomine", [false]);

    try {
      const tx1 = await staking.syncFees();
      const tx2 = await staking.syncFees();

      await provider.send("evm_mine", []);

      const receipt1 = await tx1.wait();
      const receipt2 = await tx2.wait();

      expect(receipt1!.blockNumber).to.equal(receipt2!.blockNumber);
      await expect(tx2).to.not.emit(staking, Events.FEES_SYNCED);
    } finally {
      await provider.send("evm_setAutomine", [true]);
    }

    const accAfter = await staking.getAccEthPerShare();
    const expectedDelta = (newFees * ETH_DEDUCTED_DIGITS * 1_000_000_000_000_000_000n) / STAKE_AMOUNT;
    expect(accAfter - accBefore).to.equal(expectedDelta);
  });
});

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvStakingHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { STAKE_AMOUNT } from "../../common/constants.ts";

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
    await staking.stake(STAKE_AMOUNT);

    const newFees = 1_000_000_000n;
    await staking.mockSetStakingEthPoolBalance(0n);
    await staking.mockSetEthDaoBalance(newFees);

    const tx = await staking.syncFees();

    await expect(tx).to.emit(staking, Events.FEES_SYNCED);

    const poolBalance = await staking.getStakingEthPoolBalance();
    expect(poolBalance).to.equal(newFees);
  });

  it("Updates accEthPerShare when new fees are available and total staked is non-zero", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    const accBefore = await staking.getAccEthPerShare();

    const newFees = 1_000_000_000n;
    await staking.mockSetStakingEthPoolBalance(0n);
    await staking.mockSetEthDaoBalance(newFees);

    await staking.syncFees();

    const accAfter = await staking.getAccEthPerShare();
    expect(accAfter).to.be.greaterThan(accBefore);
  });

  it("Does not change accEthPerShare when no new fees", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    const currentBalance = 1_000_000_000n;
    await staking.mockSetStakingEthPoolBalance(currentBalance);
    await staking.mockSetEthDaoBalance(currentBalance);

    const accBefore = await staking.getAccEthPerShare();

    await staking.syncFees();

    const accAfter = await staking.getAccEthPerShare();
    expect(accAfter).to.equal(accBefore);
  });

  it("Does not change accEthPerShare when total staked is zero", async function () {
    const { staking } =
      await networkHelpers.loadFixture(deployStakingFixture);

    const accBefore = await staking.getAccEthPerShare();

    await staking.mockSetStakingEthPoolBalance(0n);
    await staking.mockSetEthDaoBalance(1_000_000_000n);

    await staking.syncFees();

    const accAfter = await staking.getAccEthPerShare();
    expect(accAfter).to.equal(accBefore);
  });

  it("Syncs DAO balance correctly", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    const newBalance = 5_000_000_000n;
    await staking.mockSetEthDaoBalance(newBalance);

    await staking.syncFees();

    const ethDaoBalance = await staking.getEthDaoBalance();
    expect(ethDaoBalance).to.equal(newBalance);
  });

  it("Can be called multiple times", async function () {
    const { staking, ssvToken } =
      await networkHelpers.loadFixture(deployStakingFixture);

    await ssvToken.approve(await staking.getAddress(), STAKE_AMOUNT);
    await staking.stake(STAKE_AMOUNT);

    await staking.mockSetStakingEthPoolBalance(0n);
    await staking.mockSetEthDaoBalance(1_000_000_000n);
    await staking.syncFees();

    const accAfterFirst = await staking.getAccEthPerShare();

    await staking.mockSetEthDaoBalance(2_000_000_000n);
    await staking.syncFees();

    const accAfterSecond = await staking.getAccEthPerShare();
    expect(accAfterSecond).to.be.greaterThan(accAfterFirst);
  });
});

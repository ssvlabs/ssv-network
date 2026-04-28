import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { defaultDAOFixture } from "../../helpers/fixture-presets.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { setupTestContext } from "../../common/helpers.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVDAO function `withdrawNetworkSSVEarnings()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [owner] } = await setupTestContext());
  });

  const deployDAOWithTokenFixture = async () => {
    const { dao } = await defaultDAOFixture(connection);

    const mockToken = await connection.ethers.deployContract("MockToken", []);
    await mockToken.waitForDeployment();

    await dao.mockSetToken(await mockToken.getAddress());

    const daoBalance = 1000n;
    await dao.mockSetDaoBalance(daoBalance);

    await mockToken.mint(await dao.getAddress(), daoBalance * 10_000_000n);

    return { dao, mockToken, daoBalance };
  };

  it("Is reverted with 'InsufficientBalance' when trying to withdraw more than available", async function () {
    const { dao } = await defaultDAOFixture(connection);

    await dao.mockSetDaoBalance(100n);

    const withdrawAmount = 200n * 10_000_000n;

    await expect(dao.withdrawNetworkSSVEarnings(withdrawAmount))
      .to.be.revertedWithCustomError(dao, Errors.INSUFFICIENT_BALANCE);
  });

  it("Is reverted when amount is not a multiple of 1e7 (shrink precision)", async function () {
    const { dao } = await defaultDAOFixture(connection);

    await expect(dao.withdrawNetworkSSVEarnings(1n))
      .to.be.revertedWithCustomError(dao, Errors.MAX_PRECISION_EXCEEDED);
  });

  it("Withdraws network SSV earnings and emits NetworkEarningsWithdrawn event", async function () {
    const { dao, mockToken, daoBalance } = await networkHelpers.loadFixture(deployDAOWithTokenFixture);

    const withdrawAmount = 500n * 10_000_000n;

    const ownerBalanceBefore = await mockToken.balanceOf(owner.address);
    const daoTokenBalanceBefore = await mockToken.balanceOf(await dao.getAddress());

    const tx = await dao.withdrawNetworkSSVEarnings(withdrawAmount);
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.WITHDRAW_NETWORK_SSV_EARNINGS]);

    await expect(tx)
      .to.emit(dao, Events.NETWORK_EARNINGS_WITHDRAWN)
      .withArgs(withdrawAmount, owner.address);

    const ownerBalanceAfter = await mockToken.balanceOf(owner.address);
    const daoTokenBalanceAfter = await mockToken.balanceOf(await dao.getAddress());

    expect(ownerBalanceAfter - ownerBalanceBefore).to.equal(withdrawAmount);
    expect(daoTokenBalanceBefore - daoTokenBalanceAfter).to.equal(withdrawAmount);
  });

  it("Updates DAO balance after withdrawal", async function () {
    const { dao, daoBalance } = await networkHelpers.loadFixture(deployDAOWithTokenFixture);

    const withdrawAmount = 500n * 10_000_000n;

    await dao.withdrawNetworkSSVEarnings(withdrawAmount);

    const newBalance = await dao.getDaoBalance();
    expect(newBalance).to.equal(daoBalance - 500n);
  });

  it("Can withdraw all available earnings", async function () {
    const { dao, daoBalance } = await networkHelpers.loadFixture(deployDAOWithTokenFixture);

    const withdrawAmount = daoBalance * 10_000_000n;

    const tx = await dao.withdrawNetworkSSVEarnings(withdrawAmount);

    await expect(tx)
      .to.emit(dao, Events.NETWORK_EARNINGS_WITHDRAWN)
      .withArgs(withdrawAmount, owner.address);

    const newBalance = await dao.getDaoBalance();
    expect(newBalance).to.equal(0n);
  });
});

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvDAOHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVDAO function `withdrawNetworkSSVEarnings()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [owner] = await connection.ethers.getSigners();
  });

  const deployDAOWithTokenFixture = async () => {
    const { dao } = await ssvDAOHarnessFixture(connection);

    const mockToken = await connection.ethers.deployContract("MockToken", []);
    await mockToken.waitForDeployment();

    await dao.mockSetToken(await mockToken.getAddress());

    const daoBalance = 1000n;
    await dao.mockSetDaoBalance(daoBalance);

    await mockToken.mint(await dao.getAddress(), daoBalance * 10_000_000n);

    return { dao, mockToken, daoBalance };
  };

  it("Is reverted with 'InsufficientBalance' when trying to withdraw more than available", async function () {
    const { dao } = await ssvDAOHarnessFixture(connection);

    await dao.mockSetDaoBalance(100n);

    const withdrawAmount = 200n * 10_000_000n;

    await expect(dao.withdrawNetworkSSVEarnings(withdrawAmount))
      .to.be.revertedWithCustomError(dao, Errors.INSUFFICIENT_BALANCE);
  });

  it("Withdraws network SSV earnings and emits NetworkEarningsWithdrawn event", async function () {
    const { dao, mockToken, daoBalance } = await networkHelpers.loadFixture(deployDAOWithTokenFixture);

    const withdrawAmount = 500n * 10_000_000n;

    const tx = await dao.withdrawNetworkSSVEarnings(withdrawAmount);
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.WITHDRAW_NETWORK_SSV_EARNINGS]);

    await expect(tx)
      .to.emit(dao, Events.NETWORK_EARNINGS_WITHDRAWN)
      .withArgs(withdrawAmount, owner.address);
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

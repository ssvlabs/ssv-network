import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvDAOHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";

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

    // Deploy a mock token
    const mockToken = await connection.ethers.deployContract("MockToken", []);
    await mockToken.waitForDeployment();

    // Set the token in storage
    await dao.mockSetToken(await mockToken.getAddress());

    // Set some DAO balance
    const daoBalance = 1000n;
    await dao.mockSetDaoBalance(daoBalance);

    // Mint tokens to the DAO contract (to simulate earnings)
    await mockToken.mint(await dao.getAddress(), daoBalance * 10_000_000n);

    return { dao, mockToken, daoBalance };
  };

  it("Is reverted with 'InsufficientBalance' when trying to withdraw more than available", async function () {
    const { dao } = await ssvDAOHarnessFixture(connection);

    // Set a small DAO balance
    await dao.mockSetDaoBalance(100n);

    // Try to withdraw more than available
    const withdrawAmount = 200n * 10_000_000n;

    await expect(dao.withdrawNetworkSSVEarnings(withdrawAmount))
      .to.be.revertedWithCustomError(dao, Errors.INSUFFICIENT_BALANCE);
  });

  it("Withdraws network SSV earnings and emits NetworkEarningsWithdrawn event", async function () {
    const { dao, mockToken, daoBalance } = await networkHelpers.loadFixture(deployDAOWithTokenFixture);

    const withdrawAmount = 500n * 10_000_000n; // Expanded amount

    const tx = await dao.withdrawNetworkSSVEarnings(withdrawAmount);

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


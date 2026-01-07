import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvDAOHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";

describe("SSVDAO function `updateDeclareOperatorFeePeriod()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [owner] = await connection.ethers.getSigners();
  });

  const deployDAOFixture = async () => ssvDAOHarnessFixture(connection);

  it("Updates the declare operator fee period and emits event", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newPeriod = 604800n;

    const tx = await dao.updateDeclareOperatorFeePeriod(newPeriod);

    await expect(tx)
      .to.emit(dao, Events.DECLARE_OPERATOR_FEE_PERIOD_UPDATED)
      .withArgs(newPeriod);
  });

  it("Stores the new declare operator fee period in storage", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newPeriod = 86400n;

    await dao.updateDeclareOperatorFeePeriod(newPeriod);

    const storedPeriod = await dao.getDeclareOperatorFeePeriod();
    expect(storedPeriod).to.equal(newPeriod);
  });

  it("Can set declare period to zero", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    await dao.updateDeclareOperatorFeePeriod(86400n);
    const tx = await dao.updateDeclareOperatorFeePeriod(0n);

    await expect(tx)
      .to.emit(dao, Events.DECLARE_OPERATOR_FEE_PERIOD_UPDATED)
      .withArgs(0n);

    const storedPeriod = await dao.getDeclareOperatorFeePeriod();
    expect(storedPeriod).to.equal(0n);
  });

  it("Can update from one period to another", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const firstPeriod = 86400n;
    const secondPeriod = 172800n;

    await dao.updateDeclareOperatorFeePeriod(firstPeriod);
    const tx = await dao.updateDeclareOperatorFeePeriod(secondPeriod);

    await expect(tx)
      .to.emit(dao, Events.DECLARE_OPERATOR_FEE_PERIOD_UPDATED)
      .withArgs(secondPeriod);

    const storedPeriod = await dao.getDeclareOperatorFeePeriod();
    expect(storedPeriod).to.equal(secondPeriod);
  });
});

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvDAOHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";

describe("SSVDAO function `setMinBlocksBetweenUpdates()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
  });

  const deployDAOFixture = async () => ssvDAOHarnessFixture(connection);

  it("Sets EB update cooldown blocks and emits MinBlocksBetweenUpdatesUpdated event", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newMinBlocks = 7200n;

    const tx = await dao.setMinBlocksBetweenUpdates(newMinBlocks);

    await expect(tx)
      .to.emit(dao, Events.MIN_BLOCKS_BETWEEN_UPDATES_UPDATED)
      .withArgs(newMinBlocks);

    expect(await dao.getMinBlocksBetweenUpdates()).to.equal(newMinBlocks);
  });

  it("Is reverted when setting EB update cooldown blocks to zero", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    await expect(dao.setMinBlocksBetweenUpdates(0n))
      .to.be.revertedWithCustomError(dao, Errors.ZERO_AMOUNT);
  });

  it("Can update EB update cooldown blocks from one non-zero value to another", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    await dao.setMinBlocksBetweenUpdates(7200n);
    const tx = await dao.setMinBlocksBetweenUpdates(3600n);

    await expect(tx)
      .to.emit(dao, Events.MIN_BLOCKS_BETWEEN_UPDATES_UPDATED)
      .withArgs(3600n);

    expect(await dao.getMinBlocksBetweenUpdates()).to.equal(3600n);
  });
});

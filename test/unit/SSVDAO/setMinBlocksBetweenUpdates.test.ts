import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvDAOHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";

describe("SSVDAO function `updateMinBlocksBetweenUpdates()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
  });

  const deployDAOFixture = async () => ssvDAOHarnessFixture(connection);

  it("Sets EB update cooldown blocks and emits MinBlocksBetweenUpdatesUpdated event", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newMinBlocks = 7200n;

    const tx = await dao.updateMinBlocksBetweenUpdates(newMinBlocks);

    await expect(tx)
      .to.emit(dao, Events.MIN_BLOCKS_BETWEEN_UPDATES_UPDATED)
      .withArgs(newMinBlocks);

    expect(await dao.getMinBlocksBetweenUpdates()).to.equal(newMinBlocks);
  });

  it("Can update EB update cooldown blocks from one non-zero value to another and go back to zero", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    await dao.updateMinBlocksBetweenUpdates(7200n);
    let tx = await dao.updateMinBlocksBetweenUpdates(3600n);

    await expect(tx)
      .to.emit(dao, Events.MIN_BLOCKS_BETWEEN_UPDATES_UPDATED)
      .withArgs(3600n);

    expect(await dao.getMinBlocksBetweenUpdates()).to.equal(3600n);

    tx = await dao.updateMinBlocksBetweenUpdates(0n);

    await expect(tx)
      .to.emit(dao, Events.MIN_BLOCKS_BETWEEN_UPDATES_UPDATED)
      .withArgs(0n);

    expect(await dao.getMinBlocksBetweenUpdates()).to.equal(0n);
  });
});

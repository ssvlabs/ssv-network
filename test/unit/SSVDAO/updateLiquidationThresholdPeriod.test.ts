import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvDAOHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { MINIMAL_LIQUIDATION_THRESHOLD } from "../../common/constants.ts";

describe("SSVDAO function `updateLiquidationThresholdPeriod()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [owner] = await connection.ethers.getSigners();
  });

  const deployDAOFixture = async () => ssvDAOHarnessFixture(connection);

  it("Updates the liquidation threshold period and emits event", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newPeriod = MINIMAL_LIQUIDATION_THRESHOLD + 1000n;

    const tx = await dao.updateLiquidationThresholdPeriod(newPeriod);

    await expect(tx)
      .to.emit(dao, Events.LIQUIDATION_THRESHOLD_PERIOD_UPDATED)
      .withArgs(newPeriod);
  });

  it("Stores the new liquidation threshold period in storage", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newPeriod = 200000n;

    await dao.updateLiquidationThresholdPeriod(newPeriod);

    const storedPeriod = await dao.getMinimumBlocksBeforeLiquidation();
    expect(storedPeriod).to.equal(newPeriod);
  });

  it("Is reverted with 'NewBlockPeriodIsBelowMinimum' when period is below minimum", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const belowMinimum = MINIMAL_LIQUIDATION_THRESHOLD - 1n;

    await expect(dao.updateLiquidationThresholdPeriod(belowMinimum))
      .to.be.revertedWithCustomError(dao, Errors.NEW_BLOCK_PERIOD_IS_BELOW_MINIMUM);
  });

  it("Accepts exactly the minimum threshold", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const tx = await dao.updateLiquidationThresholdPeriod(MINIMAL_LIQUIDATION_THRESHOLD);

    await expect(tx)
      .to.emit(dao, Events.LIQUIDATION_THRESHOLD_PERIOD_UPDATED)
      .withArgs(MINIMAL_LIQUIDATION_THRESHOLD);

    const storedPeriod = await dao.getMinimumBlocksBeforeLiquidation();
    expect(storedPeriod).to.equal(MINIMAL_LIQUIDATION_THRESHOLD);
  });

  it("Can update from one period to another", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const firstPeriod = MINIMAL_LIQUIDATION_THRESHOLD + 100n;
    const secondPeriod = MINIMAL_LIQUIDATION_THRESHOLD + 200n;

    await dao.updateLiquidationThresholdPeriod(firstPeriod);
    const tx = await dao.updateLiquidationThresholdPeriod(secondPeriod);

    await expect(tx)
      .to.emit(dao, Events.LIQUIDATION_THRESHOLD_PERIOD_UPDATED)
      .withArgs(secondPeriod);

    const storedPeriod = await dao.getMinimumBlocksBeforeLiquidation();
    expect(storedPeriod).to.equal(secondPeriod);
  });
});

describe("SSVDAO function `updateLiquidationThresholdPeriodSSV()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [owner] = await connection.ethers.getSigners();
  });

  const deployDAOFixture = async () => ssvDAOHarnessFixture(connection);

  it("Updates the SSV liquidation threshold period and emits event", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newPeriod = MINIMAL_LIQUIDATION_THRESHOLD + 1000n;

    const tx = await dao.updateLiquidationThresholdPeriodSSV(newPeriod);

    await expect(tx)
      .to.emit(dao, Events.LIQUIDATION_THRESHOLD_PERIOD_UPDATED_SSV)
      .withArgs(newPeriod);
  });

  it("Stores the new SSV liquidation threshold period in storage", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newPeriod = 200000n;

    await dao.updateLiquidationThresholdPeriodSSV(newPeriod);

    const storedPeriod = await dao.getMinimumBlocksBeforeLiquidationSSV();
    expect(storedPeriod).to.equal(newPeriod);
  });

  it("Is reverted with 'NewBlockPeriodIsBelowMinimum' when period is below minimum", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const belowMinimum = MINIMAL_LIQUIDATION_THRESHOLD - 1n;

    await expect(dao.updateLiquidationThresholdPeriodSSV(belowMinimum))
      .to.be.revertedWithCustomError(dao, Errors.NEW_BLOCK_PERIOD_IS_BELOW_MINIMUM);
  });
});

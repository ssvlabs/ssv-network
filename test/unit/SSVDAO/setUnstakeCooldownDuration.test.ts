import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { defaultDAOFixture } from "../../helpers/fixture-presets.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import { setupTestContext } from "../../common/helpers.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVDAO function `updateUnstakeCooldownDuration()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [owner] } = await setupTestContext());
  });

  const deployDAOFixture = async () => defaultDAOFixture(connection);

  it("Sets unstake cooldown duration and emits CooldownDurationUpdated event", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newDuration = 604800n;

    const tx = await dao.updateUnstakeCooldownDuration(newDuration);
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.SET_UNSTAKE_COOLDOWN]);

    await expect(tx)
      .to.emit(dao, Events.COOLDOWN_DURATION_UPDATED)
      .withArgs(newDuration);
  });

  it("Stores the new cooldown duration in storage", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newDuration = 86400n;

    await dao.updateUnstakeCooldownDuration(newDuration);

    const storedDuration = await dao.getCooldownDuration();
    expect(storedDuration).to.equal(newDuration);
  });

  it("Can set cooldown duration to zero", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    await dao.updateUnstakeCooldownDuration(86400n);
    const tx = await dao.updateUnstakeCooldownDuration(0n);

    await expect(tx)
      .to.emit(dao, Events.COOLDOWN_DURATION_UPDATED)
      .withArgs(0n);

    const storedDuration = await dao.getCooldownDuration();
    expect(storedDuration).to.equal(0n);
  });

  it("Can set high cooldown duration", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const highDuration = 2592000n;

    const tx = await dao.updateUnstakeCooldownDuration(highDuration);

    await expect(tx)
      .to.emit(dao, Events.COOLDOWN_DURATION_UPDATED)
      .withArgs(highDuration);

    const storedDuration = await dao.getCooldownDuration();
    expect(storedDuration).to.equal(highDuration);
  });

  it("Can update cooldown duration from one value to another", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const firstDuration = 86400n;
    const secondDuration = 172800n;

    await dao.updateUnstakeCooldownDuration(firstDuration);
    const tx = await dao.updateUnstakeCooldownDuration(secondDuration);

    await expect(tx)
      .to.emit(dao, Events.COOLDOWN_DURATION_UPDATED)
      .withArgs(secondDuration);

    const storedDuration = await dao.getCooldownDuration();
    expect(storedDuration).to.equal(secondDuration);
  });
});

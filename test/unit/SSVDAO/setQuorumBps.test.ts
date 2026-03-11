import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { defaultDAOFixture } from "../../helpers/fixture-presets.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import { setupTestContext } from "../../common/helpers.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";
import { Errors } from "../../common/errors.ts";

describe("SSVDAO function `setQuorumBps()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [owner] } = await setupTestContext());
  });

  const deployDAOFixture = async () => defaultDAOFixture(connection);

  it("Sets quorum basis points and emits QuorumUpdated event", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newQuorum = 7500n;

    const tx = await dao.setQuorumBps(newQuorum);
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.SET_QUORUM]);

    await expect(tx)
      .to.emit(dao, Events.QUORUM_UPDATED)
      .withArgs(newQuorum);
  });

  it("Stores the new quorum in storage", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newQuorum = 6000n;

    await dao.setQuorumBps(newQuorum);

    const storedQuorum = await dao.getQuorumBps();
    expect(storedQuorum).to.equal(newQuorum);
  });

  it("Can set quorum to 100% (10000 bps)", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const maxQuorum = 10000n;

    const tx = await dao.setQuorumBps(maxQuorum);

    await expect(tx)
      .to.emit(dao, Events.QUORUM_UPDATED)
      .withArgs(maxQuorum);

    const storedQuorum = await dao.getQuorumBps();
    expect(storedQuorum).to.equal(maxQuorum);
  });

  it("Can set quorum to 0%", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    await dao.setQuorumBps(5000n);
    const tx = await dao.setQuorumBps(0n);

    await expect(tx)
      .to.emit(dao, Events.QUORUM_UPDATED)
      .withArgs(0n);

    const storedQuorum = await dao.getQuorumBps();
    expect(storedQuorum).to.equal(0n);
  });

  it("Is reverted when quorum exceeds 10000 bps", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const invalidQuorum = 10001n;

    await expect(dao.setQuorumBps(invalidQuorum))
      .to.be.revertedWithCustomError(dao, Errors.INVALID_QUORUM);
  });

  it("Can update quorum from one value to another", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const firstQuorum = 5000n;
    const secondQuorum = 8000n;

    await dao.setQuorumBps(firstQuorum);
    const tx = await dao.setQuorumBps(secondQuorum);

    await expect(tx)
      .to.emit(dao, Events.QUORUM_UPDATED)
      .withArgs(secondQuorum);

    const storedQuorum = await dao.getQuorumBps();
    expect(storedQuorum).to.equal(secondQuorum);
  });
});

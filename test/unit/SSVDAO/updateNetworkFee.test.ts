import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvDAOHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";

describe("SSVDAO function `updateNetworkFee()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [owner] = await connection.ethers.getSigners();
  });

  const deployDAOFixture = async () => ssvDAOHarnessFixture(connection);

  it("Updates the network fee and emits NetworkFeeUpdated event", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const initialFee = 0n;
    const newFee = 1_000_000_000n; // 1 gwei

    const tx = await dao.updateNetworkFee(newFee);

    await expect(tx)
      .to.emit(dao, Events.NETWORK_FEE_UPDATED)
      .withArgs(initialFee, newFee);
  });

  it("Stores the new network fee in storage", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newFee = 2_000_000_000n; // 2 gwei

    await dao.updateNetworkFee(newFee);

    // The fee is shrunk when stored (divided by DEDUCTED_DIGITS = 10_000_000)
    const storedFee = await dao.getNetworkFee();
    expect(storedFee).to.equal(newFee / 10_000_000n);
  });

  it("Updates the network fee from a non-zero value", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const firstFee = 1_000_000_000n;
    const secondFee = 2_000_000_000n;

    await dao.updateNetworkFee(firstFee);
    const tx = await dao.updateNetworkFee(secondFee);

    await expect(tx)
      .to.emit(dao, Events.NETWORK_FEE_UPDATED)
      .withArgs(firstFee, secondFee);
  });

  it("Can set network fee to zero", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const firstFee = 1_000_000_000n;
    await dao.updateNetworkFee(firstFee);

    const tx = await dao.updateNetworkFee(0n);

    await expect(tx)
      .to.emit(dao, Events.NETWORK_FEE_UPDATED)
      .withArgs(firstFee, 0n);

    const storedFee = await dao.getNetworkFee();
    expect(storedFee).to.equal(0n);
  });
});


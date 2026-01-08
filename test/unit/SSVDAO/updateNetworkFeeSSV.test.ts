import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvDAOHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";

describe("SSVDAO function `updateNetworkFeeSSV()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [owner] = await connection.ethers.getSigners();
  });

  const deployDAOFixture = async () => ssvDAOHarnessFixture(connection);

  it("Updates the SSV network fee and emits NetworkFeeUpdated event", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const initialFee = 0n;
    const newFee = 1_000_000_000n;

    const tx = await dao.updateNetworkFeeSSV(newFee);

    await expect(tx)
      .to.emit(dao, Events.NETWORK_FEE_UPDATED_SSV)
      .withArgs(initialFee, newFee);
  });

  it("Stores the new SSV network fee in storage", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newFee = 2_000_000_000n;

    await dao.updateNetworkFeeSSV(newFee);

    const storedFee = await dao.getNetworkFeeSSV();
    expect(storedFee).to.equal(newFee / 10_000_000n);
  });

  it("Updates the SSV network fee from a non-zero value", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const firstFee = 1_000_000_000n;
    const secondFee = 3_000_000_000n;

    await dao.updateNetworkFeeSSV(firstFee);
    const tx = await dao.updateNetworkFeeSSV(secondFee);

    await expect(tx)
      .to.emit(dao, Events.NETWORK_FEE_UPDATED_SSV)
      .withArgs(firstFee, secondFee);
  });

  it("Can set SSV network fee to zero", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const firstFee = 1_000_000_000n;
    await dao.updateNetworkFeeSSV(firstFee);

    const tx = await dao.updateNetworkFeeSSV(0n);

    await expect(tx)
      .to.emit(dao, Events.NETWORK_FEE_UPDATED_SSV)
      .withArgs(firstFee, 0n);

    const storedFee = await dao.getNetworkFeeSSV();
    expect(storedFee).to.equal(0n);
  });
});

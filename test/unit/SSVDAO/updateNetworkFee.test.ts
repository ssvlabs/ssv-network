import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvDAOHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import { Errors } from '../../common/errors.js';
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";
import { ETH_DEDUCTED_DIGITS } from "../../common/constants.ts";


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
    const newFee = 1_000_000_000n;

    const tx = await dao.updateNetworkFee(newFee);
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.NETWORK_FEE_CHANGE]);

    await expect(tx)
      .to.emit(dao, Events.NETWORK_FEE_UPDATED)
      .withArgs(initialFee, newFee);

    const storedFee = await dao.getNetworkFee();
    expect(storedFee).to.equal(newFee / ETH_DEDUCTED_DIGITS);
  });

  it("Is reverted when fee is not a multiple of 1e5 (shrink precision)", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    await expect(dao.updateNetworkFee(1n))
      .to.be.revertedWithCustomError(dao, Errors.MAX_PRECISION_EXCEEDED);
  });

  it("Stores the new network fee in storage", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newFee = 2_000_000_000n;

    await dao.updateNetworkFee(newFee);

    const storedFee = await dao.getNetworkFee();
    expect(storedFee).to.equal(newFee / ETH_DEDUCTED_DIGITS);
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

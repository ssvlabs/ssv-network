import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvDAOHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import { MINIMAL_OPERATOR_ETH_FEE, ETH_DEDUCTED_DIGITS } from "../../common/constants.ts";
import { setupTestContext } from "../../common/helpers.ts";

describe("SSVDAO function `updateMinimumOperatorEthFee()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [owner] } = await setupTestContext());
  });

  const deployDAOFixture = async () => ssvDAOHarnessFixture(connection);

  it("Updates the minimum operator ETH fee and emits event", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newMinFee = MINIMAL_OPERATOR_ETH_FEE;

    const tx = await dao.updateMinimumOperatorEthFee(newMinFee);

    await expect(tx)
      .to.emit(dao, Events.MINIMUM_OPERATOR_ETH_FEE_UPDATED)
      .withArgs(newMinFee);
  });

  it("Stores the new minimum operator ETH fee in storage", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newMinFee = 1000_000_000n;

    await dao.updateMinimumOperatorEthFee(newMinFee);

    const storedMinFee = await dao.getMinimumOperatorEthFee();
    expect(storedMinFee * ETH_DEDUCTED_DIGITS).to.equal(newMinFee);
  });

  it("Can set minimum operator ETH fee to zero", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    await dao.updateMinimumOperatorEthFee(MINIMAL_OPERATOR_ETH_FEE);
    const tx = await dao.updateMinimumOperatorEthFee(0n);

    await expect(tx)
      .to.emit(dao, Events.MINIMUM_OPERATOR_ETH_FEE_UPDATED)
      .withArgs(0n);

    const storedMinFee = await dao.getMinimumOperatorEthFee();
    expect(storedMinFee).to.equal(0n);
  });

  it("Can update from one min fee to another", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const firstMinFee = 500_000_000n;
    const secondMinFee = MINIMAL_OPERATOR_ETH_FEE;

    await dao.updateMinimumOperatorEthFee(firstMinFee);
    const tx = await dao.updateMinimumOperatorEthFee(secondMinFee);

    await expect(tx)
      .to.emit(dao, Events.MINIMUM_OPERATOR_ETH_FEE_UPDATED)
      .withArgs(secondMinFee);

    const storedMinFee = await dao.getMinimumOperatorEthFee();
    expect(storedMinFee * ETH_DEDUCTED_DIGITS).to.equal(secondMinFee);
  });
});

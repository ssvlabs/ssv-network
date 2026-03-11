import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { defaultDAOFixture } from "../../helpers/fixture-presets.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import { MAXIMUM_OPERATORS_FEE, ETH_DEDUCTED_DIGITS } from "../../common/constants.ts";
import { setupTestContext } from "../../common/helpers.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVDAO function `updateMaximumOperatorFee()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await setupTestContext());
  });

  const deployDAOFixture = async () => defaultDAOFixture(connection);

  it("Updates the maximum operator fee and emits event", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newMaxFee = 100_000_000_000n;

    const tx = await dao.updateMaximumOperatorFee(newMaxFee);
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.DAO_UPDATE_OPERATOR_MAX_FEE]);

    await expect(tx)
      .to.emit(dao, Events.OPERATOR_MAXIMUM_FEE_UPDATED)
      .withArgs(newMaxFee);
  });

  it("Stores the new maximum operator fee in storage", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newMaxFee = 50_000_000_000n;

    await dao.updateMaximumOperatorFee(newMaxFee);

    const storedMaxFee = await dao.getOperatorMaxFee();
    expect(storedMaxFee * ETH_DEDUCTED_DIGITS).to.equal(newMaxFee);
  });

  it("Can set maximum operator fee to zero", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    await dao.updateMaximumOperatorFee(100_000_000_000n);
    const tx = await dao.updateMaximumOperatorFee(0n);

    await expect(tx)
      .to.emit(dao, Events.OPERATOR_MAXIMUM_FEE_UPDATED)
      .withArgs(0n);

    const storedMaxFee = await dao.getOperatorMaxFee();
    expect(storedMaxFee).to.equal(0n);
  });

  it("Can update from one max fee to another", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const firstMaxFee = 50_000_000_000n;
    const secondMaxFee = MAXIMUM_OPERATORS_FEE;

    await dao.updateMaximumOperatorFee(firstMaxFee);
    const tx = await dao.updateMaximumOperatorFee(secondMaxFee);

    await expect(tx)
      .to.emit(dao, Events.OPERATOR_MAXIMUM_FEE_UPDATED)
      .withArgs(secondMaxFee);

    const storedMaxFee = await dao.getOperatorMaxFee();
    expect(storedMaxFee * ETH_DEDUCTED_DIGITS).to.equal(secondMaxFee);
  });
});

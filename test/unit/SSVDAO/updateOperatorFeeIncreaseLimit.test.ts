import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvDAOHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import { setupTestContext } from "../../common/helpers.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVDAO function `updateOperatorFeeIncreaseLimit()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [owner] } = await setupTestContext());
  });

  const deployDAOFixture = async () => ssvDAOHarnessFixture(connection);

  it("Updates the operator fee increase limit and emits event", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newLimit = 1000n;

    const tx = await dao.updateOperatorFeeIncreaseLimit(newLimit);
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.DAO_UPDATE_OPERATOR_FEE_INCREASE_LIMIT]);

    await expect(tx)
      .to.emit(dao, Events.OPERATOR_FEE_INCREASE_LIMIT_UPDATED)
      .withArgs(newLimit);
  });

  it("Can update operator fee increase limit from one value to another", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const firstLimit = 1000n;
    const secondLimit = 2000n;

    await dao.updateOperatorFeeIncreaseLimit(firstLimit);
    const tx = await dao.updateOperatorFeeIncreaseLimit(secondLimit);

    await expect(tx)
      .to.emit(dao, Events.OPERATOR_FEE_INCREASE_LIMIT_UPDATED)
      .withArgs(secondLimit);

    const storedLimit = await dao.getOperatorMaxFeeIncrease();
    expect(storedLimit).to.equal(secondLimit);
  });

  it("Stores the new operator fee increase limit in storage", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newLimit = 1500n;

    await dao.updateOperatorFeeIncreaseLimit(newLimit);

    const storedLimit = await dao.getOperatorMaxFeeIncrease();
    expect(storedLimit).to.equal(newLimit);
  });

  it("Can set operator fee increase limit to zero", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    await dao.updateOperatorFeeIncreaseLimit(1000n);
    const tx = await dao.updateOperatorFeeIncreaseLimit(0n);

    await expect(tx)
      .to.emit(dao, Events.OPERATOR_FEE_INCREASE_LIMIT_UPDATED)
      .withArgs(0n);

    const storedLimit = await dao.getOperatorMaxFeeIncrease();
    expect(storedLimit).to.equal(0n);
  });

  it("Can set high operator fee increase limit", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const highLimit = 10000n;

    const tx = await dao.updateOperatorFeeIncreaseLimit(highLimit);

    await expect(tx)
      .to.emit(dao, Events.OPERATOR_FEE_INCREASE_LIMIT_UPDATED)
      .withArgs(highLimit);

    const storedLimit = await dao.getOperatorMaxFeeIncrease();
    expect(storedLimit).to.equal(highLimit);
  });
});

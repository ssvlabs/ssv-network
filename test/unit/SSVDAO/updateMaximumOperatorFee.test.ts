import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvDAOHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import { MAXIMUM_OPERATORS_FEE } from "../../common/constants.ts";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVDAO function `updateMaximumOperatorFee()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [owner] = await connection.ethers.getSigners();
  });

  const deployDAOFixture = async () => ssvDAOHarnessFixture(connection);

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
    expect(storedMaxFee).to.equal(newMaxFee);
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
    expect(storedMaxFee).to.equal(secondMaxFee);
  });
});

describe("SSVDAO function `updateMaximumOperatorFeeSSV()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [owner] = await connection.ethers.getSigners();
  });

  const deployDAOFixture = async () => ssvDAOHarnessFixture(connection);

  it("Updates the SSV maximum operator fee and emits event", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newMaxFee = 100_000_000_000n;

    const tx = await dao.updateMaximumOperatorFeeSSV(newMaxFee);

    await expect(tx)
      .to.emit(dao, Events.OPERATOR_MAXIMUM_FEE_UPDATED_SSV)
      .withArgs(newMaxFee);
  });

  it("Stores the new SSV maximum operator fee in storage", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const newMaxFee = 75_000_000_000n;

    await dao.updateMaximumOperatorFeeSSV(newMaxFee);

    const storedMaxFee = await dao.getOperatorMaxFeeSSV();
    expect(storedMaxFee).to.equal(newMaxFee);
  });

  it("Can set SSV maximum operator fee to zero", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    await dao.updateMaximumOperatorFeeSSV(100_000_000_000n);
    const tx = await dao.updateMaximumOperatorFeeSSV(0n);

    await expect(tx)
      .to.emit(dao, Events.OPERATOR_MAXIMUM_FEE_UPDATED_SSV)
      .withArgs(0n);

    const storedMaxFee = await dao.getOperatorMaxFeeSSV();
    expect(storedMaxFee).to.equal(0n);
  });

  it("Can update SSV maximum operator fee from one value to another", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOFixture);

    const firstMaxFee = 50_000_000_000n;
    const secondMaxFee = 75_000_000_000n;

    await dao.updateMaximumOperatorFeeSSV(firstMaxFee);
    const tx = await dao.updateMaximumOperatorFeeSSV(secondMaxFee);

    await expect(tx)
      .to.emit(dao, Events.OPERATOR_MAXIMUM_FEE_UPDATED_SSV)
      .withArgs(secondMaxFee);

    const storedMaxFee = await dao.getOperatorMaxFeeSSV();
    expect(storedMaxFee).to.equal(secondMaxFee);
  });
});

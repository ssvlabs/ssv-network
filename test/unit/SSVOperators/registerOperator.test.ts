import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvOperatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey } from "../../common/helpers.ts";
import { MAXIMUM_OPERATORS_FEE, MINIMAL_OPERATOR_ETH_FEE } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";

describe("SSVOperators function `registerOperator()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [owner] = await connection.ethers.getSigners();
  });

  const deployOperatorsFixture = async () => ssvOperatorsHarnessFixture(connection);

  it("Registers an operator with valid params and emits expected events", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    const publicKey = makeOperatorKey(1);
    const fee = MINIMAL_OPERATOR_ETH_FEE;

    const tx = await operators.registerOperator(publicKey, fee, true);
    await expect(tx).to.emit(operators, Events.OPERATOR_ADDED).withArgs(1n, owner.address, publicKey, fee);
    await expect(tx).to.emit(operators, Events.OPERATOR_PRIVACY_STATUS_UPDATED).withArgs([1n], true);
  });

  it("Is reverted with 'FeeTooLow' when provided fee is below minimal allowed", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await expect(operators.registerOperator(
      makeOperatorKey(1),
      1n,
      false
    )).to.be.revertedWithCustomError(operators, Errors.FEE_TOO_LOW);
  });

  it("Is reverted with 'FeeTooHigh' when provided fee exceeds max operator fee", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await expect(operators.registerOperator(
      makeOperatorKey(1),
      MAXIMUM_OPERATORS_FEE + 1n,
      false
    )).to.be.revertedWithCustomError(operators, Errors.FEE_TOO_HIGH);
  });

  it("Is reverted with 'OperatorAlreadyExists' when registering duplicate public key", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    const publicKey = makeOperatorKey(1);
    await operators.registerOperator(publicKey, MINIMAL_OPERATOR_ETH_FEE, false);

    await expect(operators.registerOperator(
      publicKey,
      MINIMAL_OPERATOR_ETH_FEE,
      false
    )).to.be.revertedWithCustomError(operators, Errors.OPERATOR_ALREADY_EXISTS);
  });

  it("Stores operator data in storage", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    const publicKey = makeOperatorKey(1);
    await operators.registerOperator(publicKey, MINIMAL_OPERATOR_ETH_FEE, true);

    const operatorData = await operators.getOperator(1);

    expect(operatorData.owner).to.equal(owner.address);
    expect(operatorData.ethFee).to.equal(1n); // MINIMAL_OPERATOR_ETH_FEE shrinks to 1
    expect(operatorData.whitelisted).to.equal(true);
    expect(operatorData.ethSnapshot.block).to.be.greaterThan(0);
  });
});

import { expect } from "chai";
import { ethers } from "ethers";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvOperatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey, setupTestContext } from "../../common/helpers.ts";
import { MAXIMUM_OPERATORS_FEE, MINIMAL_OPERATOR_ETH_FEE } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";
import { ETH_DEDUCTED_DIGITS } from "../../common/constants.ts";

describe("SSVOperators function `registerOperator()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [owner] } = await setupTestContext());
  });

  const deployOperatorsFixture = async () => ssvOperatorsHarnessFixture(connection);

  it("Registers an operator with valid params and emits expected events", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    const publicKey = makeOperatorKey(1);
    const fee = MINIMAL_OPERATOR_ETH_FEE;

    const tx = await trackGas(
      operators.registerOperator(publicKey, fee, true),
      [GasGroup.REGISTER_OPERATOR]
    );
    await expect(tx).to.emit(operators, Events.OPERATOR_ADDED).withArgs(1n, owner.address, publicKey, fee);
    await expect(tx).to.emit(operators, Events.OPERATOR_PRIVACY_STATUS_UPDATED).withArgs([1n], true);
  });

  it("Is reverted with 'FeeTooLow' when provided fee is below minimal allowed", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await operators.mockSetMinimumOperatorEthFee(Number(MINIMAL_OPERATOR_ETH_FEE));

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
    await trackGas(
      operators.registerOperator(publicKey, MINIMAL_OPERATOR_ETH_FEE, false),
      [GasGroup.REGISTER_OPERATOR]
    );

    await expect(operators.registerOperator(
      publicKey,
      MINIMAL_OPERATOR_ETH_FEE,
      false
    )).to.be.revertedWithCustomError(operators, Errors.OPERATOR_ALREADY_EXISTS);
  });

  it("Stores operator data in storage", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    const publicKey = makeOperatorKey(1);
    await trackGas(
      operators.registerOperator(publicKey, MINIMAL_OPERATOR_ETH_FEE, true),
      [GasGroup.REGISTER_OPERATOR]
    );

    const operatorData = await operators.getOperator(1);

    expect(operatorData.owner).to.equal(owner.address);
    expect(operatorData.ethFee).to.equal(MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS);
    expect(operatorData.whitelisted).to.equal(true);
    expect(operatorData.ethSnapshot.block).to.be.greaterThan(0);
  });

  it("Registers an operator with 0 fee", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const publicKey = makeOperatorKey(1);
    
    await expect(operators.registerOperator(publicKey, 0n, false))
      .to.emit(operators, Events.OPERATOR_ADDED)
      .withArgs(1n, owner.address, publicKey, 0n);
      
    const operatorData = await operators.getOperator(1);
    expect(operatorData.ethFee).to.equal(0n);
  });

  it("Registers an operator with exact max fee", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const publicKey = makeOperatorKey(1);
    
    await expect(operators.registerOperator(publicKey, MAXIMUM_OPERATORS_FEE, false))
      .to.emit(operators, Events.OPERATOR_ADDED)
      .withArgs(1n, owner.address, publicKey, MAXIMUM_OPERATORS_FEE);
  });

  it("Registers a public operator (whitelisted = false)", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const publicKey = makeOperatorKey(1);
    
    await expect(operators.registerOperator(publicKey, MINIMAL_OPERATOR_ETH_FEE, false))
      .to.emit(operators, Events.OPERATOR_PRIVACY_STATUS_UPDATED)
      .withArgs([1n], false);
      
    const operatorData = await operators.getOperator(1);
    expect(operatorData.whitelisted).to.equal(false);
  });

  it("Is reverted with 'MaxPrecisionExceeded' when fee is not aligned to ETH_DEDUCTED_DIGITS", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await expect(operators.registerOperator(
      makeOperatorKey(1),
      1n,
      false
    )).to.be.revertedWithCustomError(operators, Errors.MAX_PRECISION_EXCEEDED);
  });

  it("Increments operator ID correctly for multiple registrations", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    
    await operators.registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE, false);
    await operators.registerOperator(makeOperatorKey(2), MINIMAL_OPERATOR_ETH_FEE, false);
    
    const op1 = await operators.getOperator(1);
    const op2 = await operators.getOperator(2);
    
    expect(op1.owner).to.not.equal(ethers.ZeroAddress);
    expect(op2.owner).to.not.equal(ethers.ZeroAddress);
  });
});

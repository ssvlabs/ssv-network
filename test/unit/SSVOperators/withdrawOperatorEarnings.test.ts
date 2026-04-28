import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey, seedOperatorWithETHBalance, setupTestContext } from "../../common/helpers.ts";
import { defaultOperatorsFixture } from "../../helpers/fixture-presets.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  ETH_DEDUCTED_DIGITS
} from '../../common/constants.ts';
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVOperators ETH earnings withdrawals", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await setupTestContext());
  });

  const deployOperatorsFixture = async () => defaultOperatorsFixture(connection);


  it("withdrawOperatorEarnings withdraws specific amount and emits event", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const [owner] = await connection.ethers.getSigners();

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );
    await seedOperatorWithETHBalance(networkHelpers, connection, operators, 1, 5n);

    const amount = 2n * ETH_DEDUCTED_DIGITS;

    await expect(
      trackGas(
        operators.withdrawOperatorEarnings(1, amount),
        [GasGroup.WITHDRAW_OPERATOR_BALANCE]
      )
    )
      .to.emit(operators, Events.OPERATOR_WITHDRAWN)
      .withArgs(owner.address, 1, amount);

    const operatorAfter = await operators.getOperator(1);
    expect(operatorAfter.ethSnapshot.balance).to.equal(3n);
  });

  it("Succeeds when withdrawing zero amount", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );
    await seedOperatorWithETHBalance(networkHelpers, connection, operators, 1, 5n);
    await operators.withdrawOperatorEarnings(1, 0n);
  });

  it("withdrawAllOperatorEarnings withdraws full balance and resets snapshot", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const [owner] = await connection.ethers.getSigners();

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );
    await seedOperatorWithETHBalance(networkHelpers, connection, operators, 1, 4n);

    const expectedAmount = 4n * ETH_DEDUCTED_DIGITS;

    await expect(
      trackGas(
        operators.withdrawAllOperatorEarnings(1),
        [GasGroup.WITHDRAW_OPERATOR_BALANCE]
      )
    )
      .to.emit(operators, Events.OPERATOR_WITHDRAWN)
      .withArgs(owner.address, 1, expectedAmount);

    const operatorAfter = await operators.getOperator(1);
    expect(operatorAfter.ethSnapshot.balance).to.equal(0n);
  });

  it("Is reverted with 'InsufficientBalance' when withdrawing more than ETH snapshot balance", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );

    await expect(operators.withdrawOperatorEarnings(1, ETH_DEDUCTED_DIGITS)).to.be.revertedWithCustomError(
      operators,
      Errors.INSUFFICIENT_BALANCE
    );
  });

  it("Is reverted with 'CallerNotOwnerWithData' when non-owner tries to withdraw ETH earnings", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const [, other] = await connection.ethers.getSigners();

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );
    await seedOperatorWithETHBalance(networkHelpers, connection, operators, 1, 1n);

    await expect(operators.connect(other).withdrawOperatorEarnings(1, ETH_DEDUCTED_DIGITS)).to.be.revertedWithCustomError(
      operators,
      Errors.CALLER_NOT_OWNER
    );
  });

  it("Is reverted with 'MaxPrecisionExceeded' when ETH withdrawal amount is not aligned to ETH_DEDUCTED_DIGITS", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );
    await seedOperatorWithETHBalance(networkHelpers, connection, operators, 1, 5n);

    await expect(operators.withdrawOperatorEarnings(1, 1n))
      .to.be.revertedWithCustomError(operators, Errors.MAX_PRECISION_EXCEEDED);
  });

  it("Is reverted with 'CallerNotOwnerWithData' when non-owner tries to withdraw all ETH earnings", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const [, other] = await connection.ethers.getSigners();

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );
    await seedOperatorWithETHBalance(networkHelpers, connection, operators, 1, 1n);

    await expect(operators.connect(other).withdrawAllOperatorEarnings(1)).to.be.revertedWithCustomError(
      operators,
      Errors.CALLER_NOT_OWNER
    );
  });

  it("Withdraws exactly 1 * ETH_DEDUCTED_DIGITS (minimum non-zero precision unit) and zeroes balance", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const [owner] = await connection.ethers.getSigners();

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);
    await seedOperatorWithETHBalance(networkHelpers, connection, operators, 1, 1n);

    const amount = 1n * ETH_DEDUCTED_DIGITS;

    await expect(operators.withdrawOperatorEarnings(1, amount))
      .to.emit(operators, Events.OPERATOR_WITHDRAWN)
      .withArgs(owner.address, 1, amount);

    const operatorAfter = await operators.getOperator(1);
    expect(operatorAfter.ethSnapshot.balance).to.equal(0n);
  });
});


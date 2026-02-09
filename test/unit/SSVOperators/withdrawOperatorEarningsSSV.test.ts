import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvOperatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey } from "../../common/helpers.ts";
import {
  DECLARE_OPERATOR_FEE_PERIOD, EXECUTE_OPERATOR_FEE_PERIOD,
  MAXIMUM_OPERATORS_FEE,
  MINIMAL_OPERATOR_ETH_FEE, OPERATOR_MAX_FEE_INCREASE,
  DEDUCTED_DIGITS, ETH_DEDUCTED_DIGITS,
} from '../../common/constants.ts';
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVOperators SSV earnings withdrawals", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
  });

  const deployOperatorsFixture = async () =>
    ssvOperatorsHarnessFixture(connection, MAXIMUM_OPERATORS_FEE, DECLARE_OPERATOR_FEE_PERIOD, EXECUTE_OPERATOR_FEE_PERIOD, OPERATOR_MAX_FEE_INCREASE);

  const seedOperatorWithSSVBalance = async (operators: any, operatorId: number, ssvSnapshotBalance: bigint) => {
    const token = await connection.ethers.deployContract("MockToken");
    await token.waitForDeployment();
    await operators.mockSetToken(await token.getAddress());

    const harnessAddress = await operators.getAddress();
    await token.mint(harnessAddress, connection.ethers.parseEther("1000"));

    await operators.mockSetOperatorBalances(operatorId, 0, Number(ssvSnapshotBalance));
  };

  it("withdrawOperatorEarningsSSV withdraws specific amount and emits event", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const [owner] = await connection.ethers.getSigners();

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );
    await seedOperatorWithSSVBalance(operators, 1, 5n);

    const amount = 2n * DEDUCTED_DIGITS;

    await expect(
      trackGas(
        operators.withdrawOperatorEarningsSSV(1, amount),
        [GasGroup.WITHDRAW_OPERATOR_BALANCE]
      )
    )
      .to.emit(operators, Events.OPERATOR_WITHDRAWN)
      .withArgs(owner.address, 1, amount);

    const operatorAfter = await operators.getOperator(1);
    expect(operatorAfter.snapshot.balance).to.equal(3n);
  });

  it("Succeeds when withdrawing zero amount", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );
    await seedOperatorWithSSVBalance(operators, 1, 5n);

    // Withdraw zero should succeed (snapshot gets updated as part of the process)
    await operators.withdrawOperatorEarningsSSV(1, 0n);
  });

  it("withdrawAllOperatorEarningsSSV withdraws full balance and resets snapshot", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const [owner] = await connection.ethers.getSigners();

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );
    await seedOperatorWithSSVBalance(operators, 1, 4n);

    const expectedAmount = 4n * DEDUCTED_DIGITS;

    await expect(
      trackGas(
        operators.withdrawAllOperatorEarningsSSV(1),
        [GasGroup.WITHDRAW_OPERATOR_BALANCE]
      )
    )
      .to.emit(operators, Events.OPERATOR_WITHDRAWN)
      .withArgs(owner.address, 1, expectedAmount);

    const operatorAfter = await operators.getOperator(1);
    expect(operatorAfter.snapshot.balance).to.equal(0n);
  });

  it("Is reverted with 'InsufficientBalance' when withdrawing more than SSV snapshot balance", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );

    await expect(operators.withdrawOperatorEarningsSSV(1, DEDUCTED_DIGITS)).to.be.revertedWithCustomError(
      operators,
      Errors.INSUFFICIENT_BALANCE
    );
  });

  it("Is reverted with 'MaxPrecisionExceeded' when SSV withdrawal amount is not aligned to DEDUCTED_DIGITS", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );
    await seedOperatorWithSSVBalance(operators, 1, 5n);

    await expect(operators.withdrawOperatorEarningsSSV(1, 1n))
      .to.be.revertedWithCustomError(operators, Errors.MAX_PRECISION_EXCEEDED);
  });

  it("Is reverted with 'CallerNotOwnerWithData' when non-owner tries to withdraw SSV earnings", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const [, other] = await connection.ethers.getSigners();

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );
    await seedOperatorWithSSVBalance(operators, 1, 1n);

    await expect(operators.connect(other).withdrawOperatorEarningsSSV(1, DEDUCTED_DIGITS)).to.be.revertedWithCustomError(
      operators,
      Errors.CALLER_NOT_OWNER
    );
  });
});

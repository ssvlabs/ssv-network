import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvOperatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey } from "../../common/helpers.ts";
import {
  DECLARE_OPERATOR_FEE_PERIOD, ETH_DEDUCTED_DIGITS, EXECUTE_OPERATOR_FEE_PERIOD,
  MAXIMUM_OPERATORS_FEE,
  MINIMAL_OPERATOR_ETH_FEE, OPERATOR_MAX_FEE_INCREASE,
} from '../../common/constants.ts';
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVOperators function `reduceOperatorFee()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  const LEGACY_REDUCED_FEE = 1_000_000_000n;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
  });

  const deployOperatorsFixture = async () =>
    ssvOperatorsHarnessFixture(connection, MAXIMUM_OPERATORS_FEE, DECLARE_OPERATOR_FEE_PERIOD, EXECUTE_OPERATOR_FEE_PERIOD, OPERATOR_MAX_FEE_INCREASE);

  it("Reduces operator fee and emits execution event", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    const initialFee = Number(MINIMAL_OPERATOR_ETH_FEE * 2n);
    await trackGas(
      operators.registerOperator(makeOperatorKey(1), initialFee, false),
      [GasGroup.REGISTER_OPERATOR]
    );

    await expect(
      trackGas(
        operators.reduceOperatorFee(1, Number(MINIMAL_OPERATOR_ETH_FEE)),
        [GasGroup.REDUCE_OPERATOR_FEE]
      )
    ).to.emit(
      operators,
      Events.OPERATOR_FEE_EXECUTED
    );
  });

  it("Is reverted with 'FeeIncreaseNotAllowed' when reducing to the same or higher fee", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    const initialFee = Number(MINIMAL_OPERATOR_ETH_FEE * 2n);
    await trackGas(
      operators.registerOperator(makeOperatorKey(1), initialFee, false),
      [GasGroup.REGISTER_OPERATOR]
    );

    await expect(operators.reduceOperatorFee(1, initialFee)).to.be.revertedWithCustomError(
      operators,
      Errors.FEE_INCREASE_NOT_ALLOWED
    );
  });

  it("Clears pending fee declaration when reducing fee", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const initialFee = Number(MINIMAL_OPERATOR_ETH_FEE * 2n);
    const declaredFee = Number(MINIMAL_OPERATOR_ETH_FEE * 3n);
    const reducedFee = Number(MINIMAL_OPERATOR_ETH_FEE);

    await operators.registerOperator(makeOperatorKey(1), initialFee, false);
    await operators.declareOperatorFee(1, declaredFee);

    // Verify declaration exists
    let request = await operators.getOperatorFeeChangeRequest(1);
    expect(request.approvalBeginTime).to.be.gt(0);

    // Reduce fee
    await operators.reduceOperatorFee(1, reducedFee);

    // Verify declaration is cleared
    request = await operators.getOperatorFeeChangeRequest(1);
    expect(request.approvalBeginTime).to.equal(0);
    
    // Verify fee is reduced
    const op = await operators.getOperator(1);
    expect(op.ethFee).to.equal(BigInt(reducedFee) / ETH_DEDUCTED_DIGITS);
  });

  it("Is reverted with 'FeeTooLow' when reducing below minimal allowed fee", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const initialFee = Number(MINIMAL_OPERATOR_ETH_FEE * 2n);

    await operators.registerOperator(makeOperatorKey(1), initialFee, false);

    await operators.mockSetMinimumOperatorEthFee(Number(MINIMAL_OPERATOR_ETH_FEE));
    await expect(operators.reduceOperatorFee(1, 10_000_000)).to.be.revertedWithCustomError(
      operators,
      Errors.FEE_TOO_LOW
    );
  });

  it("Is reverted with 'MaxPrecisionExceeded' when reduced fee is not aligned to ETH_DEDUCTED_DIGITS", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const initialFee = Number(MINIMAL_OPERATOR_ETH_FEE * 2n);

    await operators.registerOperator(makeOperatorKey(1), initialFee, false);

    await expect(operators.reduceOperatorFee(1, 1n))
      .to.be.revertedWithCustomError(operators, Errors.MAX_PRECISION_EXCEEDED);
  });

  it("Is reverted with 'CallerNotOwnerWithData' when non-owner tries to reduce fee", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const [_, other] = await connection.ethers.getSigners();
    const initialFee = Number(MINIMAL_OPERATOR_ETH_FEE * 2n);
    
    await operators.registerOperator(makeOperatorKey(1), initialFee, false);

    await expect(operators.connect(other).reduceOperatorFee(1, Number(MINIMAL_OPERATOR_ETH_FEE)))
      .to.be.revertedWithCustomError(operators, Errors.CALLER_NOT_OWNER);
  });

  it("Initializes legacy ETH snapshot and reduces fee for SSV legacy operator", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await operators.registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE * 2n, false);
    await operators.mockSetOperatorLegacySSV(1, 1);

    const before = await operators.getOperator(1);
    expect(before.ethSnapshot.block).to.equal(0);
    expect(before.ethFee).to.equal(0n);
    expect(before.fee).to.equal(1n);

    const tx = await operators.reduceOperatorFee(1, LEGACY_REDUCED_FEE);
    const receipt = await tx.wait();

    const after = await operators.getOperator(1);
    expect(after.ethSnapshot.block).to.be.gt(0);
    expect(after.ethFee).to.equal(LEGACY_REDUCED_FEE / ETH_DEDUCTED_DIGITS);

    const feeExecutedLogs = receipt?.logs.filter((log: any) => {
      try {
        const parsed = operators.interface.parseLog(log);
        return parsed?.name === Events.OPERATOR_FEE_EXECUTED;
      } catch {
        return false;
      }
    }) ?? [];
    expect(feeExecutedLogs.length).to.equal(2);
  });

  it("Keeps explicit zero fee after legacy initialization marker is set", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await operators.registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE * 2n, false);
    await operators.mockSetOperatorLegacySSV(1, 1);

    await operators.reduceOperatorFee(1, 0n);

    const afterFirstReduce = await operators.getOperator(1);
    expect(afterFirstReduce.ethSnapshot.block).to.be.gt(0);
    expect(afterFirstReduce.ethFee).to.equal(0n);

    await expect(operators.reduceOperatorFee(1, 0n))
      .to.be.revertedWithCustomError(operators, Errors.FEE_INCREASE_NOT_ALLOWED);

    const afterSecondAttempt = await operators.getOperator(1);
    expect(afterSecondAttempt.ethFee).to.equal(0n);
  });
});

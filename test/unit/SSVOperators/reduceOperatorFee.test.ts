import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey, setupTestContext } from "../../common/helpers.ts";
import { defaultOperatorsFixture } from "../../helpers/fixture-presets.ts";
import {
  ETH_DEDUCTED_DIGITS,
  MINIMAL_OPERATOR_ETH_FEE,
} from '../../common/constants.ts';
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVOperators function `reduceOperatorFee()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await setupTestContext());
  });

  const deployOperatorsFixture = async () => defaultOperatorsFixture(connection);

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
    let request = await operators.getOperatorFeeChangeRequest(1);
    expect(request.approvalBeginTime).to.be.gt(0);
    await operators.reduceOperatorFee(1, reducedFee);
    request = await operators.getOperatorFeeChangeRequest(1);
    expect(request.approvalBeginTime).to.equal(0);
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
});

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { ssvOperatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey, setupTestContext } from "../../common/helpers.ts";
import {
  DECLARE_OPERATOR_FEE_PERIOD, EXECUTE_OPERATOR_FEE_PERIOD,
  MAXIMUM_OPERATORS_FEE,
  MINIMAL_OPERATOR_ETH_FEE, OPERATOR_MAX_FEE_INCREASE,
} from '../../common/constants.ts';
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVOperators function `cancelDeclaredOperatorFee()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await setupTestContext());
  });

  const deployOperatorsFixture = async () =>
    ssvOperatorsHarnessFixture(connection, MAXIMUM_OPERATORS_FEE, DECLARE_OPERATOR_FEE_PERIOD, EXECUTE_OPERATOR_FEE_PERIOD, OPERATOR_MAX_FEE_INCREASE);

  it("Cancels declared fee and emits expected event", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );
    await trackGas(
      operators.declareOperatorFee(1, MINIMAL_OPERATOR_ETH_FEE * 2n),
      [GasGroup.DECLARE_OPERATOR_FEE]
    );

    await expect(
      trackGas(
        operators.cancelDeclaredOperatorFee(1),
        [GasGroup.CANCEL_OPERATOR_FEE]
      )
    ).to.emit(
      operators,
      Events.OPERATOR_FEE_DECLARATION_CANCELLED
    );

    const request = await operators.getOperatorFeeChangeRequest(1);
    expect(request.fee).to.equal(0n);
    expect(request.approvalBeginTime).to.equal(0n);
    expect(request.approvalEndTime).to.equal(0n);
  });

  it("Is reverted with 'NoFeeDeclared' when canceling without a declaration", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );

    await expect(operators.cancelDeclaredOperatorFee(1)).to.be.revertedWithCustomError(
      operators,
      Errors.NO_FEE_DECLARED
    );
  });
});

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey, setupTestContext } from "../../common/helpers.ts";
import { defaultOperatorsFixture } from "../../helpers/fixture-presets.ts";
import {
  DECLARE_OPERATOR_FEE_PERIOD,
  MINIMAL_OPERATOR_ETH_FEE,
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

  const deployOperatorsFixture = async () => defaultOperatorsFixture(connection);

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

  it("Cancels during the approval window and subsequent execute reverts with 'NoFeeDeclared'", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );
    await trackGas(
      operators.declareOperatorFee(1, MINIMAL_OPERATOR_ETH_FEE * 2n),
      [GasGroup.DECLARE_OPERATOR_FEE]
    );

    // Read the approval window boundaries
    const request = await operators.getOperatorFeeChangeRequest(1);
    const approvalBeginTime = request.approvalBeginTime;
    expect(approvalBeginTime).to.be.greaterThan(0n);

    // Advance to exactly the approvalBeginTime (inside the approval window)
    await networkHelpers.time.increaseTo(approvalBeginTime);

    // Verify we are within the approval window
    const currentTime = BigInt(await networkHelpers.time.latest());
    expect(currentTime).to.be.greaterThanOrEqual(approvalBeginTime);
    expect(currentTime).to.be.lessThan(request.approvalEndTime);

    // Cancel during the approval window should succeed
    await expect(
      operators.cancelDeclaredOperatorFee(1)
    ).to.emit(operators, Events.OPERATOR_FEE_DECLARATION_CANCELLED);

    // Verify the request was cleared
    const clearedRequest = await operators.getOperatorFeeChangeRequest(1);
    expect(clearedRequest.fee).to.equal(0n);
    expect(clearedRequest.approvalBeginTime).to.equal(0n);
    expect(clearedRequest.approvalEndTime).to.equal(0n);

    // Subsequent execute should revert with NoFeeDeclared
    await expect(operators.executeOperatorFee(1)).to.be.revertedWithCustomError(
      operators,
      Errors.NO_FEE_DECLARED
    );
  });
});

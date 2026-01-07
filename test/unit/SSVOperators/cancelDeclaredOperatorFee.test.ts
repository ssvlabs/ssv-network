import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvOperatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey } from "../../common/helpers.ts";
import { MINIMAL_OPERATOR_ETH_FEE } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";

describe("SSVOperators function `cancelDeclaredOperatorFee()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
  });

  const deployOperatorsFixture = async () =>
    ssvOperatorsHarnessFixture(connection, 1_000_000_000n, 0n, 1_000n, 10_000n);

  it("Cancels declared fee and emits expected event", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);
    await operators.declareOperatorFee(1, 20_000_000);

    await expect(operators.cancelDeclaredOperatorFee(1)).to.emit(
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

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);

    await expect(operators.cancelDeclaredOperatorFee(1)).to.be.revertedWithCustomError(
      operators,
      Errors.NO_FEE_DECLARED
    );
  });
});

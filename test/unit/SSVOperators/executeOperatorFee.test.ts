import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvOperatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey } from "../../common/helpers.ts";
import { MINIMAL_OPERATOR_ETH_FEE } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";

describe("SSVOperators function `executeOperatorFee()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
  });

  const deployOperatorsFixture = async () =>
    ssvOperatorsHarnessFixture(connection, 1_000_000_000n, 0n, 1_000n, 10_000n);
  const deployOperatorsWithDelay = async () =>
    ssvOperatorsHarnessFixture(connection, 1_000_000_000n, 100n, 100n, 10_000n);

  it("Executes declared fee and emits event", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);
    await operators.declareOperatorFee(1, 20_000_000);

    await expect(operators.executeOperatorFee(1)).to.emit(operators, Events.OPERATOR_FEE_EXECUTED);
  });

  it("Is reverted with 'NoFeeDeclared' when executing without a declaration", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);

    await expect(operators.executeOperatorFee(1)).to.be.revertedWithCustomError(
      operators,
      Errors.NO_FEE_DECLARED
    );
  });

  it("Is reverted with 'ApprovalNotWithinTimeframe' when executing too early or too late", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsWithDelay);

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);
    await operators.declareOperatorFee(1, 20_000_000);

    await expect(operators.executeOperatorFee(1)).to.be.revertedWithCustomError(
      operators,
      Errors.APPROVAL_NOT_WITHIN_TIMEFRAME
    );

    // Move beyond approval window
    await networkHelpers.time.increase(250);

    await expect(operators.executeOperatorFee(1)).to.be.revertedWithCustomError(
      operators,
      Errors.APPROVAL_NOT_WITHIN_TIMEFRAME
    );
  });
});

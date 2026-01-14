import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvOperatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey } from "../../common/helpers.ts";
import { MINIMAL_OPERATOR_ETH_FEE } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVOperators function `reduceOperatorFee()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
  });

  const deployOperatorsFixture = async () =>
    ssvOperatorsHarnessFixture(connection, 1_000_000_000n, 0n, 1_000n, 10_000n);

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
});

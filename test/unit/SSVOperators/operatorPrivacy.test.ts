import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvOperatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey } from "../../common/helpers.ts";
import { MINIMAL_OPERATOR_ETH_FEE } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";

describe("SSVOperators privacy helpers", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
  });

  const deployOperatorsFixture = async () =>
    ssvOperatorsHarnessFixture(connection, 1_000_000_000n, 0n, 1_000n, 10_000n);

  it("Updates privacy status via unchecked helpers", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);

    await expect(operators.setOperatorsPrivateUnchecked([1])).to.emit(
      operators,
      Events.OPERATOR_PRIVACY_STATUS_UPDATED
    ).withArgs([1n], true);

    await expect(operators.setOperatorsPublicUnchecked([1])).to.emit(
      operators,
      Events.OPERATOR_PRIVACY_STATUS_UPDATED
    ).withArgs([1n], false);
  });
});

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey, setupTestContext } from "../../common/helpers.ts";
import { defaultOperatorsFixture } from "../../helpers/fixture-presets.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
} from '../../common/constants.ts';
import { Events } from "../../common/events.ts";
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";
import { Errors } from "../../common/errors.ts";

describe("SSVOperators privacy helpers", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await setupTestContext());
  });

  const deployOperatorsFixture = async () => defaultOperatorsFixture(connection);

  it("Updates privacy status via unchecked helpers", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );

    await expect(
      trackGas(
        operators.setOperatorsPrivateUnchecked([1]),
        [GasGroup.SET_OPERATORS_PRIVATE_10]
      )
    ).to.emit(
      operators,
      Events.OPERATOR_PRIVACY_STATUS_UPDATED
    ).withArgs([1n], true);

    await expect(
      trackGas(
        operators.setOperatorsPublicUnchecked([1]),
        [GasGroup.SET_OPERATORS_PUBLIC_10]
      )
    ).to.emit(
      operators,
      Events.OPERATOR_PRIVACY_STATUS_UPDATED
    ).withArgs([1n], false);
  });

  it("Updates privacy status for a batch of operators", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);
    await operators.registerOperator(makeOperatorKey(2), Number(MINIMAL_OPERATOR_ETH_FEE), false);

    const ids = [1n, 2n];
    await expect(operators.setOperatorsPrivateUnchecked(ids))
      .to.emit(operators, Events.OPERATOR_PRIVACY_STATUS_UPDATED)
      .withArgs(ids, true);

    const op1 = await operators.getOperator(1);
    const op2 = await operators.getOperator(2);
    expect(op1.whitelisted).to.be.true;
    expect(op2.whitelisted).to.be.true;
    await expect(operators.setOperatorsPublicUnchecked(ids))
      .to.emit(operators, Events.OPERATOR_PRIVACY_STATUS_UPDATED)
      .withArgs(ids, false);
      
    const op1Public = await operators.getOperator(1);
    expect(op1Public.whitelisted).to.be.false;
  });

  it("Is reverted with 'CallerNotOwnerWithData' if caller does not own all operators in batch", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const [owner, other] = await connection.ethers.getSigners();

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);
    await operators.connect(other).registerOperator(makeOperatorKey(2), Number(MINIMAL_OPERATOR_ETH_FEE), false);
    await expect(operators.setOperatorsPrivateUnchecked([1n, 2n]))
      .to.be.revertedWithCustomError(operators, Errors.CALLER_NOT_OWNER);
  });
});

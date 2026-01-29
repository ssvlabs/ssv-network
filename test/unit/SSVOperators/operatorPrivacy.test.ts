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
} from '../../common/constants.ts';
import { Events } from "../../common/events.ts";
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";
import { Errors } from "../../common/errors.ts";

describe("SSVOperators privacy helpers", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
  });

  const deployOperatorsFixture = async () =>
    ssvOperatorsHarnessFixture(connection, MAXIMUM_OPERATORS_FEE, DECLARE_OPERATOR_FEE_PERIOD, EXECUTE_OPERATOR_FEE_PERIOD, OPERATOR_MAX_FEE_INCREASE);

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

    // Register 2 more operators
    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);
    await operators.registerOperator(makeOperatorKey(2), Number(MINIMAL_OPERATOR_ETH_FEE), false);

    const ids = [1n, 2n];

    // Set batch to private
    await expect(operators.setOperatorsPrivateUnchecked(ids))
      .to.emit(operators, Events.OPERATOR_PRIVACY_STATUS_UPDATED)
      .withArgs(ids, true);

    const op1 = await operators.getOperator(1);
    const op2 = await operators.getOperator(2);
    expect(op1.whitelisted).to.be.true;
    expect(op2.whitelisted).to.be.true;

    // Set batch to public
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
    
    // Register operator 2 by another user
    await operators.connect(other).registerOperator(makeOperatorKey(2), Number(MINIMAL_OPERATOR_ETH_FEE), false);

    // Try to update both (owner owns 1 but not 2)
    await expect(operators.setOperatorsPrivateUnchecked([1n, 2n]))
      .to.be.revertedWithCustomError(operators, Errors.CALLER_NOT_OWNER);
  });
});

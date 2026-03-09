import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { ssvOperatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey, setupTestContext } from "../../common/helpers.ts";
import {
  DECLARE_OPERATOR_FEE_PERIOD, ETH_DEDUCTED_DIGITS, EXECUTE_OPERATOR_FEE_PERIOD,
  MAXIMUM_OPERATORS_FEE,
  MINIMAL_OPERATOR_ETH_FEE,
  OPERATOR_MAX_FEE_INCREASE,
} from '../../common/constants.ts';
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVOperators function `executeOperatorFee()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await setupTestContext());
  });

  const deployOperatorsFixture = async () =>
    ssvOperatorsHarnessFixture(connection, MAXIMUM_OPERATORS_FEE, DECLARE_OPERATOR_FEE_PERIOD, EXECUTE_OPERATOR_FEE_PERIOD, OPERATOR_MAX_FEE_INCREASE);
  const deployOperatorsWithDelay = async () =>
    ssvOperatorsHarnessFixture(connection, MAXIMUM_OPERATORS_FEE, DECLARE_OPERATOR_FEE_PERIOD, EXECUTE_OPERATOR_FEE_PERIOD, OPERATOR_MAX_FEE_INCREASE);

  it("Executes declared fee and emits event", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );
    await trackGas(
      operators.declareOperatorFee(1, MINIMAL_OPERATOR_ETH_FEE * 2n),
      [GasGroup.DECLARE_OPERATOR_FEE]
    );

    await networkHelpers.mine(DECLARE_OPERATOR_FEE_PERIOD + 1n);

    await expect(
      trackGas(
        operators.executeOperatorFee(1),
        [GasGroup.EXECUTE_OPERATOR_FEE]
      )
    ).to.emit(operators, Events.OPERATOR_FEE_EXECUTED);
  });

  it("Is reverted with 'NoFeeDeclared' when executing without a declaration", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );

    await expect(operators.executeOperatorFee(1)).to.be.revertedWithCustomError(
      operators,
      Errors.NO_FEE_DECLARED
    );
  });

  it("Is reverted with 'ApprovalNotWithinTimeframe' when executing too early or too late", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsWithDelay);

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );
    await trackGas(
      operators.declareOperatorFee(1, MINIMAL_OPERATOR_ETH_FEE * 2n),
      [GasGroup.DECLARE_OPERATOR_FEE]
    );

    await expect(operators.executeOperatorFee(1)).to.be.revertedWithCustomError(
      operators,
      Errors.APPROVAL_NOT_WITHIN_TIMEFRAME
    );
    await networkHelpers.time.increase(250);

    await expect(operators.executeOperatorFee(1)).to.be.revertedWithCustomError(
      operators,
      Errors.APPROVAL_NOT_WITHIN_TIMEFRAME
    );
  });

  it("Updates operator fee and clears request after execution", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const initialFee = Number(MINIMAL_OPERATOR_ETH_FEE);
    const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;

    await operators.registerOperator(makeOperatorKey(1), initialFee, false);
    await operators.declareOperatorFee(1, newFee);

    await networkHelpers.mine(DECLARE_OPERATOR_FEE_PERIOD + 1n);

    await operators.executeOperatorFee(1);

    const op = await operators.getOperator(1);
    expect(op.ethFee).to.equal(BigInt(newFee) / ETH_DEDUCTED_DIGITS);

    const request = await operators.getOperatorFeeChangeRequest(1);
    expect(request.approvalBeginTime).to.equal(0);
  });

  it("Is reverted with 'CallerNotOwnerWithData' when non-owner tries to execute fee", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const [_, other] = await connection.ethers.getSigners();
    
    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);
    await operators.declareOperatorFee(1, MINIMAL_OPERATOR_ETH_FEE * 2n);

    await networkHelpers.mine(DECLARE_OPERATOR_FEE_PERIOD + 1n);

    await expect(operators.connect(other).executeOperatorFee(1))
      .to.be.revertedWithCustomError(operators, Errors.CALLER_NOT_OWNER);
  });

  it("Is reverted with 'FeeTooHigh' if DAO lowers max fee below declared amount before execution", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const initialFee = Number(MINIMAL_OPERATOR_ETH_FEE);
    const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;

    await operators.registerOperator(makeOperatorKey(1), initialFee, false);
    await operators.declareOperatorFee(1, newFee);
    await operators.mockSetOperatorMaxFee(Number(MINIMAL_OPERATOR_ETH_FEE));

    await networkHelpers.mine(DECLARE_OPERATOR_FEE_PERIOD + 1n);

    await expect(operators.executeOperatorFee(1)).to.be.revertedWithCustomError(
      operators,
      Errors.FEE_TOO_HIGH
    );
  });

  it("Is reverted with 'LegacyOperatorFeeDeclarationInvalid' when executing a pre-upgrade fee declaration", async function () {
    const currentTime = BigInt(Math.floor(Date.now() / 1000));
    const upgradeTimestamp = currentTime + 1000n;

    const operators = (await ssvOperatorsHarnessFixture(
      connection,
      MAXIMUM_OPERATORS_FEE,
      DECLARE_OPERATOR_FEE_PERIOD,
      EXECUTE_OPERATOR_FEE_PERIOD,
      OPERATOR_MAX_FEE_INCREASE,
      upgradeTimestamp
    )).operators;

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);

    const legacyApprovalBeginTime = upgradeTimestamp - 500n;
    const legacyApprovalEndTime = upgradeTimestamp + 500n;
    const newFee = 2n;

    await operators.mockSetOperatorFeeChangeRequest(
      1,
      newFee,
      legacyApprovalBeginTime,
      legacyApprovalEndTime
    );

    await expect(operators.executeOperatorFee(1)).to.be.revertedWithCustomError(
      operators,
      Errors.LEGACY_OPERATOR_FEE_DECLARATION_INVALID
    );
  });
});

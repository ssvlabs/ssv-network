import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
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
import { Errors } from "../../common/errors.ts";
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVOperators function `declareOperatorFee()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [owner] = await connection.ethers.getSigners();
  });

  const deployOperatorsFixture = async () =>
    ssvOperatorsHarnessFixture(connection, MAXIMUM_OPERATORS_FEE, DECLARE_OPERATOR_FEE_PERIOD, EXECUTE_OPERATOR_FEE_PERIOD, OPERATOR_MAX_FEE_INCREASE);
  const deployOperatorsWithTightMaxFee = async () =>
    ssvOperatorsHarnessFixture(connection, MINIMAL_OPERATOR_ETH_FEE, DECLARE_OPERATOR_FEE_PERIOD, EXECUTE_OPERATOR_FEE_PERIOD, OPERATOR_MAX_FEE_INCREASE);

  it("Declares operator fee within allowed limits and emits event", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );

    const operatorId = 1;
    const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n; // within allowed increase and precision

    await expect(
      trackGas(
        operators.declareOperatorFee(operatorId, newFee),
        [GasGroup.DECLARE_OPERATOR_FEE]
      )
    ).to.emit(operators, Events.OPERATOR_FEE_DECLARED);

    const request = await operators.getOperatorFeeChangeRequest(operatorId);
    expect(request.fee).to.equal(BigInt(newFee) / 10_000_000n);
    expect(request.approvalBeginTime).to.be.greaterThan(0);
    expect(request.approvalEndTime).to.be.greaterThan(request.approvalBeginTime);
  });

  it("Is reverted with 'FeeTooLow' when declaring below minimal fee", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );

    await expect(operators.declareOperatorFee(1, 1)).to.be.revertedWithCustomError(operators, Errors.FEE_TOO_LOW);
  });

  it("Is reverted with 'FeeTooHigh' when declaring above max fee", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsWithTightMaxFee);

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );

    await expect(operators.declareOperatorFee(1, Number(MINIMAL_OPERATOR_ETH_FEE + 10_000_000n))).to.be.revertedWithCustomError(
      operators,
      Errors.FEE_TOO_HIGH
    );
  });

  it("Is reverted with 'FeeIncreaseNotAllowed' when starting from zero fee", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), 0, false),
      [GasGroup.REGISTER_OPERATOR]
    );

    await expect(operators.declareOperatorFee(1, Number(MINIMAL_OPERATOR_ETH_FEE))).to.be.revertedWithCustomError(
      operators,
      Errors.FEE_INCREASE_NOT_ALLOWED
    );
  });

  it("Is reverted with 'SameFeeChangeNotAllowed' when declaring same fee", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );

    await expect(operators.declareOperatorFee(1, Number(MINIMAL_OPERATOR_ETH_FEE))).to.be.revertedWithCustomError(
      operators,
      Errors.SAME_FEE_CHANGE_NOT_ALLOWED
    );
  });

  it("Is reverted with 'FeeExceedsIncreaseLimit' when increasing fee beyond allowed percentage", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    // Fixture sets max increase to 100% (10_000)
    
    const initialFee = Number(MINIMAL_OPERATOR_ETH_FEE);
    await operators.registerOperator(makeOperatorKey(1), initialFee, false);

    // Try to increase by > 100% (e.g. triple the fee)
    const newFee = initialFee * 3;
    
    await expect(operators.declareOperatorFee(1, newFee)).to.be.revertedWithCustomError(
      operators,
      Errors.FEE_EXCEEDS_INCREASE_LIMIT
    );
  });

  it("Is reverted with 'CallerNotOwnerWithData' when non-owner tries to declare fee", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const [_, other] = await connection.ethers.getSigners();
    
    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);

    await expect(operators.connect(other).declareOperatorFee(1, Number(MINIMAL_OPERATOR_ETH_FEE) * 2))
      .to.be.revertedWithCustomError(operators, Errors.CALLER_NOT_OWNER);
  });
});

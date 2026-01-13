import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvOperatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey } from "../../common/helpers.ts";
import { MINIMAL_OPERATOR_ETH_FEE } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";

describe("SSVOperators function `declareOperatorFee()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [owner] = await connection.ethers.getSigners();
  });

  const deployOperatorsFixture = async () =>
    ssvOperatorsHarnessFixture(connection, 1_000_000_000n, 0n, 1_000n, 10_000n);
  const deployOperatorsWithTightMaxFee = async () =>
    ssvOperatorsHarnessFixture(connection, MINIMAL_OPERATOR_ETH_FEE, 0n, 1_000n, 10_000n);

  it("Declares operator fee within allowed limits and emits event", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);

    const operatorId = 1;
    const newFee = 20_000_000; // within allowed increase and precision

    await expect(operators.declareOperatorFee(operatorId, newFee)).to.emit(operators, Events.OPERATOR_FEE_DECLARED);

    const request = await operators.getOperatorFeeChangeRequest(operatorId);
    expect(request.fee).to.equal(BigInt(newFee) / 10_000_000n);
    expect(request.approvalBeginTime).to.be.greaterThan(0);
    expect(request.approvalEndTime).to.be.greaterThan(request.approvalBeginTime);
  });

  it("Is reverted with 'FeeTooLow' when declaring below minimal fee", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);

    await expect(operators.declareOperatorFee(1, 1)).to.be.revertedWithCustomError(operators, Errors.FEE_TOO_LOW);
  });

  it("Is reverted with 'FeeTooHigh' when declaring above max fee", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsWithTightMaxFee);

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);

    await expect(operators.declareOperatorFee(1, Number(MINIMAL_OPERATOR_ETH_FEE + 10_000_000n))).to.be.revertedWithCustomError(
      operators,
      Errors.FEE_TOO_HIGH
    );
  });

  it("Is reverted with 'FeeIncreaseNotAllowed' when starting from zero fee", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await operators.registerOperator(makeOperatorKey(1), 0, false);

    await expect(operators.declareOperatorFee(1, Number(MINIMAL_OPERATOR_ETH_FEE))).to.be.revertedWithCustomError(
      operators,
      Errors.FEE_INCREASE_NOT_ALLOWED
    );
  });

  it("Is reverted with 'SameFeeChangeNotAllowed' when declaring same fee", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);

    await expect(operators.declareOperatorFee(1, Number(MINIMAL_OPERATOR_ETH_FEE))).to.be.revertedWithCustomError(
      operators,
      Errors.SAME_FEE_CHANGE_NOT_ALLOWED
    );
  });
});

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvOperatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey, setupTestContext } from "../../common/helpers.ts";
import { defaultOperatorsFixture } from "../../helpers/fixture-presets.ts";
import {
  DEFAULT_OPERATOR_ETH_FEE,
  ETH_DEDUCTED_DIGITS,
  MINIMAL_OPERATOR_ETH_FEE,
} from '../../common/constants.ts';
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVOperators function `declareOperatorFee()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [owner] } = await setupTestContext());
  });

  const deployOperatorsFixture = async () => defaultOperatorsFixture(connection);
  const deployOperatorsWithTightMaxFee = async () =>
    ssvOperatorsHarnessFixture(connection, MINIMAL_OPERATOR_ETH_FEE);

  it("Declares operator fee within allowed limits and emits event", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );

    const operatorId = 1;
    const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;

    await expect(
      trackGas(
        operators.declareOperatorFee(operatorId, newFee),
        [GasGroup.DECLARE_OPERATOR_FEE]
      )
    ).to.emit(operators, Events.OPERATOR_FEE_DECLARED);

    const request = await operators.getOperatorFeeChangeRequest(operatorId);
    expect(request.fee).to.equal(BigInt(newFee) / ETH_DEDUCTED_DIGITS);
    expect(request.approvalBeginTime).to.be.greaterThan(0);
    expect(request.approvalEndTime).to.be.greaterThan(request.approvalBeginTime);
  });

  it("Is reverted with 'FeeTooLow' when declaring below minimal fee", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );

    await operators.mockSetMinimumOperatorEthFee(20_000_000);
    await expect(operators.declareOperatorFee(1, 10_000_000)).to.be.revertedWithCustomError(operators, Errors.FEE_TOO_LOW);
  });

  it("Is reverted with 'FeeTooHigh' when declaring above max fee", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsWithTightMaxFee);

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );

    await expect(operators.declareOperatorFee(1, Number(MINIMAL_OPERATOR_ETH_FEE * 2n))).to.be.revertedWithCustomError(
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
    
    const initialFee = Number(MINIMAL_OPERATOR_ETH_FEE);
    await operators.registerOperator(makeOperatorKey(1), initialFee, false);
    const newFee = initialFee * 3;
    
    await expect(operators.declareOperatorFee(1, newFee)).to.be.revertedWithCustomError(
      operators,
      Errors.FEE_EXCEEDS_INCREASE_LIMIT
    );
  });

  it("Is reverted with 'MaxPrecisionExceeded' when declared fee is not aligned to ETH_DEDUCTED_DIGITS", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );

    await expect(operators.declareOperatorFee(1, 1n))
      .to.be.revertedWithCustomError(operators, Errors.MAX_PRECISION_EXCEEDED);
  });

  it("Emits OperatorFeeExecuted when defaulting legacy SSV operator to ETH fee on declare", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);
    const operatorId = 1;
    await operators.mockSetOperatorLegacySSV(operatorId, 1);

    const newFee = DEFAULT_OPERATOR_ETH_FEE + DEFAULT_OPERATOR_ETH_FEE / 2n; // 1.5× = 2_655_000_000n

    const tx = await operators.declareOperatorFee(operatorId, newFee);
    const receipt = await tx.wait();
    const expectedBlock = BigInt(receipt!.blockNumber);

    await expect(tx).to.emit(operators, Events.OPERATOR_FEE_EXECUTED)
      .withArgs(owner.address, operatorId, expectedBlock, DEFAULT_OPERATOR_ETH_FEE);

    await expect(tx).to.emit(operators, Events.OPERATOR_FEE_DECLARED)
      .withArgs(owner.address, operatorId, expectedBlock, newFee);
  });

  it("Is reverted with 'CallerNotOwnerWithData' when non-owner tries to declare fee", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const [_, other] = await connection.ethers.getSigners();
    
    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);

    await expect(operators.connect(other).declareOperatorFee(1, Number(MINIMAL_OPERATOR_ETH_FEE) * 2))
      .to.be.revertedWithCustomError(operators, Errors.CALLER_NOT_OWNER);
  });
});

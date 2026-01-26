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

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );
    await trackGas(
      operators.declareOperatorFee(1, 20_000_000),
      [GasGroup.DECLARE_OPERATOR_FEE]
    );

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
      operators.declareOperatorFee(1, 20_000_000),
      [GasGroup.DECLARE_OPERATOR_FEE]
    );

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

  it("Updates operator fee and clears request after execution", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const initialFee = Number(MINIMAL_OPERATOR_ETH_FEE);
    const newFee = 20_000_000;

    await operators.registerOperator(makeOperatorKey(1), initialFee, false);
    await operators.declareOperatorFee(1, newFee);

    await operators.executeOperatorFee(1);

    const op = await operators.getOperator(1);
    // fee in storage is shrunk (div by 10^7 if using default precision, 
    // actually it's just stored as is if using same precision logic as declared)
    // The fixture uses standard precision. 
    // newFee is 20_000_000 (wei/units?). 
    // Let's check how it's stored. The input to declare is in WEI (or similar units), stored as shrunk.
    // In `declareOperatorFee`: `uint64 shrunkFee = fee.shrink();`
    // In `executeOperatorFee`: `operator.ethFee = feeChangeRequest.fee;`
    // getOperator returns the struct. ethFee is uint64.
    // 20_000_000 / 10_000_000 (DEDUCTED_DIGITS?) = 2?
    // Let's rely on the fact that `declareOperatorFee` takes the full value.
    
    // Actually, looking at declare test: `expect(request.fee).to.equal(BigInt(newFee) / 10_000_000n);`
    // So stored fee is 2.
    expect(op.ethFee).to.equal(BigInt(newFee) / 10_000_000n);

    const request = await operators.getOperatorFeeChangeRequest(1);
    expect(request.approvalBeginTime).to.equal(0);
  });

  it("Is reverted with 'CallerNotOwnerWithData' when non-owner tries to execute fee", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const [_, other] = await connection.ethers.getSigners();
    
    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);
    await operators.declareOperatorFee(1, 20_000_000);

    await expect(operators.connect(other).executeOperatorFee(1))
      .to.be.revertedWithCustomError(operators, Errors.CALLER_NOT_OWNER);
  });

  it("Is reverted with 'FeeTooHigh' if DAO lowers max fee below declared amount before execution", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const initialFee = Number(MINIMAL_OPERATOR_ETH_FEE);
    const newFee = 20_000_000; // 2x minimal

    await operators.registerOperator(makeOperatorKey(1), initialFee, false);
    await operators.declareOperatorFee(1, newFee);

    // DAO lowers max fee to MINIMAL_OPERATOR_ETH_FEE
    await operators.mockSetOperatorMaxFee(Number(MINIMAL_OPERATOR_ETH_FEE));

    await expect(operators.executeOperatorFee(1)).to.be.revertedWithCustomError(
      operators,
      Errors.FEE_TOO_HIGH
    );
  });
});

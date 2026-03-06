import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvOperatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey } from "../../common/helpers.ts";
import {
  DECLARE_OPERATOR_FEE_PERIOD,
  EXECUTE_OPERATOR_FEE_PERIOD,
  MAXIMUM_OPERATORS_FEE,
  MINIMAL_OPERATOR_ETH_FEE,
  OPERATOR_MAX_FEE_INCREASE,
} from "../../common/constants.ts";

describe("Minimal reduceOperatorFee test", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
  });

  const deployOperatorsFixture = async () =>
    ssvOperatorsHarnessFixture(
      connection,
      MAXIMUM_OPERATORS_FEE,
      DECLARE_OPERATOR_FEE_PERIOD,
      EXECUTE_OPERATOR_FEE_PERIOD,
      OPERATOR_MAX_FEE_INCREASE
    );

  it("Reduce operator fee normally", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    const initialFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
    await operators.registerOperator(makeOperatorKey(1), initialFee, false);

    console.log("Operator registered");

    const opBefore = await operators.getOperator(1);
    console.log("Before reduceOperatorFee:");
    console.log("  ethSnapshot.block:", opBefore.ethSnapshot.block);
    console.log("  ethFee:", opBefore.ethFee);
    console.log("  snapshot.block:", opBefore.snapshot.block);
    console.log("  fee (SSV):", opBefore.fee);

    // Normal reduction (no mocking)
    await operators.reduceOperatorFee(1, MINIMAL_OPERATOR_ETH_FEE);

    const opAfter = await operators.getOperator(1);
    console.log("After reduceOperatorFee:");
    console.log("  ethSnapshot.block:", opAfter.ethSnapshot.block);
    console.log("  ethFee:", opAfter.ethFee);

    expect(opAfter.ethSnapshot.block).to.be.gt(0);
  });

  it("Reduce operator fee after clearing ethSnapshot", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    const initialFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
    await operators.registerOperator(makeOperatorKey(1), initialFee, false);

    console.log("Operator registered");

    // Clear ethSnapshot
    await operators.mockClearEthSnapshot(1);
    await operators.mockSetSSVFee(1, 1_000_000n);

    const opBefore = await operators.getOperator(1);
    console.log("After clearing ethSnapshot:");
    console.log("  ethSnapshot.block:", opBefore.ethSnapshot.block);
    console.log("  ethFee:", opBefore.ethFee);
    console.log("  snapshot.block:", opBefore.snapshot.block);
    console.log("  fee (SSV):", opBefore.fee);

    // Try to reduce fee (use a value less than DEFAULT_OPERATOR_ETH_FEE)
    const reducedFee = 1_000_000_000n; // 1 gwei, less than DEFAULT (1.77 gwei)
    console.log("Calling reduceOperatorFee with fee:", reducedFee.toString());
    await operators.reduceOperatorFee(1, reducedFee);

    const opAfter = await operators.getOperator(1);
    console.log("After reduceOperatorFee:");
    console.log("  ethSnapshot.block:", opAfter.ethSnapshot.block);
    console.log("  ethFee:", opAfter.ethFee);

    expect(opAfter.ethSnapshot.block).to.be.gt(0);
  });
});

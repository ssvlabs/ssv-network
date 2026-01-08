import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvOperatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey } from "../../common/helpers.ts";
import { MINIMAL_OPERATOR_ETH_FEE } from "../../common/constants.ts";
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";

describe("SSVOperators function `withdrawAllVersionOperatorEarnings()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
  });

  const deployOperatorsFixture = async () =>
    ssvOperatorsHarnessFixture(connection, 1_000_000_000n, 0n, 1_000n, 10_000n);

  it("Withdraws both ETH and SSV earnings and resets balances", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);

    // Manually set balances on snapshots via fee declaration/execution to accrue balances
    await operators.declareOperatorFee(1, 20_000_000);
    await operators.executeOperatorFee(1);

    // Simulate only ETH balance to avoid token transfer dependence and fund contract for the payout.
    await operators.mockSetOperatorBalances(1, 2, 0);
    const harnessAddress = await operators.getAddress();
    await networkHelpers.setBalance(harnessAddress, connection.ethers.parseEther("1"));

    await expect(operators.withdrawAllVersionOperatorEarnings(1)).to.emit(
      operators,
      Events.OPERATOR_WITHDRAWN
    );

    const operatorAfter = await operators.getOperator(1);
    expect(operatorAfter.ethSnapshot.balance).to.equal(0n);
    expect(operatorAfter.snapshot.balance).to.equal(0n);
  });

  it("Is reverted with 'CallerNotOwnerWithData' when non-owner tries to withdraw", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    const [, other] = await connection.ethers.getSigners();
    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);

    await expect(operators.connect(other).withdrawAllVersionOperatorEarnings(1)).to.be.revertedWithCustomError(
      operators,
      Errors.CALLER_NOT_OWNER
    );
  });
});

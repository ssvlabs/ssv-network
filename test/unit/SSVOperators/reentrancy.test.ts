import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvOperatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey } from "../../common/helpers.ts";
import { MINIMAL_OPERATOR_ETH_FEE } from "../../common/constants.ts";
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";

const SHRINK_FACTOR = 10_000_000n;

describe("SSVOperators reentrancy guard", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
  });

  const deployOperatorsFixture = async () =>
    ssvOperatorsHarnessFixture(connection, 1_000_000_000n, 0n, 1_000n, 10_000n);

  it("Blocks reentrancy during ETH earnings withdrawal", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    const attacker = await connection.ethers.deployContract(
      "OperatorEarningsReentrancy",
      [await operators.getAddress()]
    );
    await attacker.waitForDeployment();

    await trackGas(
      attacker.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );

    const operatorId = await attacker.operatorId();

    await networkHelpers.setBalance(await operators.getAddress(), connection.ethers.parseEther("10"));
    await operators.mockSetOperatorBalances(Number(operatorId), 5, 0);

    const withdrawAmount = 2n * SHRINK_FACTOR;
    const reenterAmount = 1n * SHRINK_FACTOR;

    await attacker.setReenterAmount(reenterAmount);
    await trackGas(
      attacker.triggerWithdraw(withdrawAmount),
      [GasGroup.WITHDRAW_OPERATOR_BALANCE]
    );

    expect(await attacker.reentered()).to.equal(true);
    expect(await attacker.reenterSucceeded()).to.equal(false);

    const operatorAfter = await operators.getOperator(operatorId);
    expect(operatorAfter.ethSnapshot.balance).to.equal(3n);
  });
});

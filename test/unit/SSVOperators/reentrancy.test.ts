import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey, setupTestContext } from "../../common/helpers.ts";
import { defaultOperatorsFixture } from "../../helpers/fixture-presets.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  DEDUCTED_DIGITS, ETH_DEDUCTED_DIGITS,
} from '../../common/constants.ts';
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVOperators reentrancy guard", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await setupTestContext());
  });

  const deployOperatorsFixture = async () => defaultOperatorsFixture(connection);

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

    const withdrawAmount = 2n * ETH_DEDUCTED_DIGITS;
    const reenterAmount = 1n * ETH_DEDUCTED_DIGITS;

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

  it("Blocks reentrancy during SSV earnings withdrawal", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const token = await connection.ethers.deployContract("ReentrantTokenMock");
    await token.waitForDeployment();
    await operators.mockSetToken(await token.getAddress());
    const attacker = await connection.ethers.deployContract(
      "OperatorEarningsReentrancySSV",
      [await operators.getAddress(), await token.getAddress()]
    );
    await attacker.waitForDeployment();
    await trackGas(
      attacker.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );

    const operatorId = await attacker.operatorId();
    await token.mint(await operators.getAddress(), connection.ethers.parseEther("100"));
    await operators.mockSetOperatorBalances(Number(operatorId), 0, 5n);
    const withdrawAmount = 2n * DEDUCTED_DIGITS;
    const reenterAmount = 1n * DEDUCTED_DIGITS;

    await attacker.setReenterAmount(reenterAmount);
    await attacker.triggerWithdraw(withdrawAmount);







  });
});

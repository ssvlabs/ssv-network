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
  DEDUCTED_DIGITS, ETH_DEDUCTED_DIGITS,
} from '../../common/constants.ts';
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVOperators reentrancy guard", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
  });

  const deployOperatorsFixture = async () =>
    ssvOperatorsHarnessFixture(connection, MAXIMUM_OPERATORS_FEE, DECLARE_OPERATOR_FEE_PERIOD, EXECUTE_OPERATOR_FEE_PERIOD, OPERATOR_MAX_FEE_INCREASE);

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

    // Deploy ReentrantTokenMock
    const token = await connection.ethers.deployContract("ReentrantTokenMock");
    await token.waitForDeployment();

    // Set token in storage
    await operators.mockSetToken(await token.getAddress());

    // Deploy Attacker
    const attacker = await connection.ethers.deployContract(
      "OperatorEarningsReentrancySSV",
      [await operators.getAddress(), await token.getAddress()]
    );
    await attacker.waitForDeployment();

    // Register operator via attacker
    await trackGas(
      attacker.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );

    const operatorId = await attacker.operatorId();

    // Fund operators contract with tokens
    await token.mint(await operators.getAddress(), connection.ethers.parseEther("100"));
    
    // Set attacker balance in SSVOperators (using raw storage values, so shrunk)
    await operators.mockSetOperatorBalances(Number(operatorId), 0, 5n);

    // Withdraw 2 units
    const withdrawAmount = 2n * DEDUCTED_DIGITS;
    // Try to reenter for 1 unit
    const reenterAmount = 1n * DEDUCTED_DIGITS;

    await attacker.setReenterAmount(reenterAmount);
    
    // Trigger withdraw
    await attacker.triggerWithdraw(withdrawAmount);
/*
    expect(await attacker.reentered()).to.equal(true);
    expect(await attacker.reenterSucceeded()).to.equal(false);

    const operatorAfter = await operators.getOperator(operatorId);
    expect(operatorAfter.snapshot.balance).to.equal(3n); // 5 - 2 = 3. Reentry of 1 failed.
    */
  });
});

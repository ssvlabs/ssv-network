import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { ssvOperatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey, setupTestContext } from "../../common/helpers.ts";
import {
  DECLARE_OPERATOR_FEE_PERIOD, EXECUTE_OPERATOR_FEE_PERIOD,
  MAXIMUM_OPERATORS_FEE,
  MINIMAL_OPERATOR_ETH_FEE, OPERATOR_MAX_FEE_INCREASE,
} from '../../common/constants.ts';
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";
import { trackGas, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVOperators function `withdrawAllVersionOperatorEarnings()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await setupTestContext());
  });

  const deployOperatorsFixture = async () =>
    ssvOperatorsHarnessFixture(connection, MAXIMUM_OPERATORS_FEE, DECLARE_OPERATOR_FEE_PERIOD, EXECUTE_OPERATOR_FEE_PERIOD, OPERATOR_MAX_FEE_INCREASE);

  it("Withdraws both ETH and SSV earnings and resets balances", async function () {
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

    await trackGas(
      operators.executeOperatorFee(1),
      [GasGroup.EXECUTE_OPERATOR_FEE]
    );
    await operators.mockSetOperatorBalances(1, 2, 0);
    const harnessAddress = await operators.getAddress();
    await networkHelpers.setBalance(harnessAddress, connection.ethers.parseEther("1"));

    await expect(
      trackGas(
        operators.withdrawAllVersionOperatorEarnings(1),
        [GasGroup.WITHDRAW_OPERATOR_BALANCE_ALL_VERSIONS]
      )
    ).to.emit(
      operators,
      Events.OPERATOR_WITHDRAWN
    );

    const operatorAfter = await operators.getOperator(1);
    expect(operatorAfter.ethSnapshot.balance).to.equal(0n);
    expect(operatorAfter.snapshot.balance).to.equal(0n);
  });

  it("Withdraws both ETH and SSV earnings when both have balances", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const [owner] = await connection.ethers.getSigners();
    const token = await connection.ethers.deployContract("MockToken");
    await token.waitForDeployment();
    await operators.mockSetToken(await token.getAddress());

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );
    const harnessAddress = await operators.getAddress();
    await networkHelpers.setBalance(harnessAddress, connection.ethers.parseEther("1"));
    await token.mint(harnessAddress, connection.ethers.parseEther("100"));

    // Initialize the legacy SSV side so the all-version withdrawal has both paths active.
    const operatorBefore = await operators.getOperator(1);
    await operators.mockSetOperator(1, {
      validatorCount: operatorBefore.validatorCount,
      fee: 0n,
      owner: operatorBefore.owner,
      whitelisted: operatorBefore.whitelisted,
      snapshot: {
        block: operatorBefore.ethSnapshot.block,
        index: 0n,
        balance: 0n,
      },
      ethValidatorCount: operatorBefore.ethValidatorCount,
      ethFee: operatorBefore.ethFee,
      ethSnapshot: {
        block: operatorBefore.ethSnapshot.block,
        index: operatorBefore.ethSnapshot.index,
        balance: operatorBefore.ethSnapshot.balance,
      },
    });

    // Simulate both ETH and SSV balances
    const ethBalance = 2n;
    const ssvBalance = 3n;
    await operators.mockSetOperatorBalances(1, Number(ethBalance), Number(ssvBalance));

    const ownerSsvBalanceBefore = await token.balanceOf(owner.address);

    await expect(
      trackGas(
        operators.withdrawAllVersionOperatorEarnings(1),
        [GasGroup.WITHDRAW_OPERATOR_BALANCE_ALL_VERSIONS]
      )
    ).to.emit(operators, Events.OPERATOR_WITHDRAWN);

    const operatorAfter = await operators.getOperator(1);
    expect(operatorAfter.ethSnapshot.balance).to.equal(0n);
    expect(operatorAfter.snapshot.balance).to.equal(0n);

    const ownerSsvBalanceAfter = await token.balanceOf(owner.address);
    expect(ownerSsvBalanceAfter).to.be.gt(ownerSsvBalanceBefore);
  });

  it("Succeeds when withdrawing with zero balances (no-op)", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );
    await operators.mockSetOperatorBalances(1, 0, 0);
    await operators.withdrawAllVersionOperatorEarnings(1);

    const operatorAfter = await operators.getOperator(1);
    expect(operatorAfter.ethSnapshot.balance).to.equal(0n);
    expect(operatorAfter.snapshot.balance).to.equal(0n);
  });

  it("Does not initialize ETH snapshot for a legacy SSV-only operator", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);

    // Seed a legacy SSV-only operator: SSV fee set, ETH state unset.
    await operators.mockSetOperatorLegacySSV(1, 12n);

    const operatorBefore = await operators.getOperator(1);
    expect(operatorBefore.fee).to.equal(12n);
    expect(operatorBefore.ethFee).to.equal(0n);
    expect(operatorBefore.ethSnapshot.block).to.equal(0n);

    await operators.withdrawAllVersionOperatorEarnings(1);

    const operatorAfter = await operators.getOperator(1);
    expect(operatorAfter.fee).to.equal(12n);
    expect(operatorAfter.ethFee).to.equal(0n);
    expect(operatorAfter.snapshot.block).to.be.greaterThan(0n);
    expect(operatorAfter.ethSnapshot.block).to.equal(0n);
  });

  it("Pays out SSV balance for a legacy SSV-only operator without initializing ETH snapshot", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const [owner] = await connection.ethers.getSigners();

    const token = await connection.ethers.deployContract("MockToken");
    await token.waitForDeployment();
    await operators.mockSetToken(await token.getAddress());

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);
    await operators.mockSetOperatorLegacySSV(1, 12n);

    // Seed a non-zero SSV balance and fund the contract with tokens
    await operators.mockSetOperatorBalances(1, 0n, 50n);
    await token.mint(await operators.getAddress(), ethers.parseEther("100"));

    const ownerSsvBefore = await token.balanceOf(owner.address);
    await operators.withdrawAllVersionOperatorEarnings(1);
    const ownerSsvAfter = await token.balanceOf(owner.address);

    expect(ownerSsvAfter).to.be.gt(ownerSsvBefore);

    const operatorAfter = await operators.getOperator(1);
    expect(operatorAfter.snapshot.balance).to.equal(0n);
    expect(operatorAfter.ethSnapshot.block).to.equal(0n);
    expect(operatorAfter.ethFee).to.equal(0n);
  });

  it("Is reverted with 'CallerNotOwnerWithData' when non-owner tries to withdraw", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    const [, other] = await connection.ethers.getSigners();
    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );

    await expect(operators.connect(other).withdrawAllVersionOperatorEarnings(1)).to.be.revertedWithCustomError(
      operators,
      Errors.CALLER_NOT_OWNER
    );
  });
});

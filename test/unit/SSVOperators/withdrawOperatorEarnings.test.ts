import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvOperatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey } from "../../common/helpers.ts";
import { MINIMAL_OPERATOR_ETH_FEE } from "../../common/constants.ts";
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";

const SHRINK_FACTOR = 10_000_000n;

describe("SSVOperators ETH earnings withdrawals", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
  });

  const deployOperatorsFixture = async () =>
    ssvOperatorsHarnessFixture(connection, 1_000_000_000n, 0n, 1_000n, 10_000n);

  const seedOperatorWithETHBalance = async (operators: any, operatorId: number, ethSnapshotBalance: bigint) => {
    const harnessAddress = await operators.getAddress();
    await networkHelpers.setBalance(harnessAddress, connection.ethers.parseEther("1000"));
    await operators.mockSetOperatorBalances(operatorId, Number(ethSnapshotBalance), 0);
  };

  it("withdrawOperatorEarnings withdraws specific amount and emits event", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const [owner] = await connection.ethers.getSigners();

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);
    await seedOperatorWithETHBalance(operators, 1, 5n);

    const amount = 2n * SHRINK_FACTOR;

    await expect(operators.withdrawOperatorEarnings(1, amount))
      .to.emit(operators, Events.OPERATOR_WITHDRAWN)
      .withArgs(owner.address, 1, amount);

    const operatorAfter = await operators.getOperator(1);
    expect(operatorAfter.ethSnapshot.balance).to.equal(3n);
  });

  it("withdrawAllOperatorEarnings withdraws full balance and resets snapshot", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const [owner] = await connection.ethers.getSigners();

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);
    await seedOperatorWithETHBalance(operators, 1, 4n);

    const expectedAmount = 4n * SHRINK_FACTOR;

    await expect(operators.withdrawAllOperatorEarnings(1))
      .to.emit(operators, Events.OPERATOR_WITHDRAWN)
      .withArgs(owner.address, 1, expectedAmount);

    const operatorAfter = await operators.getOperator(1);
    expect(operatorAfter.ethSnapshot.balance).to.equal(0n);
  });

  it("Is reverted with 'InsufficientBalance' when withdrawing more than ETH snapshot balance", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);

    await expect(operators.withdrawOperatorEarnings(1, SHRINK_FACTOR)).to.be.revertedWithCustomError(
      operators,
      Errors.INSUFFICIENT_BALANCE
    );
  });

  it("Is reverted with 'CallerNotOwnerWithData' when non-owner tries to withdraw ETH earnings", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const [, other] = await connection.ethers.getSigners();

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);
    await seedOperatorWithETHBalance(operators, 1, 1n);

    await expect(operators.connect(other).withdrawOperatorEarnings(1, SHRINK_FACTOR)).to.be.revertedWithCustomError(
      operators,
      Errors.CALLER_NOT_OWNER
    );
  });

  it("Is reverted with 'CallerNotOwnerWithData' when non-owner tries to withdraw all ETH earnings", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const [, other] = await connection.ethers.getSigners();

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);
    await seedOperatorWithETHBalance(operators, 1, 1n);

    await expect(operators.connect(other).withdrawAllOperatorEarnings(1)).to.be.revertedWithCustomError(
      operators,
      Errors.CALLER_NOT_OWNER
    );
  });
});


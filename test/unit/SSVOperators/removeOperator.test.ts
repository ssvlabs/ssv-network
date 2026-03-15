import { expect } from "chai";
import { ethers } from "ethers";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvOperatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey, setupTestContext } from "../../common/helpers.ts";
import { DECLARE_OPERATOR_FEE_PERIOD, DEFAULT_OPERATOR_ETH_FEE, ETH_DEDUCTED_DIGITS, EXECUTE_OPERATOR_FEE_PERIOD, MINIMAL_OPERATOR_ETH_FEE } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGas, trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVOperators function `removeOperator()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [owner, other] } = await setupTestContext());
  });

  const deployOperatorsFixture = async () => ssvOperatorsHarnessFixture(connection);

  it("Removes operator successfully and emits expected event", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );

    await expect(
      trackGas(
        operators.removeOperator(1),
        [GasGroup.REMOVE_OPERATOR]
      )
    ).to.emit(operators, Events.OPERATOR_REMOVED).withArgs(1n);

    const operatorData = await operators.getOperator(1);
    expect(operatorData.ethFee).to.equal(0n);
    expect(await operators.getOperatorWhitelist(1)).to.equal(ethers.ZeroAddress);
  });

  it("Removes operator with a balance and withdraws", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);

    await operators.mockSetOperatorBalances(1, 1n, 0n);

    const operatorsAddress = await operators.getAddress();
    await connection.ethers.provider.send("hardhat_setBalance", [
      operatorsAddress,
      `0x${(10_000_000n).toString(16)}`,
    ]);

    const tx = await operators.removeOperator(1);
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.REMOVE_OPERATOR_WITH_WITHDRAW]);
  });
  
  it("Removes operator with SSV balance and withdraws", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const token = await connection.ethers.deployContract("MockToken");
    await token.waitForDeployment();
    
    await operators.mockSetToken(await token.getAddress());
    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);
    await operators.mockSetOperatorLegacySSV(1, 1n);
    await operators.mockSetOperatorBalances(1, 0n, 100n);
    await token.mint(await operators.getAddress(), ethers.parseEther("1000"));

    const before = await token.balanceOf(owner.address);
    await operators.removeOperator(1);
    const after = await token.balanceOf(owner.address);

    expect(after).to.be.gt(before);
  });

  it("Removes a legacy SSV-only operator without initializing ETH state", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const token = await connection.ethers.deployContract("MockToken");
    await token.waitForDeployment();

    await operators.mockSetToken(await token.getAddress());
    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);
    await operators.mockSetOperatorLegacySSV(1, 12n);
    await operators.mockSetOperatorBalances(1, 0n, 100n);
    await token.mint(await operators.getAddress(), ethers.parseEther("1000"));

    const before = await operators.getOperator(1);
    expect(before.snapshot.block).to.be.greaterThan(0n);
    expect(before.ethSnapshot.block).to.equal(0n);
    expect(before.ethFee).to.equal(0n);

    const ownerBalanceBefore = await token.balanceOf(owner.address);
    await operators.removeOperator(1);

    const ownerBalanceAfter = await token.balanceOf(owner.address);
    expect(ownerBalanceAfter).to.be.gt(ownerBalanceBefore);

    const after = await operators.getOperator(1);
    expect(after.snapshot.block).to.equal(0n);
    expect(after.ethSnapshot.block).to.equal(0n);
    expect(after.fee).to.equal(0n);
    expect(after.ethFee).to.equal(0n);
  });

  it("Verifies operator state after removal (fees reset, owner persists)", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), true);

    await operators.removeOperator(1);
    
    const op = await operators.getOperator(1);
    expect(op.ethFee).to.equal(0n);
    expect(op.fee).to.equal(0n);
    expect(op.validatorCount).to.equal(0n);
    expect(op.owner).to.equal(owner.address);
    expect(await operators.getOperatorWhitelist(1)).to.equal(ethers.ZeroAddress);
  });

  it("Clears a pending fee change request when removing an operator", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const operatorId = 1n;
    const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);

    const declareTx = await operators.declareOperatorFee(operatorId, Number(newFee));
    const declareReceipt = await declareTx.wait();
    const declareBlock = await connection.ethers.provider.getBlock(declareReceipt!.blockNumber);
    if (declareBlock === null) {
      throw new Error("declareOperatorFee block not found");
    }

    const requestBeforeRemoval = await operators.getOperatorFeeChangeRequest(operatorId);
    expect(requestBeforeRemoval.fee).to.equal(newFee / ETH_DEDUCTED_DIGITS);
    expect(requestBeforeRemoval.approvalBeginTime).to.equal(BigInt(declareBlock.timestamp) + DECLARE_OPERATOR_FEE_PERIOD);
    expect(requestBeforeRemoval.approvalEndTime).to.equal(
      BigInt(declareBlock.timestamp) + DECLARE_OPERATOR_FEE_PERIOD + EXECUTE_OPERATOR_FEE_PERIOD
    );

    await operators.removeOperator(operatorId);

    const requestAfterRemoval = await operators.getOperatorFeeChangeRequest(operatorId);
    expect(requestAfterRemoval.fee).to.equal(0n);
    expect(requestAfterRemoval.approvalBeginTime).to.equal(0n);
    expect(requestAfterRemoval.approvalEndTime).to.equal(0n);
  });

  it("Blocks executeOperatorFee with OperatorDoesNotExist after removal clears both snapshots", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const operatorId = 1n;
    const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);
    await operators.declareOperatorFee(operatorId, Number(newFee));
    await operators.removeOperator(operatorId);

    // Advance past the declare period so we'd be in the executable window
    await networkHelpers.time.increase(Number(DECLARE_OPERATOR_FEE_PERIOD) + 1);

    // checkOwner() sees snapshot.block == 0 && ethSnapshot.block == 0 → OperatorDoesNotExist
    // (the cleared fee change request provides defense-in-depth, but checkOwner fires first)
    await expect(
      operators.executeOperatorFee(operatorId)
    ).to.be.revertedWithCustomError(operators, Errors.OPERATOR_DOES_NOT_EXIST);
  });

  it("Blocks cancelDeclaredOperatorFee with OperatorDoesNotExist after removal clears both snapshots", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const operatorId = 1n;
    const newFee = MINIMAL_OPERATOR_ETH_FEE * 2n;

    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false);
    await operators.declareOperatorFee(operatorId, Number(newFee));
    await operators.removeOperator(operatorId);

    // checkOwner() sees snapshot.block == 0 && ethSnapshot.block == 0 → OperatorDoesNotExist
    // (the cleared fee change request provides defense-in-depth, but checkOwner fires first)
    await expect(
      operators.cancelDeclaredOperatorFee(operatorId)
    ).to.be.revertedWithCustomError(operators, Errors.OPERATOR_DOES_NOT_EXIST);
  });

  it("Cannot register the same public key after removal", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    const key = makeOperatorKey(1);
    
    await operators.registerOperator(key, Number(MINIMAL_OPERATOR_ETH_FEE), false);
    await operators.removeOperator(1);
    
    await expect(
      operators.registerOperator(key, Number(MINIMAL_OPERATOR_ETH_FEE), false)
    ).to.be.revertedWithCustomError(operators, Errors.OPERATOR_ALREADY_EXISTS);
  });

  it("Is reverted with 'CallerNotOwnerWithData' when non-owner tries to remove operator", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);

    await trackGas(
      operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), false),
      [GasGroup.REGISTER_OPERATOR]
    );

    await expect(operators.connect(other).removeOperator(1)).to.be.revertedWithCustomError(
      operators,
      Errors.CALLER_NOT_OWNER
    );
  });
});

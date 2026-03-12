import { expect } from "chai";
import { ethers } from "ethers";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvOperatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey } from "../../common/helpers.ts";
import {
  DECLARE_OPERATOR_FEE_PERIOD,
  ETH_DEDUCTED_DIGITS,
  EXECUTE_OPERATOR_FEE_PERIOD,
  MINIMAL_OPERATOR_ETH_FEE,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { trackGas, trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVOperators function `removeOperator()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;
  let other: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [owner, other] = await connection.ethers.getSigners();
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

    // Set SSV balance (mock uses raw storage value, so 100 units)
    await operators.mockSetOperatorBalances(1, 0n, 100n);
    
    // Mint tokens to operators contract
    await token.mint(await operators.getAddress(), ethers.parseEther("1000"));

    const before = await token.balanceOf(owner.address);
    await operators.removeOperator(1);
    const after = await token.balanceOf(owner.address);
    
    expect(after).to.be.gt(before);
  });

  it("Verifies operator state after removal (fees reset, owner persists)", async function () {
    const { operators } = await networkHelpers.loadFixture(deployOperatorsFixture);
    await operators.registerOperator(makeOperatorKey(1), Number(MINIMAL_OPERATOR_ETH_FEE), true);

    await operators.removeOperator(1);
    
    const op = await operators.getOperator(1);
    expect(op.ethFee).to.equal(0n);
    expect(op.fee).to.equal(0n);
    expect(op.validatorCount).to.equal(0n);
    // Owner is NOT cleared in current implementation
    expect(op.owner).to.equal(owner.address);
    // Whitelist IS cleared
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

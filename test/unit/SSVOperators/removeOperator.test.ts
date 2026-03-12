import { expect } from "chai";
import { ethers } from "ethers";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvOperatorsHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { makeOperatorKey } from "../../common/helpers.ts";
import { MINIMAL_OPERATOR_ETH_FEE } from "../../common/constants.ts";
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

    // Set SSV balance (mock uses raw storage value, so 100 units)
    await operators.mockSetOperatorBalances(1, 0n, 100n);
    
    // Mint tokens to operators contract
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
    // Owner is NOT cleared in current implementation
    expect(op.owner).to.equal(owner.address);
    // Whitelist IS cleared
    expect(await operators.getOperatorWhitelist(1)).to.equal(ethers.ZeroAddress);
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

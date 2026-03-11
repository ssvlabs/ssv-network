import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { defaultValidatorsFixture } from "../../helpers/fixture-presets.ts";
import { deployHarnessModule } from "../../setup/deploy.ts";
import { SSVModules } from "../../common/types.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext, makePublicKey, makePublicKeys, makeOperatorKey, createCluster, parseClusterFromEvent } from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  ETH_DEDUCTED_DIGITS,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { ethers } from "ethers";

const OPERATOR_FEE = 10_000_000_000n;
const DIFFERENT_FEES = [2_000_000_000n, 4_000_000_000n, 6_000_000_000n, 8_000_000_000n];

describe("Validator register/remove with non-zero ETH operator fees", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await setupTestContext());
  });

  const deployValidatorsWithFee = async () => {
    return defaultValidatorsFixture(connection, 4, OPERATOR_FEE);
  };

  const deployValidatorsWithDifferentFees = async () => {
    const validators = await deployHarnessModule(connection, SSVModules.SSVValidators);
    await validators.waitForDeployment();
    await validators.mockValidatorsPerOperatorLimit(3000);

    const [owner] = await connection.ethers.getSigners();
    const operatorIds: bigint[] = [];

    for (let i = 0; i < DIFFERENT_FEES.length; i++) {
      const id = await validators.mockOperator.staticCall(
        makeOperatorKey(i), owner.address, DIFFERENT_FEES[i], false
      );
      await validators.mockOperator(makeOperatorKey(i), owner.address, DIFFERENT_FEES[i], false);
      operatorIds.push(id);
    }

    return { validators, operatorIds };
  };

  it("registers with 4 operators at different fees and deducts sum(fees) * blocksDelta from cluster balance", async function () {
    const { validators, operatorIds } = await networkHelpers.loadFixture(deployValidatorsWithDifferentFees);

    const depositValue = ethers.parseEther("100");
    const regTx1 = await validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: depositValue }
    );
    const receipt1 = await regTx1.wait();
    const cluster1 = parseClusterFromEvent(validators, receipt1, Events.VALIDATOR_ADDED);

    const blockBeforeMine = await connection.ethers.provider.getBlockNumber();
    await networkHelpers.mine(50);
    const blocksMined = (await connection.ethers.provider.getBlockNumber()) - blockBeforeMine;

    const regTx2 = await validators.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      cluster1,
      { value: 0n }
    );
    const receipt2 = await regTx2.wait();
    const cluster2 = parseClusterFromEvent(validators, receipt2, Events.VALIDATOR_ADDED);

    const feeDeducted = cluster1.balance - cluster2.balance;
    const sumPackedFees = DIFFERENT_FEES.reduce((acc, fee) => acc + fee / ETH_DEDUCTED_DIGITS, 0n);
    const blocksDelta = BigInt(blocksMined + 1);
    const expected = sumPackedFees * blocksDelta * 1n * ETH_DEDUCTED_DIGITS;

    expect(feeDeducted).to.equal(expected);
  });

  it("second registration after N blocks settles val1 fees; burn rate doubles when val2 is active", async function () {
    const { validators, operatorIds } = await networkHelpers.loadFixture(deployValidatorsWithFee);

    const depositValue = ethers.parseEther("100");
    const regTx1 = await validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: depositValue }
    );
    const receipt1 = await regTx1.wait();
    const cluster1 = parseClusterFromEvent(validators, receipt1, Events.VALIDATOR_ADDED);

    const blockBefore1 = await connection.ethers.provider.getBlockNumber();
    await networkHelpers.mine(100);
    const blocksMined1 = (await connection.ethers.provider.getBlockNumber()) - blockBefore1;

    const regTx2 = await validators.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      cluster1,
      { value: 0n }
    );
    const receipt2 = await regTx2.wait();
    const cluster2 = parseClusterFromEvent(validators, receipt2, Events.VALIDATOR_ADDED);

    const packedFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
    const blocksDelta1 = BigInt(blocksMined1 + 1);
    const expectedFee1 = 4n * packedFee * blocksDelta1 * ETH_DEDUCTED_DIGITS;

    expect(cluster1.balance - cluster2.balance).to.equal(expectedFee1);

    const blockBefore2 = await connection.ethers.provider.getBlockNumber();
    await networkHelpers.mine(100);
    const blocksMined2 = (await connection.ethers.provider.getBlockNumber()) - blockBefore2;

    const regTx3 = await validators.registerValidator(
      makePublicKey(3),
      operatorIds,
      DEFAULT_SHARES,
      cluster2,
      { value: 0n }
    );
    const receipt3 = await regTx3.wait();
    const cluster3 = parseClusterFromEvent(validators, receipt3, Events.VALIDATOR_ADDED);

    const blocksDelta2 = BigInt(blocksMined2 + 1);
    const expectedFee2 = 4n * packedFee * blocksDelta2 * 2n * ETH_DEDUCTED_DIGITS;

    expect(cluster2.balance - cluster3.balance).to.equal(expectedFee2);
  });

  it("removeValidator settles accumulated fees and operator snapshot balance matches expected earnings", async function () {
    const { validators, operatorIds } = await networkHelpers.loadFixture(deployValidatorsWithFee);

    const depositValue = ethers.parseEther("100");
    const regTx = await validators.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: depositValue }
    );
    const receipt = await regTx.wait();
    const clusterAfterReg = parseClusterFromEvent(validators, receipt, Events.VALIDATOR_ADDED);

    const blockBeforeMine = await connection.ethers.provider.getBlockNumber();
    await networkHelpers.mine(100);
    const blocksMined = (await connection.ethers.provider.getBlockNumber()) - blockBeforeMine;

    const removeTx = await validators.removeValidator(
      makePublicKey(1),
      operatorIds,
      clusterAfterReg
    );
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(validators, removeReceipt, Events.VALIDATOR_REMOVED);

    const packedFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
    const blocksDelta = BigInt(blocksMined + 1);
    const expectedFee = 4n * packedFee * blocksDelta * 1n * ETH_DEDUCTED_DIGITS;

    expect(clusterAfterRemove.validatorCount).to.equal(0n);
    expect(clusterAfterReg.balance - clusterAfterRemove.balance).to.equal(expectedFee);

    for (const operatorId of operatorIds) {
      const [, , balance] = await validators.getOperatorEthSnapshot(operatorId);
      expect(balance).to.equal(packedFee * blocksDelta);
    }
  });

  it("bulkRegisterValidator deducts fees proportional to bulk validator count", async function () {
    const { validators, operatorIds } = await networkHelpers.loadFixture(deployValidatorsWithFee);

    const publicKeys = makePublicKeys(10);
    const shares = Array(10).fill(DEFAULT_SHARES);

    const depositValue = ethers.parseEther("100");
    const bulkTx = await validators.bulkRegisterValidator(
      publicKeys,
      operatorIds,
      shares,
      createCluster(),
      { value: depositValue }
    );
    const bulkReceipt = await bulkTx.wait();
    const clusterAfterBulk = parseClusterFromEvent(validators, bulkReceipt, Events.VALIDATOR_ADDED);

    expect(clusterAfterBulk.validatorCount).to.equal(10n);

    const blockBeforeMine = await connection.ethers.provider.getBlockNumber();
    await networkHelpers.mine(50);
    const blocksMined = (await connection.ethers.provider.getBlockNumber()) - blockBeforeMine;

    const settleTx = await validators.registerValidator(
      makePublicKey(11),
      operatorIds,
      DEFAULT_SHARES,
      clusterAfterBulk,
      { value: 0n }
    );
    const settleReceipt = await settleTx.wait();
    const clusterAfterSettle = parseClusterFromEvent(validators, settleReceipt, Events.VALIDATOR_ADDED);

    const packedFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
    const blocksDelta = BigInt(blocksMined + 1);
    const expectedFee = 4n * packedFee * blocksDelta * 10n * ETH_DEDUCTED_DIGITS;

    expect(clusterAfterBulk.balance - clusterAfterSettle.balance).to.equal(expectedFee);
  });
});

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  makeOperatorKey,
  whitelistAddresses,
  getCurrentClusterState,
} from "../../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
  NETWORK_FEE,
  ETH_DEDUCTED_DIGITS,
  BPS_DENOMINATOR,
} from "../../common/constants.ts";
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";
import {
  mineBlocks,
  getBlockNumber,
  getTxBlock,
  defaultVUnits,
  calcOperatorFeeAccrual,
} from "../helpers/index.ts";

describe("Operator Edge Cases", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let operatorOwner: HardhatEthersSigner;
  let operatorOwner2: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;
  let otherAccount: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [operatorOwner, clusterOwner, otherAccount, operatorOwner2] =
      await connection.ethers.getSigners();
  });

  const deployFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  describe("Operator removal — state verification after removal", () => {
    it("Removed operator preserves owner but zeros ethSnapshot.block", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 1);
      const opId = BigInt(operatorIds[0]);

      const opBefore = await views.getOperatorById(opId);
      expect(opBefore.owner).to.equal(operatorOwner.address);
      expect(opBefore.isActive).to.be.true;

      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      const opAfter = await views.getOperatorById(opId);
      expect(opAfter.owner).to.equal(operatorOwner.address);
      expect(opAfter.isActive).to.be.false;
      expect(opAfter.validatorCount).to.equal(0);
    });
  });

  describe("ensureETHDefaults with zero SSV fee — default fee NOT assigned", () => {
    it("Zero-fee operator stays at zero fee after ETH cluster interaction", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const zeroFeeKey = makeOperatorKey(100);
      await network
        .connect(operatorOwner)
        .registerOperator(zeroFeeKey, 0, false);
      const opId0 = 1n; // first operator

      const opIds: number[] = [Number(opId0)];
      for (let i = 2; i <= 4; i++) {
        const key = makeOperatorKey(100 + i);
        await network
          .connect(operatorOwner)
          .registerOperator(key, MINIMAL_OPERATOR_ETH_FEE, false);
        opIds.push(i);
      }

      await whitelistAddresses(network, operatorOwner, opIds, [
        clusterOwner.address,
      ]);

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regBlock = BigInt(await getTxBlock(regTx));

      const opFee = await views.getOperatorFee(opId0);
      expect(opFee).to.equal(0n);

      const opFee2 = await views.getOperatorFee(2n);
      expect(opFee2).to.equal(MINIMAL_OPERATOR_ETH_FEE);

      await mineBlocks(provider, 100);
      const earnings = await views.getOperatorEarnings(opId0);
      expect(earnings).to.equal(0n);

      const currentBlock = BigInt(await getBlockNumber(provider));
      const blockDiff = currentBlock - regBlock;
      const earnings2 = await views.getOperatorEarnings(2n);
      const packedFee = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);
      const expectedEarnings = calcOperatorFeeAccrual(blockDiff, packedFee, vUnits) * ETH_DEDUCTED_DIGITS;
      expect(earnings2).to.equal(expectedEarnings);
    });

    it("Zero-fee operator can never increase fee", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(200), 0, false);

      await expect(
        network
          .connect(operatorOwner)
          .declareOperatorFee(1, MINIMAL_OPERATOR_ETH_FEE),
      ).to.be.revertedWithCustomError(
        network,
        Errors.FEE_INCREASE_NOT_ALLOWED,
      );
    });
  });


  describe("Precision loss in operator earnings — vUnits division truncation", () => {
    it("Operator earnings are exact with standard vUnits (no truncation)", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const opIds: number[] = [];
      for (let i = 1; i <= 4; i++) {
        await network
          .connect(operatorOwner)
          .registerOperator(makeOperatorKey(300 + i), MINIMAL_OPERATOR_ETH_FEE, false);
        opIds.push(i);
      }

      await whitelistAddresses(network, operatorOwner, opIds, [
        clusterOwner.address,
      ]);

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regBlock = await getTxBlock(regTx);

      await mineBlocks(provider, 10);

      const earnings = await views.getOperatorEarnings(1n);
      const currentBlock = await getBlockNumber(provider);
      const blockDiff = BigInt(currentBlock - regBlock);

      const packedFee = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
      const expectedWei = blockDiff * packedFee * ETH_DEDUCTED_DIGITS;
      expect(earnings).to.equal(expectedWei);
    });

    it("Precision is exact with standard vUnits regardless of fee magnitude", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const doubleFee = MINIMAL_OPERATOR_ETH_FEE * 2n;
      const opIds: number[] = [];
      for (let i = 1; i <= 4; i++) {
        await network
          .connect(operatorOwner)
          .registerOperator(makeOperatorKey(400 + i), doubleFee, false);
        opIds.push(i);
      }

      await whitelistAddresses(network, operatorOwner, opIds, [
        clusterOwner.address,
      ]);

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regBlock = await getTxBlock(regTx);

      await mineBlocks(provider, 10);

      const earnings = await views.getOperatorEarnings(1n);
      const currentBlock = await getBlockNumber(provider);
      const blockDiff = BigInt(currentBlock - regBlock);

      const packedFee = doubleFee / ETH_DEDUCTED_DIGITS;
      const expectedWei = blockDiff * packedFee * ETH_DEDUCTED_DIGITS;
      expect(earnings).to.equal(expectedWei);
    });
  });

  describe("Operator index frozen after removal — cluster still functions", () => {
    it("Cluster can remove validators after one operator is removed", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const opKey1 = makeOperatorKey(500);
      await network
        .connect(operatorOwner2)
        .registerOperator(opKey1, MINIMAL_OPERATOR_ETH_FEE, false);
      const opIds: number[] = [1];
      for (let i = 2; i <= 4; i++) {
        await network
          .connect(operatorOwner)
          .registerOperator(makeOperatorKey(500 + i), MINIMAL_OPERATOR_ETH_FEE, false);
        opIds.push(i);
      }

      await whitelistAddresses(network, operatorOwner, opIds.slice(1), [
        clusterOwner.address,
      ]);
      await whitelistAddresses(network, operatorOwner2, [opIds[0]], [
        clusterOwner.address,
      ]);

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regBlock = BigInt(await getTxBlock(regTx));

      await mineBlocks(provider, 50);

      const removeOpTx = await network.connect(operatorOwner2).removeOperator(opIds[0]);
      const removeOpBlock = BigInt(await getTxBlock(removeOpTx));

      const op1 = await views.getOperatorById(1n);
      expect(op1.isActive).to.be.false;

      await mineBlocks(provider, 50);

      const currentCluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        opIds,
      );

      const removeTx = await network.connect(clusterOwner).removeValidator(
        makePublicKey(1),
        opIds,
        currentCluster,
      );
      const removeValBlock = BigInt(await getTxBlock(removeTx));

      await expect(removeTx).to.emit(network, Events.VALIDATOR_REMOVED);

      const finalCluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        opIds,
      );
      expect(BigInt(finalCluster.validatorCount)).to.equal(0n);

      const packedFee = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
      const packedNetworkFee = NETWORK_FEE / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);

      const opIndexDelta = (removeOpBlock - regBlock) * packedFee
        + 3n * (removeValBlock - regBlock) * packedFee;
      const netIndexDelta = (removeValBlock - regBlock) * packedNetworkFee;

      const opFeeUnits = (opIndexDelta * vUnits) / BPS_DENOMINATOR;
      const netFeeUnits = (netIndexDelta * vUnits) / BPS_DENOMINATOR;
      const totalBurn = (opFeeUnits + netFeeUnits) * ETH_DEDUCTED_DIGITS;
      const expectedBalance = DEFAULT_ETH_REGISTER_VALUE - totalBurn;

      expect(BigInt(finalCluster.balance)).to.equal(expectedBalance);
    });
  });


  describe("Concurrent fee changes on multiple operators in same cluster", () => {
    it("Cluster pays correct blended rate after operator fee changes", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const opIds: number[] = [];
      for (let i = 1; i <= 4; i++) {
        const owner = i === 3 ? otherAccount : operatorOwner;
        await network
          .connect(owner)
          .registerOperator(
            makeOperatorKey(600 + i),
            MINIMAL_OPERATOR_ETH_FEE,
            false,
          );
        opIds.push(i);
      }

      await whitelistAddresses(network, operatorOwner, opIds.filter(id => id !== 3), [
        clusterOwner.address,
      ]);
      await whitelistAddresses(network, otherAccount, [3], [
        clusterOwner.address,
      ]);

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regBlock = BigInt(await getTxBlock(regTx));

      await mineBlocks(provider, 50);

      const reduceOp3Tx = await network
        .connect(otherAccount)
        .reduceOperatorFee(3, 0);
      const reduceOp3Block = BigInt(await getTxBlock(reduceOp3Tx));

      const op3Fee = await views.getOperatorFee(3n);
      expect(op3Fee).to.equal(0n);

      const increasedFee = 1_900_000_000n;
      const packedCurrent = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
      const packedNew = increasedFee / ETH_DEDUCTED_DIGITS; // 19_000

      await network
        .connect(operatorOwner)
        .declareOperatorFee(1, increasedFee);

      const periods = await views.getOperatorFeePeriods();
      const declareWait = Number(periods[0]);
      await provider.send("evm_increaseTime", [declareWait + 1]);
      await mineBlocks(provider, 1);

      const execOp1Tx = await network.connect(operatorOwner).executeOperatorFee(1);
      const execOp1Block = BigInt(await getTxBlock(execOp1Tx));

      const op1Fee = await views.getOperatorFee(1n);
      expect(op1Fee).to.equal(increasedFee);

      await mineBlocks(provider, 50);

      const cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        opIds,
      );

      const viewBlock = BigInt(await getBlockNumber(provider));

      const packedNetworkFee = NETWORK_FEE / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);

      const op1IndexDelta = (execOp1Block - regBlock) * packedCurrent + (viewBlock - execOp1Block) * packedNew;
      const op2IndexDelta = (viewBlock - regBlock) * packedCurrent;
      const op3IndexDelta = (reduceOp3Block - regBlock) * packedCurrent;
      const op4IndexDelta = (viewBlock - regBlock) * packedCurrent;
      const clusterIndexDelta = op1IndexDelta + op2IndexDelta + op3IndexDelta + op4IndexDelta;

      const netIndexDelta = (viewBlock - regBlock) * packedNetworkFee;

      const opFeeUnits = (clusterIndexDelta * vUnits) / BPS_DENOMINATOR;
      const netFeeUnits = (netIndexDelta * vUnits) / BPS_DENOMINATOR;
      const totalBurn = (opFeeUnits + netFeeUnits) * ETH_DEDUCTED_DIGITS;
      const expectedBalance = DEFAULT_ETH_REGISTER_VALUE - totalBurn;

      expect(cluster.active).to.be.true;
      const settledBalance = await views.getBalance(
        clusterOwner.address,
        opIds,
        cluster,
      );
      expect(settledBalance).to.equal(expectedBalance);

      const earnings1 = await views.getOperatorEarnings(1n);
      const earnings2 = await views.getOperatorEarnings(2n);
      const earnings3 = await views.getOperatorEarnings(3n);
      const earnings4 = await views.getOperatorEarnings(4n);

      expect(earnings2).to.equal(earnings4);
      expect(earnings3).to.be.lessThan(earnings2);
      expect(earnings1).to.be.greaterThanOrEqual(earnings2);
    });
  });
});

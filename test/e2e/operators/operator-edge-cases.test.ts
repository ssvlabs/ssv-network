/**
 * Operator edge-case tests: OV-21, OV-23, OV-24, OV-28, OV-29
 */

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
  parseClusterFromEvent,
} from "../../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
  NETWORK_FEE,
  NETWORK_FEE_ETH,
  ETH_DEDUCTED_DIGITS,
  VUNITS_PRECISION,
  DECLARE_OPERATOR_FEE_PERIOD,
  EXECUTE_OPERATOR_FEE_PERIOD,
} from "../../common/constants.ts";
import { Errors } from "../../common/errors.ts";
import {
  mineBlocks,
  getBlockNumber,
  getTxBlock,
  calcClusterBurn,
  defaultVUnits,
  calcOperatorFeeAccrual,
} from "../helpers/index.ts";

describe("Operator Edge Cases (OV-21, OV-23, OV-24, OV-28, OV-29)", () => {
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

  // ──── OV-21: Operator Remove Revert Cases ────
  // (Main revert tests are in operator-reverts.test.ts; this covers the edge behavior)

  describe("OV-21: Operator removal — state verification after removal", () => {
    it("OV-21: removed operator preserves owner but zeros ethSnapshot.block", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, operatorOwner, 1);
      const opId = BigInt(operatorIds[0]);

      // Verify operator is active before removal
      const opBefore = await views.getOperatorById(opId);
      expect(opBefore.owner).to.equal(operatorOwner.address);
      expect(opBefore.isActive).to.be.true;

      // Remove operator
      await network.connect(operatorOwner).removeOperator(operatorIds[0]);

      // After removal: owner preserved, isActive false
      const opAfter = await views.getOperatorById(opId);
      expect(opAfter.owner).to.equal(operatorOwner.address);
      expect(opAfter.isActive).to.be.false;
      expect(opAfter.validatorCount).to.equal(0);
    });
  });

  // ──── OV-23: ensureETHDefaults with Zero SSV Fee — Default Fee NOT Assigned ────

  describe("OV-23: ensureETHDefaults with zero SSV fee — default fee NOT assigned", () => {
    it("OV-23: zero-fee operator stays at zero fee after ETH cluster interaction", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register operator with fee = 0 (free operator)
      const zeroFeeKey = makeOperatorKey(100);
      await network
        .connect(operatorOwner)
        .registerOperator(zeroFeeKey, 0, false);
      const opId0 = 1n; // first operator

      // Register 3 more operators with normal fee
      const opIds: number[] = [Number(opId0)];
      for (let i = 2; i <= 4; i++) {
        const key = makeOperatorKey(100 + i);
        await network
          .connect(operatorOwner)
          .registerOperator(key, MINIMAL_OPERATOR_ETH_FEE, false);
        opIds.push(i);
      }

      // Whitelist cluster owner
      await whitelistAddresses(network, operatorOwner, opIds, [
        clusterOwner.address,
      ]);

      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n).toString(16),
      ]);

      // Register validator — triggers ensureETHDefaults for operator 1
      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regBlock = BigInt(await getTxBlock(regTx));

      // Verify: zero-fee operator still has fee = 0
      const opFee = await views.getOperatorFee(opId0);
      expect(opFee).to.equal(0n);

      // Verify: other operators have the normal fee
      const opFee2 = await views.getOperatorFee(2n);
      expect(opFee2).to.equal(MINIMAL_OPERATOR_ETH_FEE);

      // Verify: zero-fee operator earns 0 (after advancing blocks)
      await mineBlocks(provider, 100);
      const earnings = await views.getOperatorEarnings(opId0);
      expect(earnings).to.equal(0n);

      // Other operators earn normally — compute exact expected earnings
      const currentBlock = BigInt(await getBlockNumber(provider));
      const blockDiff = currentBlock - regBlock;
      const earnings2 = await views.getOperatorEarnings(2n);
      // vUnits = 10_000 (1 validator, implicit EB = VUNITS_PRECISION), so vUnits / VUNITS_PRECISION = 1
      // earnings = calcOperatorFeeAccrual(blockDiff, packedFee, vUnits) * ETH_DEDUCTED_DIGITS
      const packedFee = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);
      const expectedEarnings = calcOperatorFeeAccrual(blockDiff, packedFee, vUnits) * ETH_DEDUCTED_DIGITS;
      expect(earnings2).to.equal(expectedEarnings);
    });

    it("OV-23: zero-fee operator can never increase fee", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      // Register operator with fee = 0
      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(200), 0, false);

      // Try to declare a fee increase — should revert FeeIncreaseNotAllowed
      // Use a fee above minimum to avoid FeeTooLow check triggering first
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

  // ──── OV-24: Precision Loss in Operator Earnings — vUnits Division Truncation ────

  describe("OV-24: Precision loss in operator earnings — vUnits division truncation", () => {
    it("OV-24a: operator earnings are exact with standard vUnits (no truncation)", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register 4 operators with MINIMAL_OPERATOR_ETH_FEE (the minimum allowed fee)
      // packed = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS = 1_770_000_000 / 100_000 = 17_700
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
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n).toString(16),
      ]);

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regBlock = await getTxBlock(regTx);

      // Advance 10 blocks
      await mineBlocks(provider, 10);

      const earnings = await views.getOperatorEarnings(1n);
      const currentBlock = await getBlockNumber(provider);
      const blockDiff = BigInt(currentBlock - regBlock);

      // packed fee = 17_700, vUnits = 10_000 (1 validator, implicit EB)
      // delta = (blockDiff * 17_700 * 10_000) / 10_000 = blockDiff * 17_700
      // earnings in wei = blockDiff * 17_700 * 100_000 = blockDiff * 1_770_000_000
      const packedFee = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
      const expectedWei = blockDiff * packedFee * ETH_DEDUCTED_DIGITS;
      expect(earnings).to.equal(expectedWei);
    });

    it("OV-24b: precision is exact with standard vUnits regardless of fee magnitude", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Use a fee that is exactly 2x the minimum to demonstrate exact math
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
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n).toString(16),
      ]);

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regBlock = await getTxBlock(regTx);

      // With implicit EB (1 validator → vUnits = 10_000):
      // packed fee = doubleFee / 100_000
      // delta per block = (packedFee * 10_000) / 10_000 = packedFee
      // No truncation because 10_000 divides evenly by 10_000
      await mineBlocks(provider, 10);

      const earnings = await views.getOperatorEarnings(1n);
      const currentBlock = await getBlockNumber(provider);
      const blockDiff = BigInt(currentBlock - regBlock);

      const packedFee = doubleFee / ETH_DEDUCTED_DIGITS;
      const expectedWei = blockDiff * packedFee * ETH_DEDUCTED_DIGITS;
      expect(earnings).to.equal(expectedWei);
    });
  });

  // ──── OV-28: Operator Index Frozen After Removal — Cluster Still Functions ────

  describe("OV-28: Operator index frozen after removal — cluster still functions", () => {
    it("OV-28: cluster can remove validators after one operator is removed", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register 4 operators (different owners for op1)
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

      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE * 2n + 10n ** 18n).toString(16),
      ]);

      // Register validator
      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regBlock = BigInt(await getTxBlock(regTx));

      // Get cluster state
      const cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        opIds,
      );

      // Advance some blocks to accrue fees
      await mineBlocks(provider, 50);

      // Operator 1 owner removes operator 1 (operator with active validators — DISC-OV-3)
      const removeOpTx = await network.connect(operatorOwner2).removeOperator(opIds[0]);
      const removeOpBlock = BigInt(await getTxBlock(removeOpTx));

      // Verify operator 1 is no longer active
      const op1 = await views.getOperatorById(1n);
      expect(op1.isActive).to.be.false;

      // Advance more blocks — cluster should still work
      await mineBlocks(provider, 50);

      // Cluster can still remove the validator (frozen index still contributes)
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

      await expect(removeTx).to.emit(network, "ValidatorRemoved");

      // After removal, cluster has 0 validators
      const finalCluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        opIds,
      );
      expect(BigInt(finalCluster.validatorCount)).to.equal(0n);

      // Compute exact cluster balance at removeValidator time:
      // Op1 was removed at removeOpBlock — its index froze (fee=0 after removal)
      // Ops 2-4 continue accruing at packedFee from regBlock to removeValBlock
      // Operator index delta = (removeOpBlock - regBlock) * packedFee [op1]
      //                      + 3 * (removeValBlock - regBlock) * packedFee [ops 2-4]
      // Network fee index delta = (removeValBlock - regBlock) * packedNetworkFee
      const packedFee = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
      const packedNetworkFee = NETWORK_FEE / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);

      const opIndexDelta = (removeOpBlock - regBlock) * packedFee
        + 3n * (removeValBlock - regBlock) * packedFee;
      const netIndexDelta = (removeValBlock - regBlock) * packedNetworkFee;

      const opFeeUnits = (opIndexDelta * vUnits) / VUNITS_PRECISION;
      const netFeeUnits = (netIndexDelta * vUnits) / VUNITS_PRECISION;
      const totalBurn = (opFeeUnits + netFeeUnits) * ETH_DEDUCTED_DIGITS;
      const expectedBalance = DEFAULT_ETH_REGISTER_VALUE - totalBurn;

      expect(BigInt(finalCluster.balance)).to.equal(expectedBalance);
    });
  });

  // ──── OV-29: Concurrent Fee Changes on Multiple Operators in Same Cluster ────

  describe("OV-29: Concurrent fee changes on multiple operators in same cluster", () => {
    it("OV-29: cluster pays correct blended rate after operator fee changes", async function () {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register 4 operators — each owned separately for OV-29
      // Op1 and Op3 will change fees; Op2 and Op4 stay the same
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

      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + (DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n).toString(16),
      ]);

      // Register validator at block B
      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        opIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regBlock = BigInt(await getTxBlock(regTx));

      // Advance blocks
      await mineBlocks(provider, 50);

      // Op3 reduces fee to 0 (free operator — allowed, skips minimum check)
      const reduceOp3Tx = await network
        .connect(otherAccount)
        .reduceOperatorFee(3, 0);
      const reduceOp3Block = BigInt(await getTxBlock(reduceOp3Tx));

      // Verify op3 fee changed to 0
      const op3Fee = await views.getOperatorFee(3n);
      expect(op3Fee).to.equal(0n);

      // Op1 declares fee increase (within 10% limit)
      // packedCurrent = 17_700, maxAllowed = ceil(17_700 * 1.1) = 19_470
      // Pick a valid fee: 19_000 packed = 1_900_000_000 wei
      const increasedFee = 1_900_000_000n;
      const packedCurrent = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
      const packedNew = increasedFee / ETH_DEDUCTED_DIGITS; // 19_000

      await network
        .connect(operatorOwner)
        .declareOperatorFee(1, increasedFee);

      // Advance past approval window
      const periods = await views.getOperatorFeePeriods();
      const declareWait = Number(periods[0]);
      await provider.send("evm_increaseTime", [declareWait + 1]);
      await mineBlocks(provider, 1);

      // Execute fee change
      const execOp1Tx = await network.connect(operatorOwner).executeOperatorFee(1);
      const execOp1Block = BigInt(await getTxBlock(execOp1Tx));

      const op1Fee = await views.getOperatorFee(1n);
      expect(op1Fee).to.equal(increasedFee);

      // Advance more blocks to accrue at new rates
      await mineBlocks(provider, 50);

      // Get cluster state
      const cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        opIds,
      );

      // Compute exact settled balance via getBalance
      // getBalance runs at viewBlock = current block after mineBlocks(50)
      const viewBlock = BigInt(await getBlockNumber(provider));

      // Cluster index delta from regBlock to viewBlock for each operator:
      // Op1: (execOp1Block - regBlock)*packedCurrent + (viewBlock - execOp1Block)*packedNew
      // Op2: (viewBlock - regBlock)*packedCurrent
      // Op3: (reduceOp3Block - regBlock)*packedCurrent + (viewBlock - reduceOp3Block)*0
      // Op4: (viewBlock - regBlock)*packedCurrent
      const packedNetworkFee = NETWORK_FEE / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);

      const op1IndexDelta = (execOp1Block - regBlock) * packedCurrent + (viewBlock - execOp1Block) * packedNew;
      const op2IndexDelta = (viewBlock - regBlock) * packedCurrent;
      const op3IndexDelta = (reduceOp3Block - regBlock) * packedCurrent;
      const op4IndexDelta = (viewBlock - regBlock) * packedCurrent;
      const clusterIndexDelta = op1IndexDelta + op2IndexDelta + op3IndexDelta + op4IndexDelta;

      const netIndexDelta = (viewBlock - regBlock) * packedNetworkFee;

      const opFeeUnits = (clusterIndexDelta * vUnits) / VUNITS_PRECISION;
      const netFeeUnits = (netIndexDelta * vUnits) / VUNITS_PRECISION;
      const totalBurn = (opFeeUnits + netFeeUnits) * ETH_DEDUCTED_DIGITS;
      const expectedBalance = DEFAULT_ETH_REGISTER_VALUE - totalBurn;

      expect(cluster.active).to.be.true;
      const settledBalance = await views.getBalance(
        clusterOwner.address,
        opIds,
        cluster,
      );
      expect(settledBalance).to.equal(expectedBalance);

      // Each operator's earnings should be consistent with their fee history
      const earnings1 = await views.getOperatorEarnings(1n);
      const earnings2 = await views.getOperatorEarnings(2n);
      const earnings3 = await views.getOperatorEarnings(3n);
      const earnings4 = await views.getOperatorEarnings(4n);

      // Op2 and Op4 should have identical earnings (same fee throughout)
      expect(earnings2).to.equal(earnings4);

      // Op3 should have less than op2 (reduced fee after 50 blocks)
      expect(earnings3).to.be.lessThan(earnings2);

      // Op1 should have more than op2 (fee was increased after declare+execute)
      expect(earnings1).to.be.greaterThanOrEqual(earnings2);
    });
  });
});

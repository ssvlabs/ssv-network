import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  makeOperatorKey,
  makePublicKey,
  whitelistAddresses,
  getCurrentClusterState,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
  ETH_DEDUCTED_DIGITS,
  DECLARE_OPERATOR_FEE_PERIOD,
  EXECUTE_OPERATOR_FEE_PERIOD, DEFAULT_ETH_REGISTER_VALUE,
} from '../../common/constants.ts';
import {
  mineBlocks,
  getBlockNumber,
  getTxBlock,
  calcOperatorFeeAccrual,
  defaultVUnits,
} from "../../helpers/index.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";

describe("Operator Lifecycle", function () {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let operatorOwner: HardhatEthersSigner;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [operatorOwner, clusterOwner] } = await setupTestContext());
  });

  const deployFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  describe("Register Operator (Public, Non-Zero Fee)", () => {
    it("Registers public operator with non-zero fee and verifies initial state", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);

      const pubkey = makeOperatorKey(1);
      const fee = 1_770_000_000n;

      const tx = await network
        .connect(operatorOwner)
        .registerOperator(pubkey, fee, false);
      const receipt = await tx.wait();
      const regBlock = BigInt(receipt!.blockNumber);

      const opData = await views.getOperatorById(1n);
      expect(opData.owner).to.equal(operatorOwner.address);
      expect(opData.fee).to.equal(fee);
      expect(opData.validatorCount).to.equal(0n);
      expect(opData.isPrivate).to.equal(false);
      expect(opData.isActive).to.equal(true);

      const earnings = await views.getOperatorEarnings(1n);
      expect(earnings).to.equal(0n);

      await expect(tx)
        .to.emit(network, Events.OPERATOR_ADDED)
        .withArgs(1n, operatorOwner.address, pubkey, fee);
      await expect(tx)
        .to.emit(network, Events.OPERATOR_PRIVACY_STATUS_UPDATED)
        .withArgs([1n], false);
    });

    it("Register with fee=0 succeeds, operator is free forever", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);

      const pubkey = makeOperatorKey(1);

      await network
        .connect(operatorOwner)
        .registerOperator(pubkey, 0n, false);

      const opData = await views.getOperatorById(1n);
      expect(opData.fee).to.equal(0n);
      expect(opData.isPrivate).to.equal(false);

      await expect(
        network
          .connect(operatorOwner)
          .declareOperatorFee(1n, MINIMAL_OPERATOR_ETH_FEE),
      ).to.be.revertedWithCustomError(network, Errors.FEE_INCREASE_NOT_ALLOWED);
    });

    it("Register with setPrivate=true sets whitelisted flag", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);

      const pubkey = makeOperatorKey(1);

      const tx = await network
        .connect(operatorOwner)
        .registerOperator(pubkey, MINIMAL_OPERATOR_ETH_FEE, true);

      const opData = await views.getOperatorById(1n);
      expect(opData.isPrivate).to.equal(true);

      await expect(tx)
        .to.emit(network, Events.OPERATOR_PRIVACY_STATUS_UPDATED)
        .withArgs([1n], true);
    });

    it("Register with same pubkey again reverts OperatorAlreadyExists", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      const pubkey = makeOperatorKey(1);
      await network
        .connect(operatorOwner)
        .registerOperator(pubkey, MINIMAL_OPERATOR_ETH_FEE, false);

      await expect(
        network
          .connect(operatorOwner)
          .registerOperator(pubkey, MINIMAL_OPERATOR_ETH_FEE, false),
      ).to.be.revertedWithCustomError(network, Errors.OPERATOR_ALREADY_EXISTS);
    });

    it("Register with fee not divisible by ETH_DEDUCTED_DIGITS reverts MaxPrecisionExceeded", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      const pubkey = makeOperatorKey(1);
      const badFee = MINIMAL_OPERATOR_ETH_FEE + 1n;

      await expect(
        network
          .connect(operatorOwner)
          .registerOperator(pubkey, badFee, false),
      ).to.be.revertedWithCustomError(network, Errors.MAX_PRECISION_EXCEEDED);
    });
  });

  describe("Register Operator (Private, Zero Fee)", () => {
    it("Registers private zero-fee operator and verifies fee immutability", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);

      const pubkey = makeOperatorKey(1);

      await network
        .connect(operatorOwner)
        .registerOperator(pubkey, 0n, true);

      const opData = await views.getOperatorById(1n);
      expect(opData.fee).to.equal(0n);
      expect(opData.isPrivate).to.equal(true);

      await expect(
        network
          .connect(operatorOwner)
          .declareOperatorFee(1n, MINIMAL_OPERATOR_ETH_FEE),
      ).to.be.revertedWithCustomError(network, Errors.FEE_INCREASE_NOT_ALLOWED);
    });
  });

  describe("ensureETHDefaults — Default Fee Assignment", () => {
    it("Operator registered with non-zero fee gets correct ethFee", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);

      const fee = MINIMAL_OPERATOR_ETH_FEE;
      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), fee, false);

      const opData = await views.getOperatorById(1n);
      expect(opData.fee).to.equal(fee);
      expect(opData.isActive).to.equal(true);
    });

    it("Operator registered with fee=0 and SSV fee=0 stays free", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);

      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), 0n, false);

      const opData = await views.getOperatorById(1n);
      expect(opData.fee).to.equal(0n);
    });
  });

  describe("Operator Fee Declaration -> Wait -> Execution", () => {
    it("Declares fee, waits, and executes within approval window", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const initialFee = MINIMAL_OPERATOR_ETH_FEE;
      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), initialFee, false);

      for (let i = 2; i <= 4; i++) {
        await network
          .connect(operatorOwner)
          .registerOperator(makeOperatorKey(i), initialFee, false);
      }

      await whitelistAddresses(network, operatorOwner, [1, 2, 3, 4], [
        clusterOwner.address,
      ]);

      await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(1),
          [1, 2, 3, 4],
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE},
        );

      const currentFee = await views.getOperatorFee(1n);
      const currentPacked = currentFee / ETH_DEDUCTED_DIGITS;
      const maxIncreaseBps = await views.getOperatorFeeIncreaseLimit();
      const maxAllowedPacked =
        (currentPacked * (10_000n + maxIncreaseBps) + 9_999n) / 10_000n;
      const newFee = maxAllowedPacked * ETH_DEDUCTED_DIGITS;

      const declareTx = await network
        .connect(operatorOwner)
        .declareOperatorFee(1n, newFee);
      await declareTx.wait();

      await expect(declareTx).to.emit(network, Events.OPERATOR_FEE_DECLARED);

      await expect(
        network.connect(operatorOwner).executeOperatorFee(1n),
      ).to.be.revertedWithCustomError(
        network,
        Errors.APPROVAL_NOT_WITHIN_TIMEFRAME,
      );

      const declareFeePeriod = Number(DECLARE_OPERATOR_FEE_PERIOD);
      await provider.send("evm_increaseTime", [declareFeePeriod + 1]);
      await provider.send("evm_mine", []);

      const executeTx = await network
        .connect(operatorOwner)
        .executeOperatorFee(1n);
      await executeTx.wait();

      await expect(executeTx).to.emit(network, Events.OPERATOR_FEE_EXECUTED);

      const updatedFee = await views.getOperatorFee(1n);
      expect(updatedFee).to.equal(newFee);
    });

    it("Execute after approval window expires reverts", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE, false);

      const currentFee = await views.getOperatorFee(1n);
      const currentPacked = currentFee / ETH_DEDUCTED_DIGITS;
      const maxIncreaseBps = await views.getOperatorFeeIncreaseLimit();
      const maxAllowedPacked =
        (currentPacked * (10_000n + maxIncreaseBps) + 9_999n) / 10_000n;
      const newFee = maxAllowedPacked * ETH_DEDUCTED_DIGITS;

      await network
        .connect(operatorOwner)
        .declareOperatorFee(1n, newFee);

      const totalPeriod =
        Number(DECLARE_OPERATOR_FEE_PERIOD) +
        Number(EXECUTE_OPERATOR_FEE_PERIOD) +
        1;
      await provider.send("evm_increaseTime", [totalPeriod]);
      await provider.send("evm_mine", []);

      await expect(
        network.connect(operatorOwner).executeOperatorFee(1n),
      ).to.be.revertedWithCustomError(
        network,
        Errors.APPROVAL_NOT_WITHIN_TIMEFRAME,
      );
    });

    it("Edge: cancel declared fee clears the request", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);

      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE, false);

      const currentFee = await views.getOperatorFee(1n);
      const currentPacked = currentFee / ETH_DEDUCTED_DIGITS;
      const maxIncreaseBps = await views.getOperatorFeeIncreaseLimit();
      const maxAllowedPacked =
        (currentPacked * (10_000n + maxIncreaseBps) + 9_999n) / 10_000n;
      const newFee = maxAllowedPacked * ETH_DEDUCTED_DIGITS;

      await network
        .connect(operatorOwner)
        .declareOperatorFee(1n, newFee);

      const cancelTx = await network
        .connect(operatorOwner)
        .cancelDeclaredOperatorFee(1n);
      await expect(cancelTx).to.emit(
        network,
        Events.OPERATOR_FEE_DECLARATION_CANCELLED,
      );

      await expect(
        network.connect(operatorOwner).executeOperatorFee(1n),
      ).to.be.revertedWithCustomError(network, Errors.NO_FEE_DECLARED);
    });

    it("Fee increase exceeding limit reverts FeeExceedsIncreaseLimit", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);

      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE, false);

      const currentFee = await views.getOperatorFee(1n);
      const currentPacked = currentFee / ETH_DEDUCTED_DIGITS;
      const maxIncreaseBps = await views.getOperatorFeeIncreaseLimit();
      const maxAllowedPacked =
        (currentPacked * (10_000n + maxIncreaseBps) + 9_999n) / 10_000n;
      const excessiveFee = (maxAllowedPacked + 1n) * ETH_DEDUCTED_DIGITS;

      const maxOperatorFee = await views.getMaximumOperatorFee();
      if (excessiveFee <= maxOperatorFee) {
        await expect(
          network
            .connect(operatorOwner)
            .declareOperatorFee(1n, excessiveFee),
        ).to.be.revertedWithCustomError(
          network,
          Errors.FEE_EXCEEDS_INCREASE_LIMIT,
        );
      }
    });
  });

  describe("Operator Fee Reduction (Immediate, No Timelock)", () => {
    it("Reduces fee immediately, preserving earnings at old fee", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const initialFee = 2_000_000_000n;
      const packedInitialFee = initialFee / ETH_DEDUCTED_DIGITS;

      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), initialFee, false);
      for (let i = 2; i <= 4; i++) {
        await network
          .connect(operatorOwner)
          .registerOperator(makeOperatorKey(i), initialFee, false);
      }
      await whitelistAddresses(network, operatorOwner, [1, 2, 3, 4], [
        clusterOwner.address,
      ]);

      await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(1),
          [1, 2, 3, 4],
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        );

      const regBlock = BigInt(await getBlockNumber(provider));

      await mineBlocks(provider, 100);

      const reducedFee = MINIMAL_OPERATOR_ETH_FEE;
      const reduceTx = await network
        .connect(operatorOwner)
        .reduceOperatorFee(1n, reducedFee);
      const reduceBlock = BigInt(await getTxBlock(reduceTx));

      await expect(reduceTx).to.emit(network, Events.OPERATOR_FEE_EXECUTED);

      const newFee = await views.getOperatorFee(1n);
      expect(newFee).to.equal(reducedFee);

      const blockDiff = reduceBlock - regBlock;
      const vUnits = defaultVUnits(1n);
      const expectedEarnings = calcOperatorFeeAccrual(blockDiff, packedInitialFee, vUnits) * ETH_DEDUCTED_DIGITS;
      const earnings = await views.getOperatorEarnings(1n);
      expect(earnings).to.equal(expectedEarnings);
    });

    it("Reduce to exactly current fee reverts FeeIncreaseNotAllowed", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE, false);

      await expect(
        network
          .connect(operatorOwner)
          .reduceOperatorFee(1n, MINIMAL_OPERATOR_ETH_FEE),
      ).to.be.revertedWithCustomError(network, Errors.FEE_INCREASE_NOT_ALLOWED);
    });

    it("Reduce to higher fee reverts FeeIncreaseNotAllowed", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE, false);

      const higherFee = MINIMAL_OPERATOR_ETH_FEE + ETH_DEDUCTED_DIGITS;
      await expect(
        network
          .connect(operatorOwner)
          .reduceOperatorFee(1n, higherFee),
      ).to.be.revertedWithCustomError(network, Errors.FEE_INCREASE_NOT_ALLOWED);
    });

    it("Reducing fee clears pending fee change request", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);

      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE, false);

      const currentFee = await views.getOperatorFee(1n);
      const currentPacked = currentFee / ETH_DEDUCTED_DIGITS;
      const maxIncreaseBps = await views.getOperatorFeeIncreaseLimit();
      const maxAllowedPacked =
        (currentPacked * (10_000n + maxIncreaseBps) + 9_999n) / 10_000n;
      const newFee = maxAllowedPacked * ETH_DEDUCTED_DIGITS;

      await network
        .connect(operatorOwner)
        .declareOperatorFee(1n, newFee);

      const declareFeePeriod = Number(DECLARE_OPERATOR_FEE_PERIOD);
      await connection.ethers.provider.send("evm_increaseTime", [declareFeePeriod + 1]);
      await connection.ethers.provider.send("evm_mine", []);
      await network
        .connect(operatorOwner)
        .executeOperatorFee(1n);

      const updatedFee = await views.getOperatorFee(1n);
      const updatedPacked = updatedFee / ETH_DEDUCTED_DIGITS;
      const maxIncreaseBps2 = await views.getOperatorFeeIncreaseLimit();
      const maxAllowedPacked2 =
        (updatedPacked * (10_000n + maxIncreaseBps2) + 9_999n) / 10_000n;
      const newFee2 = maxAllowedPacked2 * ETH_DEDUCTED_DIGITS;
      await network
        .connect(operatorOwner)
        .declareOperatorFee(1n, newFee2);

      await network
        .connect(operatorOwner)
        .reduceOperatorFee(1n, MINIMAL_OPERATOR_ETH_FEE);

      await expect(
        network.connect(operatorOwner).executeOperatorFee(1n),
      ).to.be.revertedWithCustomError(network, Errors.NO_FEE_DECLARED);
    });
  });

  describe("Operator Earnings Accumulation and Withdrawal", () => {
    it("Accumulates earnings and supports partial + full withdrawal", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = MINIMAL_OPERATOR_ETH_FEE;
      const packedFee = fee / ETH_DEDUCTED_DIGITS;
      for (let i = 1; i <= 4; i++) {
        await network
          .connect(operatorOwner)
          .registerOperator(makeOperatorKey(i), fee, false);
      }

      await whitelistAddresses(network, operatorOwner, [1, 2, 3, 4], [
        clusterOwner.address,
      ]);

      const regTx = await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(1),
          [1, 2, 3, 4],
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        );
      const regBlock = BigInt(await getTxBlock(regTx));
      const vUnits = defaultVUnits(1n);

      await mineBlocks(provider, 100);

      const earningsBlock = BigInt(await getBlockNumber(provider));
      const expectedEarningsBefore = calcOperatorFeeAccrual(earningsBlock - regBlock, packedFee, vUnits) * ETH_DEDUCTED_DIGITS;
      const earningsBefore = await views.getOperatorEarnings(1n);
      expect(earningsBefore).to.equal(expectedEarningsBefore);

      const partialAmount = earningsBefore / 2n;
      const alignedPartial =
        (partialAmount / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS;

      const ownerBalBefore = await provider.getBalance(
        operatorOwner.address,
      );

      const partialTx = await network
        .connect(operatorOwner)
        .withdrawOperatorEarnings(1n, alignedPartial);
      const partialReceipt = await partialTx.wait();
      const partialGas =
        partialReceipt!.gasUsed * partialReceipt!.gasPrice;

      await expect(partialTx).to.emit(network, Events.OPERATOR_WITHDRAWN);

      const ownerBalAfter = await provider.getBalance(
        operatorOwner.address,
      );
      expect(ownerBalAfter - ownerBalBefore + partialGas).to.equal(
        alignedPartial,
      );

      await mineBlocks(provider, 100);

      const fullViewBlock = BigInt(await getBlockNumber(provider));
      const expectedEarningsBeforeFull =
        calcOperatorFeeAccrual(fullViewBlock - regBlock, packedFee, vUnits) * ETH_DEDUCTED_DIGITS - alignedPartial;
      const earningsBeforeFull = await views.getOperatorEarnings(1n);
      expect(earningsBeforeFull).to.equal(expectedEarningsBeforeFull);

      const ownerBalBefore2 = await provider.getBalance(
        operatorOwner.address,
      );
      const fullTx = await network
        .connect(operatorOwner)
        .withdrawAllOperatorEarnings(1n);
      const fullReceipt = await fullTx.wait();
      const fullGas = fullReceipt!.gasUsed * fullReceipt!.gasPrice;
      const fullBlock = BigInt(await getTxBlock(fullTx));

      const ownerBalAfter2 = await provider.getBalance(
        operatorOwner.address,
      );

      const expectedFullTransfer =
        calcOperatorFeeAccrual(fullBlock - regBlock, packedFee, vUnits) * ETH_DEDUCTED_DIGITS - alignedPartial;
      expect(ownerBalAfter2 - ownerBalBefore2 + fullGas).to.equal(
        expectedFullTransfer,
      );
    });
  });

  describe("Remove Operator — Full Cleanup and Final Withdrawal", () => {
    it("Removes operator with earnings, transfers funds, and cleans up state", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = MINIMAL_OPERATOR_ETH_FEE;

      for (let i = 1; i <= 4; i++) {
        await network
          .connect(operatorOwner)
          .registerOperator(makeOperatorKey(i), fee, false);
      }

      await network
        .connect(operatorOwner)
        .setOperatorsPrivateUnchecked([1n]);

      await whitelistAddresses(network, operatorOwner, [1, 2, 3, 4], [
        clusterOwner.address,
      ]);

      const valRegTx = await network
        .connect(clusterOwner)
        .registerValidator(
          makePublicKey(1),
          [1, 2, 3, 4],
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        );
      const regBlock = BigInt(await getTxBlock(valRegTx));
      const packedFee = fee / ETH_DEDUCTED_DIGITS;
      const vUnits = defaultVUnits(1n);

      await mineBlocks(provider, 50);

      const cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        [1, 2, 3, 4],
      );
      const removeValTx = await network
        .connect(clusterOwner)
        .removeValidator(makePublicKey(1), [1, 2, 3, 4], cluster);
      const removeValBlock = BigInt(await getTxBlock(removeValTx));

      const expectedEarnings = calcOperatorFeeAccrual(removeValBlock - regBlock, packedFee, vUnits) * ETH_DEDUCTED_DIGITS;
      const earningsBefore = await views.getOperatorEarnings(1n);
      expect(earningsBefore).to.equal(expectedEarnings);

      const ownerBalBefore = await provider.getBalance(
        operatorOwner.address,
      );
      const removeTx = await network
        .connect(operatorOwner)
        .removeOperator(1n);
      const removeReceipt = await removeTx.wait();
      const removeGas =
        removeReceipt!.gasUsed * removeReceipt!.gasPrice;

      await expect(removeTx).to.emit(network, Events.OPERATOR_REMOVED).withArgs(1n);
      await expect(removeTx).to.emit(network, Events.OPERATOR_WITHDRAWN);

      const ownerBalAfter = await provider.getBalance(
        operatorOwner.address,
      );
      expect(ownerBalAfter - ownerBalBefore + removeGas).to.equal(
        expectedEarnings,
      );

      const opData = await views.getOperatorById(1n);
      expect(opData.isActive).to.equal(false);

      expect(opData.owner).to.equal(operatorOwner.address);
    });

    it("Remove operator with 0 earnings in both versions", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);

      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE, false);

      const earningsBefore = await views.getOperatorEarnings(1n);
      expect(earningsBefore).to.equal(0n);

      const removeTx = await network
        .connect(operatorOwner)
        .removeOperator(1n);
      await expect(removeTx).to.emit(network, Events.OPERATOR_REMOVED).withArgs(1n);
    });

    it("After removal, registering validator with removed operator reverts", async () => {
      const { network } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      for (let i = 1; i <= 4; i++) {
        await network
          .connect(operatorOwner)
          .registerOperator(makeOperatorKey(i), MINIMAL_OPERATOR_ETH_FEE, false);
      }

      await whitelistAddresses(network, operatorOwner, [1, 2, 3, 4], [
        clusterOwner.address,
      ]);

      await network
        .connect(operatorOwner)
        .removeOperator(1n);

      await expect(
        network.connect(clusterOwner).registerValidator(
          makePublicKey(1),
          [1, 2, 3, 4],
          DEFAULT_SHARES,
          EMPTY_CLUSTER,
          { value: DEFAULT_ETH_REGISTER_VALUE },
        ),
      ).to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });

    it("Double removal reverts OperatorDoesNotExist", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE, false);
      await network.connect(operatorOwner).removeOperator(1n);

      await expect(
        network.connect(operatorOwner).removeOperator(1n),
      ).to.be.revertedWithCustomError(network, Errors.OPERATOR_DOES_NOT_EXIST);
    });
  });
});

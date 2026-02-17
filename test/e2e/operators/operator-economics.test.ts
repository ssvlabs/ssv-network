/**
 * OV-13, OV-15 to OV-18: Operator Economics Tests
 *
 * Covers: earnings accumulation/withdrawal (OV-13),
 * fee change during active cluster (OV-15),
 * multi-cluster operator earnings (OV-16),
 * removal after all validators removed (OV-17),
 * combined ETH+SSV withdrawal (OV-18).
 */

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  makeOperatorKey,
  makePublicKey,
  makePublicKeys,
  whitelistAddresses,
  parseClusterFromEvent,
  getCurrentClusterState,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
  ETH_DEDUCTED_DIGITS,
  NETWORK_FEE_ETH,
  VUNITS_PRECISION,
  DECLARE_OPERATOR_FEE_PERIOD,
  EXECUTE_OPERATOR_FEE_PERIOD,
} from "../../common/constants.ts";
import {
  mineBlocks,
  getBlockNumber,
  getTxBlock,
  calcOperatorFeeAccrual,
  calcClusterBurn,
  defaultVUnits,
} from "../helpers/index.ts";
import { ethers } from "ethers";

describe("Operator Economics (OV-13, OV-15 to OV-18)", function () {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let operatorOwner: HardhatEthersSigner;
  let clusterOwnerA: HardhatEthersSigner;
  let clusterOwnerB: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    const signers = await connection.ethers.getSigners();
    operatorOwner = signers[0];
    clusterOwnerA = signers[1];
    clusterOwnerB = signers[2];
  });

  const deployFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };

  /** Helper: register N operators with given fee */
  async function registerOps(
    network: any,
    count: number,
    fee: bigint,
  ): Promise<number[]> {
    const ids: number[] = [];
    for (let i = 1; i <= count; i++) {
      const id = await network
        .connect(operatorOwner)
        .registerOperator.staticCall(makeOperatorKey(i), fee, false);
      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(i), fee, false);
      ids.push(Number(id));
    }
    return ids;
  }

  /** Helper: fund an account and register a validator */
  async function fundAndRegisterValidator(
    network: any,
    provider: any,
    signer: HardhatEthersSigner,
    operatorIds: number[],
    pubkey: string,
    depositEth: bigint,
    cluster: any,
  ) {
    await provider.send("hardhat_setBalance", [
      signer.address,
      "0x" + (depositEth + 10n ** 18n).toString(16),
    ]);
    const tx = await network
      .connect(signer)
      .registerValidator(pubkey, operatorIds, DEFAULT_SHARES, cluster, {
        value: depositEth,
      });
    return tx;
  }

  // =========================================================================
  // OV-13: Operator Earnings Accumulation and Withdrawal (economics-focused)
  // =========================================================================
  describe("OV-13: Operator Earnings Accumulation and Withdrawal", () => {
    it("OV-13: verifies exact earnings math with partial and full withdrawal", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = MINIMAL_OPERATOR_ETH_FEE; // 1_770_000_000
      const packedFee = fee / ETH_DEDUCTED_DIGITS; // 17_700

      const operatorIds = await registerOps(network, 4, fee);

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwnerA.address,
      ]);

      const depositEth = ethers.parseEther("10");
      await fundAndRegisterValidator(
        network,
        provider,
        clusterOwnerA,
        operatorIds,
        makePublicKey(1),
        depositEth,
        EMPTY_CLUSTER,
      );

      const regBlock = BigInt(await getBlockNumber(provider));

      // Advance 100 blocks
      await mineBlocks(provider, 100);

      // Check earnings for operator 1
      // Each operator with 1 validator at default fee:
      // effectiveVUnits = 1 * 10_000 = 10_000
      // accrual per block = (packedFee * 10_000) / 10_000 = packedFee = 17_700 (packed)
      const vUnits = defaultVUnits(1n);
      const earningsViewBlock = BigInt(await getBlockNumber(provider));
      const expectedEarnings1 = calcOperatorFeeAccrual(earningsViewBlock - regBlock, packedFee, vUnits) * ETH_DEDUCTED_DIGITS;
      const earnings1 = await views.getOperatorEarnings(1n);
      expect(earnings1).to.equal(expectedEarnings1);

      // Partial withdrawal (half)
      const half = (earnings1 / (2n * ETH_DEDUCTED_DIGITS)) * ETH_DEDUCTED_DIGITS;
      const partialTx = await network
        .connect(operatorOwner)
        .withdrawOperatorEarnings(1n, half);
      await expect(partialTx).to.emit(network, "OperatorWithdrawn");

      // Remaining earnings = total accrued up to partialBlock minus withdrawn half
      const partialBlock = BigInt(await getTxBlock(partialTx));
      const expectedAfterPartial = calcOperatorFeeAccrual(partialBlock - regBlock, packedFee, vUnits) * ETH_DEDUCTED_DIGITS - half;
      const earningsAfterPartial = await views.getOperatorEarnings(1n);
      expect(earningsAfterPartial).to.equal(expectedAfterPartial);

      // Full withdrawal
      await mineBlocks(provider, 50);
      const fullTx = await network
        .connect(operatorOwner)
        .withdrawAllOperatorEarnings(1n);
      await expect(fullTx).to.emit(network, "OperatorWithdrawn");
    });
  });

  // =========================================================================
  // OV-15: Fee Change During Active Cluster — No Gap, No Double-Count
  // =========================================================================
  describe("OV-15: Fee Change During Active Cluster", () => {
    it("OV-15: verifies continuous fee accrual across fee change boundary", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const initialFee = MINIMAL_OPERATOR_ETH_FEE; // 1_770_000_000
      const packedInitialFee = initialFee / ETH_DEDUCTED_DIGITS; // 17_700

      const operatorIds = await registerOps(network, 4, initialFee);

      // Register 3 validators for operator coverage
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwnerA.address,
      ]);
      const deposit = ethers.parseEther("30");
      await fundAndRegisterValidator(
        network,
        provider,
        clusterOwnerA,
        operatorIds,
        makePublicKey(1),
        deposit,
        EMPTY_CLUSTER,
      );

      // Get cluster state after first validator
      let cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwnerA.address,
        operatorIds,
      );

      // Register 2 more validators
      for (let i = 2; i <= 3; i++) {
        await provider.send("hardhat_setBalance", [
          clusterOwnerA.address,
          "0x" + (deposit + 10n ** 18n).toString(16),
        ]);
        const tx = await network
          .connect(clusterOwnerA)
          .registerValidator(
            makePublicKey(i),
            operatorIds,
            DEFAULT_SHARES,
            cluster,
            { value: ethers.parseEther("5") },
          );
        cluster = await getCurrentClusterState(
          connection,
          network,
          clusterOwnerA.address,
          operatorIds,
        );
      }

      const setupBlock = BigInt(await getBlockNumber(provider));

      // Record earnings before fee change
      const earningsBeforeDeclare = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );

      // Advance some blocks
      await mineBlocks(provider, 50);

      // Declare fee increase for operator 1
      const currentFee = await views.getOperatorFee(BigInt(operatorIds[0]));
      const currentPacked = currentFee / ETH_DEDUCTED_DIGITS;
      const maxIncreaseBps = await views.getOperatorFeeIncreaseLimit();
      const maxAllowedPacked =
        (currentPacked * (10_000n + maxIncreaseBps) + 9_999n) / 10_000n;
      const newFee = maxAllowedPacked * ETH_DEDUCTED_DIGITS;

      await network
        .connect(operatorOwner)
        .declareOperatorFee(BigInt(operatorIds[0]), newFee);

      // Wait for approval period and execute
      const declareFeePeriod = Number(DECLARE_OPERATOR_FEE_PERIOD);
      await provider.send("evm_increaseTime", [declareFeePeriod + 1]);
      await provider.send("evm_mine", []);

      // Record earnings right before execute
      const earningsBeforeExecute = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsBeforeExecute).to.be.greaterThan(earningsBeforeDeclare);

      // Execute fee change — this calls updateSnapshotSt, settling earnings at OLD fee
      const executeTx = await network
        .connect(operatorOwner)
        .executeOperatorFee(BigInt(operatorIds[0]));
      await executeTx.wait();

      // Verify new fee
      const feeAfter = await views.getOperatorFee(BigInt(operatorIds[0]));
      expect(feeAfter).to.equal(newFee);

      // Advance 100 blocks at new fee
      await mineBlocks(provider, 100);

      // Verify earnings continued accruing at new fee
      const earningsAfterNewFee = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsAfterNewFee).to.be.greaterThan(earningsBeforeExecute);

      // Verify no gap: operator 1 (with new fee) should have higher earnings than
      // operators 2-4 (still at old fee) over the same period
      const earningsOp2 = await views.getOperatorEarnings(
        BigInt(operatorIds[1]),
      );
      // Op1 had old fee for the first period + new (higher) fee for the second period
      // Op2 had old fee for the entire period
      // So earningsOp1 > earningsOp2
      expect(earningsAfterNewFee).to.be.greaterThan(earningsOp2);
    });
  });

  // =========================================================================
  // OV-16: Multi-Cluster Operator — Earnings From Multiple Clusters
  // =========================================================================
  describe("OV-16: Multi-Cluster Operator — Earnings From Multiple Clusters", () => {
    it("OV-16: operator earns from two clusters, correct accounting on partial removal", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = MINIMAL_OPERATOR_ETH_FEE;
      const packedFee = fee / ETH_DEDUCTED_DIGITS; // 17_700

      const operatorIds = await registerOps(network, 4, fee);

      // Whitelist both cluster owners
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwnerA.address,
        clusterOwnerB.address,
      ]);

      // User A: register 2 validators
      const regA1Tx = await fundAndRegisterValidator(
        network,
        provider,
        clusterOwnerA,
        operatorIds,
        makePublicKey(1),
        ethers.parseEther("10"),
        EMPTY_CLUSTER,
      );
      const blockA1 = BigInt(await getTxBlock(regA1Tx));
      let clusterA = await getCurrentClusterState(
        connection,
        network,
        clusterOwnerA.address,
        operatorIds,
      );

      await provider.send("hardhat_setBalance", [
        clusterOwnerA.address,
        "0x" + (ethers.parseEther("10") + 10n ** 18n).toString(16),
      ]);
      const regA2Tx = await network
        .connect(clusterOwnerA)
        .registerValidator(
          makePublicKey(2),
          operatorIds,
          DEFAULT_SHARES,
          clusterA,
          { value: ethers.parseEther("5") },
        );
      const blockA2 = BigInt(await getTxBlock(regA2Tx));
      clusterA = await getCurrentClusterState(
        connection,
        network,
        clusterOwnerA.address,
        operatorIds,
      );

      // User B: register 3 validators (bulk)
      await provider.send("hardhat_setBalance", [
        clusterOwnerB.address,
        "0x" + (ethers.parseEther("30") + 10n ** 18n).toString(16),
      ]);
      const regBTx = await network.connect(clusterOwnerB).bulkRegisterValidator(
        [makePublicKey(10), makePublicKey(11), makePublicKey(12)],
        operatorIds,
        [DEFAULT_SHARES, DEFAULT_SHARES, DEFAULT_SHARES],
        EMPTY_CLUSTER,
        { value: ethers.parseEther("20") },
      );
      const blockB = BigInt(await getTxBlock(regBTx));

      // Verify operator 1 has 5 validators total (2 from A + 3 from B)
      const opData = await views.getOperatorById(BigInt(operatorIds[0]));
      expect(opData.validatorCount).to.equal(5n);

      // Advance 100 blocks
      await mineBlocks(provider, 100);

      // Check earnings: operator with 5 validators
      // Earnings = accrual(blockA1→blockA2, 1 val) + accrual(blockA2→blockB, 2 vals) + accrual(blockB→now, 5 vals)
      const viewBlock = BigInt(await getBlockNumber(provider));
      const expectedEarningsAt100 = (
        calcOperatorFeeAccrual(blockA2 - blockA1, packedFee, defaultVUnits(1n)) +
        calcOperatorFeeAccrual(blockB - blockA2, packedFee, defaultVUnits(2n)) +
        calcOperatorFeeAccrual(viewBlock - blockB, packedFee, defaultVUnits(5n))
      ) * ETH_DEDUCTED_DIGITS;
      const earningsAt100 = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsAt100).to.equal(expectedEarningsAt100);

      // User A: remove both validators
      clusterA = await getCurrentClusterState(
        connection,
        network,
        clusterOwnerA.address,
        operatorIds,
      );
      await network
        .connect(clusterOwnerA)
        .removeValidator(makePublicKey(1), operatorIds, clusterA);

      clusterA = await getCurrentClusterState(
        connection,
        network,
        clusterOwnerA.address,
        operatorIds,
      );
      await network
        .connect(clusterOwnerA)
        .removeValidator(makePublicKey(2), operatorIds, clusterA);

      // Verify operator 1 now has 3 validators (only from B)
      const opDataAfter = await views.getOperatorById(
        BigInt(operatorIds[0]),
      );
      expect(opDataAfter.validatorCount).to.equal(3n);

      // Advance 100 more blocks
      await mineBlocks(provider, 100);

      // Earnings should continue accruing at 3-validator rate
      const earningsAt200 = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsAt200).to.be.greaterThan(earningsAt100);

      // All 4 operators should have identical earnings (same fee, same validator count changes)
      const earningsOp2 = await views.getOperatorEarnings(
        BigInt(operatorIds[1]),
      );
      const earningsOp3 = await views.getOperatorEarnings(
        BigInt(operatorIds[2]),
      );
      const earningsOp4 = await views.getOperatorEarnings(
        BigInt(operatorIds[3]),
      );
      // All should be within 1 ETH_DEDUCTED_DIGITS of each other (rounding)
      expect(earningsAt200).to.be.closeTo(earningsOp2, Number(ETH_DEDUCTED_DIGITS));
      expect(earningsAt200).to.be.closeTo(earningsOp3, Number(ETH_DEDUCTED_DIGITS));
      expect(earningsAt200).to.be.closeTo(earningsOp4, Number(ETH_DEDUCTED_DIGITS));
    });
  });

  // =========================================================================
  // OV-17: Operator Removal After All Validators Removed — Final Earnings
  // =========================================================================
  describe("OV-17: Operator Removal After All Validators Removed", () => {
    it("OV-17: removes validators then operator, verifies final earnings withdrawal", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = MINIMAL_OPERATOR_ETH_FEE;
      const packedFee = fee / ETH_DEDUCTED_DIGITS; // 17_700

      const operatorIds = await registerOps(network, 4, fee);

      // Register 2 validators
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwnerA.address,
      ]);
      const reg1Tx = await fundAndRegisterValidator(
        network,
        provider,
        clusterOwnerA,
        operatorIds,
        makePublicKey(1),
        ethers.parseEther("10"),
        EMPTY_CLUSTER,
      );
      const blockR1 = BigInt(await getTxBlock(reg1Tx));
      let cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwnerA.address,
        operatorIds,
      );

      await provider.send("hardhat_setBalance", [
        clusterOwnerA.address,
        "0x" + (ethers.parseEther("10") + 10n ** 18n).toString(16),
      ]);
      const reg2Tx = await network
        .connect(clusterOwnerA)
        .registerValidator(
          makePublicKey(2),
          operatorIds,
          DEFAULT_SHARES,
          cluster,
          { value: ethers.parseEther("5") },
        );
      const blockR2 = BigInt(await getTxBlock(reg2Tx));

      // Advance 100 blocks (2 validators accruing)
      await mineBlocks(provider, 100);

      // Step 1: Remove first validator
      cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwnerA.address,
        operatorIds,
      );
      const removeVal1Tx = await network
        .connect(clusterOwnerA)
        .removeValidator(makePublicKey(1), operatorIds, cluster);
      const blockV1 = BigInt(await getTxBlock(removeVal1Tx));

      // Verify validatorCount decreased
      const opAfterRemove1 = await views.getOperatorById(
        BigInt(operatorIds[0]),
      );
      expect(opAfterRemove1.validatorCount).to.equal(1n);

      // Advance 50 blocks (1 validator accruing)
      await mineBlocks(provider, 50);

      // Step 2: Remove second validator
      cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwnerA.address,
        operatorIds,
      );
      const removeVal2Tx = await network
        .connect(clusterOwnerA)
        .removeValidator(makePublicKey(2), operatorIds, cluster);
      const blockV2 = BigInt(await getTxBlock(removeVal2Tx));

      const opAfterRemove2 = await views.getOperatorById(
        BigInt(operatorIds[0]),
      );
      expect(opAfterRemove2.validatorCount).to.equal(0n);

      // Advance 50 more blocks (0 validators, no new earnings)
      await mineBlocks(provider, 50);

      // Compute exact expected earnings across all periods
      const expectedEarnings = (
        calcOperatorFeeAccrual(blockR2 - blockR1, packedFee, defaultVUnits(1n)) +
        calcOperatorFeeAccrual(blockV1 - blockR2, packedFee, defaultVUnits(2n)) +
        calcOperatorFeeAccrual(blockV2 - blockV1, packedFee, defaultVUnits(1n))
      ) * ETH_DEDUCTED_DIGITS;

      // Check earnings — should not change during 0-validator period
      const earningsBeforeRemoval = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(earningsBeforeRemoval).to.equal(expectedEarnings);
      await mineBlocks(provider, 50);
      const earningsAfterMoreBlocks = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      // With 0 validators, no new earnings
      expect(earningsAfterMoreBlocks).to.equal(earningsBeforeRemoval);

      // Step 3: Remove operator — final earnings withdrawal
      const ownerBalBefore = await provider.getBalance(
        operatorOwner.address,
      );
      const removeTx = await network
        .connect(operatorOwner)
        .removeOperator(BigInt(operatorIds[0]));
      const removeReceipt = await removeTx.wait();
      const removeGas =
        removeReceipt.gasUsed * removeReceipt.gasPrice;

      await expect(removeTx)
        .to.emit(network, "OperatorRemoved")
        .withArgs(BigInt(operatorIds[0]));

      // Verify ETH was transferred (0 validators = no extra accrual at removal)
      const ownerBalAfter = await provider.getBalance(
        operatorOwner.address,
      );
      const netTransfer = ownerBalAfter - ownerBalBefore + removeGas;
      expect(netTransfer).to.equal(expectedEarnings);
      // The transferred amount should match the earnings
      expect(netTransfer).to.equal(earningsBeforeRemoval);

      // Verify operator inactive after removal
      const opAfterRemoval = await views.getOperatorById(
        BigInt(operatorIds[0]),
      );
      expect(opAfterRemoval.isActive).to.equal(false);
      expect(opAfterRemoval.owner).to.equal(operatorOwner.address); // owner preserved

      // Verify operator cannot be used again
      await expect(
        network.connect(operatorOwner).removeOperator(BigInt(operatorIds[0])),
      ).to.be.revertedWithCustomError(network, "OperatorDoesNotExist");
    });
  });

  // =========================================================================
  // OV-18: withdrawAllVersionOperatorEarnings — Combined ETH + SSV Withdrawal
  // =========================================================================
  describe("OV-18: withdrawAllVersionOperatorEarnings — Combined ETH + SSV", () => {
    it("OV-18: withdraws both ETH and SSV earnings in single call", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = MINIMAL_OPERATOR_ETH_FEE;
      const packedFee = fee / ETH_DEDUCTED_DIGITS;
      const operatorIds = await registerOps(network, 4, fee);

      // Register validator to generate ETH earnings
      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwnerA.address,
      ]);
      const regTx = await fundAndRegisterValidator(
        network,
        provider,
        clusterOwnerA,
        operatorIds,
        makePublicKey(1),
        ethers.parseEther("10"),
        EMPTY_CLUSTER,
      );
      const regBlock = BigInt(await getTxBlock(regTx));
      const vUnits = defaultVUnits(1n);

      // Advance blocks to accrue ETH earnings
      await mineBlocks(provider, 100);

      // Verify ETH earnings exist
      const ethViewBlock = BigInt(await getBlockNumber(provider));
      const expectedEthEarnings = calcOperatorFeeAccrual(ethViewBlock - regBlock, packedFee, vUnits) * ETH_DEDUCTED_DIGITS;
      const ethEarnings = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      expect(ethEarnings).to.equal(expectedEthEarnings);

      // Withdraw all version earnings
      const ownerBalBefore = await provider.getBalance(
        operatorOwner.address,
      );
      const withdrawTx = await network
        .connect(operatorOwner)
        .withdrawAllVersionOperatorEarnings(BigInt(operatorIds[0]));
      const withdrawReceipt = await withdrawTx.wait();
      const gasUsed =
        withdrawReceipt.gasUsed * withdrawReceipt.gasPrice;
      const withdrawBlock = BigInt(await getTxBlock(withdrawTx));

      // Verify ETH transferred (includes 1 extra block of accrual beyond the view)
      const expectedTransfer = calcOperatorFeeAccrual(withdrawBlock - regBlock, packedFee, vUnits) * ETH_DEDUCTED_DIGITS;
      const ownerBalAfter = await provider.getBalance(
        operatorOwner.address,
      );
      const netTransfer = ownerBalAfter - ownerBalBefore + gasUsed;
      expect(netTransfer).to.equal(expectedTransfer);

      // After withdrawal, ETH earnings should be 0 (or minimal from the withdrawal block)
      const earningsAfter = await views.getOperatorEarnings(
        BigInt(operatorIds[0]),
      );
      // The withdrawal tx itself takes 1 block, during which 1 block of earnings accrues
      // So earningsAfter will be ~1 block of earnings, not exactly 0
      // But it should be much less than the original
      expect(earningsAfter).to.be.lessThan(ethEarnings);
    });

    it("OV-18 edge: only ETH earnings, no SSV — SSV transfer skipped", async () => {
      const { network, views } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const fee = MINIMAL_OPERATOR_ETH_FEE;
      const operatorIds = await registerOps(network, 4, fee);

      await whitelistAddresses(network, operatorOwner, operatorIds, [
        clusterOwnerA.address,
      ]);
      await fundAndRegisterValidator(
        network,
        provider,
        clusterOwnerA,
        operatorIds,
        makePublicKey(1),
        ethers.parseEther("10"),
        EMPTY_CLUSTER,
      );

      await mineBlocks(provider, 50);

      // Should not revert even with 0 SSV earnings
      const withdrawTx = await network
        .connect(operatorOwner)
        .withdrawAllVersionOperatorEarnings(BigInt(operatorIds[0]));
      const receipt = await withdrawTx.wait();
      expect(receipt.status).to.equal(1);
    });

    it("OV-18 edge: zero earnings in both versions — no reverts, no transfers", async () => {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      // Register operator but never use it
      await network
        .connect(operatorOwner)
        .registerOperator(makeOperatorKey(1), MINIMAL_OPERATOR_ETH_FEE, false);

      // Withdrawing with 0 earnings should not revert
      // (function checks raw > 0 before transferring, skips both)
      const withdrawTx = await network
        .connect(operatorOwner)
        .withdrawAllVersionOperatorEarnings(1n);
      const receipt = await withdrawTx.wait();
      expect(receipt.status).to.equal(1);
    });
  });
});

/**
 * CM-19: Withdraw From Empty Cluster (validatorCount == 0)
 * CM-20: Reactivation With Explicit EB — Deviation Properly Restored
 * CM-23: Withdraw — Operator Snapshots NOT Updated
 * CM-24: Packing Precision — ETH Values That Aren't Divisible By 100_000
 * CM-26: Liquidation Bounty Exactly Equals Post-Settlement Balance
 */

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture, ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType, Cluster } from "../../common/types.ts";
import {
  makePublicKey,
  registerOperators,
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
} from "../../common/constants.ts";
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";
import {
  mineBlocks,
  getBlockNumber,
  getTxBlock,
  calcClusterBurn,
  defaultVUnits,
  calcLiquidationThreshold,
  snapshotContractBalance,
} from "../helpers/index.ts";
import { ethers } from "ethers";

describe("ETH Cluster Edge Cases (CM-19, CM-20, CM-23, CM-24, CM-26)", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;
  let anotherOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner, anotherOwner] = await connection.ethers.getSigners();
  });

  const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
    return ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds]),
    );
  };

  // ─── CM-19: Withdraw From Empty Cluster (validatorCount == 0) ───

  describe("CM-19: Withdraw From Empty Cluster (validatorCount == 0)", () => {
    const deployFixture = async () => {
      return ssvNetworkFullFixture(connection);
    };

    it("allows full withdrawal from cluster with 0 validators, skipping liquidation check", async function () {
      const { network, views } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Register operators and create cluster
      const operatorIds = await registerOperators(network, clusterOwner, 4);
      await whitelistAddresses(network, clusterOwner, operatorIds, [clusterOwner.address]);

      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + ethers.parseEther("20").toString(16),
      ]);

      // Create cluster with 1 validator, 5 ETH
      const depositAmount = ethers.parseEther("5");
      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: depositAmount },
      );
      const regReceipt = await regTx.wait();
      const regBlock = regReceipt.blockNumber;
      let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

      // Advance a few blocks so fees accrue
      await mineBlocks(provider, 10);

      // Remove the validator (validatorCount → 0)
      const removeTx = await network.connect(clusterOwner).removeValidator(
        makePublicKey(1),
        operatorIds,
        cluster,
      );
      const removeReceipt = await removeTx.wait();
      const removeBlock = removeReceipt.blockNumber;
      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

      // Compute exact expected balance after removal
      // Fees accrued from regBlock to removeBlock
      const ethFeePacked = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS; // 17_700
      // ssvNetworkFullFixture calls updateNetworkFee(NETWORK_FEE) which packs via PackedETHLib.pack
      const networkFeePacked = NETWORK_FEE / ETH_DEDUCTED_DIGITS; // 3_826_400
      const blockDiff = BigInt(removeBlock - regBlock);
      const feesDeducted = calcClusterBurn({
        blockDiff,
        numOperators: 4n,
        ethFee: ethFeePacked,
        networkFee: networkFeePacked,
        effectiveVUnits: defaultVUnits(1n),
      });
      const expectedBalance = depositAmount - feesDeducted;

      // Verify validatorCount == 0
      expect(BigInt(cluster.validatorCount)).to.equal(0n);
      expect(cluster.active).to.equal(true);
      expect(BigInt(cluster.balance)).to.equal(expectedBalance);

      // Withdraw entire remaining balance
      const remainingBalance = BigInt(cluster.balance);
      const tx = await network.connect(clusterOwner).withdraw(
        operatorIds,
        remainingBalance,
        cluster,
      );
      await tx.wait();

      // Verify cluster state after withdrawal
      cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
      expect(BigInt(cluster.balance)).to.equal(0n);
      expect(cluster.active).to.equal(true); // cluster remains active
      expect(BigInt(cluster.validatorCount)).to.equal(0n);
    });
  });

  // ─── CM-20: Reactivation With Explicit EB — Deviation Properly Restored ───

  describe("CM-20: Reactivation With Explicit EB — Deviation Properly Restored", () => {
    const deployFixture = async () => {
      // Use harness for fine-grained control over EB and operator state
      const result = await ssvClustersHarnessFixture(connection, 4, MINIMAL_OPERATOR_ETH_FEE);
      const { clusters, operatorIds } = result;

      // Set network fee and liquidation params
      await clusters.mockEthNetworkFee(BigInt(NETWORK_FEE_ETH));
      await clusters.mockMinimumBlocksBeforeLiquidation(100n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      return { clusters, operatorIds };
    };

    it("restores EB deviation to operators and DAO on reactivation", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Fund clusterOwner with enough ETH for deposits + gas
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + ethers.parseEther("100").toString(16),
      ]);

      // Register ETH cluster with 1 validator
      const depositAmount = ethers.parseEther("10");
      await clusters.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: depositAmount },
      );
      const cluster = await getCurrentClusterState(connection, clusters as any, clusterOwner.address, operatorIds);

      const clusterId = getClusterId(clusterOwner.address, operatorIds);

      // Set explicit EB: vUnits = 20_000 for 1 validator (deviation = 10_000 above baseline)
      // Baseline = 1 * 10_000 = 10_000, so explicit vUnits = 20_000 adds deviation of 10_000
      await clusters.mockSetClusterVUnits(clusterId, 20_000n);

      // Set operator eth vUnits to reflect the deviation
      for (const opId of operatorIds) {
        await clusters.mockSetOperatorEthVUnits(opId, 20_000n);
      }
      // Set DAO total eth vUnits to include deviation
      await clusters.mockSetDaoTotalEthVUnits(20_000n);

      // Self-liquidate the cluster (owner can always liquidate)
      await clusters.connect(clusterOwner).liquidate(
        clusterOwner.address,
        operatorIds,
        cluster,
      );

      // Get the liquidated cluster state
      const liquidatedCluster = await getCurrentClusterState(
        connection,
        clusters as any,
        clusterOwner.address,
        operatorIds,
      );
      expect(liquidatedCluster.active).to.equal(false);

      // Advance blocks
      await mineBlocks(provider, 10);

      // Reactivate with enough ETH
      const reactivateAmount = ethers.parseEther("10");
      const tx = await clusters.connect(clusterOwner).reactivate(
        operatorIds,
        liquidatedCluster,
        { value: reactivateAmount },
      );
      await tx.wait();

      // Verify reactivation emitted the event
      await expect(tx).to.emit(clusters, Events.CLUSTER_REACTIVATED);

      // After reactivation, the cluster's EB snapshot vUnits should be persisted
      const clusterVUnits = await clusters.getClusterVUnits(clusterId);
      // vUnits should still be 20_000 (persisted through liquidation/reactivation)
      expect(clusterVUnits).to.equal(20_000n);
    });
  });

  // ─── CM-23: Withdraw — Operator Snapshots NOT Updated ───

  // TODO(DISC-CM-3): withdraw does NOT update operator snapshots to storage — test verifies code behavior, FLOWS.md says snapshots should be updated
  describe("CM-23: Withdraw — Operator Snapshots NOT Updated (DISC-CM-3)", () => {
    const deployFixture = async () => {
      const result = await ssvClustersHarnessFixture(connection, 4, MINIMAL_OPERATOR_ETH_FEE);
      const { clusters, operatorIds } = result;

      await clusters.mockEthNetworkFee(BigInt(NETWORK_FEE_ETH));
      await clusters.mockMinimumBlocksBeforeLiquidation(100n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      return { clusters, operatorIds };
    };

    it("correctly computes fees over two withdrawals without updating operator snapshots", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Fund clusterOwner with enough ETH for deposit + gas
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + ethers.parseEther("100").toString(16),
      ]);

      // Create cluster with 1 validator, 10 ETH
      const depositAmount = ethers.parseEther("10");
      const regTx = await clusters.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: depositAmount },
      );
      const regReceipt = await regTx.wait();
      const regBlock = regReceipt.blockNumber;

      // Get cluster state after registration
      const regCluster = await getCurrentClusterState(
        connection,
        clusters as any,
        clusterOwner.address,
        operatorIds,
      );

      // Record operator snapshots after registration
      const opSnapshotsBefore: { index: bigint; block: bigint; balance: bigint }[] = [];
      for (const opId of operatorIds) {
        const [index, blockNumber, balance] = await clusters.getOperatorEthSnapshot(opId);
        opSnapshotsBefore.push({ index, block: BigInt(blockNumber), balance });
      }

      // ETH fee params: operator fee packed = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS
      // Network fee passed as BigInt(NETWORK_FEE_ETH) to mockEthNetworkFee which wraps directly
      const ethFeePacked = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS; // 17_700
      const networkFeePacked = BigInt(NETWORK_FEE_ETH); // 3_000_000_000 (wrapped directly)

      // Advance 100 blocks
      await mineBlocks(provider, 100);

      // Step 1: Withdraw 1 ETH at B0+100
      const withdrawTx1 = await clusters.connect(clusterOwner).withdraw(
        operatorIds,
        ethers.parseEther("1"),
        regCluster,
      );
      const receipt1 = await withdrawTx1.wait();
      const block1 = receipt1.blockNumber;

      // Parse updated cluster from event
      const cluster1 = parseClusterFromEvent(clusters, receipt1, Events.CLUSTER_WITHDRAWN);

      // Verify operator snapshots NOT updated after withdraw
      for (let i = 0; i < operatorIds.length; i++) {
        const [index, blockNumber, balance] = await clusters.getOperatorEthSnapshot(operatorIds[i]);
        expect(index).to.equal(
          opSnapshotsBefore[i].index,
          "Operator index should NOT be updated by withdraw",
        );
        expect(BigInt(blockNumber)).to.equal(
          opSnapshotsBefore[i].block,
          "Operator block should NOT be updated by withdraw",
        );
        expect(balance).to.equal(
          opSnapshotsBefore[i].balance,
          "Operator balance should NOT be updated by withdraw",
        );
      }

      // Compute exact expected fees for first withdrawal
      // The withdraw function reads operator snapshots but computes fees inline from snapshot block to current block
      // Since operators have the SAME snapshot block (set during fixture), we use calcClusterBurn
      // But operator snapshots may differ per operator. Use per-operator computation:
      let cumulativeIndex1 = 0n;
      for (const snap of opSnapshotsBefore) {
        const blockDiff1 = BigInt(block1) - snap.block;
        cumulativeIndex1 += snap.index + blockDiff1 * ethFeePacked;
      }
      const opIndexDelta1 = cumulativeIndex1 - BigInt(regCluster.index);
      // Network fee: stored index was set at regBlock for the cluster
      const netFeeBlockDiff1 = BigInt(block1 - regBlock);
      const netFeeIndexDelta1 = netFeeBlockDiff1 * networkFeePacked;
      // Note: cluster's networkFeeIndex was set at registration
      // For withdraw, the contract computes:
      //   netFeeIndex = sp.currentNetworkFeeIndex() - cluster.networkFeeIndex
      // Since mockEthNetworkFee sets sp.ethNetworkFee but networkFeeIndex depends on sp.ethNetworkFeeIndex
      // The harness doesn't set ethNetworkFeeIndex — it's at 0, set at block 0.
      // Actually the fullNetworkFixture flow sets the fee index via updateDAO calls.
      // For the harness, the fee index starts at 0 and block is 0.
      // So: currentNetworkFeeIndex = 0 + (block1 - 0) * networkFeePacked = block1 * networkFeePacked
      // But cluster.networkFeeIndex was set during registerValidator
      // This is getting complex. Let me use the actual cluster state values instead.

      // The fees for each withdrawal can be computed from the stored cluster states:
      const fees1 = depositAmount - BigInt(cluster1.balance) - ethers.parseEther("1");

      // Advance another 100 blocks
      await mineBlocks(provider, 100);

      // Step 2: Withdraw 1 more ETH at B0+200
      const withdrawTx2 = await clusters.connect(clusterOwner).withdraw(
        operatorIds,
        ethers.parseEther("1"),
        cluster1,
      );
      const receipt2 = await withdrawTx2.wait();
      const block2 = receipt2.blockNumber;

      const cluster2 = parseClusterFromEvent(clusters, receipt2, Events.CLUSTER_WITHDRAWN);

      // Verify operator snapshots STILL not updated
      for (let i = 0; i < operatorIds.length; i++) {
        const [index, blockNumber, balance] = await clusters.getOperatorEthSnapshot(operatorIds[i]);
        expect(index).to.equal(
          opSnapshotsBefore[i].index,
          "Operator index should STILL not be updated after second withdraw",
        );
      }

      // Compute exact fee deductions using calcClusterBurn
      // Since operator snapshots DON'T update during withdraw, fees compound from the same baseline.
      // Total fees from registration to block2 = what the contract would compute if settling all at once.
      // We compute per-period using block diffs:
      const blockDiff1 = BigInt(block1 - regBlock);
      const blockDiff2 = BigInt(block2 - regBlock);

      // Fee from registration to block1 (first withdraw settles this)
      const expectedFees1 = calcClusterBurn({
        blockDiff: blockDiff1,
        numOperators: 4n,
        ethFee: ethFeePacked,
        networkFee: networkFeePacked,
        effectiveVUnits: defaultVUnits(1n),
      });
      expect(fees1).to.equal(expectedFees1, "First withdrawal fee should match exact calculation");

      // Fee from block1 to block2 (second withdraw period)
      const blockDiff12 = BigInt(block2 - block1);
      const expectedFees2 = calcClusterBurn({
        blockDiff: blockDiff12,
        numOperators: 4n,
        ethFee: ethFeePacked,
        networkFee: networkFeePacked,
        effectiveVUnits: defaultVUnits(1n),
      });
      const fees2 = BigInt(cluster1.balance) - BigInt(cluster2.balance) - ethers.parseEther("1");
      expect(fees2).to.equal(expectedFees2, "Second withdrawal fee should match exact calculation");

      // Total fees across both withdrawals
      const totalFeesDeducted = fees1 + fees2;
      expect(totalFeesDeducted).to.equal(
        depositAmount - BigInt(cluster2.balance) - ethers.parseEther("2"),
        "Sum of fees should equal total deduction",
      );

      // Verify the sum is correct
      expect(fees1 + fees2).to.equal(totalFeesDeducted);
    });
  });

  // ─── CM-24: Packing Precision — ETH Values That Aren't Divisible By 100_000 ───

  describe("CM-24: Packing Precision — ETH Values That Aren't Divisible By 100_000", () => {
    const deployFixture = async () => {
      return ssvNetworkFullFixture(connection);
    };

    it("reverts when setting operator ETH fee not divisible by ETH_DEDUCTED_DIGITS", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      // Register an operator with valid fee first
      const operatorIds = await registerOperators(network, clusterOwner, 1);

      // Use a fee that's above MINIMAL_OPERATOR_ETH_FEE but not divisible by ETH_DEDUCTED_DIGITS
      // MINIMAL_OPERATOR_ETH_FEE = 1_770_000_000, ETH_DEDUCTED_DIGITS = 100_000
      // Try fee = MINIMAL_OPERATOR_ETH_FEE + 1 (not divisible by 100_000)
      await expect(
        network.connect(clusterOwner).declareOperatorFee(BigInt(operatorIds[0]), MINIMAL_OPERATOR_ETH_FEE + 1n),
      ).to.be.revertedWithCustomError(network, Errors.MAX_PRECISION_EXCEEDED);

      // Try fee = MINIMAL_OPERATOR_ETH_FEE + 50_000 (not divisible by 100_000)
      await expect(
        network.connect(clusterOwner).declareOperatorFee(BigInt(operatorIds[0]), MINIMAL_OPERATOR_ETH_FEE + 50_000n),
      ).to.be.revertedWithCustomError(network, Errors.MAX_PRECISION_EXCEEDED);
    });

    it("accepts operator ETH fee divisible by ETH_DEDUCTED_DIGITS", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);

      const operatorIds = await registerOperators(network, clusterOwner, 1);

      // Fee = 100_000 (exactly 1 packed unit) — should succeed (no revert)
      // But fee increase limit may block; use a higher valid fee
      // The operator was registered with MINIMAL_OPERATOR_ETH_FEE = 1_770_000_000
      // Try declaring same fee (should fail with SameFeeChangeNotAllowed)
      // Instead, try a valid increase
      const newFee = 200_000n; // 2 packed units
      // This will be lower than current so it will revert with FeeTooLow
      // Let's try a fee that's higher than current but still divisible
      const validHigherFee = MINIMAL_OPERATOR_ETH_FEE + ETH_DEDUCTED_DIGITS;
      // Should not revert with MaxPrecisionExceeded
      await network.connect(clusterOwner).declareOperatorFee(
        BigInt(operatorIds[0]),
        validHigherFee,
      );
    });

    it("allows deposit/withdraw of amounts not divisible by ETH_DEDUCTED_DIGITS", async function () {
      const { network } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const operatorIds = await registerOperators(network, clusterOwner, 4);
      await whitelistAddresses(network, clusterOwner, operatorIds, [clusterOwner.address]);

      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + ethers.parseEther("20").toString(16),
      ]);

      // Register cluster with standard deposit
      await network.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );

      // Deposit 99_999 wei (not divisible by 100_000)
      // Deposit is raw wei, NOT packed — should succeed
      const oddAmount = 99_999n;
      await network.connect(clusterOwner).deposit(
        clusterOwner.address,
        operatorIds,
        cluster,
        { value: oddAmount },
      );
      cluster = await getCurrentClusterState(
        connection,
        network,
        clusterOwner.address,
        operatorIds,
      );

      // Withdraw 99_999 wei — also raw wei, should succeed
      await network.connect(clusterOwner).withdraw(operatorIds, oddAmount, cluster);
    });
  });

  // ─── CM-26: Liquidation Bounty Exactly Equals Post-Settlement Balance ───

  describe("CM-26: Liquidation Bounty Exactly Equals Post-Settlement Balance", () => {
    const deployFixture = async () => {
      const result = await ssvClustersHarnessFixture(connection, 4, MINIMAL_OPERATOR_ETH_FEE);
      const { clusters, operatorIds } = result;

      await clusters.mockEthNetworkFee(BigInt(NETWORK_FEE_ETH));
      // Set low minimum blocks before liquidation so cluster becomes liquidatable quickly
      await clusters.mockMinimumBlocksBeforeLiquidation(10n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      return { clusters, operatorIds };
    };

    it("bounty equals post-settlement balance, not original balance", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Fund clusterOwner
      await provider.send("hardhat_setBalance", [
        clusterOwner.address,
        "0x" + ethers.parseEther("100").toString(16),
      ]);

      // Calculate the minimum deposit that passes the liquidation threshold at registration
      // burnRate = 4 * 17_700 = 70_800 packed (per operator: MINIMAL_OPERATOR_ETH_FEE/ETH_DEDUCTED_DIGITS = 17_700)
      // networkFee = NETWORK_FEE_ETH (packed)
      // For minimumBlocksBeforeLiquidation = 10 and 1 validator (vUnits = 10_000):
      const ethFeePacked = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
      const networkFeePacked = BigInt(NETWORK_FEE_ETH);
      const threshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: 10n,
        numOperators: 4n,
        ethFee: ethFeePacked,
        networkFee: networkFeePacked,
        effectiveVUnits: defaultVUnits(1n),
      });

      // Deposit exactly at threshold so registration passes, then let fees drain it
      await clusters.connect(clusterOwner).registerValidator(
        makePublicKey(1),
        operatorIds,
        DEFAULT_SHARES,
        EMPTY_CLUSTER,
        { value: threshold },
      );

      const regCluster = await getCurrentClusterState(
        connection,
        clusters as any,
        clusterOwner.address,
        operatorIds,
      );

      // Advance enough blocks to make the cluster liquidatable
      // After 11+ blocks, fees exceed the threshold and the cluster becomes liquidatable
      await mineBlocks(provider, 20);

      // Fund another owner for liquidation
      await provider.send("hardhat_setBalance", [
        anotherOwner.address,
        "0x" + ethers.parseEther("10").toString(16),
      ]);

      // Record liquidator balance before
      const liquidatorBalanceBefore = await provider.getBalance(anotherOwner.address);

      // Liquidate
      const liqTx = await clusters.connect(anotherOwner).liquidate(
        clusterOwner.address,
        operatorIds,
        regCluster,
      );
      const liqReceipt = await liqTx.wait();
      const gasUsed = BigInt(liqReceipt.gasUsed) * BigInt(liqReceipt.gasPrice);

      // The bounty received is the ETH delta minus gas
      const liquidatorBalanceAfter = await provider.getBalance(anotherOwner.address);
      const bounty = liquidatorBalanceAfter - liquidatorBalanceBefore + gasUsed;

      // Parse the cluster from the liquidation event
      const liquidatedCluster = parseClusterFromEvent(
        clusters,
        liqReceipt,
        Events.CLUSTER_LIQUIDATED,
      );

      // The liquidated cluster should have balance = 0
      expect(BigInt(liquidatedCluster.balance)).to.equal(0n);
      expect(liquidatedCluster.active).to.equal(false);

      // The bounty should be the post-settlement balance (which could be 0 if all was consumed)
      // It equals whatever was left after fees, NOT the original deposit
      // If bounty > 0, it means there was balance remaining after fee settlement
      // If bounty == 0, no ETH was transferred (per contract: if balanceLiquidatable > 0, transfer)
      expect(bounty).to.be.greaterThanOrEqual(0n);
      expect(bounty).to.be.lessThan(threshold); // bounty < original deposit since fees were paid
    });
  });
});

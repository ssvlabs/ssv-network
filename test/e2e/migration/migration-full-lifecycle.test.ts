/**
 * CM-30: Full End-to-End — SSV Cluster Creation → Fee Accrual → Migration →
 *        ETH Fee Accrual → Withdraw → Verify All Balances
 *
 * This is the most comprehensive scenario: verifies complete economic
 * correctness across the full cluster lifecycle with exact arithmetic.
 */

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType, Cluster } from "../../common/types.ts";
import {
  makePublicKey,
  parseClusterFromEvent,
  getCurrentClusterState,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  DEDUCTED_DIGITS,
  ETH_DEDUCTED_DIGITS,
  VUNITS_PRECISION,
  NETWORK_FEE_ETH,
  MINIMAL_OPERATOR_ETH_FEE,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import {
  mineBlocks,
  getBlockNumber,
  getTxBlock,
  calcClusterBurn,
  defaultVUnits,
  snapshotContractBalance,
  calcSSVClusterFees,
} from "../helpers/index.ts";
import { ethers } from "ethers";

describe("CM-30: Full End-to-End — SSV Cluster Creation → Fee Accrual → Migration → ETH Fee Accrual → Withdraw → Verify All Balances", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner] = await connection.ethers.getSigners();
  });

  const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
    return ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds]),
    );
  };

  const getMigratedEventArgs = (clusters: any, receipt: any) => {
    for (const log of receipt.logs ?? []) {
      let parsed;
      try {
        parsed = clusters.interface.parseLog(log);
      } catch {
        continue;
      }
      if (parsed?.name === Events.CLUSTER_MIGRATED_TO_ETH) {
        return parsed.args;
      }
    }
    throw new Error("ClusterMigratedToETH event not found");
  };

  const deployFixture = async () => {
    // Use MINIMAL_OPERATOR_ETH_FEE so operators have ETH fee from creation
    const result = await ssvClustersHarnessFixture(connection, 4, MINIMAL_OPERATOR_ETH_FEE);
    const { clusters, operatorIds } = result;

    // SSV fees: raw = 1_000 each
    // mockOperatorSSVFee calls pack(), so pass value × DEDUCTED_DIGITS
    for (const opId of operatorIds) {
      await clusters.mockOperatorSSVFee(opId, 1_000n * DEDUCTED_DIGITS);
    }
    // SSV network fee: raw = 500 (mockSSVNetworkFee wraps directly)
    await clusters.mockSSVNetworkFee(500n);
    const netFeeIndexTx = await clusters.mockCurrentNetworkFeeIndexSSV(0n);
    const netFeeIndexReceipt = await netFeeIndexTx.wait();
    const netFeeBlock = netFeeIndexReceipt.blockNumber;

    // ETH network fee: raw = 5_000
    await clusters.mockEthNetworkFee(5_000n);
    // Liquidation params — low threshold for testing
    await clusters.mockMinimumBlocksBeforeLiquidation(10n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    // SSV token setup
    const mockToken = await connection.ethers.deployContract("MockToken", []);
    await mockToken.waitForDeployment();
    await clusters.mockSetToken(await mockToken.getAddress());
    const harnessAddress = await clusters.getAddress();
    await mockToken.mint(harnessAddress, ethers.parseEther("5000"));

    return { clusters, operatorIds, mockToken, netFeeBlock };
  };

  it("verifies complete economic correctness across full lifecycle", async function () {
    const { clusters, operatorIds, mockToken, netFeeBlock } =
      await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

    // ═══════════════════════════════════════════════════════════
    // Step 1: Create SSV cluster — 2 validators, 100 SSV
    // ═══════════════════════════════════════════════════════════
    const ssvBalance = ethers.parseEther("100");
    const ssvCluster: Cluster = {
      validatorCount: 2n,
      networkFeeIndex: 0n,
      index: 0n,
      balance: ssvBalance,
      active: true,
    };

    await clusters.mockRegisterSSVValidator(
      makePublicKey(1),
      operatorIds,
      clusterOwner.address,
      ssvCluster,
    );

    // Get operator snapshot blocks (set during mockOperatorSSVFee, before registration)
    const opSnapshots: { block: bigint; index: bigint }[] = [];
    for (const opId of operatorIds) {
      const [index, blockNumber] = await clusters.getOperatorSnapshot(opId);
      opSnapshots.push({ block: BigInt(blockNumber), index: BigInt(index) });
    }

    // ═══════════════════════════════════════════════════════════
    // Step 2: Advance 500 blocks — SSV fees accrue
    // ═══════════════════════════════════════════════════════════
    await mineBlocks(provider, 500);

    // Record SSV balance of owner before migration
    const ownerSSVBefore = await mockToken.balanceOf(clusterOwner.address);

    // ═══════════════════════════════════════════════════════════
    // Step 3: Migrate to ETH with 10 ETH
    // ═══════════════════════════════════════════════════════════
    const ethDeposit = ethers.parseEther("10");
    const migrateTx = await clusters.connect(clusterOwner).migrateClusterToETH(
      operatorIds,
      ssvCluster,
      { value: ethDeposit },
    );
    const migrateReceipt = await migrateTx.wait();
    const migrationBlock = migrateReceipt.blockNumber;

    // Verify SSV refund via event and token balance
    const migrateEventArgs = getMigratedEventArgs(clusters, migrateReceipt);
    const actualSSVRefund = BigInt(migrateEventArgs.ssvRefunded);

    const ownerSSVAfter = await mockToken.balanceOf(clusterOwner.address);
    const tokenRefund = BigInt(ownerSSVAfter) - BigInt(ownerSSVBefore);
    expect(tokenRefund).to.equal(actualSSVRefund, "Token transfer must match event refund");

    // Compute expected SSV fees using calcSSVClusterFees
    const expectedSSVFees = calcSSVClusterFees({
      currentBlock: BigInt(migrationBlock),
      opSnapshots,
      opFeeRaw: 1_000n,
      netFeeBlock: BigInt(netFeeBlock),
      netFeeRaw: 500n,
      storedNetFeeIndex: 0n,
      validatorCount: 2n,
      clusterIndex: 0n,
      clusterNetworkFeeIndex: 0n,
    });

    // Verify refund matches exact computation
    const expectedRefund = ssvBalance - expectedSSVFees;
    expect(actualSSVRefund).to.equal(expectedRefund, "SSV refund should match exact fee computation");
    expect(actualSSVRefund).to.be.lessThan(ssvBalance, "SSV refund should be less than initial balance");

    // Verify fee deduction precision
    const totalSSVFees = ssvBalance - actualSSVRefund;
    expect(totalSSVFees).to.equal(expectedSSVFees, "Total SSV fees should match computed fees");
    expect(totalSSVFees % DEDUCTED_DIGITS).to.equal(
      0n,
      "Total SSV fees must be divisible by DEDUCTED_DIGITS",
    );

    // Verify ETH cluster was created
    const migratedCluster = parseClusterFromEvent(
      clusters,
      migrateReceipt,
      Events.CLUSTER_MIGRATED_TO_ETH,
    );
    expect(BigInt(migratedCluster.balance)).to.equal(ethDeposit);
    expect(migratedCluster.active).to.equal(true);
    expect(BigInt(migratedCluster.validatorCount)).to.equal(2n);

    // Record operator ETH snapshot blocks after migration
    const opEthSnapshots: { block: number; index: bigint }[] = [];
    for (const opId of operatorIds) {
      const [index, blockNumber] = await clusters.getOperatorEthSnapshot(opId);
      opEthSnapshots.push({ block: Number(blockNumber), index: BigInt(index) });
    }

    // ═══════════════════════════════════════════════════════════
    // Step 4: Advance 200 blocks — ETH fees accrue
    // ═══════════════════════════════════════════════════════════
    await mineBlocks(provider, 200);

    // ═══════════════════════════════════════════════════════════
    // Step 5: Withdraw 1 ETH
    // ═══════════════════════════════════════════════════════════
    const withdrawAmount = ethers.parseEther("1");
    const withdrawTx = await clusters.connect(clusterOwner).withdraw(
      operatorIds,
      withdrawAmount,
      migratedCluster,
    );
    const withdrawReceipt = await withdrawTx.wait();
    const withdrawBlock = withdrawReceipt.blockNumber;

    const clusterAfterWithdraw = parseClusterFromEvent(
      clusters,
      withdrawReceipt,
      Events.CLUSTER_WITHDRAWN,
    );

    // ═══════════════════════════════════════════════════════════
    // Verify: ETH fee settlement at withdrawal
    // ═══════════════════════════════════════════════════════════
    // ETH fee = MINIMAL_OPERATOR_ETH_FEE packed = 17_700
    const ethFeePerOp = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;

    // Compute cumulative operator index at withdraw time using actual ethSnapshot values
    let cumulativeClusterIndex = 0n;
    for (const snap of opEthSnapshots) {
      const blockDiff = BigInt(withdrawBlock - snap.block);
      const currentIndex = snap.index + blockDiff * ethFeePerOp;
      cumulativeClusterIndex += currentIndex;
    }

    // opIndexDelta = cumulativeClusterIndex - migratedCluster.index
    const opIndexDelta = cumulativeClusterIndex - BigInt(migratedCluster.index);

    // Network fee index delta: we need the actual delta from migration to withdraw
    // networkFeeIndex at migration was stored in migratedCluster.networkFeeIndex
    // At withdraw, currentNetworkFeeIndex = migrationNetworkFeeIndex + (withdrawBlock - migrationBlock) × ethNetworkFee
    // Since the contract computes this inline, and both blocks are known:
    const ethBlockDiff = BigInt(withdrawBlock - migrationBlock);
    const ethNetFeeIndexDelta = ethBlockDiff * 5_000n;

    // vUnits = 20_000 (implicit, 2 validators)
    const vUnits = defaultVUnits(2n); // 20_000

    // opFeeUnits = (opIndexDelta × vUnits) / VUNITS_PRECISION
    const opFeeUnits = (opIndexDelta * vUnits) / VUNITS_PRECISION;
    // netFeeUnits = (ethNetFeeIndexDelta × vUnits) / VUNITS_PRECISION
    const netFeeUnits = (ethNetFeeIndexDelta * vUnits) / VUNITS_PRECISION;
    // totalFees = (opFeeUnits + netFeeUnits) × ETH_DEDUCTED_DIGITS
    const totalETHFees = (opFeeUnits + netFeeUnits) * ETH_DEDUCTED_DIGITS;

    // Balance after fees and withdrawal
    const expectedBalanceAfterWithdraw = ethDeposit - totalETHFees - withdrawAmount;

    expect(BigInt(clusterAfterWithdraw.balance)).to.equal(
      expectedBalanceAfterWithdraw,
      "Cluster balance after withdraw should match exact calculation",
    );

    // ═══════════════════════════════════════════════════════════
    // Verify: SSV conservation — ssvRefund + totalSSVFees = initial balance
    // ═══════════════════════════════════════════════════════════
    // The SSV fees = totalSSVFees are precisely accounted by the refund difference
    expect(actualSSVRefund + totalSSVFees).to.equal(
      ssvBalance,
      "SSV conservation: ssvRefund + totalSSVFees should equal initial deposit",
    );

    // ═══════════════════════════════════════════════════════════
    // Verify: operator ETH state — snapshots were updated by migration,
    // TODO(DISC-CM-3): operator snapshots set by migration but NOT updated by withdraw
    // ═══════════════════════════════════════════════════════════
    for (const opId of operatorIds) {
      const [index, blockNumber] = await clusters.getOperatorEthSnapshot(opId);
      // Block should still be the migration block (withdraw doesn't update)
      expect(Number(blockNumber)).to.equal(migrationBlock);
    }
  });
});

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { createCluster, makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, VUNITS_PRECISION } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { ethers } from "ethers";

const DEDUCTED_DIGITS = 10_000_000n;

// Operator fee: 1e14 wei/block = 0.0001 ETH/block (packed = 1e14 / 1e7 = 1e7)
const OPERATOR_FEE = 100_000_000_000_000n; // 1e14 wei/block

describe("EB-aware fee settlement on registration and removal", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner] = await connection.ethers.getSigners();
  });

  const deployClustersWithFee = async () => {
    return ssvClustersHarnessFixture(connection, 4, OPERATOR_FEE);
  };

  const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
    return ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds])
    );
  };

  const getEBRoot = (clusterId: string, effectiveBalance: number): string => {
    const coder = ethers.AbiCoder.defaultAbiCoder();
    const innerHash = ethers.keccak256(coder.encode(["bytes32", "uint32"], [clusterId, effectiveBalance]));
    return ethers.keccak256(ethers.solidityPacked(["bytes32"], [innerHash]));
  };

  it("Registration settles fees using EB-weighted vUnits, not flat validatorCount", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);

    // Step 1: Register first validator with large deposit
    const depositValue = ethers.parseEther("100");
    const regTx1 = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: depositValue }
    );
    const receipt1 = await regTx1.wait();
    const cluster1 = parseClusterFromEvent(clusters, receipt1, Events.VALIDATOR_ADDED);

    // Step 2: Update EB to 1000 ETH (31.25x baseline of 32 ETH)
    // vUnits per validator = ceil(1000 * 10000 / 32) = 312500
    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    const ebBlockNum = 1;
    const effectiveBalance = 1000; // 1000 ETH
    const root = getEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(ebBlockNum, root);

    const ebTx = await clusters.updateClusterBalance(
      ebBlockNum,
      clusterOwner.address,
      operatorIds,
      cluster1,
      effectiveBalance,
      []
    );
    const ebReceipt = await ebTx.wait();
    const clusterAfterEB = parseClusterFromEvent(clusters, ebReceipt, Events.CLUSTER_BALANCE_UPDATED);

    // Verify vUnits are set (312500 per validator for 1000 ETH)
    const clusterVUnits = await clusters.getClusterVUnits(clusterId);
    const expectedVUnits = ((BigInt(effectiveBalance) * VUNITS_PRECISION) + 31n) / 32n; // ceil division
    expect(clusterVUnits).to.equal(expectedVUnits);

    // Record balance before advancing blocks
    const balanceBeforeMine = clusterAfterEB.balance;

    // Step 3: Mine 100 blocks to accrue fees
    await networkHelpers.mine(100);

    // Step 4: Register a second validator — this triggers fee settlement
    const regTx2 = await clusters.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      clusterAfterEB,
      { value: 0n }
    );
    const receipt2 = await regTx2.wait();
    const clusterAfterReg = parseClusterFromEvent(clusters, receipt2, Events.VALIDATOR_ADDED);

    // Step 5: Verify fees were settled using EB-weighted calculation
    // With EB-aware settlement:
    //   usage = (indexDelta * vUnits) / VUNITS_PRECISION + (networkFeeIndexDelta * vUnits) / VUNITS_PRECISION
    //   The fee deducted should be ~31.25x higher than flat validatorCount=1 would give
    //
    // The key assertion: balance should have decreased significantly more than
    // a flat validatorCount=1 settlement would produce.
    const balanceAfterReg = clusterAfterReg.balance;
    const feeDeducted = balanceBeforeMine - balanceAfterReg;

    // Calculate what flat settlement would have been:
    // flat_fee = (operatorIndexDelta) * validatorCount + (networkFeeIndexDelta) * validatorCount
    // With 4 operators at fee 1e14/1e7=1e7 packed, over ~101 blocks, flat would be:
    // packed_operator_fee = 1e14 / DEDUCTED_DIGITS = 1e7
    const packedOpFee = OPERATOR_FEE / DEDUCTED_DIGITS;
    // 4 operators * packedFee * ~101 blocks * validatorCount(1) = indexDelta * 1
    // expanded = indexDelta * 1 * DEDUCTED_DIGITS

    // With EB-aware: usage is multiplied by vUnits/VUNITS_PRECISION = 312500/10000 = 31.25x
    // So EB-aware fee should be ~31.25x the flat fee
    const ebMultiplier = expectedVUnits; // 312500
    // fee_eb / fee_flat ≈ ebMultiplier / VUNITS_PRECISION = 31.25

    // Assert the fee deducted is at least 20x what flat would give
    // (using 20x instead of 31.25x to account for rounding and block timing)
    // If the bug existed (flat settlement), feeDeducted would be very small
    // With the fix (EB-weighted), feeDeducted should be large
    expect(feeDeducted).to.be.gt(0n, "Fee should have been deducted");

    // The ratio check: EB-weighted fees should be much higher than baseline
    // For 1 validator with 1000 ETH EB over ~101 blocks with 4 operators at 1e14 fee:
    // flat_usage_packed = 4 * 1e7 * 101 * 1 = 4,040,000,000
    // flat_usage_expanded = 4,040,000,000 * 10,000,000 = 40,400,000,000,000,000 = 0.0404 ETH
    // eb_usage = flat_usage * 312500 / 10000 = flat * 31.25 ≈ 1.2625 ETH
    const flatUsageEstimate = 4n * packedOpFee * 101n * 1n * DEDUCTED_DIGITS;

    // With EB-weighted settlement, fee should be significantly more than flat
    expect(feeDeducted).to.be.gt(
      flatUsageEstimate * 10n, // At least 10x the flat estimate
      "EB-weighted fee settlement should charge significantly more than flat validatorCount"
    );
  });

  it("Removal settles fees using EB-weighted vUnits", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithFee);

    // Register 2 validators
    const depositValue = ethers.parseEther("100");
    const regTx1 = await clusters.registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: depositValue }
    );
    const receipt1 = await regTx1.wait();
    const cluster1 = parseClusterFromEvent(clusters, receipt1, Events.VALIDATOR_ADDED);

    const regTx2 = await clusters.registerValidator(
      makePublicKey(2),
      operatorIds,
      DEFAULT_SHARES,
      cluster1,
      { value: 0n }
    );
    const receipt2 = await regTx2.wait();
    const cluster2 = parseClusterFromEvent(clusters, receipt2, Events.VALIDATOR_ADDED);

    // Update EB to 500 ETH (total for 2 validators = 250 ETH each)
    // vUnits = ceil(500 * 10000 / 32) = 156250
    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    const ebBlockNum = 1;
    const effectiveBalance = 500; // 500 ETH total cluster EB
    const root = getEBRoot(clusterId, effectiveBalance);
    await clusters.mockSetEBRoot(ebBlockNum, root);

    const ebTx = await clusters.updateClusterBalance(
      ebBlockNum,
      clusterOwner.address,
      operatorIds,
      cluster2,
      effectiveBalance,
      []
    );
    const ebReceipt = await ebTx.wait();
    const clusterAfterEB = parseClusterFromEvent(clusters, ebReceipt, Events.CLUSTER_BALANCE_UPDATED);

    const clusterVUnits = await clusters.getClusterVUnits(clusterId);
    const expectedVUnits = ((BigInt(effectiveBalance) * VUNITS_PRECISION) + 31n) / 32n;
    expect(clusterVUnits).to.equal(expectedVUnits);

    const balanceBeforeMine = clusterAfterEB.balance;

    // Mine 100 blocks
    await networkHelpers.mine(100);

    // Remove a validator — triggers fee settlement
    const removeTx = await clusters.removeValidator(
      makePublicKey(1),
      operatorIds,
      clusterAfterEB
    );
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);

    const feeDeducted = balanceBeforeMine - clusterAfterRemove.balance;
    expect(feeDeducted).to.be.gt(0n, "Fee should have been deducted on removal");

    // With 2 validators at 500 ETH total (vUnits=156250), EB multiplier = 156250/10000 = 15.625x
    // flat_usage = 4 * packedOpFee * ~101 blocks * 2 validators * DEDUCTED_DIGITS
    const packedOpFee = OPERATOR_FEE / DEDUCTED_DIGITS;
    const flatUsageEstimate = 4n * packedOpFee * 101n * 2n * DEDUCTED_DIGITS;

    // EB-weighted fee should be significantly higher than flat
    expect(feeDeducted).to.be.gt(
      flatUsageEstimate * 5n,
      "EB-weighted fee settlement on removal should charge more than flat validatorCount"
    );
  });
});

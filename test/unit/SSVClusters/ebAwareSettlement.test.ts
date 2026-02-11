import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { createCluster, makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_SHARES, VUNITS_PRECISION } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { ethers } from "ethers";

// ETH_DEDUCTED_DIGITS from SSVPackedLib.sol — ETH fees are packed with 1e5 precision
const ETH_DEDUCTED_DIGITS = 100_000n;

// Operator fee: 1e10 wei/block (packed = 1e10 / 1e5 = 1e5)
// Must be divisible by ETH_DEDUCTED_DIGITS
const OPERATOR_FEE = 10_000_000_000n; // 1e10 wei/block

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
    const effectiveBalance = 1000;
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

    // Verify vUnits are set
    const clusterVUnits = await clusters.getClusterVUnits(clusterId);
    const expectedVUnits = ((BigInt(effectiveBalance) * VUNITS_PRECISION) + 31n) / 32n;
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
    const balanceAfterReg = clusterAfterReg.balance;
    const feeDeducted = balanceBeforeMine - balanceAfterReg;

    // Calculate what flat (non-EB) settlement would have been:
    // packed_op_fee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS = 1e5
    // flat_usage_packed = 4 operators * 1e5 * ~101 blocks * 1 validator = 40,400,000
    // flat_usage_expanded = 40,400,000 * 100,000 = 4,040,000,000,000 = ~4e12 wei
    const packedOpFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
    const flatUsageExpanded = 4n * packedOpFee * 101n * 1n * ETH_DEDUCTED_DIGITS;

    // With EB-weighted: multiplied by vUnits/VUNITS_PRECISION = 312500/10000 = 31.25x
    // So EB-aware fee should be ~31.25x the flat fee
    expect(feeDeducted).to.be.gt(0n, "Fee should have been deducted");
    expect(feeDeducted).to.be.gt(
      flatUsageExpanded * 10n,
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

    // Update EB to 500 ETH total for cluster (250 ETH per validator)
    const clusterId = getClusterId(clusterOwner.address, operatorIds);
    const ebBlockNum = 1;
    const effectiveBalance = 500;
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

    // flat_usage = 4 * packedOpFee * ~101 blocks * 2 validators * ETH_DEDUCTED_DIGITS
    const packedOpFee = OPERATOR_FEE / ETH_DEDUCTED_DIGITS;
    const flatUsageExpanded = 4n * packedOpFee * 101n * 2n * ETH_DEDUCTED_DIGITS;

    // EB-weighted should be significantly higher (vUnits/VUNITS_PRECISION = 156250/10000 ≈ 15.6x)
    expect(feeDeducted).to.be.gt(
      flatUsageExpanded * 5n,
      "EB-weighted fee settlement on removal should charge more than flat validatorCount"
    );
  });
});

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ethers } from "ethers";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { Cluster, NetworkHelpersType } from "../../common/types.ts";
import { createCluster, makePublicKeys, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEDUCTED_DIGITS } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";

type Snapshot = {
  block: bigint;
  index: bigint;
};

describe("SSVClusters legacy SSV accounting", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner] = await connection.ethers.getSigners();
  });

  const deployLegacySSVFixture = async (operatorFeeRaw: bigint, networkFeeRaw: bigint) => {
    const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection);
    const operatorFeeUnpacked = operatorFeeRaw * DEDUCTED_DIGITS;

    for (const operatorId of operatorIds) {
      await clusters.mockOperatorSSVFee(operatorId, operatorFeeUnpacked);
    }

    await clusters.mockSSVNetworkFee(networkFeeRaw);
    const networkFeeIndexTx = await clusters.mockCurrentNetworkFeeIndexSSV(0n);
    const networkFeeIndexReceipt = await networkFeeIndexTx.wait();

    return {
      clusters,
      operatorIds,
      networkFeeIndexBlock: BigInt(networkFeeIndexReceipt!.blockNumber),
    };
  };

  const deployOperatorFeeFixture = async () => deployLegacySSVFixture(2_000n, 0n);
  const deployNetworkFeeFixture = async () => deployLegacySSVFixture(0n, 75n);

  const createLegacySSVCluster = (overrides: Partial<Cluster> = {}): Cluster =>
    createCluster({
      validatorCount: 2n,
      index: 0n,
      networkFeeIndex: 0n,
      balance: ethers.parseEther("100"),
      ...overrides,
    });

  const captureSnapshots = async (clusters: any, operatorIds: bigint[]): Promise<Snapshot[]> =>
    Promise.all(
      operatorIds.map(async (operatorId) => {
        const [index, blockNumber] = await clusters.getOperatorSnapshot(operatorId);
        return {
          block: BigInt(blockNumber),
          index: BigInt(index),
        };
      })
    );

  const calculateClusterIndex = (snapshots: Snapshot[], currentBlock: bigint, operatorFeeRaw: bigint): bigint =>
    snapshots.reduce(
      (sum, snapshot) => sum + snapshot.index + (currentBlock - snapshot.block) * operatorFeeRaw,
      0n
    );

  const calculateNetworkFeeIndex = (
    currentBlock: bigint,
    feeIndexBlock: bigint,
    networkFeeRaw: bigint
  ): bigint => (currentBlock - feeIndexBlock) * networkFeeRaw;

  const calculateSettledFees = (
    cluster: Cluster,
    currentClusterIndex: bigint,
    currentNetworkFeeIndex: bigint
  ): bigint =>
    (
      (currentClusterIndex - cluster.index) * BigInt(cluster.validatorCount) +
      (currentNetworkFeeIndex - cluster.networkFeeIndex) * BigInt(cluster.validatorCount)
    ) * DEDUCTED_DIGITS;

  it("removeValidator settles accrued legacy SSV operator fees before decrementing validator count", async function () {
    const operatorFeeRaw = 2_000n;
    const { clusters, operatorIds, networkFeeIndexBlock } =
      await networkHelpers.loadFixture(deployOperatorFeeFixture);

    const [publicKey1, publicKey2] = makePublicKeys(2);
    const cluster = createLegacySSVCluster({ validatorCount: 2n });

    await clusters.mockRegisterSSVValidator(publicKey1, operatorIds, clusterOwner.address, cluster);
    await clusters.mockRegisterSSVValidator(publicKey2, operatorIds, clusterOwner.address, cluster);

    const snapshots = await captureSnapshots(clusters, operatorIds);

    await networkHelpers.mine(25);

    const removeTx = await clusters.connect(clusterOwner).removeValidator(publicKey1, operatorIds, cluster);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);
    const removeBlock = BigInt(removeReceipt!.blockNumber);

    const expectedClusterIndex = calculateClusterIndex(snapshots, removeBlock, operatorFeeRaw);
    const expectedNetworkFeeIndex = calculateNetworkFeeIndex(removeBlock, networkFeeIndexBlock, 0n);
    const expectedFees = calculateSettledFees(cluster, expectedClusterIndex, expectedNetworkFeeIndex);

    expect(clusterAfterRemove.validatorCount).to.equal(1n);
    expect(clusterAfterRemove.index).to.equal(expectedClusterIndex);
    expect(clusterAfterRemove.networkFeeIndex).to.equal(expectedNetworkFeeIndex);
    expect(clusterAfterRemove.balance).to.equal(cluster.balance - expectedFees);
    expect(expectedFees).to.equal(expectedClusterIndex * BigInt(cluster.validatorCount) * DEDUCTED_DIGITS);
    expect(expectedFees % DEDUCTED_DIGITS).to.equal(0n);
  });

  it("removeValidator settles legacy SSV fees identically when a pending ETH fee change request exists", async function () {
    const operatorFeeRaw = 2_000n;
    const { clusters, operatorIds, networkFeeIndexBlock } =
      await networkHelpers.loadFixture(deployOperatorFeeFixture);

    const [publicKey1, publicKey2] = makePublicKeys(2, 21);
    const cluster = createLegacySSVCluster({ validatorCount: 2n });

    await clusters.mockRegisterSSVValidator(publicKey1, operatorIds, clusterOwner.address, cluster);
    await clusters.mockRegisterSSVValidator(publicKey2, operatorIds, clusterOwner.address, cluster);

    // Inject a pending ETH fee change request on each operator (declared, within approval window)
    const now = BigInt(await networkHelpers.time.latest());
    for (const operatorId of operatorIds) {
      await clusters.mockSetOperatorFeeChangeRequest(
        operatorId,
        99_999n, // large pending ETH fee — must NOT affect SSV settlement
        now + 1n, // approvalBeginTime (in the future, so pending)
        now + 86400n, // approvalEndTime
      );
    }

    const snapshots = await captureSnapshots(clusters, operatorIds);

    await networkHelpers.mine(30);

    const removeTx = await clusters.connect(clusterOwner).removeValidator(publicKey1, operatorIds, cluster);
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);
    const removeBlock = BigInt(removeReceipt!.blockNumber);

    // Expected values use only the SSV fee — identical formula to the operator-fee-only test
    const expectedClusterIndex = calculateClusterIndex(snapshots, removeBlock, operatorFeeRaw);
    const expectedNetworkFeeIndex = calculateNetworkFeeIndex(removeBlock, networkFeeIndexBlock, 0n);
    const expectedFees = calculateSettledFees(cluster, expectedClusterIndex, expectedNetworkFeeIndex);

    expect(clusterAfterRemove.validatorCount).to.equal(1n);
    expect(clusterAfterRemove.index).to.equal(expectedClusterIndex);
    expect(clusterAfterRemove.networkFeeIndex).to.equal(expectedNetworkFeeIndex);
    expect(clusterAfterRemove.balance).to.equal(cluster.balance - expectedFees);
    // The pending ETH fee (99_999) had zero effect — fees match the SSV-only formula exactly
    expect(expectedFees).to.equal(expectedClusterIndex * BigInt(cluster.validatorCount) * DEDUCTED_DIGITS);
  });

  it("bulkRemoveValidator settles legacy SSV network fees on active clusters", async function () {
    const networkFeeRaw = 75n;
    const { clusters, operatorIds, networkFeeIndexBlock } =
      await networkHelpers.loadFixture(deployNetworkFeeFixture);

    const publicKeys = makePublicKeys(3, 11);
    const cluster = createLegacySSVCluster({
      validatorCount: 3n,
      balance: ethers.parseEther("60"),
    });

    for (const publicKey of publicKeys) {
      await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, cluster);
    }

    const snapshots = await captureSnapshots(clusters, operatorIds);

    await networkHelpers.mine(40);

    const removeTx = await clusters.connect(clusterOwner).bulkRemoveValidator(
      [publicKeys[0], publicKeys[1]],
      operatorIds,
      cluster
    );
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);
    const removeBlock = BigInt(removeReceipt!.blockNumber);

    const expectedClusterIndex = calculateClusterIndex(snapshots, removeBlock, 0n);
    const expectedNetworkFeeIndex = calculateNetworkFeeIndex(removeBlock, networkFeeIndexBlock, networkFeeRaw);
    const expectedFees = calculateSettledFees(cluster, expectedClusterIndex, expectedNetworkFeeIndex);

    expect(expectedClusterIndex).to.equal(0n);
    expect(clusterAfterRemove.validatorCount).to.equal(1n);
    expect(clusterAfterRemove.index).to.equal(0n);
    expect(clusterAfterRemove.networkFeeIndex).to.equal(expectedNetworkFeeIndex);
    expect(clusterAfterRemove.balance).to.equal(cluster.balance - expectedFees);
    expect(expectedFees).to.equal(expectedNetworkFeeIndex * BigInt(cluster.validatorCount) * DEDUCTED_DIGITS);
  });
});

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { createCluster, makePublicKey, parseClusterFromEvent } from "../../common/helpers.ts";
import { DEFAULT_SHARES, DEDUCTED_DIGITS, ETH_DEDUCTED_DIGITS } from "../../common/constants.ts";
import { Events } from "../../common/events.ts";

const ETH_OPERATOR_FEE = 10_000_000_000n;
const SSV_OPERATOR_FEE = DEDUCTED_DIGITS;

describe("Removed operator impact on active cluster accounting", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner] = await connection.ethers.getSigners();
  });

  const deployClustersWithEthFee = async () => {
    return ssvClustersHarnessFixture(connection, 4, ETH_OPERATOR_FEE);
  };

  const deployClusters = async () => {
    return ssvClustersHarnessFixture(connection, 4);
  };

  it("excludes removed operator fees from ETH cluster settlement and freezes removed operator ETH earnings", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClustersWithEthFee);

    await clusters.mockEthNetworkFee(0);

    const registerTx = await clusters.connect(clusterOwner).registerValidator(
      makePublicKey(1),
      operatorIds,
      DEFAULT_SHARES,
      createCluster(),
      { value: connection.ethers.parseEther("100") }
    );
    const registerReceipt = await registerTx.wait();
    const clusterAfterRegister = parseClusterFromEvent(clusters, registerReceipt, Events.VALIDATOR_ADDED);

    const removedOperatorId = operatorIds[2];
    await clusters.mockRemoveOperator(removedOperatorId);

    const activeOperatorIds = operatorIds.filter((id) => id !== removedOperatorId);

    const ethSnapshotsBefore = new Map<bigint, { blockNumber: bigint; balance: bigint }>();
    for (const operatorId of operatorIds) {
      const [, blockNumber, balance] = await clusters.getOperatorEthSnapshot(operatorId);
      ethSnapshotsBefore.set(operatorId, {
        blockNumber: BigInt(blockNumber),
        balance: BigInt(balance),
      });
    }

    await networkHelpers.mine(50);

    const removeTx = await clusters.connect(clusterOwner).removeValidator(
      makePublicKey(1),
      operatorIds,
      clusterAfterRegister
    );
    const removeReceipt = await removeTx.wait();
    const clusterAfterRemove = parseClusterFromEvent(clusters, removeReceipt, Events.VALIDATOR_REMOVED);

    const receiptBlock = BigInt(removeReceipt!.blockNumber);
    const packedEthFee = ETH_OPERATOR_FEE / ETH_DEDUCTED_DIGITS;

    let totalOperatorFeeRaw = 0n;
    for (const operatorId of activeOperatorIds) {
      const before = ethSnapshotsBefore.get(operatorId)!;
      const [, blockAfter, balanceAfter] = await clusters.getOperatorEthSnapshot(operatorId);

      const expectedDeltaRaw = packedEthFee * (receiptBlock - before.blockNumber);
      const actualDeltaRaw = BigInt(balanceAfter) - before.balance;

      expect(actualDeltaRaw).to.equal(expectedDeltaRaw);
      expect(BigInt(blockAfter)).to.equal(receiptBlock);

      totalOperatorFeeRaw += expectedDeltaRaw;
    }

    const removedBefore = ethSnapshotsBefore.get(removedOperatorId)!;
    const [, removedBlockAfter, removedBalanceAfter] = await clusters.getOperatorEthSnapshot(removedOperatorId);
    expect(BigInt(removedBlockAfter)).to.equal(removedBefore.blockNumber);
    expect(BigInt(removedBalanceAfter)).to.equal(removedBefore.balance);
    expect(BigInt(removedBalanceAfter)).to.equal(0n);

    const expectedClusterFeeDeduction = totalOperatorFeeRaw * ETH_DEDUCTED_DIGITS;
    expect(clusterAfterRegister.balance - clusterAfterRemove.balance).to.equal(expectedClusterFeeDeduction);
    expect(clusterAfterRemove.validatorCount).to.equal(0n);
  });

  it("freezes removed operator SSV earnings while active operators continue earning on SSV cluster settlement", async function () {
    const { clusters, operatorIds } = await networkHelpers.loadFixture(deployClusters);

    await clusters.mockSSVNetworkFee(0);
    await clusters.mockCurrentNetworkFeeIndexSSV(0);

    const ssvCluster = createCluster({
      validatorCount: 1n,
      balance: 0n,
    });

    await clusters.mockRegisterSSVValidator(
      makePublicKey(100),
      operatorIds,
      clusterOwner.address,
      ssvCluster
    );

    for (const operatorId of operatorIds) {
      await clusters.mockOperatorSSVFee(operatorId, SSV_OPERATOR_FEE);
    }

    const removedOperatorId = operatorIds[1];
    await clusters.mockRemoveOperator(removedOperatorId);

    const ssvSnapshotsBefore = new Map<bigint, { blockNumber: bigint; balance: bigint }>();
    for (const operatorId of operatorIds) {
      const [, blockNumber, balance] = await clusters.getOperatorSnapshot(operatorId);
      ssvSnapshotsBefore.set(operatorId, {
        blockNumber: BigInt(blockNumber),
        balance: BigInt(balance),
      });
    }

    await networkHelpers.mine(30);

    const liquidateTx = await clusters.connect(clusterOwner).liquidateSSV(
      clusterOwner.address,
      operatorIds,
      ssvCluster
    );
    const liquidateReceipt = await liquidateTx.wait();
    const receiptBlock = BigInt(liquidateReceipt!.blockNumber);
    const packedSsvFee = SSV_OPERATOR_FEE / DEDUCTED_DIGITS;

    const activeOperatorIds = operatorIds.filter((id) => id !== removedOperatorId);
    for (const operatorId of activeOperatorIds) {
      const before = ssvSnapshotsBefore.get(operatorId)!;
      const [, blockAfter, balanceAfter] = await clusters.getOperatorSnapshot(operatorId);

      const expectedDeltaRaw = packedSsvFee * (receiptBlock - before.blockNumber);
      const actualDeltaRaw = BigInt(balanceAfter) - before.balance;

      expect(actualDeltaRaw).to.equal(expectedDeltaRaw);
      expect(actualDeltaRaw).to.be.greaterThan(0n);
      expect(BigInt(blockAfter)).to.equal(receiptBlock);
    }

    const removedBefore = ssvSnapshotsBefore.get(removedOperatorId)!;
    const [, removedBlockAfter, removedBalanceAfter] = await clusters.getOperatorSnapshot(removedOperatorId);
    expect(BigInt(removedBlockAfter)).to.equal(removedBefore.blockNumber);
    expect(BigInt(removedBalanceAfter)).to.equal(removedBefore.balance);
    expect(BigInt(removedBalanceAfter)).to.equal(0n);
  });
});

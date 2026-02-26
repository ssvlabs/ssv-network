import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType, Cluster } from "../../common/types.ts";
import {
  makePublicKey,
  parseClusterFromEvent,
} from "../../common/helpers.ts";
import {
  DEDUCTED_DIGITS,
  ETH_DEDUCTED_DIGITS,
  VUNITS_PRECISION,
  MINIMAL_OPERATOR_ETH_FEE,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import {
  mineBlocks,
  defaultVUnits,
  calcSSVClusterFees,
} from "../helpers/index.ts";
import { ethers } from "ethers";

describe("Full End-to-End — SSV Cluster Creation → Fee Accrual → Migration → ETH Fee Accrual → Withdraw → Verify All Balances", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner] = await connection.ethers.getSigners();
  });


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
    const result = await ssvClustersHarnessFixture(connection, 4, MINIMAL_OPERATOR_ETH_FEE);
    const { clusters, operatorIds } = result;

    for (const opId of operatorIds) {
      await clusters.mockOperatorSSVFee(opId, 1_000n * DEDUCTED_DIGITS);
    }
    await clusters.mockSSVNetworkFee(500n);
    const netFeeIndexTx = await clusters.mockCurrentNetworkFeeIndexSSV(0n);
    const netFeeIndexReceipt = await netFeeIndexTx.wait();
    const netFeeBlock = netFeeIndexReceipt!.blockNumber;

    await clusters.mockEthNetworkFee(5_000n);
    await clusters.mockMinimumBlocksBeforeLiquidation(10n);
    await clusters.mockMinimumLiquidationCollateral(0n);

    const mockToken = await connection.ethers.deployContract("MockToken", []);
    await mockToken.waitForDeployment();
    await clusters.mockSetToken(await mockToken.getAddress());
    const harnessAddress = await clusters.getAddress();
    await mockToken.mint(harnessAddress, ethers.parseEther("5000"));

    return { clusters, operatorIds, mockToken, netFeeBlock };
  };

  it("Verifies complete economic correctness across full lifecycle", async function () {
    const { clusters, operatorIds, mockToken, netFeeBlock } =
      await networkHelpers.loadFixture(deployFixture);
    const provider = connection.ethers.provider;

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

    const opSnapshots: { block: bigint; index: bigint }[] = [];
    for (const opId of operatorIds) {
      const [index, blockNumber] = await clusters.getOperatorSnapshot(opId);
      opSnapshots.push({ block: BigInt(blockNumber), index: BigInt(index) });
    }

    await mineBlocks(provider, 500);

    const ownerSSVBefore = await mockToken.balanceOf(clusterOwner.address);

    const ethDeposit = ethers.parseEther("10");
    const migrateTx = await clusters.connect(clusterOwner).migrateClusterToETH(
      operatorIds,
      ssvCluster,
      { value: ethDeposit },
    );
    const migrateReceipt = await migrateTx.wait();
    const migrationBlock = migrateReceipt!.blockNumber;

    const migrateEventArgs = getMigratedEventArgs(clusters, migrateReceipt);
    const actualSSVRefund = BigInt(migrateEventArgs.ssvRefunded);

    const ownerSSVAfter = await mockToken.balanceOf(clusterOwner.address);
    const tokenRefund = BigInt(ownerSSVAfter) - BigInt(ownerSSVBefore);
    expect(tokenRefund).to.equal(actualSSVRefund);

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

    const expectedRefund = ssvBalance - expectedSSVFees;
    expect(actualSSVRefund).to.equal(expectedRefund);
    expect(actualSSVRefund).to.be.lessThan(ssvBalance);

    const totalSSVFees = ssvBalance - actualSSVRefund;
    expect(totalSSVFees).to.equal(expectedSSVFees);
    expect(totalSSVFees % DEDUCTED_DIGITS).to.equal(0n);

    const migratedCluster = parseClusterFromEvent(
      clusters,
      migrateReceipt,
      Events.CLUSTER_MIGRATED_TO_ETH,
    );
    expect(BigInt(migratedCluster.balance)).to.equal(ethDeposit);
    expect(migratedCluster.active).to.equal(true);
    expect(BigInt(migratedCluster.validatorCount)).to.equal(2n);

    const opEthSnapshots: { block: number; index: bigint }[] = [];
    for (const opId of operatorIds) {
      const [index, blockNumber] = await clusters.getOperatorEthSnapshot(opId);
      opEthSnapshots.push({ block: Number(blockNumber), index: BigInt(index) });
    }

    await mineBlocks(provider, 200);

    const withdrawAmount = ethers.parseEther("1");
    const withdrawTx = await clusters.connect(clusterOwner).withdraw(
      operatorIds,
      withdrawAmount,
      migratedCluster,
    );
    const withdrawReceipt = await withdrawTx.wait();
    const withdrawBlock = withdrawReceipt!.blockNumber;

    const clusterAfterWithdraw = parseClusterFromEvent(
      clusters,
      withdrawReceipt,
      Events.CLUSTER_WITHDRAWN,
    );

    const ethFeePerOp = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;

    let cumulativeClusterIndex = 0n;
    for (const snap of opEthSnapshots) {
      const blockDiff = BigInt(withdrawBlock - snap.block);
      const currentIndex = snap.index + blockDiff * ethFeePerOp;
      cumulativeClusterIndex += currentIndex;
    }

    const opIndexDelta = cumulativeClusterIndex - BigInt(migratedCluster.index);

    const ethBlockDiff = BigInt(withdrawBlock - migrationBlock);
    const ethNetFeeIndexDelta = ethBlockDiff * 5_000n;

    const vUnits = defaultVUnits(2n);

    const opFeeUnits = (opIndexDelta * vUnits) / VUNITS_PRECISION;
    const netFeeUnits = (ethNetFeeIndexDelta * vUnits) / VUNITS_PRECISION;
    const totalETHFees = (opFeeUnits + netFeeUnits) * ETH_DEDUCTED_DIGITS;

    const expectedBalanceAfterWithdraw = ethDeposit - totalETHFees - withdrawAmount;

    expect(BigInt(clusterAfterWithdraw.balance)).to.equal(expectedBalanceAfterWithdraw);

    expect(actualSSVRefund + totalSSVFees).to.equal(ssvBalance);

    for (const opId of operatorIds) {
      const [index, blockNumber] = await clusters.getOperatorEthSnapshot(opId);
      expect(Number(blockNumber)).to.equal(migrationBlock);
    }
  });
});

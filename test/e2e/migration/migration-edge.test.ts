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
  MINIMAL_OPERATOR_ETH_FEE,
  NETWORK_FEE_ETH,
  ETH_DEDUCTED_DIGITS, DEFAULT_ETH_REGISTER_VALUE,
} from '../../common/constants.ts';
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";
import {
  mineBlocks,
  calcLiquidationThreshold,
  defaultVUnits,
  calcSSVClusterFees,
} from "../helpers/index.ts";
import { ethers } from "ethers";

describe("Migration Edge Cases", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let clusterOwner: HardhatEthersSigner;
  let clusterOwnerB: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner, clusterOwnerB] = await connection.ethers.getSigners();
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


  describe("Migration — SSV Refund Is Exactly Correct After Extended Fee Accrual", () => {
    const deployFixture = async () => {
      const result = await ssvClustersHarnessFixture(connection, 4, 0n);
      const { clusters, operatorIds } = result;

      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, 1_500n * DEDUCTED_DIGITS);
      }

      await clusters.mockSSVNetworkFee(800n);
      const netFeeIndexTx = await clusters.mockCurrentNetworkFeeIndexSSV(0n);
      const netFeeIndexReceipt = await netFeeIndexTx.wait();
      const netFeeBlock = netFeeIndexReceipt!.blockNumber;

      await clusters.mockEthNetworkFee(BigInt(NETWORK_FEE_ETH));
      await clusters.mockMinimumBlocksBeforeLiquidation(10n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      await clusters.mockSetToken(await mockToken.getAddress());
      const harnessAddress = await clusters.getAddress();
      await mockToken.mint(harnessAddress, ethers.parseEther("2000"));

      return { clusters, operatorIds, mockToken, netFeeBlock };
    };

    it("SSV refund matches independent fee calculation after 1000 blocks", async function () {
      const { clusters, operatorIds, mockToken, netFeeBlock } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const ssvBalance = ethers.parseEther("500");
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

      await mineBlocks(provider, 1000);

      const ownerSSVBefore = await mockToken.balanceOf(clusterOwner.address);

      const ethDeposit = ethers.parseEther("10");
      const migrateTx = await clusters.connect(clusterOwner).migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: ethDeposit },
      );
      const receipt = await migrateTx.wait();
      const migrationBlock = BigInt(receipt!.blockNumber);

      const expectedFees = calcSSVClusterFees({
        currentBlock: migrationBlock,
        opSnapshots,
        opFeeRaw: 1_500n,
        netFeeBlock: BigInt(netFeeBlock),
        netFeeRaw: 800n,
        storedNetFeeIndex: 0n,
        validatorCount: 2n,
        clusterIndex: 0n,
        clusterNetworkFeeIndex: 0n,
      });

      const eventArgs = getMigratedEventArgs(clusters, receipt);
      const actualRefund = BigInt(eventArgs.ssvRefunded);

      const ownerSSVAfter = await mockToken.balanceOf(clusterOwner.address);
      const tokenRefund = BigInt(ownerSSVAfter) - BigInt(ownerSSVBefore);
      expect(tokenRefund).to.equal(actualRefund);

      const expectedRefund = ssvBalance - expectedFees;
      expect(actualRefund).to.equal(expectedRefund);
      expect(actualRefund).to.be.lessThan(ssvBalance);

      const totalFees = ssvBalance - actualRefund;
      expect(totalFees).to.equal(expectedFees);
      expect(totalFees % DEDUCTED_DIGITS).to.equal(0n);
    });
  });

  describe("Migration of Cluster Where Some Operators Were Removed", () => {
    const deployFixture = async () => {
      const result = await ssvClustersHarnessFixture(connection, 4, 0n);
      const { clusters, operatorIds } = result;

      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, 1_000n * DEDUCTED_DIGITS);
      }
      await clusters.mockSSVNetworkFee(500n);
      await clusters.mockCurrentNetworkFeeIndexSSV(0n);

      await clusters.mockEthNetworkFee(BigInt(NETWORK_FEE_ETH));
      await clusters.mockMinimumBlocksBeforeLiquidation(10n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      await clusters.mockSetToken(await mockToken.getAddress());
      const harnessAddress = await clusters.getAddress();
      await mockToken.mint(harnessAddress, ethers.parseEther("2000"));

      return { clusters, operatorIds, mockToken };
    };

    it("Migration succeeds when Op1 is removed — removed operator is skipped", async function () {
      const { clusters, operatorIds, mockToken } =
        await networkHelpers.loadFixture(deployFixture);

      const ssvCluster: Cluster = {
        validatorCount: 1n,
        networkFeeIndex: 0n,
        index: 0n,
        balance: ethers.parseEther("10"),
        active: true,
      };

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1),
        operatorIds,
        clusterOwner.address,
        ssvCluster,
      );

      await clusters.mockRemoveOperator(operatorIds[0]);

      const ethDeposit = ethers.parseEther("10");
      const migrateTx = await clusters.connect(clusterOwner).migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: ethDeposit },
      );
      const receipt = await migrateTx.wait();

      await expect(migrateTx).to.emit(clusters, Events.CLUSTER_MIGRATED_TO_ETH);

      const op1EthVCount = await clusters.getOperatorEthValidatorCount(operatorIds[0]);
      expect(op1EthVCount).to.equal(0n);

      for (let i = 1; i < operatorIds.length; i++) {
        const ethVCount = await clusters.getOperatorEthValidatorCount(operatorIds[i]);
        expect(ethVCount).to.equal(1n);
      }
    });
  });

  describe("DAO Earnings Settlement During Migration", () => {
    const deployFixture = async () => {
      const result = await ssvClustersHarnessFixture(connection, 4, 0n);
      const { clusters, operatorIds } = result;

      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, 1_000n * DEDUCTED_DIGITS);
      }
      await clusters.mockSSVNetworkFee(500n);
      await clusters.mockCurrentNetworkFeeIndexSSV(0n);

      await clusters.mockEthNetworkFee(BigInt(NETWORK_FEE_ETH));
      await clusters.mockMinimumBlocksBeforeLiquidation(10n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      await clusters.mockSetToken(await mockToken.getAddress());
      const harnessAddress = await clusters.getAddress();
      await mockToken.mint(harnessAddress, ethers.parseEther("2000"));

      return { clusters, operatorIds, mockToken };
    };

    it("DAO earnings for both SSV and ETH are settled during migration", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const ssvCluster: Cluster = {
        validatorCount: 2n,
        networkFeeIndex: 0n,
        index: 0n,
        balance: ethers.parseEther("100"),
        active: true,
      };

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1),
        operatorIds,
        clusterOwner.address,
        ssvCluster,
      );

      await mineBlocks(provider, 100);

      const migrateTx = await clusters.connect(clusterOwner).migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const receipt = await migrateTx.wait();
      const migrationBlock = receipt!.blockNumber;

      const daoEthBlockAfter = await clusters.getDaoEthIndexBlockNumber();
      const daoEthValidatorCount = await clusters.getDaoEthValidatorCount();

      expect(daoEthValidatorCount).to.equal(2n);
      expect(Number(daoEthBlockAfter)).to.equal(migrationBlock);

      await expect(migrateTx).to.emit(clusters, Events.CLUSTER_MIGRATED_TO_ETH);
    });
  });

  describe("Multiple Migrations — Same Operators, Different Clusters", () => {
    const deployFixture = async () => {
      const result = await ssvClustersHarnessFixture(connection, 4, MINIMAL_OPERATOR_ETH_FEE);
      const { clusters, operatorIds } = result;

      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, 1_000n * DEDUCTED_DIGITS);
      }
      await clusters.mockSSVNetworkFee(500n);
      await clusters.mockCurrentNetworkFeeIndexSSV(0n);

      await clusters.mockEthNetworkFee(BigInt(NETWORK_FEE_ETH));
      await clusters.mockMinimumBlocksBeforeLiquidation(10n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      await clusters.mockSetToken(await mockToken.getAddress());
      const harnessAddress = await clusters.getAddress();
      await mockToken.mint(harnessAddress, ethers.parseEther("5000"));

      return { clusters, operatorIds, mockToken };
    };

    it("Two clusters with same operators migrate correctly without index corruption", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const clusterA: Cluster = {
        validatorCount: 2n,
        networkFeeIndex: 0n,
        index: 0n,
        balance: ethers.parseEther("50"),
        active: true,
      };
      await clusters.mockRegisterSSVValidator(
        makePublicKey(1),
        operatorIds,
        clusterOwner.address,
        clusterA,
      );

      const clusterB: Cluster = {
        validatorCount: 1n,
        networkFeeIndex: 0n,
        index: 0n,
        balance: ethers.parseEther("30"),
        active: true,
      };
      await clusters.mockRegisterSSVValidator(
        makePublicKey(2),
        operatorIds,
        clusterOwnerB.address,
        clusterB,
      );

      await mineBlocks(provider, 100);

      const ethDeposit1 = ethers.parseEther("5");
      const migrateTx1 = await clusters.connect(clusterOwner).migrateClusterToETH(
        operatorIds,
        clusterA,
        { value: ethDeposit1 },
      );
      await migrateTx1.wait();

      for (const opId of operatorIds) {
        const ethVCount = await clusters.getOperatorEthValidatorCount(opId);
        expect(ethVCount).to.equal(2n);
      }

      const opEthSnapshotsAfterMig1: { block: bigint; index: bigint }[] = [];
      for (const opId of operatorIds) {
        const [index, blockNumber] = await clusters.getOperatorEthSnapshot(opId);
        opEthSnapshotsAfterMig1.push({ block: BigInt(blockNumber), index: BigInt(index) });
      }

      await mineBlocks(provider, 100);

      const ethDeposit2 = ethers.parseEther("3");
      const migrateTx2 = await clusters.connect(clusterOwnerB).migrateClusterToETH(
        operatorIds,
        clusterB,
        { value: ethDeposit2 },
      );
      const receipt2 = await migrateTx2.wait();
      const migration2Block = BigInt(receipt2!.blockNumber);

      for (const opId of operatorIds) {
        const ethVCount = await clusters.getOperatorEthValidatorCount(opId);
        expect(ethVCount).to.equal(3n);
      }

      const clusterBAfter = parseClusterFromEvent(clusters, receipt2, Events.CLUSTER_MIGRATED_TO_ETH);

      const ethFeePerOp = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
      let expectedClusterBIndex = 0n;
      for (const snap of opEthSnapshotsAfterMig1) {
        const blockDiff = migration2Block - snap.block;
        const currentIndex = snap.index + blockDiff * ethFeePerOp;
        expectedClusterBIndex += currentIndex;
      }
      expect(BigInt(clusterBAfter.index)).to.equal(expectedClusterBIndex);

      const clusterIdA = getClusterId(clusterOwner.address, operatorIds);
      const clusterIdB = getClusterId(clusterOwnerB.address, operatorIds);
      const hashA = await clusters.getClusterHash(clusterIdA);
      const hashB = await clusters.getClusterHash(clusterIdB);
      expect(hashA).to.not.equal(ethers.ZeroHash);
      expect(hashB).to.not.equal(ethers.ZeroHash);
    });
  });

  describe("Revert — Migrate With Insufficient ETH For Liquidation Check", () => {
    const deployFixture = async () => {
      const result = await ssvClustersHarnessFixture(connection, 4, MINIMAL_OPERATOR_ETH_FEE);
      const { clusters, operatorIds } = result;
      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, 1_000n * DEDUCTED_DIGITS);
      }
      await clusters.mockSSVNetworkFee(500n);
      await clusters.mockCurrentNetworkFeeIndexSSV(0n);

      await clusters.mockEthNetworkFee(5_000n);
      await clusters.mockMinimumBlocksBeforeLiquidation(100n);
      await clusters.mockMinimumLiquidationCollateral(0n);

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      await clusters.mockSetToken(await mockToken.getAddress());
      const harnessAddress = await clusters.getAddress();
      await mockToken.mint(harnessAddress, ethers.parseEther("2000"));

      return { clusters, operatorIds, mockToken };
    };

    it("Reverts when ETH deposit is below liquidation threshold", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);

      const ssvCluster: Cluster = {
        validatorCount: 2n,
        networkFeeIndex: 0n,
        index: 0n,
        balance: ethers.parseEther("10"),
        active: true,
      };

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1),
        operatorIds,
        clusterOwner.address,
        ssvCluster,
      );

      const threshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: 100n,
        numOperators: 4n,
        ethFee: 17_700n,
        networkFee: 5_000n,
        effectiveVUnits: defaultVUnits(2n),
      });

      const migrateTx = await clusters.connect(clusterOwner).migrateClusterToETH(
        operatorIds,
        ssvCluster,
        { value: threshold },
      );
      await migrateTx.wait();
      await expect(migrateTx).to.emit(clusters, Events.CLUSTER_MIGRATED_TO_ETH);
    });

    it("Reverts when ETH deposit is 1 wei below threshold", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);

      const ssvCluster: Cluster = {
        validatorCount: 2n,
        networkFeeIndex: 0n,
        index: 0n,
        balance: ethers.parseEther("10"),
        active: true,
      };

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1),
        operatorIds,
        clusterOwner.address,
        ssvCluster,
      );

      const threshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: 100n,
        numOperators: 4n,
        ethFee: 17_700n,
        networkFee: 5_000n,
        effectiveVUnits: defaultVUnits(2n),
      });

      await expect(
        clusters.connect(clusterOwner).migrateClusterToETH(
          operatorIds,
          ssvCluster,
          { value: threshold - 1n },
        ),
      ).to.be.revertedWithCustomError(clusters, Errors.INSUFFICIENT_BALANCE);
    });

    it("Reverts when ETH deposit is 0", async function () {
      const { clusters, operatorIds } =
        await networkHelpers.loadFixture(deployFixture);

      const ssvCluster: Cluster = {
        validatorCount: 2n,
        networkFeeIndex: 0n,
        index: 0n,
        balance: ethers.parseEther("10"),
        active: true,
      };

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1),
        operatorIds,
        clusterOwner.address,
        ssvCluster,
      );

      await expect(
        clusters.connect(clusterOwner).migrateClusterToETH(
          operatorIds,
          ssvCluster,
          { value: 0n },
        ),
      ).to.be.revertedWithCustomError(clusters, Errors.INSUFFICIENT_BALANCE);
    });
  });
});

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvClustersHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  createCluster,
  makePublicKey,
  parseClusterFromEvent,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  DEDUCTED_DIGITS,
  ETH_DEDUCTED_DIGITS,
  VUNITS_PRECISION, DEFAULT_ETH_REGISTER_VALUE,
} from '../../common/constants.ts';
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import {
  mineBlocks,
  defaultVUnits,
} from "../helpers/index.ts";
import { ethers } from "ethers";

const OP_SSV_FEE_UNPACKED = 10_000_000_000n;
const NETWORK_FEE_SSV_RAW = 500n;
const NETWORK_FEE_ETH_RAW = 5_000n;
const MIN_BLOCKS_LIQ = 100n;
const MIN_LIQ_COLLATERAL_RAW = 100_000n;

const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
  return ethers.keccak256(
    ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds]),
  );
};

const getMigratedToETHEventArgs = (contract: any, receipt: any) => {
  for (const log of receipt.logs ?? []) {
    let parsed;
    try { parsed = contract.interface.parseLog(log); } catch { continue; }
    if (parsed?.name === Events.CLUSTER_MIGRATED_TO_ETH) {
      return parsed.args;
    }
  }
  throw new Error("ClusterMigratedToETH event not found");
};

describe("Migration SSV → ETH", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner] = await connection.ethers.getSigners();
  });


  describe("Basic Migration With SSV Refund", () => {
    const deployFixture = async () => {
      const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, 4, 0n);

      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, OP_SSV_FEE_UNPACKED);
      }

      await clusters.mockSSVNetworkFee(NETWORK_FEE_SSV_RAW);
      await clusters.mockEthNetworkFee(NETWORK_FEE_ETH_RAW);
      await clusters.mockMinimumBlocksBeforeLiquidation(MIN_BLOCKS_LIQ);
      await clusters.mockMinimumLiquidationCollateral(MIN_LIQ_COLLATERAL_RAW);
      await clusters.mockMinimumBlocksBeforeLiquidationSSV(MIN_BLOCKS_LIQ);
      await clusters.mockMinimumLiquidationCollateralSSV(MIN_LIQ_COLLATERAL_RAW);

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      const harnessAddr = await clusters.getAddress();
      await mockToken.mint(harnessAddr, connection.ethers.parseEther("10000"));
      await clusters.mockSetToken(await mockToken.getAddress());

      return { clusters, operatorIds, mockToken };
    };

    it("Migrates SSV cluster to ETH with correct SSV refund and ETH deposit", async function () {
      const { clusters, operatorIds, mockToken } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const ssvBalance = 100n * 10n ** 18n;
      const ssvCluster = createCluster({
        validatorCount: 2n,
        balance: ssvBalance,
        active: true,
      });

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1), operatorIds, clusterOwner.address, ssvCluster,
      );

      expect(await clusters.getDaoEthValidatorCount()).to.equal(0);
      await mineBlocks(provider, 100);
      const ownerSSVBefore = await mockToken.balanceOf(clusterOwner.address);

      const opFeeRaw = OP_SSV_FEE_UNPACKED / DEDUCTED_DIGITS; // 1_000
      const currentBlock = await provider.getBlockNumber();
      const migrateBlockPredicted = BigInt(currentBlock + 1);

      let cumulativeIndexSSV = 0n;
      for (const opId of operatorIds) {
        const snap = await clusters.getOperatorSnapshot(opId);
        const storedIndex = BigInt(snap[0]);
        const storedBlock = BigInt(snap[1]);
        cumulativeIndexSSV += storedIndex + (migrateBlockPredicted - storedBlock) * opFeeRaw;
      }

      const liveNFI = await clusters.getCurrentNetworkFeeIndexSSV() + NETWORK_FEE_SSV_RAW;

      const validatorCount = 2n;
      const usagePacked = cumulativeIndexSSV * validatorCount + liveNFI * validatorCount;
      const expectedUsage = usagePacked * DEDUCTED_DIGITS;
      const expectedRefund = ssvBalance - expectedUsage;

      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds, ssvCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const receipt = await migrateTx.wait();
      const migrateBlock = receipt!.blockNumber;
      expect(BigInt(migrateBlock)).to.equal(migrateBlockPredicted);

      const eventArgs = getMigratedToETHEventArgs(clusters, receipt);
      expect(eventArgs.ethDeposited).to.equal(DEFAULT_ETH_REGISTER_VALUE);

      const ownerSSVAfter = await mockToken.balanceOf(clusterOwner.address);
      const ssvRefund = ownerSSVAfter - ownerSSVBefore;
      expect(ssvRefund).to.equal(eventArgs.ssvRefunded);
      expect(ssvRefund).to.equal(expectedRefund);

      const clusterAfter = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(clusterAfter.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);
      expect(clusterAfter.active).to.equal(true);
      expect(clusterAfter.validatorCount).to.equal(2n);

      expect(clusterAfter.index).to.equal(0n);

      for (const opId of operatorIds) {
        expect(await clusters.getOperatorValidatorCount(opId)).to.equal(0);
        expect(await clusters.getOperatorEthValidatorCount(opId)).to.equal(2);
      }

      expect(await clusters.getDaoEthValidatorCount()).to.equal(2);
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(20_000n);

      const clusterId = getClusterId(clusterOwner.address, operatorIds);
      expect(await clusters.getClusterHash(clusterId)).to.not.equal(ethers.ZeroHash);

      expect(eventArgs.effectiveBalance).to.equal(64);

      await expect(migrateTx).to.not.emit(clusters, Events.CLUSTER_REACTIVATED);
    });

    it("Migration with insufficient ETH reverts (edge)", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);

      const ssvCluster = createCluster({
        validatorCount: 2n,
        balance: 100n * 10n ** 18n,
        active: true,
      });

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1), operatorIds, clusterOwner.address, ssvCluster,
      );

      await expect(
        clusters.migrateClusterToETH(operatorIds, ssvCluster, { value: 0n }),
      ).to.be.revertedWithCustomError(clusters, Errors.INSUFFICIENT_BALANCE);
    });
  });

  describe("Migration of Liquidated SSV Cluster", () => {
    const deployFixture = async () => {
      const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, 4, 0n);

      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, OP_SSV_FEE_UNPACKED);
      }

      await clusters.mockSSVNetworkFee(NETWORK_FEE_SSV_RAW);
      await clusters.mockEthNetworkFee(NETWORK_FEE_ETH_RAW);
      await clusters.mockMinimumBlocksBeforeLiquidation(MIN_BLOCKS_LIQ);
      await clusters.mockMinimumLiquidationCollateral(MIN_LIQ_COLLATERAL_RAW);
      await clusters.mockMinimumBlocksBeforeLiquidationSSV(MIN_BLOCKS_LIQ);
      await clusters.mockMinimumLiquidationCollateralSSV(MIN_LIQ_COLLATERAL_RAW);

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      const harnessAddr = await clusters.getAddress();
      await mockToken.mint(harnessAddr, connection.ethers.parseEther("10000"));
      await clusters.mockSetToken(await mockToken.getAddress());

      return { clusters, operatorIds, mockToken };
    };

    it("Migrates liquidated SSV cluster — no SSV refund, emits ClusterReactivated", async function () {
      const { clusters, operatorIds, mockToken } = await networkHelpers.loadFixture(deployFixture);

      const ssvCluster = createCluster({
        validatorCount: 2n,
        balance: 0n,
        active: false,
        index: 0n,
        networkFeeIndex: 0n,
      });

      await clusters.mockRegisterSSVValidator(
        makePublicKey(1), operatorIds, clusterOwner.address, ssvCluster,
      );

      const ownerSSVBefore = await mockToken.balanceOf(clusterOwner.address);

      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds, ssvCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const receipt = await migrateTx.wait();
      const eventArgs = getMigratedToETHEventArgs(clusters, receipt);

      const ownerSSVAfter = await mockToken.balanceOf(clusterOwner.address);
      expect(ownerSSVAfter - ownerSSVBefore).to.equal(0n);
      expect(eventArgs.ssvRefunded).to.equal(0n);

      await expect(migrateTx).to.emit(clusters, Events.CLUSTER_REACTIVATED);

      const clusterAfter = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(clusterAfter.active).to.equal(true);
      expect(clusterAfter.balance).to.equal(DEFAULT_ETH_REGISTER_VALUE);
      expect(await clusters.getDaoEthValidatorCount()).to.equal(2);
      expect(await clusters.getDaoTotalEthVUnits()).to.equal(20_000n);
    });
  });

  describe("Migration With Mixed Operator ETH State", () => {
    const deployFixtureMixed = async () => {
      const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, 4, 0n);

      for (const opId of operatorIds) {
        await clusters.mockOperatorSSVFee(opId, OP_SSV_FEE_UNPACKED);
      }

      await clusters.mockSSVNetworkFee(NETWORK_FEE_SSV_RAW);
      await clusters.mockEthNetworkFee(NETWORK_FEE_ETH_RAW);
      await clusters.mockMinimumBlocksBeforeLiquidation(MIN_BLOCKS_LIQ);
      await clusters.mockMinimumLiquidationCollateral(MIN_LIQ_COLLATERAL_RAW);
      await clusters.mockMinimumBlocksBeforeLiquidationSSV(MIN_BLOCKS_LIQ);
      await clusters.mockMinimumLiquidationCollateralSSV(MIN_LIQ_COLLATERAL_RAW);

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      const harnessAddr = await clusters.getAddress();
      await mockToken.mint(harnessAddr, connection.ethers.parseEther("10000"));
      await clusters.mockSetToken(await mockToken.getAddress());

      await clusters.mockSetOperatorFee(operatorIds[0], 2_000_000_000n); // raw = 20_000
      await clusters.mockSetOperatorFee(operatorIds[1], 3_000_000_000n); // raw = 30_000
      await clusters.mockSetOperatorFee(operatorIds[2], 1_500_000_000n); // raw = 15_000
      await clusters.mockSetOperatorFee(operatorIds[3], 1_000_000_000n); // raw = 10_000

      return { clusters, operatorIds, mockToken };
    };

    it("Operators with different ETH fees produce correct cumulative index after migration", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixtureMixed);

      const ssvCluster = createCluster({
        validatorCount: 1n,
        balance: 50n * 10n ** 18n,
        active: true,
      });
      await clusters.mockRegisterSSVValidator(
        makePublicKey(1), operatorIds, clusterOwner.address, ssvCluster,
      );

      await mineBlocks(connection.ethers.provider, 200);

      const ethDeposit = 5n * 10n ** 18n;
      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds, ssvCluster,
        { value: ethDeposit },
      );
      const receipt = await migrateTx.wait();

      await expect(migrateTx).to.emit(clusters, Events.CLUSTER_MIGRATED_TO_ETH);

      for (const opId of operatorIds) {
        expect(await clusters.getOperatorEthValidatorCount(opId)).to.equal(1);
      }

      for (const opId of operatorIds) {
        const ssvCount = await clusters.getOperatorValidatorCount(opId);
        expect(ssvCount).to.equal(0);
      }

      expect(await clusters.getDaoEthValidatorCount()).to.equal(1);
    });

    it("Migration succeeds even when operators have zero ETH fee", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixtureMixed);

      await clusters.mockSetOperatorFee(operatorIds[2], 0n);
      await clusters.mockSetOperatorFee(operatorIds[3], 0n);

      const ssvCluster = createCluster({
        validatorCount: 2n,
        balance: 100n * 10n ** 18n,
        active: true,
      });
      await clusters.mockRegisterSSVValidator(
        makePublicKey(1), operatorIds, clusterOwner.address, ssvCluster,
      );

      const ethDeposit = 10n * 10n ** 18n;
      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds, ssvCluster,
        { value: ethDeposit },
      );

      await expect(migrateTx).to.emit(clusters, Events.CLUSTER_MIGRATED_TO_ETH);

      const receipt = await migrateTx.wait();
      const clusterAfter = parseClusterFromEvent(clusters, receipt, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(clusterAfter.balance).to.equal(ethDeposit);
      expect(clusterAfter.validatorCount).to.equal(2n);
      expect(await clusters.getDaoEthValidatorCount()).to.equal(2);
    });
  });

  describe("Post-Migration ETH Fee Accrual", () => {
    const deployFixtureCM8 = async () => {
      const result = await ssvClustersHarnessFixture(connection, 4, 0n);

      for (const opId of result.operatorIds) {
        await result.clusters.mockOperatorSSVFee(opId, OP_SSV_FEE_UNPACKED);
      }

      await result.clusters.mockSSVNetworkFee(NETWORK_FEE_SSV_RAW);
      await result.clusters.mockEthNetworkFee(NETWORK_FEE_ETH_RAW);
      await result.clusters.mockMinimumBlocksBeforeLiquidation(MIN_BLOCKS_LIQ);
      await result.clusters.mockMinimumLiquidationCollateral(MIN_LIQ_COLLATERAL_RAW);
      await result.clusters.mockMinimumBlocksBeforeLiquidationSSV(MIN_BLOCKS_LIQ);
      await result.clusters.mockMinimumLiquidationCollateralSSV(MIN_LIQ_COLLATERAL_RAW);

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      const harnessAddr = await result.clusters.getAddress();
      await mockToken.mint(harnessAddr, connection.ethers.parseEther("10000"));
      await result.clusters.mockSetToken(await mockToken.getAddress());

      return { ...result, mockToken };
    };

    it("ETH fees accrue correctly after migration, not SSV fees", async function () {
      const { clusters, operatorIds, mockToken } = await networkHelpers.loadFixture(deployFixtureCM8);

      const provider = connection.ethers.provider;

      const ssvCluster = createCluster({
        validatorCount: 2n,
        balance: 100n * 10n ** 18n,
        active: true,
      });
      await clusters.mockRegisterSSVValidator(
        makePublicKey(1), operatorIds, clusterOwner.address, ssvCluster,
      );

      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds, ssvCluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const migrateReceipt = await migrateTx.wait();
      const migrateBlock = migrateReceipt!.blockNumber;
      let cluster = parseClusterFromEvent(clusters, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);

      await mineBlocks(provider, 50);

      const regTx = await clusters.registerValidator(
        makePublicKey(3), operatorIds, DEFAULT_SHARES, cluster,
        { value: 0n },
      );
      const regReceipt = await regTx.wait();
      const regBlock = regReceipt!.blockNumber;
      const clusterAfterReg = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

      const blocksSinceMigration = BigInt(regBlock - migrateBlock);
      const vUnits = defaultVUnits(2n); // 20_000 (2 validators at registration)
      const netFeeUnits = (blocksSinceMigration * NETWORK_FEE_ETH_RAW * vUnits) / VUNITS_PRECISION;
      const expectedFees = netFeeUnits * ETH_DEDUCTED_DIGITS;
      const expectedBalance = DEFAULT_ETH_REGISTER_VALUE - expectedFees;

      expect(clusterAfterReg.validatorCount).to.equal(3n);

      expect(clusterAfterReg.balance).to.equal(expectedBalance);
    });
  });
});

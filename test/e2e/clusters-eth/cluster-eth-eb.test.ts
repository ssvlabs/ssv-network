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
  ETH_DEDUCTED_DIGITS,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import {
  mineBlocks,
  calcClusterBurn,
  defaultVUnits,
} from "../helpers/index.ts";
import { ethers } from "ethers";

const OP_FEE_RAW = 10_000n;
const OP_FEE_UNPACKED = OP_FEE_RAW * ETH_DEDUCTED_DIGITS; // 1_000_000_000
const NETWORK_FEE_RAW = 5_000n;
const MIN_BLOCKS_LIQ = 100n;
const MIN_LIQ_COLLATERAL_RAW = 100_000n;
const NUM_OPERATORS = 4n;

const getClusterId = (ownerAddress: string, operatorIds: bigint[]): string => {
  return ethers.keccak256(
    ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds]),
  );
};

const getEBRoot = (clusterId: string, effectiveBalance: number): string => {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const innerHash = ethers.keccak256(coder.encode(["bytes32", "uint32"], [clusterId, effectiveBalance]));
  return ethers.keccak256(ethers.solidityPacked(["bytes32"], [innerHash]));
};

describe("ETH Cluster with Explicit EB", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner] = await connection.ethers.getSigners();
  });

  const deployFixture = async () => {
    const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, 4, OP_FEE_UNPACKED);

    await clusters.mockEthNetworkFee(NETWORK_FEE_RAW);
    await clusters.mockMinimumBlocksBeforeLiquidation(MIN_BLOCKS_LIQ);
    await clusters.mockMinimumLiquidationCollateral(MIN_LIQ_COLLATERAL_RAW);

    return { clusters, operatorIds };
  };

  describe("Fee Scaling With Explicit EB", () => {
    it("Fees use old vUnits before EB update and new vUnits after", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const deposit = connection.ethers.parseEther("10");
      const regTx1 = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: deposit / 2n },
      );
      const reg1Receipt = await regTx1.wait();
      const b_reg1 = reg1Receipt!.blockNumber;
      let cluster = parseClusterFromEvent(clusters, reg1Receipt, Events.VALIDATOR_ADDED);

      const regTx2 = await clusters.registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, cluster,
        { value: deposit / 2n },
      );
      const regReceipt = await regTx2.wait();
      const b0 = regReceipt!.blockNumber;
      cluster = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

      expect(cluster.validatorCount).to.equal(2n);
      const clusterId = getClusterId(clusterOwner.address, operatorIds);
      const implicitVUnits = defaultVUnits(2n); // 20_000

      const ebBlockNum = 50;
      const effectiveBalance = 96;
      const root = getEBRoot(clusterId, effectiveBalance);
      await clusters.mockSetEBRoot(ebBlockNum, root);

      const currentBlock = await provider.getBlockNumber();
      const targetBlocks = b0 + 100 - currentBlock - 1;
      await mineBlocks(provider, targetBlocks);

      const updateTx = await clusters.updateClusterBalance(
        ebBlockNum, clusterOwner.address, operatorIds, cluster,
        effectiveBalance, [],
      );
      const updateReceipt = await updateTx.wait();
      const updateBlock = updateReceipt!.blockNumber;
      cluster = parseClusterFromEvent(clusters, updateReceipt, Events.CLUSTER_BALANCE_UPDATED);

      const feePhase1 = calcClusterBurn({
        blockDiff: BigInt(b0 - b_reg1),
        numOperators: NUM_OPERATORS,
        ethFee: OP_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: defaultVUnits(1n), // 10_000 (1 validator)
      });

      const feePhase2 = calcClusterBurn({
        blockDiff: BigInt(updateBlock - b0),
        numOperators: NUM_OPERATORS,
        ethFee: OP_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: implicitVUnits, // 20_000 (2 validators)
      });

      const expectedBalanceAfterUpdate = deposit - feePhase1 - feePhase2;
      expect(cluster.balance).to.equal(expectedBalanceAfterUpdate);

      const newVUnits = 30_000n;
      expect(await clusters.getClusterVUnits(clusterId)).to.equal(newVUnits);

      const deviation = newVUnits - implicitVUnits; // 10_000
      for (const opId of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(deviation);
      }

      const withdrawBlock = updateBlock + 100;
      const currentBlock2 = await provider.getBlockNumber();
      const blocksToMine = withdrawBlock - currentBlock2 - 1;
      await mineBlocks(provider, blocksToMine);

      const withdrawAmount = connection.ethers.parseEther("1");
      const withdrawTx = await clusters.withdraw(operatorIds, withdrawAmount, cluster);
      const withdrawReceipt = await withdrawTx.wait();
      const wBlock = withdrawReceipt!.blockNumber;
      const clusterAfterWithdraw = parseClusterFromEvent(clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

      const blockDiffStep3 = BigInt(wBlock - updateBlock);
      const feesStep3 = calcClusterBurn({
        blockDiff: blockDiffStep3,
        numOperators: NUM_OPERATORS,
        ethFee: OP_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: newVUnits, // 30_000 = new vUnits
      });

      const expectedBalanceAfterWithdraw = expectedBalanceAfterUpdate - feesStep3 - withdrawAmount;
      expect(clusterAfterWithdraw.balance).to.equal(expectedBalanceAfterWithdraw);

      const burnPerBlockOld = calcClusterBurn({
        blockDiff: 1n,
        numOperators: NUM_OPERATORS,
        ethFee: OP_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: implicitVUnits,
      });
      const burnPerBlockNew = calcClusterBurn({
        blockDiff: 1n,
        numOperators: NUM_OPERATORS,
        ethFee: OP_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: newVUnits,
      });

      expect(burnPerBlockNew * 2n).to.equal(burnPerBlockOld * 3n);
    });
  });

  describe("Migration With Explicit EB Deviation Sync", () => {
    const deployFixtureCM13 = async () => {
      const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, 4, OP_FEE_UNPACKED);

      await clusters.mockEthNetworkFee(NETWORK_FEE_RAW);
      await clusters.mockMinimumBlocksBeforeLiquidation(MIN_BLOCKS_LIQ);
      await clusters.mockMinimumLiquidationCollateral(MIN_LIQ_COLLATERAL_RAW);

      await clusters.mockSSVNetworkFee(0n); // no SSV network fee
      await clusters.mockMinimumBlocksBeforeLiquidationSSV(MIN_BLOCKS_LIQ);
      await clusters.mockMinimumLiquidationCollateralSSV(MIN_LIQ_COLLATERAL_RAW);

      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      const harnessAddr = await clusters.getAddress();
      await mockToken.mint(harnessAddr, connection.ethers.parseEther("10000"));
      await clusters.mockSetToken(await mockToken.getAddress());

      return { clusters, operatorIds };
    };

    it("migration syncs EB deviation to operators and DAO", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixtureCM13);

      const ssvCluster = createCluster({
        validatorCount: 2n,
        balance: 100n * 10n ** 18n,
        active: true,
      });

      const publicKey = makePublicKey(1);
      await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);

      const clusterId = getClusterId(clusterOwner.address, operatorIds);

      await clusters.mockSetClusterVUnits(clusterId, 40_000n); // baseline + 20k deviation

      expect(await clusters.getDaoEthValidatorCount()).to.equal(0);
      const daoVUnitsBefore = await clusters.getDaoTotalEthVUnits();

      const migrationDeposit = connection.ethers.parseEther("10");
      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds, ssvCluster,
        { value: migrationDeposit },
      );
      const migrateReceipt = await migrateTx.wait();

      await expect(migrateTx).to.emit(clusters, Events.CLUSTER_MIGRATED_TO_ETH);

      // Verify daoTotalEthVUnits = 40_000
      // updateDAO(true, 2) adds baseline = 20_000
      // deviation sync adds 20_000
      // Total: 40_000
      const daoVUnitsAfter = await clusters.getDaoTotalEthVUnits();
      expect(daoVUnitsAfter - daoVUnitsBefore).to.equal(40_000n);

      // Each operator: operatorEthVUnits = 20_000 (deviation only)
      for (const opId of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(20_000n);
      }

      // ethDaoValidatorCount increased by 2
      expect(await clusters.getDaoEthValidatorCount()).to.equal(2);

      // Future fee accrual should use 40_000 vUnits
      const clusterAfter = parseClusterFromEvent(clusters, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);
      expect(clusterAfter.balance).to.equal(migrationDeposit);
      expect(clusterAfter.active).to.equal(true);
    });
  });
});

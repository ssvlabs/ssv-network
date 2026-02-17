/**
 * E2E Scenario Tests: ETH Cluster with Explicit Effective Balance
 * Covers CM-12, CM-13
 *
 * Uses harness fixture for direct EB root setup (mockSetEBRoot).
 */

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
  VUNITS_PRECISION,
  ETH_DEDUCTED_DIGITS,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import {
  mineBlocks,
  getTxBlock,
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

describe("E2E: ETH Cluster with Explicit EB (CM-12, CM-13)", () => {
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

    // Fund the harness contract
    const harnessAddr = await clusters.getAddress();
    await connection.ethers.provider.send("hardhat_setBalance", [
      harnessAddr,
      "0x" + (100n * 10n ** 18n).toString(16),
    ]);

    return { clusters, operatorIds };
  };

  // ─── CM-12: ETH Cluster With Explicit EB — Fee Scaling Verification ───

  describe("CM-12: Fee Scaling With Explicit EB", () => {
    it("fees use old vUnits before EB update and new vUnits after", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      // Step 1: Create cluster with 2 validators, 10 ETH
      const deposit = 10n * 10n ** 18n;
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

      // Step 2: updateClusterBalance at ~B0+100 with effectiveBalance = 96 ETH
      // vUnits = ceil(96 * 10_000 / 32) = 30_000
      const ebBlockNum = 50; // oracle block
      const effectiveBalance = 96;
      const root = getEBRoot(clusterId, effectiveBalance);
      await clusters.mockSetEBRoot(ebBlockNum, root);

      // Advance to ~B0+100
      const currentBlock = await provider.getBlockNumber();
      const targetBlocks = b0 + 100 - currentBlock - 1;
      if (targetBlocks > 0) await mineBlocks(provider, targetBlocks);

      const updateTx = await clusters.updateClusterBalance(
        ebBlockNum, clusterOwner.address, operatorIds, cluster,
        effectiveBalance, [],
      );
      const updateReceipt = await updateTx.wait();
      const updateBlock = updateReceipt!.blockNumber;
      cluster = parseClusterFromEvent(clusters, updateReceipt, Events.CLUSTER_BALANCE_UPDATED);

      // Fees settled in two phases:
      // Phase 1: reg1 to reg2 (1 block, 1 validator) — settled during 2nd registerValidator
      const feePhase1 = calcClusterBurn({
        blockDiff: BigInt(b0 - b_reg1),
        numOperators: NUM_OPERATORS,
        ethFee: OP_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: defaultVUnits(1n), // 10_000 (1 validator)
      });
      // Phase 2: reg2 to update (updateBlock - b0 blocks, 2 validators)
      const feePhase2 = calcClusterBurn({
        blockDiff: BigInt(updateBlock - b0),
        numOperators: NUM_OPERATORS,
        ethFee: OP_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: implicitVUnits, // 20_000 (2 validators)
      });

      const expectedBalanceAfterUpdate = deposit - feePhase1 - feePhase2;
      expect(cluster.balance).to.equal(expectedBalanceAfterUpdate);

      // Verify EB snapshot stored
      const newVUnits = 30_000n;
      expect(await clusters.getClusterVUnits(clusterId)).to.equal(newVUnits);

      // Verify deviation
      const deviation = newVUnits - implicitVUnits; // 10_000
      for (const opId of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(deviation);
      }

      // Step 3: Withdraw 1 ETH at ~B0+200 — fees use NEW vUnits (30_000)
      const withdrawBlock = updateBlock + 100;
      const currentBlock2 = await provider.getBlockNumber();
      const blocksToMine = withdrawBlock - currentBlock2 - 1;
      if (blocksToMine > 0) await mineBlocks(provider, blocksToMine);

      const withdrawAmount = 1n * 10n ** 18n;
      const withdrawTx = await clusters.withdraw(operatorIds, withdrawAmount, cluster);
      const withdrawReceipt = await withdrawTx.wait();
      const wBlock = withdrawReceipt!.blockNumber;
      const clusterAfterWithdraw = parseClusterFromEvent(clusters, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

      // Fees for blocks since updateClusterBalance, using new vUnits
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

      // Verify EB increase → 50% more fees per block (30_000/20_000 = 1.5x)
      // Fees per block at old vUnits vs new vUnits
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
      // 1.5x scaling
      expect(burnPerBlockNew * 2n).to.equal(burnPerBlockOld * 3n);
    });
  });

  // ─── CM-13: Migration With Explicit EB Deviation Sync ───
  // Note: This scenario requires SSV cluster with explicit EB set, then migration.
  // Migration calls CoreLib.transferTokenBalance, so a mock SSV token must be set.

  describe("CM-13: Migration With Explicit EB Deviation Sync", () => {
    const deployFixtureCM13 = async () => {
      const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, 4, OP_FEE_UNPACKED);

      await clusters.mockEthNetworkFee(NETWORK_FEE_RAW);
      await clusters.mockMinimumBlocksBeforeLiquidation(MIN_BLOCKS_LIQ);
      await clusters.mockMinimumLiquidationCollateral(MIN_LIQ_COLLATERAL_RAW);

      // SSV protocol params needed for migration's SSV fee settlement
      await clusters.mockSSVNetworkFee(0n); // no SSV network fee
      await clusters.mockMinimumBlocksBeforeLiquidationSSV(MIN_BLOCKS_LIQ);
      await clusters.mockMinimumLiquidationCollateralSSV(MIN_LIQ_COLLATERAL_RAW);

      // Deploy mock token for SSV refund during migration
      const mockToken = await connection.ethers.deployContract("MockToken", []);
      await mockToken.waitForDeployment();
      const harnessAddr = await clusters.getAddress();
      await mockToken.mint(harnessAddr, connection.ethers.parseEther("10000"));
      await clusters.mockSetToken(await mockToken.getAddress());

      // Fund the harness contract with ETH
      await connection.ethers.provider.send("hardhat_setBalance", [
        harnessAddr,
        "0x" + (100n * 10n ** 18n).toString(16),
      ]);

      return { clusters, operatorIds };
    };

    it("migration syncs EB deviation to operators and DAO", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixtureCM13);

      // Set up SSV cluster with 2 validators and explicit EB
      const ssvCluster = createCluster({
        validatorCount: 2n,
        balance: 100n * 10n ** 18n,
        active: true,
      });

      // Register SSV cluster via mock
      const publicKey = makePublicKey(1);
      await clusters.mockRegisterSSVValidator(publicKey, operatorIds, clusterOwner.address, ssvCluster);

      const clusterId = getClusterId(clusterOwner.address, operatorIds);

      // Set explicit EB: effectiveBalance = 128 ETH → vUnits = ceil(128 * 10_000 / 32) = 40_000
      // baseline = 2 * 10_000 = 20_000, deviation = 20_000
      await clusters.mockSetClusterVUnits(clusterId, 40_000n);

      // Verify initial state
      expect(await clusters.getDaoEthValidatorCount()).to.equal(0);
      const daoVUnitsBefore = await clusters.getDaoTotalEthVUnits();

      // Migrate SSV cluster to ETH with 10 ETH
      const migrationDeposit = 10n * 10n ** 18n;
      const migrateTx = await clusters.migrateClusterToETH(
        operatorIds, ssvCluster,
        { value: migrationDeposit },
      );
      const migrateReceipt = await migrateTx.wait();

      // Verify ClusterMigratedToETH event with correct effectiveBalance
      await expect(migrateTx).to.emit(clusters, Events.CLUSTER_MIGRATED_TO_ETH);

      // Parse event to get effectiveBalance
      let eventArgs: any;
      for (const log of migrateReceipt!.logs ?? []) {
        let parsed;
        try { parsed = clusters.interface.parseLog(log); } catch { continue; }
        if (parsed?.name === Events.CLUSTER_MIGRATED_TO_ETH) {
          eventArgs = parsed.args;
          break;
        }
      }
      // effectiveBalance = vUnitsToEB(40_000) = (40_000 * 32) / 10_000 = 128
      expect(eventArgs.effectiveBalance).to.equal(128);

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

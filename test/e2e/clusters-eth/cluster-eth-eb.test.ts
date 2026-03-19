import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullFixture, ssvNetworkFullPreUpgradeFixture, upgradeToStakingVersion } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  makePublicKey,
  getCurrentClusterState,
  parseClusterFromEvent,
  registerOperators,
  whitelistAddresses,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  DEFAULT_ETH_REGISTER_VALUE,
  ETH_DEDUCTED_DIGITS,
  MINIMAL_OPERATOR_ETH_FEE,
  EMPTY_CLUSTER,
  OP_ETH_FEE_RAW,
  DEFAULT_NETWORK_FEE_RAW,
  DEFAULT_NETWORK_FEE_UNPACKED,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import {
  mineBlocks,
  getBlockNumber,
  calcClusterBurn,
  calcVUnits,
  defaultVUnits,
} from "../../helpers/index.ts";
import {
  setupOracles,
  commitEBRoot,
  computeClusterId,
  computeEBRoot,
  makeOperatorKey,
} from "../../helpers/index.ts";
import { ethers } from "ethers";

const NUM_OPERATORS = 4n;

describe("ETH Cluster with Explicit EB", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;
  let oracle1: HardhatEthersSigner;
  let oracle2: HardhatEthersSigner;
  let oracle3: HardhatEthersSigner;
  let oracle4: HardhatEthersSigner;
  let staker: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner, oracle1, oracle2, oracle3, oracle4, staker] } = await setupTestContext());
  });

  describe("Fee Scaling With Explicit EB", () => {
    const deployFixture = async () => {
      const { network, views, ssvToken } = await ssvNetworkFullFixture(connection);

      await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
      await network.updateMinimumLiquidationCollateral(0n);

      await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

      const operatorIds = await registerOperators(network, clusterOwner, 4);
      await whitelistAddresses(network, clusterOwner, operatorIds, [clusterOwner.address]);

      return { network, views, operatorIds };
    };

    it("Fees use old vUnits before EB update and new vUnits after", async function () {
      const { network, views, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const deposit = connection.ethers.parseEther("10");
      const regTx1 = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: deposit / 2n },
      );
      const reg1Receipt = await regTx1.wait();
      const b_reg1 = reg1Receipt!.blockNumber;
      let cluster = parseClusterFromEvent(network, reg1Receipt, Events.VALIDATOR_ADDED);

      const regTx2 = await network.connect(clusterOwner).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, cluster,
        { value: deposit / 2n },
      );
      const regReceipt = await regTx2.wait();
      const b0 = regReceipt!.blockNumber;
      cluster = parseClusterFromEvent(network, regReceipt, Events.VALIDATOR_ADDED);

      expect(cluster.validatorCount).to.equal(2n);
      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const implicitVUnits = defaultVUnits(2n);

      const effectiveBalance = 96;
      const root = computeEBRoot(clusterId, effectiveBalance);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitEBRoot(network, root, rootBlockNum, [oracle1, oracle2, oracle3]);

      const currentBlock = await provider.getBlockNumber();
      const targetBlocks = b0 + 100 - currentBlock - 1;
      if (targetBlocks > 0) {
        await mineBlocks(provider, targetBlocks);
      }

      const updateTx = await network.connect(clusterOwner).updateClusterBalance(
        rootBlockNum, clusterOwner.address, operatorIds, cluster,
        effectiveBalance, [],
      );
      const updateReceipt = await updateTx.wait();
      const updateBlock = updateReceipt!.blockNumber;
      cluster = parseClusterFromEvent(network, updateReceipt, Events.CLUSTER_BALANCE_UPDATED);

      const feePhase1 = calcClusterBurn({
        blockDiff: BigInt(b0 - b_reg1),
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: defaultVUnits(1n),
      });

      const feePhase2 = calcClusterBurn({
        blockDiff: BigInt(updateBlock - b0),
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: implicitVUnits,
      });

      const expectedBalanceAfterUpdate = deposit - feePhase1 - feePhase2;
      expect(cluster.balance).to.equal(expectedBalanceAfterUpdate);

      const newVUnits = calcVUnits(BigInt(effectiveBalance));
      expect(newVUnits).to.equal(30_000n);

      const ebAfterUpdate = await views.getEffectiveBalance(
        clusterOwner.address, operatorIds, cluster,
      );
      expect(ebAfterUpdate).to.equal(effectiveBalance);

      await mineBlocks(provider, 100);

      const withdrawAmount = connection.ethers.parseEther("1");
      const withdrawTx = await network.connect(clusterOwner).withdraw(operatorIds, withdrawAmount, cluster);
      const withdrawReceipt = await withdrawTx.wait();
      const wBlock = withdrawReceipt!.blockNumber;
      const clusterAfterWithdraw = parseClusterFromEvent(network, withdrawReceipt, Events.CLUSTER_WITHDRAWN);

      const blockDiffStep3 = BigInt(wBlock - updateBlock);
      const feesStep3 = calcClusterBurn({
        blockDiff: blockDiffStep3,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: newVUnits,
      });

      const expectedBalanceAfterWithdraw = expectedBalanceAfterUpdate - feesStep3 - withdrawAmount;
      expect(clusterAfterWithdraw.balance).to.equal(expectedBalanceAfterWithdraw);

      const burnPerBlockOld = calcClusterBurn({
        blockDiff: 1n,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: implicitVUnits,
      });
      const burnPerBlockNew = calcClusterBurn({
        blockDiff: 1n,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: newVUnits,
      });

      expect(burnPerBlockNew * 2n).to.equal(burnPerBlockOld * 3n);
    });
  });

  describe("Migration With Explicit EB Deviation Sync", () => {
    const deployFixtureCM13 = async () => {
      const { network: legacyNetwork, views: legacyViews, ssvToken } =
        await ssvNetworkFullPreUpgradeFixture(connection);

      const operatorIds: number[] = [];
      for (let i = 0; i < 4; i++) {
        const expectedId = await legacyNetwork.connect(clusterOwner)
          .registerOperator.staticCall(makeOperatorKey(i + 1), 10_000_000_000n, false);
        await legacyNetwork.connect(clusterOwner)
          .registerOperator(makeOperatorKey(i + 1), 10_000_000_000n, false);
        operatorIds.push(Number(expectedId));
      }

      const ssvDeposit = ethers.parseEther("100");
      await ssvToken.mint(clusterOwner.address, ssvDeposit * 2n);
      await ssvToken.connect(clusterOwner).approve(
        await legacyNetwork.getAddress(), ssvDeposit * 2n,
      );

      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, ssvDeposit, EMPTY_CLUSTER,
      );
      let cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );
      await legacyNetwork.connect(clusterOwner).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, ssvDeposit, cluster,
      );
      cluster = await getCurrentClusterState(
        connection, legacyNetwork, clusterOwner.address, operatorIds,
      );

      const { newNetwork, newViews } = await upgradeToStakingVersion(
        connection, legacyNetwork, legacyViews,
      );

      await setupOracles(newNetwork, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

      return { network: newNetwork, views: newViews, ssvToken, operatorIds, cluster };
    };

    it("migration syncs EB deviation to operators and DAO", async function () {
      const { network, views, operatorIds, cluster } =
        await networkHelpers.loadFixture(deployFixtureCM13);
      const provider = connection.ethers.provider;

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);
      const effectiveBalance = 128;
      const root = computeEBRoot(clusterId, effectiveBalance);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitEBRoot(network, root, rootBlockNum, [oracle1, oracle2, oracle3]);

      const updateTx = await network.connect(clusterOwner).updateClusterBalance(
        rootBlockNum, clusterOwner.address, operatorIds, cluster,
        effectiveBalance, [],
      );
      const updateReceipt = await updateTx.wait();
      const updatedCluster = parseClusterFromEvent(network, updateReceipt, Events.CLUSTER_BALANCE_UPDATED);

      const migrationDeposit = ethers.parseEther("10");
      const migrateTx = await network.connect(clusterOwner).migrateClusterToETH(
        operatorIds, updatedCluster,
        { value: migrationDeposit },
      );
      const migrateReceipt = await migrateTx.wait();

      await expect(migrateTx).to.emit(network, Events.CLUSTER_MIGRATED_TO_ETH);

      const migratedCluster = parseClusterFromEvent(network, migrateReceipt, Events.CLUSTER_MIGRATED_TO_ETH);
      const ebAfterMigration = await views.getEffectiveBalance(
        clusterOwner.address, operatorIds, migratedCluster,
      );
      expect(ebAfterMigration).to.equal(effectiveBalance);

      for (const opId of operatorIds) {
        const op = await views.getOperatorById(opId);
        expect(op.validatorCount).to.equal(2);
      }

      expect(await views.getNetworkValidatorsCount()).to.equal(2);

      expect(migratedCluster.balance).to.equal(migrationDeposit);
      expect(migratedCluster.active).to.equal(true);
      expect(migratedCluster.validatorCount).to.equal(2n);

      const networkFeeETH = await views.getNetworkFee();
      const networkFeeRawActual = networkFeeETH / ETH_DEDUCTED_DIGITS;
      const opFeeRawActual = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;

      const burnRate = await views.getBurnRate(
        clusterOwner.address, operatorIds, migratedCluster,
      );
      const expectedBurn = calcClusterBurn({
        blockDiff: 1n,
        numOperators: NUM_OPERATORS,
        ethFee: opFeeRawActual,
        networkFee: networkFeeRawActual,
        effectiveVUnits: calcVUnits(BigInt(effectiveBalance)),
      });
      expect(burnRate).to.equal(expectedBurn);
    });
  });
});

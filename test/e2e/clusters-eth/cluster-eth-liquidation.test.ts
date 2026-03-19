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
  BPS_DENOMINATOR,
  ETH_DEDUCTED_DIGITS, DEFAULT_ETH_REGISTER_VALUE,
} from '../../common/constants.ts';
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import {
  mineBlocks,
  calcClusterBurn,
  calcLiquidationThreshold,
  defaultVUnits,
} from "../helpers/index.ts";
import { ethers } from "ethers";

const OP_FEE_RAW = 10_000n;
const OP_FEE_UNPACKED = OP_FEE_RAW * ETH_DEDUCTED_DIGITS;
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

describe("ETH Cluster Liquidation", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;
  let liquidator: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    [clusterOwner, liquidator] = await connection.ethers.getSigners();
  });

  const deployFixture = async () => {
    const { clusters, operatorIds } = await ssvClustersHarnessFixture(connection, 4, OP_FEE_UNPACKED);

    await clusters.mockEthNetworkFee(NETWORK_FEE_RAW);
    await clusters.mockMinimumBlocksBeforeLiquidation(MIN_BLOCKS_LIQ);
    await clusters.mockMinimumLiquidationCollateral(MIN_LIQ_COLLATERAL_RAW);

    return { clusters, operatorIds };
  };

  describe("Cluster at exact threshold is NOT liquidatable by third party", () => {
    it("Balance == threshold is NOT liquidatable, balance < threshold IS", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const regTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regReceipt = await regTx.wait();
      let cluster = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

      const vUnits = defaultVUnits(1n);
      const perBlockBurn = calcClusterBurn({
        blockDiff: 1n,
        numOperators: NUM_OPERATORS,
        ethFee: OP_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_LIQ,
        numOperators: NUM_OPERATORS,
        ethFee: OP_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      await mineBlocks(provider, 9);

      const feesAt10 = calcClusterBurn({
        blockDiff: 10n,
        numOperators: NUM_OPERATORS,
        ethFee: OP_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const balAfterFees = DEFAULT_ETH_REGISTER_VALUE - feesAt10;

      const maxWithdraw = balAfterFees - liqThreshold - perBlockBurn;

      const wTx = await clusters.withdraw(operatorIds, maxWithdraw, cluster);
      const wReceipt = await wTx.wait();
      cluster = parseClusterFromEvent(clusters, wReceipt, Events.CLUSTER_WITHDRAWN);
      expect(cluster.balance).to.equal(liqThreshold + perBlockBurn);

      await expect(
        clusters.connect(liquidator).liquidate(clusterOwner.address, operatorIds, cluster),
      ).to.be.revertedWithCustomError(clusters, Errors.CLUSTER_NOT_LIQUIDATABLE);

      await mineBlocks(provider, 1);
      const liqTx = await clusters.connect(liquidator).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      await expect(liqTx).to.emit(clusters, Events.CLUSTER_LIQUIDATED);
    });
  });

  describe("Liquidation With Explicit EB — Deviation Cleanup", () => {
    it("Liquidation reverses EB deviation from operators and DAO", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const deposit = 2_000_000_000_000n;

      const regTx = await clusters.bulkRegisterValidator(
        [makePublicKey(1), makePublicKey(2)], operatorIds, [DEFAULT_SHARES, DEFAULT_SHARES], createCluster(),
        { value: deposit },
      );
      let cluster = parseClusterFromEvent(clusters, await regTx.wait(), Events.VALIDATOR_ADDED);

      expect(cluster.validatorCount).to.equal(2n);

      const clusterId = getClusterId(clusterOwner.address, operatorIds);

      const ebBlockNum = 1;
      const effectiveBalance = 96;
      const root = getEBRoot(clusterId, effectiveBalance);
      await clusters.mockSetEBRoot(ebBlockNum, root);

      const updateTx = await clusters.updateClusterBalance(
        ebBlockNum, clusterOwner.address, operatorIds, cluster,
        effectiveBalance, [],
      );
      const updateReceipt = await updateTx.wait();
      cluster = parseClusterFromEvent(clusters, updateReceipt, Events.CLUSTER_BALANCE_UPDATED);

      const newVUnits = 30_000n;
      const baseline = 2n * BPS_DENOMINATOR; // 20_000
      const deviation = newVUnits - baseline; // 10_000

      expect(await clusters.getClusterVUnits(clusterId)).to.equal(newVUnits);
      const daoVUnitsBefore = await clusters.getDaoTotalEthVUnits();

      for (const opId of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(deviation);
      }

      await mineBlocks(provider, 60);

      const liqTx = await clusters.connect(liquidator).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      const liqReceipt = await liqTx.wait();
      const liqCluster = parseClusterFromEvent(clusters, liqReceipt, Events.CLUSTER_LIQUIDATED);

      expect(liqCluster.active).to.equal(false);
      expect(liqCluster.balance).to.equal(0n);

      for (const opId of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(0n);
      }

      const daoVUnitsAfter = await clusters.getDaoTotalEthVUnits();
      expect(daoVUnitsBefore - daoVUnitsAfter).to.equal(newVUnits);

      expect(await clusters.getDaoEthValidatorCount()).to.equal(0);

      for (const opId of operatorIds) {
        expect(await clusters.getOperatorEthValidatorCount(opId)).to.equal(0);
      }
    });
  });

  describe("Auto-Liquidation via updateClusterBalance", () => {
    it("EB increase triggers auto-liquidation, bounty goes to updater", async function () {
      const { clusters, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const deposit = 500_000_000_000n;
      const regTx = await clusters.registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, createCluster(),
        { value: deposit },
      );
      const regReceipt = await regTx.wait();
      let cluster = parseClusterFromEvent(clusters, regReceipt, Events.VALIDATOR_ADDED);

      const clusterId = getClusterId(clusterOwner.address, operatorIds);

      const implicitThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_LIQ,
        numOperators: NUM_OPERATORS,
        ethFee: OP_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: defaultVUnits(1n),
      });
      expect(deposit).to.be.greaterThan(implicitThreshold);

      const ebBlockNum = 1;
      const effectiveBalance = 64;
      const root = getEBRoot(clusterId, effectiveBalance);
      await clusters.mockSetEBRoot(ebBlockNum, root);

      const updaterBalBefore = await provider.getBalance(liquidator.address);

      const updateTx = await clusters.connect(liquidator).updateClusterBalance(
        ebBlockNum, clusterOwner.address, operatorIds, cluster,
        effectiveBalance, [],
      );
      const updateReceipt = await updateTx.wait();

      await expect(updateTx).to.emit(clusters, Events.CLUSTER_BALANCE_UPDATED);
      await expect(updateTx).to.emit(clusters, Events.CLUSTER_LIQUIDATED);

      const regBlock = regReceipt!.blockNumber;
      const updateBlock = updateReceipt!.blockNumber;
      const blockDiff = BigInt(updateBlock - regBlock);
      const oldVUnits = defaultVUnits(1n);
      const feesAtOldVUnits = calcClusterBurn({
        blockDiff,
        numOperators: NUM_OPERATORS,
        ethFee: OP_FEE_RAW,
        networkFee: NETWORK_FEE_RAW,
        effectiveVUnits: oldVUnits,
      });
      const expectedBounty = deposit - feesAtOldVUnits;

      const gasUsed = updateReceipt!.gasUsed * updateReceipt!.gasPrice;
      const updaterBalAfter = await provider.getBalance(liquidator.address);
      const bountyReceived = updaterBalAfter - updaterBalBefore + gasUsed;
      expect(bountyReceived).to.equal(expectedBounty);

      for (const opId of operatorIds) {
        expect(await clusters.getOperatorEthVUnits(opId)).to.equal(0n);
      }
      expect(await clusters.getDaoEthValidatorCount()).to.equal(0);
    });
  });
});

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  makePublicKey,
  parseClusterFromEvent,
  registerOperators,
  whitelistAddresses,
  getCurrentClusterState,
  setupTestContext,
} from "../../common/helpers.ts";
import {
  DEFAULT_SHARES,
  DEFAULT_ETH_REGISTER_VALUE,
  MINIMAL_LIQUIDATION_THRESHOLD,
  EMPTY_CLUSTER,
  OP_ETH_FEE_RAW,
  DEFAULT_NETWORK_FEE_RAW,
  DEFAULT_NETWORK_FEE_UNPACKED,
} from '../../common/constants.ts';
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import {
  mineBlocks,
  getBlockNumber,
  calcClusterBurn,
  calcLiquidationThreshold,
  calcVUnits,
  defaultVUnits,
} from "../../helpers/index.ts";
import {
  setupOracles,
  commitEBRoot,
  computeClusterId,
  computeEBRoot,
} from "../../helpers/index.ts";
import { ethers } from "ethers";

// ---------------------------------------------------------------------------
//  Diamond storage reader for cluster hash verification
// ---------------------------------------------------------------------------
function mainStorageBaseSlot(): bigint {
  return BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.main"))) - 1n;
}

async function readETHClusterHash(
  provider: any,
  contractAddress: string,
  clusterKey: string,
): Promise<bigint> {
  const baseSlot = mainStorageBaseSlot() + 10n;
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const storageSlot = ethers.keccak256(
    coder.encode(["bytes32", "uint256"], [clusterKey, baseSlot]),
  );
  const raw = await provider.getStorage(contractAddress, storageSlot);
  return BigInt(raw);
}

function computeClusterKey(ownerAddress: string, operatorIds: number[]): string {
  return ethers.keccak256(
    ethers.solidityPacked(
      ["address", "uint64[]"],
      [ownerAddress, operatorIds.map(BigInt)],
    ),
  );
}

const MIN_BLOCKS_LIQ = MINIMAL_LIQUIDATION_THRESHOLD;
const NUM_OPERATORS = 4n;

describe("ETH Cluster Liquidation", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;
  let clusterOwner: HardhatEthersSigner;
  let liquidator: HardhatEthersSigner;
  let oracle1: HardhatEthersSigner;
  let oracle2: HardhatEthersSigner;
  let oracle3: HardhatEthersSigner;
  let oracle4: HardhatEthersSigner;
  let staker: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers, signers: [clusterOwner, liquidator, oracle1, oracle2, oracle3, oracle4, staker] } = await setupTestContext());
  });

  const deployFixture = async () => {
    const { network, views, ssvToken } = await ssvNetworkFullFixture(connection);

    await network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
    await network.updateMinimumLiquidationCollateral(0n);

    await setupOracles(network, ssvToken, staker, [oracle1, oracle2, oracle3, oracle4]);

    const operatorIds = await registerOperators(network, clusterOwner, 4);
    await whitelistAddresses(network, clusterOwner, operatorIds, [clusterOwner.address]);

    return { network, views, operatorIds };
  };

  describe("Cluster at exact threshold is NOT liquidatable by third party", () => {
    it("Balance == threshold is NOT liquidatable, balance < threshold IS", async function () {
      const { network, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regReceipt = await regTx.wait();
      let cluster = parseClusterFromEvent(network, regReceipt, Events.VALIDATOR_ADDED);

      const vUnits = defaultVUnits(1n);
      const perBlockBurn = calcClusterBurn({
        blockDiff: 1n,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const liqThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_LIQ,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });

      await mineBlocks(provider, 9);

      const feesAt10 = calcClusterBurn({
        blockDiff: 10n,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: vUnits,
      });
      const balAfterFees = DEFAULT_ETH_REGISTER_VALUE - feesAt10;

      const maxWithdraw = balAfterFees - liqThreshold - perBlockBurn;

      const wTx = await network.connect(clusterOwner).withdraw(operatorIds, maxWithdraw, cluster);
      const wReceipt = await wTx.wait();
      cluster = parseClusterFromEvent(network, wReceipt, Events.CLUSTER_WITHDRAWN);
      expect(cluster.balance).to.equal(liqThreshold + perBlockBurn);

      await expect(
        network.connect(liquidator).liquidate(clusterOwner.address, operatorIds, cluster),
      ).to.be.revertedWithCustomError(network, Errors.CLUSTER_NOT_LIQUIDATABLE);

      await mineBlocks(provider, 1);
      const liqTx = await network.connect(liquidator).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      await expect(liqTx).to.emit(network, Events.CLUSTER_LIQUIDATED);
    });
  });

  describe("Liquidation With Explicit EB — Deviation Cleanup", () => {
    it("Liquidation reverses EB deviation from operators and DAO", async function () {
      const { network, views, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const regTx1 = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      let cluster = parseClusterFromEvent(network, await regTx1.wait(), Events.VALIDATOR_ADDED);

      const regTx2 = await network.connect(clusterOwner).registerValidator(
        makePublicKey(2), operatorIds, DEFAULT_SHARES, cluster,
        { value: DEFAULT_ETH_REGISTER_VALUE },
      );
      const regReceipt2 = await regTx2.wait();
      cluster = parseClusterFromEvent(network, regReceipt2, Events.VALIDATOR_ADDED);
      expect(cluster.validatorCount).to.equal(2n);

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);

      const effectiveBalance = 96;
      const root = computeEBRoot(clusterId, effectiveBalance);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitEBRoot(network, root, rootBlockNum, [oracle1, oracle2, oracle3]);

      const updateTx = await network.connect(clusterOwner).updateClusterBalance(
        rootBlockNum, clusterOwner.address, operatorIds, cluster,
        effectiveBalance, [],
      );
      const updateReceipt = await updateTx.wait();
      cluster = parseClusterFromEvent(network, updateReceipt, Events.CLUSTER_BALANCE_UPDATED);

      const newVUnits = calcVUnits(BigInt(effectiveBalance));
      expect(newVUnits).to.equal(30_000n);

      const ebAfterUpdate = await views.getEffectiveBalance(
        clusterOwner.address, operatorIds, cluster,
      );
      expect(ebAfterUpdate).to.equal(effectiveBalance);

      const liqThresholdNewVUnits = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_LIQ,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: newVUnits,
      });
      const burnPerBlockNewVUnits = calcClusterBurn({
        blockDiff: 1n,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: newVUnits,
      });
      const currentBalance = BigInt(cluster.balance);
      const blocksUntilLiquidatable = Number((currentBalance - liqThresholdNewVUnits) / burnPerBlockNewVUnits);
      await mineBlocks(provider, blocksUntilLiquidatable);

      const liqTx = await network.connect(liquidator).liquidate(
        clusterOwner.address, operatorIds, cluster,
      );
      const liqReceipt = await liqTx.wait();
      const liqCluster = parseClusterFromEvent(network, liqReceipt, Events.CLUSTER_LIQUIDATED);

      expect(liqCluster.active).to.equal(false);
      expect(liqCluster.balance).to.equal(0n);

      expect(await views.getNetworkValidatorsCount()).to.equal(0);
      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(opId);
        expect(opData.validatorCount).to.equal(0);
      }

      // INV-023: After liquidation, ethClusters[key] still stores the hash of the zeroed cluster state
      const contractAddress = await network.getAddress();
      const clusterKey = computeClusterKey(clusterOwner.address, operatorIds);
      const hashAfterLiq = await readETHClusterHash(provider, contractAddress, clusterKey);
      expect(hashAfterLiq).to.not.equal(0n, "INV-023: ethClusters[key] != 0 after liquidation (stores hash of zeroed state)");
      // Verify the stored hash matches keccak256(abi.encodePacked(validatorCount, networkFeeIndex, index, balance, active))
      // Note: ClusterLib.hashClusterData uses encodePacked with balance before active
      const expectedHash = BigInt(ethers.keccak256(
        ethers.solidityPacked(
          ["uint32", "uint64", "uint64", "uint256", "bool"],
          [liqCluster.validatorCount, liqCluster.networkFeeIndex, liqCluster.index, liqCluster.balance, liqCluster.active],
        ),
      ));
      expect(hashAfterLiq).to.equal(expectedHash, "INV-023: stored hash == keccak256 of liquidated cluster struct");
    });
  });

  describe("Auto-Liquidation via updateClusterBalance", () => {
    it("EB increase triggers auto-liquidation, bounty goes to updater", async function () {
      const { network, views, operatorIds } = await networkHelpers.loadFixture(deployFixture);
      const provider = connection.ethers.provider;

      const implicitVUnits = defaultVUnits(1n);
      const implicitThreshold = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MIN_BLOCKS_LIQ,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: implicitVUnits,
      });

      const deposit = implicitThreshold + (implicitThreshold / 2n);
      expect(deposit).to.be.greaterThan(implicitThreshold);

      const regTx = await network.connect(clusterOwner).registerValidator(
        makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
        { value: deposit },
      );
      const regReceipt = await regTx.wait();
      let cluster = parseClusterFromEvent(network, regReceipt, Events.VALIDATOR_ADDED);
      const regBlock = regReceipt!.blockNumber;

      const clusterId = computeClusterId(clusterOwner.address, operatorIds);

      const effectiveBalance = 64;
      const root = computeEBRoot(clusterId, effectiveBalance);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitEBRoot(network, root, rootBlockNum, [oracle1, oracle2, oracle3]);

      const updaterBalBefore = await provider.getBalance(liquidator.address);

      const updateTx = await network.connect(liquidator).updateClusterBalance(
        rootBlockNum, clusterOwner.address, operatorIds, cluster,
        effectiveBalance, [],
      );
      const updateReceipt = await updateTx.wait();

      await expect(updateTx).to.emit(network, Events.CLUSTER_BALANCE_UPDATED);
      await expect(updateTx).to.emit(network, Events.CLUSTER_LIQUIDATED);

      const updateBlock = updateReceipt!.blockNumber;
      const blockDiff = BigInt(updateBlock - regBlock);
      const oldVUnits = defaultVUnits(1n);
      const feesAtOldVUnits = calcClusterBurn({
        blockDiff,
        numOperators: NUM_OPERATORS,
        ethFee: OP_ETH_FEE_RAW,
        networkFee: DEFAULT_NETWORK_FEE_RAW,
        effectiveVUnits: oldVUnits,
      });
      const expectedBounty = deposit - feesAtOldVUnits;

      const gasUsed = updateReceipt!.gasUsed * updateReceipt!.gasPrice;
      const updaterBalAfter = await provider.getBalance(liquidator.address);
      const bountyReceived = updaterBalAfter - updaterBalBefore + gasUsed;
      expect(bountyReceived).to.equal(expectedBounty);

      expect(await views.getNetworkValidatorsCount()).to.equal(0);
      for (const opId of operatorIds) {
        const opData = await views.getOperatorById(opId);
        expect(opData.validatorCount).to.equal(0);
      }
    });
  });
});

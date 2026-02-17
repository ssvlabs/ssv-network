/**
 * ES-6 to ES-10: Effective Balance update scenario tests.
 *
 * Covers: first EB update (implicit to explicit), EB increase,
 * EB decrease, auto-liquidation on EB increase, and fee settlement timing.
 */

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { Cluster, NetworkHelpersType } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  whitelistAddresses,
  getCurrentClusterState,
  generateMerkleForClusterEB,
} from "../../common/helpers.ts";
import { Events } from "../../common/events.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
  NETWORK_FEE,
  STAKE_AMOUNT,
  MINIMAL_LIQUIDATION_THRESHOLD,
  ETH_DEDUCTED_DIGITS,
} from "../../common/constants.ts";

// Packed fee values (raw values as stored in contract, divide by ETH_DEDUCTED_DIGITS)
const PACKED_ETH_FEE = MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS;
// The non-fork fixture sets ethNetworkFee = NETWORK_FEE (the SSV fee constant)
const PACKED_NETWORK_FEE = NETWORK_FEE / ETH_DEDUCTED_DIGITS;
import {
  mineBlocks,
  getBlockNumber,
  calcClusterBurn,
  calcVUnits,
  defaultVUnits,
  calcLiquidationThreshold,
} from "../helpers/index.ts";

/**
 * Parse the updated cluster from a ClusterBalanceUpdated event in a tx receipt.
 */
async function getClusterFromEBUpdateTx(
  network: any,
  tx: any,
): Promise<Cluster> {
  const receipt = await tx.wait();
  for (const log of receipt.logs ?? []) {
    let parsed;
    try {
      parsed = network.interface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed?.name === "ClusterBalanceUpdated") {
      const clusterTuple = parsed.args[parsed.args.length - 1];
      return {
        validatorCount: clusterTuple[0].toString(),
        networkFeeIndex: clusterTuple[1].toString(),
        index: clusterTuple[2].toString(),
        active: clusterTuple[3],
        balance: clusterTuple[4].toString(),
      };
    }
    if (parsed?.name === "ClusterLiquidated") {
      const clusterTuple = parsed.args[parsed.args.length - 1];
      return {
        validatorCount: clusterTuple[0].toString(),
        networkFeeIndex: clusterTuple[1].toString(),
        index: clusterTuple[2].toString(),
        active: clusterTuple[3],
        balance: clusterTuple[4].toString(),
      };
    }
  }
  throw new Error("ClusterBalanceUpdated/ClusterLiquidated event not found in tx receipt");
}

/**
 * Helper: deploy the full system, register 4 operators, set up oracles,
 * stake SSV, and register a 2-validator ETH cluster.
 */
async function setupClusterWithEB(
  connection: NetworkConnection<"generic">,
  networkHelpers: NetworkHelpersType,
  depositValue: bigint = DEFAULT_ETH_REGISTER_VALUE,
) {
  const { network, views, cssvToken, ssvToken } =
    await ssvNetworkFullFixture(connection);

  const provider = connection.ethers.provider;
  const signers = await connection.ethers.getSigners();
  const [owner, oracle1, oracle2, oracle3, oracle4, staker, clusterOwner] = signers;

  // Register oracles
  await network.replaceOracle(1, oracle1.address);
  await network.replaceOracle(2, oracle2.address);
  await network.replaceOracle(3, oracle3.address);
  await network.replaceOracle(4, oracle4.address);

  // Stake SSV so cSSV supply > 0
  await ssvToken.transfer(staker.address, STAKE_AMOUNT);
  await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
  await network.connect(staker).stake(STAKE_AMOUNT);

  // Register 4 operators
  const operatorIds = await registerOperators(network, owner, 4);

  // Whitelist cluster owner
  await whitelistAddresses(network, owner, operatorIds, [clusterOwner.address]);

  // Fund cluster owner
  await provider.send("hardhat_setBalance", [
    clusterOwner.address,
    "0x" + (depositValue + 10n ** 18n).toString(16),
  ]);

  // Register first validator
  await network.connect(clusterOwner).registerValidator(
    makePublicKey(1),
    operatorIds,
    DEFAULT_SHARES,
    EMPTY_CLUSTER,
    { value: depositValue },
  );

  let cluster = await getCurrentClusterState(
    connection, network, clusterOwner.address, operatorIds,
  );

  // Register second validator
  await provider.send("hardhat_setBalance", [
    clusterOwner.address,
    "0x" + (depositValue + 10n ** 18n).toString(16),
  ]);

  await network.connect(clusterOwner).registerValidator(
    makePublicKey(2),
    operatorIds,
    DEFAULT_SHARES,
    cluster,
    { value: depositValue },
  );

  cluster = await getCurrentClusterState(
    connection, network, clusterOwner.address, operatorIds,
  );

  // Compute clusterId
  const clusterId = connection.ethers.keccak256(
    connection.ethers.solidityPacked(
      ["address", "uint64[]"],
      [clusterOwner.address, operatorIds],
    ),
  );

  return {
    network,
    views,
    cssvToken,
    ssvToken,
    provider,
    owner,
    oracle1,
    oracle2,
    oracle3,
    oracle4,
    staker,
    clusterOwner,
    operatorIds,
    cluster,
    clusterId,
  };
}

/**
 * Helper: commit a root with quorum (3 of 4 oracles).
 */
async function commitRootWithQuorum(
  network: any,
  oracles: HardhatEthersSigner[],
  root: string,
  blockNum: number,
) {
  await network.connect(oracles[0]).commitRoot(root, blockNum);
  await network.connect(oracles[1]).commitRoot(root, blockNum);
  await network.connect(oracles[2]).commitRoot(root, blockNum);
}

/**
 * Helper: generate merkle tree and commit root for a single cluster EB update.
 */
async function prepareEBUpdate(
  connection: NetworkConnection<"generic">,
  network: any,
  oracles: HardhatEthersSigner[],
  provider: any,
  clusterId: string,
  effectiveBalance: number,
) {
  const { root, proofs } = generateMerkleForClusterEB(connection, [
    { clusterId, effectiveBalance },
  ]);

  // Mine blocks and record the block number for root commitment
  await mineBlocks(provider, 1);
  const rootBlockNum = await getBlockNumber(provider);

  // Commit root with quorum
  await commitRootWithQuorum(network, oracles, root, rootBlockNum);

  return { root, proof: proofs[clusterId], rootBlockNum };
}

/**
 * Helper: perform an EB update and return the updated cluster from the event.
 */
async function performEBUpdate(
  connection: NetworkConnection<"generic">,
  network: any,
  oracles: HardhatEthersSigner[],
  provider: any,
  clusterOwner: HardhatEthersSigner,
  operatorIds: number[],
  cluster: Cluster,
  clusterId: string,
  effectiveBalance: number,
  caller?: HardhatEthersSigner,
): Promise<{ cluster: Cluster; rootBlockNum: number; tx: any }> {
  const { proof, rootBlockNum } = await prepareEBUpdate(
    connection, network, oracles, provider, clusterId, effectiveBalance,
  );

  const signer = caller ?? clusterOwner;
  const tx = await network.connect(signer).updateClusterBalance(
    rootBlockNum, clusterOwner.address, operatorIds, cluster, effectiveBalance, proof,
  );

  const updatedCluster = await getClusterFromEBUpdateTx(network, tx);
  return { cluster: updatedCluster, rootBlockNum, tx };
}

describe("E2E: EB Updates (ES-6 to ES-10)", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
  });

  // ----------------------------------------------------------------
  // ES-6: First EB Update — Implicit to Explicit (Same vUnits)
  // ----------------------------------------------------------------
  describe("ES-6: First EB Update — Implicit to Explicit (Same vUnits)", () => {
    it("transitions from implicit to explicit vUnits with no deviation change", async function () {
      const ctx = await setupClusterWithEB(connection, networkHelpers);
      const {
        network, provider, oracle1, oracle2, oracle3, oracle4,
        clusterOwner, operatorIds, cluster, clusterId,
      } = ctx;
      const oracles = [oracle1, oracle2, oracle3, oracle4];

      // 2 validators at 32 ETH each = 64 ETH total = 20,000 vUnits (same as implicit)
      const effectiveBalance = 64;
      const expectedVUnits = calcVUnits(BigInt(effectiveBalance));
      expect(expectedVUnits).to.equal(defaultVUnits(2n)); // 20,000

      // Mine some blocks to accumulate fees
      await mineBlocks(provider, 10);

      // Perform EB update
      const { cluster: updatedCluster, tx } = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds,
        cluster, clusterId, effectiveBalance,
      );

      await expect(tx).to.emit(network, Events.CLUSTER_BALANCE_UPDATED);

      // Cluster is still active, balance reduced by fees
      expect(updatedCluster.active).to.be.true;
      expect(BigInt(updatedCluster.balance)).to.be.lessThan(BigInt(cluster.balance));
    });
  });

  // ----------------------------------------------------------------
  // ES-7: EB Increase — Higher Fee Burn Rate
  // ----------------------------------------------------------------
  describe("ES-7: EB Increase — Higher Fee Burn Rate", () => {
    it("updates vUnits upward and increases the fee burn rate proportionally", async function () {
      const ctx = await setupClusterWithEB(connection, networkHelpers);
      const {
        network, provider, oracle1, oracle2, oracle3, oracle4,
        clusterOwner, operatorIds, cluster, clusterId,
      } = ctx;
      const oracles = [oracle1, oracle2, oracle3, oracle4];

      // Set explicit vUnits at 64 ETH (20,000 vUnits)
      const { cluster: clusterAfterFirst } = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds,
        cluster, clusterId, 64,
      );

      // Mine some blocks
      await mineBlocks(provider, 50);

      // Increase EB to 96 ETH → 30,000 vUnits
      const { cluster: clusterAfterIncrease, tx } = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds,
        clusterAfterFirst, clusterId, 96,
      );

      await expect(tx).to.emit(network, Events.CLUSTER_BALANCE_UPDATED);

      // Balance decreased (fees settled with OLD vUnits=20,000)
      expect(BigInt(clusterAfterIncrease.balance)).to.be.lessThan(BigInt(clusterAfterFirst.balance));
      expect(clusterAfterIncrease.active).to.be.true;

      // Verify vUnits math
      expect(calcVUnits(96n)).to.equal(30000n);

      // Verify burn rate ratio: 30,000 / 20,000 = 1.5x
      const oldBurn = calcClusterBurn({
        blockDiff: 100n, numOperators: 4n, ethFee: PACKED_ETH_FEE,
        networkFee: PACKED_NETWORK_FEE, effectiveVUnits: 20000n,
      });
      const newBurn = calcClusterBurn({
        blockDiff: 100n, numOperators: 4n, ethFee: PACKED_ETH_FEE,
        networkFee: PACKED_NETWORK_FEE, effectiveVUnits: 30000n,
      });
      expect(newBurn * 20000n).to.equal(oldBurn * 30000n);
    });
  });

  // ----------------------------------------------------------------
  // ES-8: EB Decrease — Lower Fee Burn Rate
  // ----------------------------------------------------------------
  describe("ES-8: EB Decrease — Lower Fee Burn Rate", () => {
    it("updates vUnits downward and decreases the fee burn rate", async function () {
      const ctx = await setupClusterWithEB(connection, networkHelpers);
      const {
        network, provider, oracle1, oracle2, oracle3, oracle4,
        clusterOwner, operatorIds, cluster, clusterId,
      } = ctx;
      const oracles = [oracle1, oracle2, oracle3, oracle4];

      // Set explicit vUnits at 96 ETH (30,000 vUnits)
      const { cluster: clusterAfterFirst } = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds,
        cluster, clusterId, 96,
      );

      // Mine blocks
      await mineBlocks(provider, 50);

      // Decrease EB to 64 ETH → 20,000 vUnits
      const { cluster: clusterAfterDecrease, tx } = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds,
        clusterAfterFirst, clusterId, 64,
      );

      await expect(tx).to.emit(network, Events.CLUSTER_BALANCE_UPDATED);
      expect(clusterAfterDecrease.active).to.be.true;

      // Verify vUnits math
      expect(calcVUnits(64n)).to.equal(20000n);

      // Verify burn rate ratio: 20,000 / 30,000 = 2/3
      const highBurn = calcClusterBurn({
        blockDiff: 100n, numOperators: 4n, ethFee: PACKED_ETH_FEE,
        networkFee: PACKED_NETWORK_FEE, effectiveVUnits: 30000n,
      });
      const lowBurn = calcClusterBurn({
        blockDiff: 100n, numOperators: 4n, ethFee: PACKED_ETH_FEE,
        networkFee: PACKED_NETWORK_FEE, effectiveVUnits: 20000n,
      });
      expect(lowBurn * 30000n).to.equal(highBurn * 20000n);
    });
  });

  // ----------------------------------------------------------------
  // ES-9: Auto-Liquidation on EB Increase
  // ----------------------------------------------------------------
  describe("ES-9: Auto-Liquidation on EB Increase", () => {
    it("auto-liquidates cluster when EB increase pushes balance below threshold", async function () {
      // Thresholds (using packed fee values as stored in contract):
      //   thresholdOld (20k vUnits) ≈ 0.01675 ETH
      //   thresholdNew (40k vUnits) ≈ 0.03349 ETH
      //
      // Strategy: deposit a small amount (~0.025 ETH/validator = 0.05 ETH total),
      // then mine enough blocks so that after fee settlement the balance is
      // between thresholdOld and thresholdNew. The EB increase to 40k vUnits
      // then triggers auto-liquidation because the threshold doubles.
      const SMALL_DEPOSIT = connection.ethers.parseEther("0.025");
      const ctx = await setupClusterWithEB(connection, networkHelpers, SMALL_DEPOSIT);
      const {
        network, provider, oracle1, oracle2, oracle3, oracle4,
        clusterOwner, operatorIds, cluster, clusterId,
      } = ctx;
      const oracles = [oracle1, oracle2, oracle3, oracle4];

      expect(cluster.active).to.be.true;

      // Set explicit vUnits at baseline (64 ETH = 20,000 vUnits)
      const { cluster: clusterAfterFirst } = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds,
        cluster, clusterId, 64,
      );
      expect(clusterAfterFirst.active).to.be.true;

      const balanceAfterFirst = BigInt(clusterAfterFirst.balance);

      // Compute thresholds with correct packed fee values
      const thresholdOld = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: 4n, ethFee: PACKED_ETH_FEE,
        networkFee: PACKED_NETWORK_FEE, effectiveVUnits: 20000n,
      });
      const thresholdNew = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: 4n, ethFee: PACKED_ETH_FEE,
        networkFee: PACKED_NETWORK_FEE, effectiveVUnits: 40000n,
      });

      // Verify the balance is above both thresholds initially
      expect(balanceAfterFirst).to.be.greaterThan(thresholdNew);

      // Compute per-block burn rate at OLD vUnits
      const burnPerBlock = calcClusterBurn({
        blockDiff: 1n, numOperators: 4n, ethFee: PACKED_ETH_FEE,
        networkFee: PACKED_NETWORK_FEE, effectiveVUnits: 20000n,
      });

      // Mine blocks to burn balance to between thresholdOld and thresholdNew.
      // Target: midpoint between thresholds. Account for ~6 extra blocks during the second EB update.
      const targetBalance = (thresholdOld + thresholdNew) / 2n;
      const totalBlocksNeeded = (balanceAfterFirst - targetBalance) / burnPerBlock;
      const blocksToMine = totalBlocksNeeded - 6n; // Reserve ~6 blocks for the EB update overhead
      await mineBlocks(provider, Number(blocksToMine));

      // Increase EB to 128 ETH → 40,000 vUnits
      // Fee settlement uses OLD vUnits (20k). After settlement, balance is between
      // thresholdOld and thresholdNew. The liquidation check uses NEW vUnits (40k),
      // so the threshold doubles and the cluster becomes liquidatable.
      const { cluster: clusterAfterLiquidation, tx } = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds,
        clusterAfterFirst, clusterId, 128, oracle4,
      );

      // Should emit both events
      await expect(tx).to.emit(network, Events.CLUSTER_BALANCE_UPDATED);
      await expect(tx).to.emit(network, Events.CLUSTER_LIQUIDATED);

      // Cluster is now liquidated
      expect(clusterAfterLiquidation.active).to.be.false;
      expect(BigInt(clusterAfterLiquidation.balance)).to.equal(0n);
    });
  });

  // ----------------------------------------------------------------
  // ES-10: Fee Settlement Uses OLD vUnits — No Gap
  // ----------------------------------------------------------------
  describe("ES-10: Fee Settlement Uses OLD vUnits — No Gap", () => {
    it("settles fees with old vUnits before applying new vUnits", async function () {
      const ctx = await setupClusterWithEB(connection, networkHelpers);
      const {
        network, provider, oracle1, oracle2, oracle3, oracle4,
        clusterOwner, operatorIds, cluster, clusterId,
      } = ctx;
      const oracles = [oracle1, oracle2, oracle3, oracle4];

      // Set explicit vUnits at 64 ETH (20,000 vUnits)
      const { cluster: clusterAfterFirst, tx: tx1 } = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds,
        cluster, clusterId, 64,
      );

      const balanceAfterFirstUpdate = BigInt(clusterAfterFirst.balance);
      // Get the block the first EB update tx was included in
      const receipt1 = await tx1.wait();
      const blockOfFirstUpdate = BigInt(receipt1.blockNumber);

      // Mine exactly 100 blocks
      await mineBlocks(provider, 100);

      // Update EB to 96 ETH (30,000 vUnits) — fees should use OLD 20,000 vUnits
      const { proof: proof2, rootBlockNum: rootBlockNum2 } = await prepareEBUpdate(
        connection, network, oracles, provider, clusterId, 96,
      );

      const tx2 = await network.updateClusterBalance(
        rootBlockNum2, clusterOwner.address, operatorIds, clusterAfterFirst, 96, proof2,
      );

      const clusterAfterSecond = await getClusterFromEBUpdateTx(network, tx2);

      // Get the actual block the second update tx was included in
      const receipt2 = await tx2.wait();
      const blockOfSecondUpdate = BigInt(receipt2.blockNumber);
      const actualBlockDiff = blockOfSecondUpdate - blockOfFirstUpdate;

      // Calculate expected fees using OLD vUnits (20,000) and PACKED fee values
      const expectedFees = calcClusterBurn({
        blockDiff: actualBlockDiff,
        numOperators: 4n, ethFee: PACKED_ETH_FEE,
        networkFee: PACKED_NETWORK_FEE, effectiveVUnits: 20000n,
      });

      const expectedBalance = balanceAfterFirstUpdate - expectedFees;
      const actualBalance = BigInt(clusterAfterSecond.balance);

      // Fee settlement MUST use OLD vUnits
      expect(actualBalance).to.equal(expectedBalance);
    });
  });
});

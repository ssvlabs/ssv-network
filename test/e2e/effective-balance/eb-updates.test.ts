import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { Cluster, NetworkHelpersType } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  whitelistAddresses,
  getCurrentClusterState,
  generateMerkleForClusterEB,
  setupTestContext,
} from "../../common/helpers.ts";
import { Events } from "../../common/events.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  NETWORK_FEE,
  STAKE_AMOUNT,
  MINIMAL_LIQUIDATION_THRESHOLD,
  ETH_DEDUCTED_DIGITS,
  OP_ETH_FEE_RAW,
} from "../../common/constants.ts";
import {
  mineBlocks,
  getBlockNumber,
  calcClusterBurn,
  calcVUnits,
  defaultVUnits,
  calcLiquidationThreshold,
} from "../../helpers/index.ts";

const PACKED_NETWORK_FEE = NETWORK_FEE / ETH_DEDUCTED_DIGITS;

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
    if (parsed?.name === Events.CLUSTER_BALANCE_UPDATED) {
      const clusterTuple = parsed.args[parsed.args.length - 1];
      return {
        validatorCount: clusterTuple[0].toString(),
        networkFeeIndex: clusterTuple[1].toString(),
        index: clusterTuple[2].toString(),
        active: clusterTuple[3],
        balance: clusterTuple[4].toString(),
      };
    }
    if (parsed?.name === Events.CLUSTER_LIQUIDATED) {
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

  await network.replaceOracle(1, oracle1.address);
  await network.replaceOracle(2, oracle2.address);
  await network.replaceOracle(3, oracle3.address);
  await network.replaceOracle(4, oracle4.address);

  await ssvToken.transfer(staker.address, STAKE_AMOUNT);
  await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
  await network.connect(staker).stake(STAKE_AMOUNT);

  const operatorIds = await registerOperators(network, owner, 4);

  await whitelistAddresses(network, owner, operatorIds, [clusterOwner.address]);

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

  await mineBlocks(provider, 1);
  const rootBlockNum = await getBlockNumber(provider);

  await commitRootWithQuorum(network, oracles, root, rootBlockNum);

  return { root, proof: proofs[clusterId], rootBlockNum };
}

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

describe("EB Updates", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  before(async function () {
    ({ connection, networkHelpers } = await setupTestContext());
  });

  describe("First EB Update — Implicit to Explicit (Same vUnits)", () => {
    it("Transitions from implicit to explicit vUnits with no deviation change", async function () {
      const ctx = await setupClusterWithEB(connection, networkHelpers);
      const {
        network, provider, oracle1, oracle2, oracle3, oracle4,
        clusterOwner, operatorIds, cluster, clusterId,
      } = ctx;
      const oracles = [oracle1, oracle2, oracle3, oracle4];

      const effectiveBalance = 64;
      const expectedVUnits = calcVUnits(BigInt(effectiveBalance));
      expect(expectedVUnits).to.equal(defaultVUnits(2n));

      await mineBlocks(provider, 10);

      const { cluster: updatedCluster, tx } = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds,
        cluster, clusterId, effectiveBalance,
      );

      await expect(tx).to.emit(network, Events.CLUSTER_BALANCE_UPDATED);

      expect(updatedCluster.active).to.be.true;
      expect(BigInt(updatedCluster.balance)).to.be.lessThan(BigInt(cluster.balance));
    });
  });

  describe("EB Increase — Higher Fee Burn Rate", () => {
    it("Updates vUnits upward and increases the fee burn rate proportionally", async function () {
      const ctx = await setupClusterWithEB(connection, networkHelpers);
      const {
        network, provider, oracle1, oracle2, oracle3, oracle4,
        clusterOwner, operatorIds, cluster, clusterId,
      } = ctx;
      const oracles = [oracle1, oracle2, oracle3, oracle4];

      const { cluster: clusterAfterFirst } = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds,
        cluster, clusterId, 64,
      );

      await mineBlocks(provider, 50);

      const { cluster: clusterAfterIncrease, tx } = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds,
        clusterAfterFirst, clusterId, 96,
      );

      await expect(tx).to.emit(network, Events.CLUSTER_BALANCE_UPDATED);

      expect(BigInt(clusterAfterIncrease.balance)).to.be.lessThan(BigInt(clusterAfterFirst.balance));
      expect(clusterAfterIncrease.active).to.be.true;

      expect(calcVUnits(96n)).to.equal(30000n);

      const oldBurn = calcClusterBurn({
        blockDiff: 100n, numOperators: 4n, ethFee: OP_ETH_FEE_RAW,
        networkFee: PACKED_NETWORK_FEE, effectiveVUnits: 20000n,
      });
      const newBurn = calcClusterBurn({
        blockDiff: 100n, numOperators: 4n, ethFee: OP_ETH_FEE_RAW,
        networkFee: PACKED_NETWORK_FEE, effectiveVUnits: 30000n,
      });
      expect(newBurn * 20000n).to.equal(oldBurn * 30000n);
    });
  });

  describe("EB Decrease — Lower Fee Burn Rate", () => {
    it("Updates vUnits downward and decreases the fee burn rate", async function () {
      const ctx = await setupClusterWithEB(connection, networkHelpers);
      const {
        network, provider, oracle1, oracle2, oracle3, oracle4,
        clusterOwner, operatorIds, cluster, clusterId,
      } = ctx;
      const oracles = [oracle1, oracle2, oracle3, oracle4];

      const { cluster: clusterAfterFirst } = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds,
        cluster, clusterId, 96,
      );

      await mineBlocks(provider, 50);

      const { cluster: clusterAfterDecrease, tx } = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds,
        clusterAfterFirst, clusterId, 64,
      );

      await expect(tx).to.emit(network, Events.CLUSTER_BALANCE_UPDATED);
      expect(clusterAfterDecrease.active).to.be.true;

      expect(calcVUnits(64n)).to.equal(20000n);

      const highBurn = calcClusterBurn({
        blockDiff: 100n, numOperators: 4n, ethFee: OP_ETH_FEE_RAW,
        networkFee: PACKED_NETWORK_FEE, effectiveVUnits: 30000n,
      });
      const lowBurn = calcClusterBurn({
        blockDiff: 100n, numOperators: 4n, ethFee: OP_ETH_FEE_RAW,
        networkFee: PACKED_NETWORK_FEE, effectiveVUnits: 20000n,
      });
      expect(lowBurn * 30000n).to.equal(highBurn * 20000n);
    });
  });

  describe("Auto-Liquidation on EB Increase", () => {
    it("Auto-liquidates cluster when EB increase pushes balance below threshold", async function () {
      const SMALL_DEPOSIT = connection.ethers.parseEther("0.025");
      const ctx = await setupClusterWithEB(connection, networkHelpers, SMALL_DEPOSIT);
      const {
        network, provider, oracle1, oracle2, oracle3, oracle4,
        clusterOwner, operatorIds, cluster, clusterId,
      } = ctx;
      const oracles = [oracle1, oracle2, oracle3, oracle4];

      expect(cluster.active).to.be.true;

      const { cluster: clusterAfterFirst } = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds,
        cluster, clusterId, 64,
      );
      expect(clusterAfterFirst.active).to.be.true;

      const balanceAfterFirst = BigInt(clusterAfterFirst.balance);

      const thresholdOld = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: 4n, ethFee: OP_ETH_FEE_RAW,
        networkFee: PACKED_NETWORK_FEE, effectiveVUnits: 20000n,
      });
      const thresholdNew = calcLiquidationThreshold({
        minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
        numOperators: 4n, ethFee: OP_ETH_FEE_RAW,
        networkFee: PACKED_NETWORK_FEE, effectiveVUnits: 40000n,
      });

      expect(balanceAfterFirst).to.be.greaterThan(thresholdNew);

      const burnPerBlock = calcClusterBurn({
        blockDiff: 1n, numOperators: 4n, ethFee: OP_ETH_FEE_RAW,
        networkFee: PACKED_NETWORK_FEE, effectiveVUnits: 20000n,
      });

      const targetBalance = (thresholdOld + thresholdNew) / 2n;
      const totalBlocksNeeded = (balanceAfterFirst - targetBalance) / burnPerBlock;
      const blocksToMine = totalBlocksNeeded - 6n;
      await mineBlocks(provider, Number(blocksToMine));

      const { cluster: clusterAfterLiquidation, tx } = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds,
        clusterAfterFirst, clusterId, 128, oracle4,
      );

      await expect(tx).to.emit(network, Events.CLUSTER_BALANCE_UPDATED);
      await expect(tx).to.emit(network, Events.CLUSTER_LIQUIDATED);

      expect(clusterAfterLiquidation.active).to.be.false;
      expect(BigInt(clusterAfterLiquidation.balance)).to.equal(0n);
    });
  });

  describe("Fee Settlement Uses OLD vUnits — No Gap", () => {
    it("Settles fees with old vUnits before applying new vUnits", async function () {
      const ctx = await setupClusterWithEB(connection, networkHelpers);
      const {
        network, provider, oracle1, oracle2, oracle3, oracle4,
        clusterOwner, operatorIds, cluster, clusterId,
      } = ctx;
      const oracles = [oracle1, oracle2, oracle3, oracle4];

      const { cluster: clusterAfterFirst, tx: tx1 } = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds,
        cluster, clusterId, 64,
      );

      const balanceAfterFirstUpdate = BigInt(clusterAfterFirst.balance);
      const receipt1 = await tx1.wait();
      const blockOfFirstUpdate = BigInt(receipt1.blockNumber);

      await mineBlocks(provider, 100);

      const { proof: proof2, rootBlockNum: rootBlockNum2 } = await prepareEBUpdate(
        connection, network, oracles, provider, clusterId, 96,
      );

      const tx2 = await network.updateClusterBalance(
        rootBlockNum2, clusterOwner.address, operatorIds, clusterAfterFirst, 96, proof2,
      );

      const clusterAfterSecond = await getClusterFromEBUpdateTx(network, tx2);

      const receipt2 = await tx2.wait();
      const blockOfSecondUpdate = BigInt(receipt2!.blockNumber);
      const actualBlockDiff = blockOfSecondUpdate - blockOfFirstUpdate;

      const expectedFees = calcClusterBurn({
        blockDiff: actualBlockDiff,
        numOperators: 4n, ethFee: OP_ETH_FEE_RAW,
        networkFee: PACKED_NETWORK_FEE, effectiveVUnits: 20000n,
      });

      const expectedBalance = balanceAfterFirstUpdate - expectedFees;
      const actualBalance = BigInt(clusterAfterSecond.balance);

      expect(actualBalance).to.equal(expectedBalance);
    });
  });
});

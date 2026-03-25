import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { Cluster, NetworkHelpersType } from "../../common/types.ts";
import {
  registerOperators,
  whitelistAddresses,
  makePublicKey,
  parseClusterFromEvent,
  generateMerkleForClusterEB,
} from "../../common/helpers.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
  STAKE_AMOUNT,
  BPS_DENOMINATOR,
} from "../../common/constants.ts";
import { Events } from "../../common/events.ts";
import { ethers } from "ethers";

// ---------------------------------------------------------------------------
//  Diamond storage reader for latestCommittedBlock
// ---------------------------------------------------------------------------
function ebStorageBaseSlot(): bigint {
  return BigInt(ethers.keccak256(ethers.toUtf8Bytes("ssv.network.storage.eb"))) - 1n;
}

/**
 * Read seb.latestCommittedBlock from contract storage.
 * latestCommittedBlock is field index 3 in StorageEB.
 * It's a uint64 at the low bits of its slot.
 */
async function readLatestCommittedBlock(
  provider: any,
  contractAddress: string,
): Promise<bigint> {
  const slot = ebStorageBaseSlot() + 3n;
  const raw = BigInt(await provider.getStorage(contractAddress, "0x" + slot.toString(16)));
  return raw & 0xFFFFFFFFFFFFFFFFn;
}

describe("ITEST-1 Integration: commitRoot -> updateClusterBalance E2E", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let operatorOwner: HardhatEthersSigner;
  let clusterOwnerA: HardhatEthersSigner;
  let clusterOwnerB: HardhatEthersSigner;
  let staker: HardhatEthersSigner;
  let oracle1: HardhatEthersSigner;
  let oracle2: HardhatEthersSigner;
  let oracle3: HardhatEthersSigner;
  let oracle4: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    const signers = await connection.ethers.getSigners();
    operatorOwner = signers[1];
    clusterOwnerA = signers[2];
    clusterOwnerB = signers[3];
    staker = signers[4];
    [oracle1, oracle2, oracle3, oracle4] = signers.slice(10, 14);
  });

  const deployFixture = async () => ssvNetworkFullFixture(connection);

  const getClusterId = (ownerAddress: string, operatorIds: number[]): string => {
    return ethers.keccak256(
      ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds.map(BigInt)])
    );
  };

  const toClusterArg = (cluster: Cluster) => ({
    validatorCount: Number(cluster.validatorCount),
    networkFeeIndex: BigInt(cluster.networkFeeIndex),
    index: BigInt(cluster.index),
    active: cluster.active,
    balance: BigInt(cluster.balance),
  });

  const setupOraclesAndStake = async (network: any, ssvToken: any): Promise<HardhatEthersSigner[]> => {
    const oracles = [oracle1, oracle2, oracle3, oracle4];
    for (let i = 0; i < oracles.length; i++) {
      await network.replaceOracle(i + 1, oracles[i].address);
    }

    await ssvToken.mint(staker.address, STAKE_AMOUNT);
    await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
    await network.connect(staker).stake(STAKE_AMOUNT);

    return oracles;
  };

  const commitRootWithThreeOracles = async (
    network: any,
    oracles: HardhatEthersSigner[],
    root: string,
    blockNum: number
  ) => {
    const tx1 = await network.connect(oracles[0]).commitRoot(root, blockNum);
    await expect(tx1).to.emit(network, Events.WEIGHTED_ROOT_PROPOSED);

    const tx2 = await network.connect(oracles[1]).commitRoot(root, blockNum);
    await expect(tx2).to.emit(network, Events.WEIGHTED_ROOT_PROPOSED);

    const tx3 = await network.connect(oracles[2]).commitRoot(root, blockNum);
    await expect(tx3).to.emit(network, Events.ROOT_COMMITTED).withArgs(root, blockNum);
  };

  const registerOneValidatorCluster = async (
    network: any,
    owner: HardhatEthersSigner,
    operatorIds: number[],
    validatorSeed: number
  ): Promise<{ cluster: Cluster; registerBlock: bigint }> => {
    const tx = await network.connect(owner).registerValidator(
      makePublicKey(validatorSeed),
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );
    const receipt = await tx.wait();
    return {
      cluster: parseClusterFromEvent(network, receipt, Events.VALIDATOR_ADDED),
      registerBlock: BigInt(receipt.blockNumber),
    };
  };

  it("3 oracles commit root, then updateClusterBalance applies EB=64 and doubles post-update fee accrual", async function () {
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFixture);
    const oracles = await setupOraclesAndStake(network, ssvToken);

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwnerA.address]);

    const { cluster } = await registerOneValidatorCluster(network, clusterOwnerA, operatorIds, 1);

    const clusterId = getClusterId(clusterOwnerA.address, operatorIds);
    const { root, proofs } = generateMerkleForClusterEB(connection, [{ clusterId, effectiveBalance: 64 }]);
    const blockNum = await connection.ethers.provider.getBlockNumber();

    await commitRootWithThreeOracles(network, oracles, root, blockNum);
    expect(await views.getCommittedRoot(blockNum)).to.equal(root);

    // INV-030: Record latestCommittedBlock before updateClusterBalance
    const contractAddress = await network.getAddress();
    const latestCommittedBlockBefore = await readLatestCommittedBlock(connection.ethers.provider, contractAddress);
    expect(latestCommittedBlockBefore).to.equal(BigInt(blockNum), "INV-030: latestCommittedBlock == committed root blockNum");

    const updateTx = await network.updateClusterBalance(
      blockNum,
      clusterOwnerA.address,
      operatorIds.map(BigInt),
      toClusterArg(cluster),
      64,
      proofs[clusterId]
    );
    const updateReceipt = await updateTx.wait();
    const clusterAfterUpdate = parseClusterFromEvent(network, updateReceipt, Events.CLUSTER_BALANCE_UPDATED);
    expect(clusterAfterUpdate.active).to.equal(true);

    // INV-030: latestCommittedBlock unchanged after updateClusterBalance
    const latestCommittedBlockAfter = await readLatestCommittedBlock(connection.ethers.provider, contractAddress);
    expect(latestCommittedBlockAfter).to.equal(latestCommittedBlockBefore, "INV-030: updateClusterBalance does not modify latestCommittedBlock");

    const blocksToMine = 40;
    const earningsBefore = await views.getOperatorEarnings(operatorIds[0]);
    await networkHelpers.mine(blocksToMine);
    const earningsAfter = await views.getOperatorEarnings(operatorIds[0]);

    const actualDelta = earningsAfter - earningsBefore;
    const expectedPostUpdateDelta = BigInt(blocksToMine) * MINIMAL_OPERATOR_ETH_FEE * 2n;
    const expectedBaselineDelta = BigInt(blocksToMine) * MINIMAL_OPERATOR_ETH_FEE;

    expect(expectedPostUpdateDelta).to.equal(expectedBaselineDelta * 2n);
    expect(actualDelta).to.equal(expectedPostUpdateDelta);
  });

  it("Two clusters update from the same committed root and settle independently per-cluster", async function () {
    const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFixture);
    const oracles = await setupOraclesAndStake(network, ssvToken);

    const operatorIds = await registerOperators(network, operatorOwner, 4);
    await whitelistAddresses(
      network,
      operatorOwner,
      operatorIds,
      [clusterOwnerA.address, clusterOwnerB.address]
    );

    const { cluster: clusterA } = await registerOneValidatorCluster(network, clusterOwnerA, operatorIds, 1);
    const { cluster: clusterB } = await registerOneValidatorCluster(network, clusterOwnerB, operatorIds, 2);

    const clusterIdA = getClusterId(clusterOwnerA.address, operatorIds);
    const clusterIdB = getClusterId(clusterOwnerB.address, operatorIds);

    const { root, proofs } = generateMerkleForClusterEB(connection, [
      { clusterId: clusterIdA, effectiveBalance: 32 },
      { clusterId: clusterIdB, effectiveBalance: 64 },
    ]);

    const blockNum = await connection.ethers.provider.getBlockNumber();
    await commitRootWithThreeOracles(network, oracles, root, blockNum);
    expect(await views.getCommittedRoot(blockNum)).to.equal(root);

    const updateTxA = await network.updateClusterBalance(
      blockNum,
      clusterOwnerA.address,
      operatorIds.map(BigInt),
      toClusterArg(clusterA),
      32,
      proofs[clusterIdA]
    );
    const updateReceiptA = await updateTxA.wait();
    const clusterAAfterUpdate = parseClusterFromEvent(network, updateReceiptA, Events.CLUSTER_BALANCE_UPDATED);

    const updateTxB = await network.updateClusterBalance(
      blockNum,
      clusterOwnerB.address,
      operatorIds.map(BigInt),
      toClusterArg(clusterB),
      64,
      proofs[clusterIdB]
    );
    const updateReceiptB = await updateTxB.wait();
    const clusterBAfterUpdate = parseClusterFromEvent(network, updateReceiptB, Events.CLUSTER_BALANCE_UPDATED);

    const blockBeforeAccrual = await connection.ethers.provider.getBlockNumber();
    const earningsBefore = await views.getOperatorEarnings(operatorIds[0]);
    const balanceABefore = await views.getBalance(
      clusterOwnerA.address,
      operatorIds,
      toClusterArg(clusterAAfterUpdate)
    );
    const balanceBBefore = await views.getBalance(
      clusterOwnerB.address,
      operatorIds,
      toClusterArg(clusterBAfterUpdate)
    );

    const blocksToMine = 25;
    await networkHelpers.mine(blocksToMine);
    const blockAfterAccrual = await connection.ethers.provider.getBlockNumber();

    const earningsAfter = await views.getOperatorEarnings(operatorIds[0]);
    const balanceAAfter = await views.getBalance(
      clusterOwnerA.address,
      operatorIds,
      toClusterArg(clusterAAfterUpdate)
    );
    const balanceBAfter = await views.getBalance(
      clusterOwnerB.address,
      operatorIds,
      toClusterArg(clusterBAfterUpdate)
    );

    const blocksDelta = BigInt(blockAfterAccrual - blockBeforeAccrual);
    const combinedExpectedEarningsDelta = blocksDelta * MINIMAL_OPERATOR_ETH_FEE * 3n;
    expect(earningsAfter - earningsBefore).to.equal(combinedExpectedEarningsDelta);

    const feeRatePerBlockAtDefaultVUnits = (4n * MINIMAL_OPERATOR_ETH_FEE) + (await views.getNetworkFee());
    const expectedBalanceDeltaA = blocksDelta * feeRatePerBlockAtDefaultVUnits;
    const expectedBalanceDeltaB = (blocksDelta * feeRatePerBlockAtDefaultVUnits * 20_000n) / BPS_DENOMINATOR;

    expect(balanceABefore - balanceAAfter).to.equal(expectedBalanceDeltaA);
    expect(balanceBBefore - balanceBAfter).to.equal(expectedBalanceDeltaB);
  });
});

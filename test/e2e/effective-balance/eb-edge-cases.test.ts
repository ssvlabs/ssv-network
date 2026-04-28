import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { Cluster } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  whitelistAddresses,
  getCurrentClusterState,
  generateMerkleForClusterEB,
  setupTestContext,
} from "../../common/helpers.ts";
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  STAKE_AMOUNT,
} from "../../common/constants.ts";
import {
  mineBlocks,
  getBlockNumber,
} from "../../helpers/index.ts";
import { ethers as ethersLib } from "ethers";

async function getClusterFromEBUpdateTx(network: any, tx: any): Promise<Cluster> {
  const receipt = await tx.wait();
  for (const log of receipt.logs ?? []) {
    let parsed;
    try { parsed = network.interface.parseLog(log); } catch { continue; }
    if (parsed?.name === Events.CLUSTER_BALANCE_UPDATED || parsed?.name === Events.CLUSTER_LIQUIDATED) {
      const ct = parsed.args[parsed.args.length - 1];
      return {
        validatorCount: ct[0].toString(), networkFeeIndex: ct[1].toString(),
        index: ct[2].toString(), active: ct[3], balance: ct[4].toString(),
      };
    }
  }
  throw new Error("ClusterBalanceUpdated event not found");
}

async function setMinBlocksBetweenUpdates(
  provider: any,
  networkAddress: string,
  value: number,
): Promise<void> {
  const baseSlot = BigInt(ethersLib.keccak256(ethersLib.toUtf8Bytes("ssv.network.storage.eb"))) - 1n;
  const targetSlot = baseSlot + 3n;
  const slotHex = "0x" + targetSlot.toString(16).padStart(64, "0");

  const currentValue = await provider.getStorage(networkAddress, slotHex);
  const currentBigInt = BigInt(currentValue);

  const mask32at64 = ((1n << 32n) - 1n) << 64n;
  const cleared = currentBigInt & ~mask32at64;
  const newValue = cleared | (BigInt(value) << 64n);

  const newValueHex = "0x" + newValue.toString(16).padStart(64, "0");
  await provider.send("hardhat_setStorageAt", [networkAddress, slotHex, newValueHex]);
}

async function setupCluster(connection: NetworkConnection<"generic">) {
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
    makePublicKey(1), operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER,
    { value: DEFAULT_ETH_REGISTER_VALUE },
  );
  let cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

  await network.connect(clusterOwner).registerValidator(
    makePublicKey(2), operatorIds, DEFAULT_SHARES, cluster,
    { value: DEFAULT_ETH_REGISTER_VALUE },
  );
  cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

  const clusterId = connection.ethers.keccak256(
    connection.ethers.solidityPacked(["address", "uint64[]"], [clusterOwner.address, operatorIds]),
  );

  const oracles = [oracle1, oracle2, oracle3, oracle4];

  return {
    network, views, cssvToken, ssvToken, provider,
    owner, oracles, staker, clusterOwner,
    operatorIds, cluster, clusterId,
  };
}

async function commitRootWithQuorum(
  network: any, oracles: HardhatEthersSigner[], root: string, blockNum: number,
) {
  await network.connect(oracles[0]).commitRoot(root, blockNum);
  await network.connect(oracles[1]).commitRoot(root, blockNum);
  await network.connect(oracles[2]).commitRoot(root, blockNum);
}

async function performEBUpdate(
  connection: NetworkConnection<"generic">,
  network: any, oracles: HardhatEthersSigner[], provider: any,
  clusterOwner: HardhatEthersSigner, operatorIds: number[],
  cluster: Cluster, clusterId: string, effectiveBalance: number,
): Promise<{ cluster: Cluster; rootBlockNum: number }> {
  const { root, proofs } = generateMerkleForClusterEB(connection, [
    { clusterId, effectiveBalance },
  ]);
  await mineBlocks(provider, 1);
  const rootBlockNum = await getBlockNumber(provider);
  await commitRootWithQuorum(network, oracles, root, rootBlockNum);

  const tx = await network.updateClusterBalance(
    rootBlockNum, clusterOwner.address, operatorIds, cluster, effectiveBalance, proofs[clusterId],
  );
  const updatedCluster = await getClusterFromEBUpdateTx(network, tx);
  return { cluster: updatedCluster, rootBlockNum };
}

describe("EB Edge Cases", () => {
  let connection: NetworkConnection<"generic">;

  before(async function () {
    ({ connection } = await setupTestContext());
  });

  describe("EB Limits Enforcement", () => {
    it("Reverts when effectiveBalance is below minimum (< validatorCount * 32)", async function () {
      const ctx = await setupCluster(connection);
      const { network, provider, oracles, clusterOwner, operatorIds, cluster, clusterId } = ctx;

      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: 63 },
      ]);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitRootWithQuorum(network, oracles, root, rootBlockNum);

      await expect(
        network.updateClusterBalance(
          rootBlockNum, clusterOwner.address, operatorIds, cluster, 63, proofs[clusterId],
        ),
      ).to.be.revertedWithCustomError(network, Errors.EB_BELOW_MINIMUM);
    });

    it("Succeeds when effectiveBalance is exactly at minimum (validatorCount * 32)", async function () {
      const ctx = await setupCluster(connection);
      const { network, provider, oracles, clusterOwner, operatorIds, cluster, clusterId } = ctx;

      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: 64 },
      ]);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitRootWithQuorum(network, oracles, root, rootBlockNum);

      await expect(
        network.updateClusterBalance(
          rootBlockNum, clusterOwner.address, operatorIds, cluster, 64, proofs[clusterId],
        ),
      ).to.emit(network, Events.CLUSTER_BALANCE_UPDATED);
    });

    it("Reverts when effectiveBalance exceeds maximum (> validatorCount * 2048)", async function () {
      const ctx = await setupCluster(connection);
      const { network, provider, oracles, clusterOwner, operatorIds, cluster, clusterId } = ctx;

      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: 4097 },
      ]);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitRootWithQuorum(network, oracles, root, rootBlockNum);

      await expect(
        network.updateClusterBalance(
          rootBlockNum, clusterOwner.address, operatorIds, cluster, 4097, proofs[clusterId],
        ),
      ).to.be.revertedWithCustomError(network, Errors.EB_EXCEEDS_MAXIMUM);
    });

    it("Succeeds when effectiveBalance is exactly at maximum (validatorCount * 2048)", async function () {
      const ctx = await setupCluster(connection);
      const { network, provider, oracles, clusterOwner, operatorIds, cluster, clusterId } = ctx;

      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: 4096 },
      ]);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitRootWithQuorum(network, oracles, root, rootBlockNum);

      await expect(
        network.updateClusterBalance(
          rootBlockNum, clusterOwner.address, operatorIds, cluster, 4096, proofs[clusterId],
        ),
      ).to.emit(network, Events.CLUSTER_BALANCE_UPDATED);
    });
  });

  describe("Merkle Proof Verification", () => {
    it("Accepts a valid merkle proof", async function () {
      const ctx = await setupCluster(connection);
      const { network, provider, oracles, clusterOwner, operatorIds, cluster, clusterId } = ctx;

      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: 64 },
      ]);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitRootWithQuorum(network, oracles, root, rootBlockNum);

      await expect(
        network.updateClusterBalance(
          rootBlockNum, clusterOwner.address, operatorIds, cluster, 64, proofs[clusterId],
        ),
      ).to.emit(network, Events.CLUSTER_BALANCE_UPDATED);
    });

    it("Reverts with invalid proof path", async function () {
      const ctx = await setupCluster(connection);
      const { network, provider, oracles, clusterOwner, operatorIds, cluster, clusterId } = ctx;

      const { root } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: 64 },
      ]);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitRootWithQuorum(network, oracles, root, rootBlockNum);

      const fakeProof = [connection.ethers.keccak256(connection.ethers.toUtf8Bytes("fake"))];
      await expect(
        network.updateClusterBalance(
          rootBlockNum, clusterOwner.address, operatorIds, cluster, 64, fakeProof,
        ),
      ).to.be.revertedWithCustomError(network, Errors.INVALID_PROOF);
    });

    it("Reverts when proof is for a different cluster", async function () {
      const ctx = await setupCluster(connection);
      const { network, provider, oracles, clusterOwner, operatorIds, cluster, clusterId } = ctx;

      const fakeClusterId = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("wrong-cluster"));
      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId: fakeClusterId, effectiveBalance: 64 },
      ]);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitRootWithQuorum(network, oracles, root, rootBlockNum);

      await expect(
        network.updateClusterBalance(
          rootBlockNum, clusterOwner.address, operatorIds, cluster, 64, proofs[fakeClusterId],
        ),
      ).to.be.revertedWithCustomError(network, Errors.INVALID_PROOF);
    });

    it("Reverts when EB value doesn't match the proof", async function () {
      const ctx = await setupCluster(connection);
      const { network, provider, oracles, clusterOwner, operatorIds, cluster, clusterId } = ctx;

      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: 64 },
      ]);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitRootWithQuorum(network, oracles, root, rootBlockNum);

      await expect(
        network.updateClusterBalance(
          rootBlockNum, clusterOwner.address, operatorIds, cluster, 96, proofs[clusterId],
        ),
      ).to.be.revertedWithCustomError(network, Errors.INVALID_PROOF);
    });
  });

  describe("Update Frequency and Staleness", () => {
    it("Reverts when update is too frequent (minBlocksBetweenUpdates)", async function () {
      const ctx = await setupCluster(connection);
      const { network, provider, oracles, clusterOwner, operatorIds, cluster, clusterId } = ctx;

      await setMinBlocksBetweenUpdates(provider, await network.getAddress(), 100);

      const { cluster: clusterAfterFirst } = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds,
        cluster, clusterId, 64,
      );

      await mineBlocks(provider, 50);

      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: 96 },
      ]);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitRootWithQuorum(network, oracles, root, rootBlockNum);

      await expect(
        network.updateClusterBalance(
          rootBlockNum, clusterOwner.address, operatorIds, clusterAfterFirst, 96, proofs[clusterId],
        ),
      ).to.be.revertedWithCustomError(network, Errors.UPDATE_TOO_FREQUENT);
    });

    it("Succeeds when enough blocks have passed", async function () {
      const ctx = await setupCluster(connection);
      const { network, provider, oracles, clusterOwner, operatorIds, cluster, clusterId } = ctx;

      await setMinBlocksBetweenUpdates(provider, await network.getAddress(), 100);

      const { cluster: clusterAfterFirst } = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds,
        cluster, clusterId, 64,
      );

      await mineBlocks(provider, 100);

      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: 96 },
      ]);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitRootWithQuorum(network, oracles, root, rootBlockNum);

      await expect(
        network.updateClusterBalance(
          rootBlockNum, clusterOwner.address, operatorIds, clusterAfterFirst, 96, proofs[clusterId],
        ),
      ).to.emit(network, Events.CLUSTER_BALANCE_UPDATED);
    });

    it("First update always passes frequency check (lastUpdateBlock == 0)", async function () {
      const ctx = await setupCluster(connection);
      const { network, provider, oracles, clusterOwner, operatorIds, cluster, clusterId } = ctx;

      await setMinBlocksBetweenUpdates(provider, await network.getAddress(), 1000);

      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: 64 },
      ]);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitRootWithQuorum(network, oracles, root, rootBlockNum);

      await expect(
        network.updateClusterBalance(
          rootBlockNum, clusterOwner.address, operatorIds, cluster, 64, proofs[clusterId],
        ),
      ).to.emit(network, Events.CLUSTER_BALANCE_UPDATED);
    });

    it("Reverts with MustUseLatestRoot when a newer root has already been committed", async function () {
      const ctx = await setupCluster(connection);
      const { network, provider, oracles, clusterOwner, operatorIds, cluster, clusterId } = ctx;

      const { cluster: clusterAfterFirst, rootBlockNum: rootBlockNum1 } = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds,
        cluster, clusterId, 64,
      );

      await mineBlocks(provider, 5);
      {
        const { root } = generateMerkleForClusterEB(connection, [
          { clusterId, effectiveBalance: 96 },
        ]);
        const rootBlockNumNew = await getBlockNumber(provider);
        await commitRootWithQuorum(network, oracles, root, rootBlockNumNew);
      }

      const { root: oldRoot, proofs: oldProofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: 64 },
      ]);
      await expect(
        network.updateClusterBalance(
          rootBlockNum1, clusterOwner.address, operatorIds, clusterAfterFirst, 64, oldProofs[clusterId],
        ),
      ).to.be.revertedWithCustomError(network, Errors.MUST_USE_LATEST_ROOT);
    });

    it("Reverts with StaleUpdate when replaying the latest root after a successful update", async function () {
      const ctx = await setupCluster(connection);
      const { network, provider, oracles, clusterOwner, operatorIds, cluster, clusterId } = ctx;

      const { cluster: clusterAfterFirst, rootBlockNum: rootBlockNum1 } = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds,
        cluster, clusterId, 64,
      );

      const { proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: 64 },
      ]);

      await expect(
        network.updateClusterBalance(
          rootBlockNum1, clusterOwner.address, operatorIds, clusterAfterFirst, 64, proofs[clusterId],
        ),
      ).to.be.revertedWithCustomError(network, Errors.STALE_UPDATE);
    });

    it("First update always passes staleness check (lastRootBlockNum == 0)", async function () {
      const ctx = await setupCluster(connection);
      const { network, provider, oracles, clusterOwner, operatorIds, cluster, clusterId } = ctx;

      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: 64 },
      ]);
      await mineBlocks(provider, 1);
      const rootBlockNum = await getBlockNumber(provider);
      await commitRootWithQuorum(network, oracles, root, rootBlockNum);

      await expect(
        network.updateClusterBalance(
          rootBlockNum, clusterOwner.address, operatorIds, cluster, 64, proofs[clusterId],
        ),
      ).to.emit(network, Events.CLUSTER_BALANCE_UPDATED);
    });

    it("Reverts with MustUseLatestRoot when trying to use an older root after two updates", async function () {
      const ctx = await setupCluster(connection);
      const { network, provider, oracles, clusterOwner, operatorIds, cluster, clusterId } = ctx;

      await mineBlocks(provider, 5);
      const { cluster: clusterAfterFirst, rootBlockNum: rootBlockNum1 } = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds,
        cluster, clusterId, 64,
      );

      await mineBlocks(provider, 5);
      const { cluster: clusterAfterSecond, rootBlockNum: rootBlockNum2 } = await performEBUpdate(
        connection, network, oracles, provider, clusterOwner, operatorIds,
        clusterAfterFirst, clusterId, 96,
      );

      const { root, proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: 64 },
      ]);
      await expect(
        network.updateClusterBalance(
          rootBlockNum1, clusterOwner.address, operatorIds, clusterAfterSecond, 64, proofs[clusterId],
        ),
      ).to.be.revertedWithCustomError(network, Errors.MUST_USE_LATEST_ROOT);
    });

    it("RootNotFound: reverts when no root committed for blockNum", async function () {
      const ctx = await setupCluster(connection);
      const { network, clusterOwner, operatorIds, cluster, clusterId } = ctx;

      const { proofs } = generateMerkleForClusterEB(connection, [
        { clusterId, effectiveBalance: 64 },
      ]);

      await expect(
        network.updateClusterBalance(
          999, clusterOwner.address, operatorIds, cluster, 64, proofs[clusterId],
        ),
      ).to.be.revertedWithCustomError(network, Errors.ROOT_NOT_FOUND);
    });
  });
});

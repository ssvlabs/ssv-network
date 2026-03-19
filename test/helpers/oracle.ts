import { ethers } from "ethers";
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import type { SSVNetwork } from '../../types/ethers-contracts/index.js';
import type { Cluster } from '../common/types.ts';
import { STAKE_AMOUNT } from '../common/constants.ts';
import { parseClusterFromEvent } from './cluster.ts';
import { Events } from '../common/events.ts';

export function computeClusterId(ownerAddress: string, operatorIds: (number | bigint)[]): string {
  return ethers.keccak256(ethers.solidityPacked(["address", "uint64[]"], [ownerAddress, operatorIds]));
}

export function computeEBRoot(clusterId: string, effectiveBalance: number): string {
  const coder = ethers.AbiCoder.defaultAbiCoder();
  const innerHash = ethers.keccak256(coder.encode(["bytes32", "uint32"], [clusterId, effectiveBalance]));
  return ethers.keccak256(ethers.solidityPacked(["bytes32"], [innerHash]));
}

export async function setupOracles(network: any, ssvToken: any, staker: any, oracles: any[]): Promise<void> {
  for (let i = 0; i < oracles.length; i++) {
    await network.replaceOracle(i + 1, oracles[i].address);
  }
  await ssvToken.mint(staker.address, STAKE_AMOUNT);
  await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
  await network.connect(staker).stake(STAKE_AMOUNT);
}

export async function commitEBRoot(network: any, root: string, blockNum: number, oracles: any[]): Promise<any> {
  if (oracles.length < 3) {
    throw new Error("commitEBRoot requires at least 3 oracle signers for quorum");
  }
  await network.connect(oracles[0]).commitRoot(root, blockNum);
  await network.connect(oracles[1]).commitRoot(root, blockNum);
  const tx = await network.connect(oracles[2]).commitRoot(root, blockNum);
  return tx.wait();
}

export function generateMerkleForClusterEB(connection: any, entries: {
  clusterId: string;
  effectiveBalance: number;
}[]): {
  root: string;
  proofs: Record<string, string[]>;
} {
  if (entries.length === 0) {
    return { root: connection.ethers.ZeroHash, proofs: {} };
  }
  const leafMap = new Map<string, string>();
  const leaves: string[] = [];
  for (const { clusterId, effectiveBalance } of entries) {
    const encoded = connection.ethers.AbiCoder.defaultAbiCoder().encode(["bytes32", "uint32"], [clusterId, effectiveBalance]);
    const innerHash = connection.ethers.keccak256(encoded);
    const leaf = connection.ethers.keccak256(innerHash);
    leaves.push(leaf);
    leafMap.set(clusterId, leaf);
  }
  leaves.sort((a, b) => (BigInt(a) < BigInt(b) ? -1 : BigInt(a) > BigInt(b) ? 1 : 0));
  let layer = leaves.slice();
  const layers: string[][] = [layer];
  while (layer.length > 1) {
    const nextLayer: string[] = [];
    for (let i = 0; i < layer.length; i += 2) {
      const left = layer[i];
      const right = i + 1 < layer.length ? layer[i + 1] : left;
      const parent = BigInt(left) < BigInt(right)
        ? connection.ethers.keccak256(connection.ethers.concat([left, right]))
        : connection.ethers.keccak256(connection.ethers.concat([right, left]));
      nextLayer.push(parent);
    }
    layer = nextLayer;
    layers.push(layer);
  }
  const root = layer[0] ?? connection.ethers.ZeroHash;
  const proofs: Record<string, string[]> = {};
  for (const { clusterId } of entries) {
    const leaf = leafMap.get(clusterId)!;
    let idx = leaves.indexOf(leaf);
    const proof: string[] = [];
    for (let level = 0; level < layers.length - 1; level++) {
      const isLeft = idx % 2 === 0;
      const siblingIdx = isLeft ? idx + 1 : idx - 1;
      if (siblingIdx < layers[level].length) {
        proof.push(layers[level][siblingIdx]);
      }
      idx = Math.floor(idx / 2);
    }
    proofs[clusterId] = proof;
  }
  return { root, proofs };
}

export function buildEBMerkleForDefaultClusters(connection: any, registered: {
  clusters: Array<{
    owner: HardhatEthersSigner;
    cluster: Cluster;
    validatorKey: string;
  }>;
  operatorIds: number[];
}, effectiveBalance: number): {
  root: string;
  proofsByOwner: Record<string, {
    proof: string[];
    cluster: Cluster;
    clusterId: string;
  }>;
} {
  const { clusters, operatorIds } = registered;
  const entries = clusters.map(({ owner }) => {
    const clusterId = connection.ethers.keccak256(connection.ethers.solidityPacked(["address", "uint64[]"], [owner.address, operatorIds]));
    return { clusterId, effectiveBalance };
  });
  const { root, proofs: rawProofs } = generateMerkleForClusterEB(connection, entries);
  const proofsByOwner: Record<string, {
    proof: string[];
    cluster: Cluster;
    clusterId: string;
  }> = {};
  clusters.forEach((info, i) => {
    const clusterId = entries[i].clusterId;
    proofsByOwner[info.owner.address] = {
      proof: rawProofs[clusterId],
      cluster: info.cluster,
      clusterId,
    };
  });
  return { root, proofsByOwner };
}

export async function mockEBAndUpdate(clusters: any, ownerAddress: string, operatorIds: bigint[], cluster: any, effectiveBalance: number, blockNum: number): Promise<{
  cluster: Cluster;
  block: bigint;
}> {
  const clusterId = computeClusterId(ownerAddress, operatorIds);
  const root = computeEBRoot(clusterId, effectiveBalance);
  await clusters.mockSetEBRoot(blockNum, root);
  const tx = await clusters.updateClusterBalance(blockNum, ownerAddress, operatorIds, cluster, effectiveBalance, []);
  const receipt = await tx.wait();
  return {
    cluster: parseClusterFromEvent(clusters, receipt, Events.CLUSTER_BALANCE_UPDATED),
    block: BigInt(receipt!.blockNumber),
  };
}

export async function updateClusterBalancesForDefaultClusters(network: SSVNetwork, registered: {
  clusters: Array<{
    owner: HardhatEthersSigner;
    cluster: Cluster;
    validatorKey: string;
  }>;
  operatorIds: number[];
}, merkleData: {
  root: string;
  proofsByOwner: Record<string, {
    proof: string[];
    cluster: Cluster;
    clusterId: string;
  }>;
}, blockNum: number, effectiveBalance: number, selectedOwners?: string[]): Promise<void> {
  const ownersToUpdate = selectedOwners ?? Object.keys(merkleData.proofsByOwner);
  const operatorIdsBigInt = registered.operatorIds.map(id => BigInt(id));
  for (const ownerAddr of ownersToUpdate) {
    const { proof, cluster } = merkleData.proofsByOwner[ownerAddr];
    const clusterStruct = {
      validatorCount: Number(cluster.validatorCount),
      networkFeeIndex: BigInt(cluster.networkFeeIndex),
      index: BigInt(cluster.index),
      active: cluster.active,
      balance: BigInt(cluster.balance),
    };
    const tx = await network.updateClusterBalance(blockNum, ownerAddr, operatorIdsBigInt, clusterStruct, effectiveBalance, proof);
    await tx.wait();
  }
}

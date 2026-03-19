/**
 * Event scanning to build initial state from a mainnet fork.
 *
 * Discovers operators and clusters by paginating through on-chain events
 * in 10k-block chunks. Used to seed the simulation's operator pool
 * with real mainnet operators.
 */

import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import type { OperatorRecord } from "./types.ts";
import type { SeededRNG } from "./rng.ts";

/** ABI fragments for discovery events */
const OPERATOR_ADDED_ABI = [
  "event OperatorAdded(uint64 indexed operatorId, address indexed owner, bytes publicKey, uint256 fee)",
];

const OPERATOR_REMOVED_ABI = [
  "event OperatorRemoved(uint64 indexed operatorId)",
];

const CLUSTER_EVENT_ABI = [
  "event ValidatorAdded(address indexed owner, uint64[] operatorIds, bytes publicKey, bytes shares, tuple(uint32, uint64, uint64, bool, uint256) cluster)",
  "event ValidatorRemoved(address indexed owner, uint64[] operatorIds, bytes publicKey, tuple(uint32, uint64, uint64, bool, uint256) cluster)",
  "event ClusterDeposited(address indexed owner, uint64[] operatorIds, uint256 value, tuple(uint32, uint64, uint64, bool, uint256) cluster)",
  "event ClusterWithdrawn(address indexed owner, uint64[] operatorIds, uint256 value, tuple(uint32, uint64, uint64, bool, uint256) cluster)",
  "event ClusterLiquidated(address indexed owner, uint64[] operatorIds, tuple(uint32, uint64, uint64, bool, uint256) cluster)",
  "event ClusterReactivated(address indexed owner, uint64[] operatorIds, tuple(uint32, uint64, uint64, bool, uint256) cluster)",
  "event ClusterMigratedToETH(address indexed owner, uint64[] operatorIds, tuple(uint32, uint64, uint64, bool, uint256) cluster)",
];

/** Chunk size for event pagination to avoid RPC response size limits (QuickNode/Alchemy: ~500 blocks is safe for high-activity contracts) */
const CHUNK_SIZE = 500;

/**
 * Discover all operators from OperatorAdded/OperatorRemoved events.
 *
 * Returns a Map<operatorId, { id, owner, fee, isActive }> (without signers —
 * signers are attached later by the setup phase via impersonation).
 */
export async function discoverOperators(
  provider: any,
  ethers: any,
  networkAddress: string,
  fromBlock: number,
  toBlock: number,
  minOperators = 50,
): Promise<Map<bigint, Omit<OperatorRecord, "ownerSigner">>> {
  const operators = new Map<bigint, Omit<OperatorRecord, "ownerSigner">>();

  const addedIface = new ethers.Interface(OPERATOR_ADDED_ABI);
  const removedIface = new ethers.Interface(OPERATOR_REMOVED_ABI);

  const addedTopic = addedIface.getEvent("OperatorAdded")!.topicHash;
  const removedTopic = removedIface.getEvent("OperatorRemoved")!.topicHash;

  // Scan backwards from toBlock so we find the most-recent (active) operators
  // first and can stop early once we have enough candidates.
  for (let end = toBlock; end >= fromBlock; end -= CHUNK_SIZE) {
    const start = Math.max(end - CHUNK_SIZE + 1, fromBlock);

    const logs = await provider.getLogs({
      address: networkAddress,
      topics: [[addedTopic, removedTopic]],
      fromBlock: start,
      toBlock: end,
    });

    // Process in chronological order within this chunk so removals overwrite additions.
    for (const log of logs) {
      if (log.topics[0] === addedTopic) {
        const decoded = addedIface.parseLog(log);
        if (!decoded) continue;

        const operatorId = BigInt(decoded.args[0]);
        const owner = decoded.args[1] as string;
        const fee = BigInt(decoded.args[3]);

        operators.set(operatorId, {
          id: operatorId,
          owner,
          fee,
          isActive: true,
        });
      } else if (log.topics[0] === removedTopic) {
        const decoded = removedIface.parseLog(log);
        if (!decoded) continue;

        const operatorId = BigInt(decoded.args[0]);
        const existing = operators.get(operatorId);
        if (existing) {
          existing.isActive = false;
        }
      }
    }

    // Stop once we have enough operator candidates to satisfy the sample pool.
    const activeCount = [...operators.values()].filter(op => op.isActive).length;
    if (activeCount >= minOperators) break;
  }

  return operators;
}

/**
 * Minimal cluster info discovered from events (before the simulation
 * creates its own clusters). Used for reference/sampling only.
 */
export interface DiscoveredCluster {
  owner: string;
  operatorIds: bigint[];
  validatorCount: number;
  lastClusterTuple: {
    validatorCount: bigint;
    networkFeeIndex: bigint;
    index: bigint;
    active: boolean;
    balance: bigint;
  };
}

/**
 * Discover clusters from validator-registration and cluster events.
 * Builds a map of clusterKey → latest cluster state from events.
 *
 * Note: on a pre-upgrade fork these will all be SSV clusters.
 */
export async function discoverClusters(
  provider: any,
  ethers: any,
  networkAddress: string,
  fromBlock: number,
  toBlock: number,
): Promise<Map<string, DiscoveredCluster>> {
  const clusters = new Map<string, DiscoveredCluster>();
  const iface = new ethers.Interface(CLUSTER_EVENT_ABI);

  const topics = CLUSTER_EVENT_ABI.map((abi) => {
    const parsed = new ethers.Interface([abi]);
    const eventName = abi.match(/event\s+(\w+)/)![1];
    return parsed.getEvent(eventName)!.topicHash;
  });

  for (let start = fromBlock; start <= toBlock; start += CHUNK_SIZE) {
    const end = Math.min(start + CHUNK_SIZE - 1, toBlock);

    const logs = await provider.getLogs({
      address: networkAddress,
      topics: [topics],
      fromBlock: start,
      toBlock: end,
    });

    for (const log of logs) {
      let decoded;
      try {
        decoded = iface.parseLog(log);
      } catch {
        continue;
      }
      if (!decoded) continue;

      const owner = decoded.args[0] as string;
      const operatorIds = (decoded.args[1] as any[]).map((id: any) => BigInt(id));
      const clusterTuple = decoded.args[decoded.args.length - 1];

      const sortedOps = [...operatorIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
      const key = clusterKeyFromParts(ethers, owner, sortedOps);

      const [vc, nfi, idx, active, balance] = clusterTuple;

      const existing = clusters.get(key);
      const validatorCount = Number(vc);

      clusters.set(key, {
        owner,
        operatorIds: sortedOps,
        validatorCount: existing ? Math.max(existing.validatorCount, validatorCount) : validatorCount,
        lastClusterTuple: {
          validatorCount: BigInt(vc),
          networkFeeIndex: BigInt(nfi),
          index: BigInt(idx),
          active: Boolean(active),
          balance: BigInt(balance),
        },
      });
    }
  }

  return clusters;
}

/**
 * Compute the deterministic cluster key matching the on-chain
 * keccak256(abi.encodePacked(owner, operatorIds)) pattern.
 */
function clusterKeyFromParts(ethers: any, owner: string, sortedOperatorIds: bigint[]): string {
  return ethers.keccak256(
    ethers.solidityPacked(
      ["address", "uint64[]"],
      [owner, sortedOperatorIds],
    ),
  );
}

/**
 * Sample N active operators from a discovered operator map,
 * verifying each via the views contract's getOperatorById.
 *
 * Returns operators with refreshed on-chain fee data.
 */
export async function sampleOperators(
  allOperators: Map<bigint, Omit<OperatorRecord, "ownerSigner">>,
  views: any,
  count: number,
  rng: SeededRNG,
): Promise<Array<Omit<OperatorRecord, "ownerSigner">>> {
  // Filter to active operators
  const active = [...allOperators.values()].filter((op) => op.isActive);

  if (active.length === 0) {
    throw new Error("No active operators found");
  }

  // Shuffle and take up to `count`
  const shuffled = rng.shuffle([...active]);
  const candidates = shuffled.slice(0, Math.min(count * 2, shuffled.length));

  const sampled: Array<Omit<OperatorRecord, "ownerSigner">> = [];

  for (const candidate of candidates) {
    if (sampled.length >= count) break;

    try {
      // Verify on-chain: getOperatorById returns OperatorTuple
      // [owner, ethFee, ethValidatorCount, whitelistedAddress, isPrivate, isActive]
      const opData = await views.getOperatorById(candidate.id);
      const isActive = opData[5] as boolean;

      if (isActive) {
        sampled.push({
          id: candidate.id,
          owner: opData[0] as string,
          fee: BigInt(opData[1]),
          isActive: true,
        });
      }
    } catch {
      // Skip operators that revert (removed, etc.)
      continue;
    }
  }

  return sampled;
}

/**
 * StateSnapshot — captures the state of all entities relevant to
 * the current scenario context for pre/post comparison.
 */

import type { SSVNetworkViews } from "../../types/ethers-contracts/index.js";
import {
  readOperatorEthVUnits,
  readDaoTotalEthVUnits,
} from "./storage-readers.ts";

// --- Snapshot interfaces ---

export interface OperatorSnapshot {
  id: bigint;
  fee: bigint;
  earnings: bigint;
  ethVUnits: bigint;
  isActive: boolean;
}

export interface ClusterSnapshot {
  balance: bigint;
  active: boolean;
  validatorCount: number;
}

export interface StateSnapshot {
  /** Block number at time of capture */
  block: number;
  /** Per-operator state */
  operators: Map<bigint, OperatorSnapshot>;
  /** Cluster state (if a cluster is in context) */
  cluster?: ClusterSnapshot;
  /** Global state */
  daoTotalEthVUnits: bigint;
  networkFee: bigint;
  accEthPerShare: bigint;
  contractEthBalance: bigint;
}

// --- Snapshot capture ---

export interface SnapshotOptions {
  provider: any;
  views: SSVNetworkViews;
  proxyAddress: string;
  /** Operator IDs to snapshot */
  operatorIds: bigint[];
  /** Cluster info for balance read (optional) */
  cluster?: {
    owner: string;
    operatorIds: bigint[];
    clusterTuple: any;
  };
}

/**
 * Capture a full state snapshot from chain state.
 */
export async function captureSnapshot(opts: SnapshotOptions): Promise<StateSnapshot> {
  const { provider, views, proxyAddress, operatorIds, cluster } = opts;

  const block = await provider.getBlockNumber();

  // Operator snapshots
  const operators = new Map<bigint, OperatorSnapshot>();
  for (const opId of operatorIds) {
    let fee = 0n;
    let earnings = 0n;
    let isActive = true;
    try {
      earnings = BigInt(await views.getOperatorEarnings(opId));
    } catch {
      // Operator may not have earnings
    }
    try {
      const opData = await views.getOperatorById(opId);
      fee = BigInt(opData[1]); // fee field
      isActive = opData[5]; // isActive field
    } catch {
      isActive = false;
    }
    let ethVUnits = 0n;
    try {
      ethVUnits = await readOperatorEthVUnits(provider, proxyAddress, opId);
    } catch {
      // May not have vUnits
    }
    operators.set(opId, { id: opId, fee, earnings, ethVUnits, isActive });
  }

  // Cluster snapshot
  let clusterSnap: ClusterSnapshot | undefined;
  if (cluster) {
    try {
      const balance = BigInt(
        await views.getBalance(
          cluster.owner,
          cluster.operatorIds,
          cluster.clusterTuple,
        ),
      );
      clusterSnap = {
        balance,
        active: cluster.clusterTuple.active ?? true,
        validatorCount: Number(cluster.clusterTuple.validatorCount ?? 0),
      };
    } catch {
      // Cluster may be liquidated
      clusterSnap = {
        balance: 0n,
        active: false,
        validatorCount: Number(cluster.clusterTuple.validatorCount ?? 0),
      };
    }
  }

  // Global state
  let daoTotalEthVUnits = 0n;
  try {
    daoTotalEthVUnits = await readDaoTotalEthVUnits(provider, proxyAddress);
  } catch {
    // ignore
  }

  let networkFee = 0n;
  try {
    networkFee = BigInt(await views.getNetworkFee());
  } catch {
    // ignore
  }

  let accEthPerShare = 0n;
  try {
    accEthPerShare = BigInt(await views.accEthPerShare());
  } catch {
    // ignore
  }

  const contractEthBalance = BigInt(await provider.getBalance(proxyAddress));

  return {
    block,
    operators,
    cluster: clusterSnap,
    daoTotalEthVUnits,
    networkFee,
    accEthPerShare,
    contractEthBalance,
  };
}

/**
 * Convert a StateSnapshot to a compact JSON-serializable form.
 */
export function compactSnapshot(snap: StateSnapshot) {
  return {
    block: snap.block,
    daoTotalEthVUnits: snap.daoTotalEthVUnits.toString(),
    networkFee: snap.networkFee.toString(),
    accEthPerShare: snap.accEthPerShare.toString(),
    contractEthBalance: snap.contractEthBalance.toString(),
    operatorCount: snap.operators.size,
    clusterBalance: snap.cluster?.balance.toString(),
    clusterActive: snap.cluster?.active,
  };
}

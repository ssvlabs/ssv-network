import type { NetworkConnection } from 'hardhat/types/network';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import type { SSVNetwork } from '../../types/ethers-contracts/index.js';
import type { Cluster, ClusterTuple, SSVModules } from '../common/types.ts';
import { EMPTY_CLUSTER, DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, SSV_MODULE_CONTRACTS } from '../common/constants.ts';
import { Events } from '../common/events.ts';
import { makePublicKey } from './keys.ts';
import { setAccountBalance } from './blocks.ts';

export function getHarnessName(module: SSVModules): `${string}Harness` {
  return `${SSV_MODULE_CONTRACTS[module]}Harness`;
}

export function createCluster(overrides: Partial<Cluster> = {}): Cluster {
  return {
    ...EMPTY_CLUSTER,
    active: true,
    ...overrides,
  };
}

export function createLegacySSVCluster(overrides: Partial<Cluster> = {}): Cluster {
  return {
    ...EMPTY_CLUSTER,
    validatorCount: 1n,
    active: true,
    balance: 10_000_000_000_000_000_000n,
    ...overrides,
  };
}

export const clusterToTuple = (cluster: Cluster): ClusterTuple => [
  cluster.validatorCount,
  cluster.networkFeeIndex,
  cluster.index,
  cluster.active,
  cluster.balance,
] as const;

const EVENT_ABI = [
  'event ClusterDeposited(address indexed owner, uint64[] operatorIds, uint256 value, tuple(uint32, uint64, uint64, bool, uint256) cluster)',
  'event ClusterWithdrawn(address indexed owner, uint64[] operatorIds, uint256 value, tuple(uint32, uint64, uint64, bool, uint256) cluster)',
  'event ClusterLiquidated(address indexed owner, uint64[] operatorIds, tuple(uint32, uint64, uint64, bool, uint256) cluster)',
  'event ClusterReactivated(address indexed owner, uint64[] operatorIds, tuple(uint32, uint64, uint64, bool, uint256) cluster)',
  'event ValidatorAdded(address indexed owner, uint64[] operatorIds, bytes publicKey, bytes shares, tuple(uint32, uint64, uint64, bool, uint256) cluster)',
  'event ValidatorRemoved(address indexed owner, uint64[] operatorIds, bytes publicKey, tuple(uint32, uint64, uint64, bool, uint256) cluster)',
  'event ClusterMigratedToETH(address indexed owner, uint64[] operatorIds, uint256 ethDeposited, uint256 ssvRefunded, uint32 effectiveBalance, tuple(uint32, uint64, uint64, bool, uint256) cluster)',
] as const;

export function extractEventArgs(contract: any, receipt: any, eventName: string | string[]): any {
  const names = Array.isArray(eventName) ? eventName : [eventName];
  for (const log of receipt.logs ?? []) {
    let parsed;
    try {
      parsed = contract.interface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed && names.includes(parsed.name)) {
      return parsed.args;
    }
  }
  throw new Error(`${names.join(' | ')} event not found in receipt`);
}

export function parseClusterFromEvent(contract: any, receipt: any, eventName: string): Cluster {
  if (receipt.eventsByName?.[eventName]?.length > 0) {
    const parsed = receipt.eventsByName[eventName][0];
    const clusterTuple = parsed.args[parsed.args.length - 1];
    const [validatorCount, networkFeeIndex, index, active, balance] = clusterTuple;
    return {
      validatorCount: BigInt(validatorCount),
      networkFeeIndex: BigInt(networkFeeIndex),
      index: BigInt(index),
      active,
      balance: BigInt(balance),
    };
  }
  for (const log of receipt.logs ?? []) {
    let parsed;
    try {
      parsed = contract.interface.parseLog(log);
    } catch {
      continue;
    }
    if (parsed?.name === eventName) {
      const clusterTuple = parsed.args[parsed.args.length - 1];
      const [validatorCount, networkFeeIndex, index, active, balance] = clusterTuple;
      return {
        validatorCount: BigInt(validatorCount),
        networkFeeIndex: BigInt(networkFeeIndex),
        index: BigInt(index),
        active,
        balance: BigInt(balance),
      };
    }
  }
  throw new Error(`Event ${eventName} not found`);
}

export async function getCurrentClusterState(connection: NetworkConnection<"generic">, networkContract: SSVNetwork, ownerAddress: string, operatorIds: bigint[] | number[]): Promise<Cluster> {
  const provider = connection.ethers.provider;
  const owner = connection.ethers.getAddress(ownerAddress).toLowerCase();
  const ownerTopic = connection.ethers.zeroPadValue(owner, 32);
  const opsExpected = [...operatorIds]
    .map(id => BigInt(id).toString())
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  const latestBlock = await provider.getBlockNumber();
  const minFromBlock = Math.max(0, latestBlock - 199);
  let allLogs: any[] = [];
  let currentTo = latestBlock;

  while (currentTo >= minFromBlock) {
    const fromBlock = Math.max(currentTo - 9, minFromBlock);
    const logs = await provider.getLogs({
      address: networkContract.target as string,
      fromBlock,
      toBlock: currentTo,
      topics: [null, ownerTopic],
    });
    allLogs = allLogs.concat(logs);
    currentTo = fromBlock - 1;
  }

  allLogs.sort((a, b) => {
    if (a.blockNumber !== b.blockNumber) {
      return a.blockNumber - b.blockNumber;
    }
    return a.transactionIndex - b.transactionIndex;
  });

  const iface = new connection.ethers.Interface(EVENT_ABI);
  let latestClusterTuple: any = [0n, 0n, 0n, true, 0n];

  for (const log of allLogs) {
    let decoded;
    try {
      decoded = iface.parseLog(log);
    } catch {
      continue;
    }
    if (!decoded) continue;
    const operatorIdsFromEvent = decoded.args[1];
    if (!Array.isArray(operatorIdsFromEvent)) continue;
    const idsFromEvent = operatorIdsFromEvent
      .map(b => b.toString())
      .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
    if (JSON.stringify(idsFromEvent) !== JSON.stringify(opsExpected)) continue;
    latestClusterTuple = decoded.args[decoded.args.length - 1];
  }

  return {
    validatorCount: latestClusterTuple[0].toString(),
    networkFeeIndex: latestClusterTuple[1].toString(),
    index: latestClusterTuple[2].toString(),
    active: latestClusterTuple[3],
    balance: latestClusterTuple[4].toString(),
  };
}

export async function registerAndParseCluster(clusters: any, operatorIds: bigint[], pubkeyIndex = 1): Promise<Cluster> {
  const tx = await clusters.registerValidator(makePublicKey(pubkeyIndex), operatorIds, DEFAULT_SHARES, createCluster(), { value: DEFAULT_ETH_REGISTER_VALUE });
  const receipt = await tx.wait();
  return parseClusterFromEvent(clusters, receipt, Events.VALIDATOR_ADDED);
}

export async function addValidatorsToCluster(connection: any, network: SSVNetwork, keys: string[], shares: string[], clusterOwner: HardhatEthersSigner, operatorIds: number[], cluster: Cluster): Promise<Cluster> {
  await setAccountBalance(connection.ethers.provider, clusterOwner.address, (1000n * 10n ** 18n));
  await network.connect(clusterOwner).bulkRegisterValidator(keys, operatorIds, shares, cluster, { value: DEFAULT_ETH_REGISTER_VALUE });
  return await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
}

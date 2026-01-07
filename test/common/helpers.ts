import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
  SSV_MODULE_CONTRACTS,
  VUNITS_PRECISION,
} from './constants.ts';
import type { NetworkConnection } from 'hardhat/types/network';
import type { Cluster, ClusterTuple, OperatorTuple, SSVModules } from './types.ts';
import type { SSVNetwork, SSVNetworkViews } from '../../types/ethers-contracts/index.js';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';

export function makePublicKey(seed: number): string {
  return `0x${seed.toString(16).padStart(96, "0")}`;
}

export function makeArrayOfKeysAndShares(initialSeed: number, amount: number): { keys: string[], shares: string[] } {
  let keys: string[] = [];
  let shares: string[] = [];
  for (let i = initialSeed; i < amount; i++) {
    keys.push(`0x${i.toString(16).padStart(96, "0")}`)
    shares.push("0x1234");
  }
  return {
    keys,
    shares
  };
}

export function makeOperatorKey(seed: number): string {
  return `0x${(seed + 1000).toString(16).padStart(96, "0")}`;
}

export function getHarnessName(
  module: SSVModules
): `${string}Harness` {
  return `${SSV_MODULE_CONTRACTS[module]}Harness`;
}

export const clusterToTuple = (cluster: Cluster): ClusterTuple => [
  cluster.validatorCount,
  cluster.networkFeeIndex,
  cluster.index,
  cluster.active,
  cluster.balance,
] as const;

export async function registerOperators(network: any, owner: any, count: number): Promise<number[]> {
  const operatorIds: number[] = [];

  for (let i = 0; i < count; i += 1) {
    const expectedId = await network.connect(owner).registerOperator.staticCall(
      makeOperatorKey(i + 1), MINIMAL_OPERATOR_ETH_FEE, true
    );

    const tx = await network
      .connect(owner)
      .registerOperator(
        makeOperatorKey(i + 1), MINIMAL_OPERATOR_ETH_FEE, true
      );
    await tx.wait();
    operatorIds.push(expectedId);
  }

  return operatorIds;
}

export async function whitelistAddresses(network: any, operators: number[], addresses: string[]): Promise<void> {
  const tx = await network.setOperatorsWhitelists(operators, addresses);
  await tx.wait();
}

export async function calculateInitialBurnRate(
  views: SSVNetworkViews,
  operatorIds: number[] | bigint[],
  cluster: Cluster
): Promise<bigint> {
  let operatorsFee: bigint = 0n;
  const len: number = operatorIds.length;
  for (let i: number = 0; i < len; ++i) {
    const op: OperatorTuple = await views.getOperatorById(BigInt(operatorIds[i]));
    operatorsFee += BigInt(op[1].toString());
  }

  const networkFee: bigint = BigInt((await views.getNetworkFee()).toString());

  const vUnits: bigint = BigInt(cluster.validatorCount.toString()) * VUNITS_PRECISION;

  const units: bigint = vUnits / VUNITS_PRECISION;

  return (networkFee + operatorsFee) * units;
}

export async function registerDefaultCluster(
  connection: any,
  network: SSVNetwork,
  operatorOwner: HardhatEthersSigner,
  clusterOwner: HardhatEthersSigner
): Promise<{
  cluster: Cluster,
  validatorKey: string,
  operatorIds: number[]
}> {
  const validatorKey = makePublicKey(1);
  const operatorIds = await registerOperators(network, operatorOwner, 4);
  await whitelistAddresses(network, operatorIds, [clusterOwner.address]);
  await network.connect(clusterOwner).registerValidator(
    validatorKey,
    operatorIds,
    DEFAULT_SHARES,
    0,
    EMPTY_CLUSTER,
    { value: DEFAULT_ETH_REGISTER_VALUE })

  const cluster = await getCurrentClusterState(
    connection,
    network,
    clusterOwner.address,
    operatorIds
  );

  return {
    cluster, validatorKey, operatorIds
  }
}

export async function addValidatorsToCluster(
  connection: any,
  network: SSVNetwork,
  keys: string[],
  shares: string[],
  clusterOwner: HardhatEthersSigner,
  operatorIds: number[],
  cluster: Cluster
): Promise<Cluster> {
  await network.connect(clusterOwner).bulkRegisterValidator(
    keys,
    operatorIds,
    shares,
    0,
    cluster,
    { value: DEFAULT_ETH_REGISTER_VALUE }
  )

  return await getCurrentClusterState(
    connection,
    network,
    clusterOwner.address,
    operatorIds
  );
}

const EVENT_ABI = [
  'event ClusterDeposited(address indexed owner, uint64[] operatorIds, uint256 value, tuple(uint32, uint64, uint64, bool, uint256) cluster)',
  'event ClusterWithdrawn(address indexed owner, uint64[] operatorIds, uint256 value, tuple(uint32, uint64, uint64, bool, uint256) cluster)',
  'event ClusterLiquidated(address indexed owner, uint64[] operatorIds, tuple(uint32, uint64, uint64, bool, uint256) cluster)',
  'event ClusterReactivated(address indexed owner, uint64[] operatorIds, tuple(uint32, uint64, uint64, bool, uint256) cluster)',
  'event ValidatorAdded(address indexed owner, uint64[] operatorIds, bytes publicKey, bytes shares, tuple(uint32, uint64, uint64, bool, uint256) cluster)',
  'event ValidatorRemoved(address indexed owner, uint64[] operatorIds, bytes publicKey, tuple(uint32, uint64, uint64, bool, uint256) cluster)',
] as const;

export async function getCurrentClusterState(
  connection: NetworkConnection<"generic">,
  networkContract: SSVNetwork,
  ownerAddress: string,
  operatorIds: bigint[] | number[]
): Promise<Cluster> {
  const provider = connection.ethers.provider;

  const owner = connection.ethers.getAddress(ownerAddress).toLowerCase();
  const ownerTopic = connection.ethers.zeroPadValue(owner, 32);

  const opsExpected = [...operatorIds]
    .map(id => BigInt(id).toString())
    .sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));

  const latestBlock = await provider.getBlockNumber();

  const logs = await provider.getLogs({
    address: networkContract.target as string,
    fromBlock: 0,
    toBlock: latestBlock,
    topics: [null, ownerTopic],
  });

  const iface = new connection.ethers.Interface(EVENT_ABI);

  let latestClusterTuple: any = [0n, 0n, 0n, true, 0n];

  for (const log of logs) {
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
      .sort((a, b) => a.localeCompare(b, undefined, {numeric: true}));

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
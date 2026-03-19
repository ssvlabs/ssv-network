import {
  BPS_DENOMINATOR,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  OPERATOR_FEE_PRECISION,
  MINIMAL_OPERATOR_ETH_FEE,
  SSV_MODULE_CONTRACTS,
  BPS_DENOMINATOR,
} from './constants.ts';
import type { NetworkConnection } from 'hardhat/types/network';
import type { Cluster, ClusterTuple, OperatorTuple, SSVModules } from './types.ts';
import type { SSVNetwork, SSVNetworkViews } from '../../types/ethers-contracts/index.js';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';

export function makePublicKey(seed: number): string {
  return `0x${seed.toString(16).padStart(96, "0")}`;
}

export function makePublicKeys(count: number, start = 1): string[] {
  return Array.from({ length: count }, (_, i) => makePublicKey(start + i));
}

export function createCluster(overrides: Partial<Cluster> = {}): Cluster {
  return {
    ...EMPTY_CLUSTER,
    active: true,
    ...overrides,
  };
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

type OperatorFeeViews = Pick<
  SSVNetworkViews,
  "getOperatorFee" | "getMaximumOperatorFee" | "getOperatorFeeIncreaseLimit"
>;

export async function getOperatorFeeBounds(
  views: OperatorFeeViews,
  operatorId: bigint
): Promise<{
  currentRaw: bigint;
  maxOperatorRaw: bigint;
  maxAllowedRaw: bigint;
}> {
  const currentFee = await views.getOperatorFee(operatorId);
  const maxOperatorFee = await views.getMaximumOperatorFee();
  const increaseLimitBps = await views.getOperatorFeeIncreaseLimit();

  const currentRaw = currentFee / OPERATOR_FEE_PRECISION;
  const maxOperatorRaw = maxOperatorFee / OPERATOR_FEE_PRECISION;
  const maxAllowedRaw =
    (currentRaw * (BPS_DENOMINATOR + increaseLimitBps) + (BPS_DENOMINATOR - 1n)) / BPS_DENOMINATOR;

  return {
    currentRaw,
    maxOperatorRaw,
    maxAllowedRaw,
  };
}

export async function getValidOperatorFeeIncrease(
  views: OperatorFeeViews,
  operatorId: bigint
): Promise<bigint> {
  const { currentRaw, maxOperatorRaw, maxAllowedRaw } = await getOperatorFeeBounds(views, operatorId);
  const upperRaw = maxAllowedRaw < maxOperatorRaw ? maxAllowedRaw : maxOperatorRaw;
  if (upperRaw <= currentRaw) {
    throw new Error("No valid fee increase available for current fork configuration");
  }
  return upperRaw * OPERATOR_FEE_PRECISION;
}

export async function getFeeAboveIncreaseLimit(
  views: OperatorFeeViews,
  operatorId: bigint
): Promise<bigint> {
  const { maxOperatorRaw, maxAllowedRaw } = await getOperatorFeeBounds(views, operatorId);
  const candidateRaw = maxAllowedRaw + 1n;
  if (candidateRaw > maxOperatorRaw) {
    throw new Error("Cannot construct FeeExceedsIncreaseLimit case without hitting FeeTooHigh first");
  }
  return candidateRaw * OPERATOR_FEE_PRECISION;
}

export async function whitelistAddresses(network: any, signer: HardhatEthersSigner, operators: number[], addresses: string[]): Promise<void> {
  const tx = await network.connect(signer).setOperatorsWhitelists(operators, addresses);
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

  const vUnits: bigint = BigInt(cluster.validatorCount.toString()) * BPS_DENOMINATOR;

  const units: bigint = vUnits / BPS_DENOMINATOR;

  return (networkFee + operatorsFee) * units;
}

export async function registerDefaultCluster(
  connection: any,
  network: SSVNetwork,
  views: SSVNetworkViews,
  operatorOwner: HardhatEthersSigner,
  clusterOwner: HardhatEthersSigner
): Promise<{
  cluster: Cluster,
  validatorKey: string,
  operatorIds: number[],
  receiptRegister: any
}> {
  const validatorKey = makePublicKey(1);
  const operatorIds = await registerOperators(network, operatorOwner, 4);
  await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

  await connection.ethers.provider.send("hardhat_setBalance", [
    clusterOwner.address,
    "0x" + (DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n).toString(16),
  ]);

  const tx = await network.connect(clusterOwner).registerValidator(
    validatorKey,
    operatorIds,
    DEFAULT_SHARES,
    EMPTY_CLUSTER,
    { value: DEFAULT_ETH_REGISTER_VALUE }
  );
  const receiptRegister = await tx.wait();

  const cluster = await getCurrentClusterState(
    connection,
    network,
    clusterOwner.address,
    operatorIds
  );

  return {
    cluster, validatorKey, operatorIds, receiptRegister
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
  await connection.ethers.provider.send("hardhat_setBalance", [
    clusterOwner.address,
    "0x" + (1000n * 10n ** 18n).toString(16),
  ]);

  await network.connect(clusterOwner).bulkRegisterValidator(
    keys,
    operatorIds,
    shares,
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
  const minFromBlock = Math.max(0, latestBlock - 199); // limit to last 200 blocks

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

export async function registerDefaultClusters(
  connection: any,
  network: SSVNetwork,
  operatorIds: number[],
  operatorOwner: HardhatEthersSigner,
  n: number,
): Promise<{
  clusters: Array<{
    owner: HardhatEthersSigner,
    cluster: Cluster,
    validatorKey: string
  }>,
  operatorIds: number[]
}> {
  const allSigners: HardhatEthersSigner[] = await connection.ethers.getSigners();
  const clusterOwners: HardhatEthersSigner[] = allSigners.slice(5, 5 + n);

  if (clusterOwners.length < n) {
    throw new Error(`Not enough signers available for ${n} clusters`);
  }

  const ownerAddresses = clusterOwners.map(owner => owner.address);
  await whitelistAddresses(network, operatorOwner, operatorIds, ownerAddresses);

  const results: Array<{
    owner: HardhatEthersSigner,
    cluster: Cluster,
    validatorKey: string
  }> = [];

  for (let i = 0; i < n; i++) {
    const owner = clusterOwners[i];
    const validatorKey = makePublicKey(i + 1);

    await network.connect(owner).registerValidator(
      validatorKey,
      operatorIds,
      DEFAULT_SHARES,
      EMPTY_CLUSTER,
      { value: DEFAULT_ETH_REGISTER_VALUE }
    );

    const cluster = await getCurrentClusterState(
      connection,
      network,
      owner.address,
      operatorIds
    );

    results.push({ owner, cluster, validatorKey });
  }

  return { clusters: results, operatorIds };
}

export function generateMerkleForClusterEB(
  connection: any,
  entries: { clusterId: string; effectiveBalance: number }[]
): {
  root: string;
  proofs: Record<string, string[]>;
} {
  if (entries.length === 0) {
    return { root: connection.ethers.ZeroHash, proofs: {} };
  }

  const leafMap = new Map<string, string>();
  const leaves: string[] = [];

  for (const { clusterId, effectiveBalance } of entries) {
    const encoded = connection.ethers.AbiCoder.defaultAbiCoder().encode(
      ["bytes32", "uint32"],
      [clusterId, effectiveBalance]
    );
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
      const right = i + 1 < layer.length ? layer[i + 1] : left; // promote if odd
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

export function buildEBMerkleForDefaultClusters(
  connection: any,
  registered: {
    clusters: Array<{
      owner: HardhatEthersSigner;
      cluster: Cluster;
      validatorKey: string;
    }>;
    operatorIds: number[];
  },
  effectiveBalance: number
): {
  root: string;
  proofsByOwner: Record<
    string,
    { proof: string[]; cluster: Cluster; clusterId: string }
  >;
} {
  const { clusters, operatorIds } = registered;

  const entries = clusters.map(({ owner }) => {
    const clusterId = connection.ethers.keccak256(
      connection.ethers.solidityPacked(
        ["address", "uint64[]"],
        [owner.address, operatorIds]
      )
    );
    return { clusterId, effectiveBalance };
  });

  const { root, proofs: rawProofs } = generateMerkleForClusterEB(connection, entries);

  const proofsByOwner: Record<
    string,
    { proof: string[]; cluster: Cluster; clusterId: string }
  > = {};

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

export async function updateClusterBalancesForDefaultClusters(
  network: SSVNetwork,
  registered: {
    clusters: Array<{
      owner: HardhatEthersSigner;
      cluster: Cluster;
      validatorKey: string;
    }>;
    operatorIds: number[];
  },
  merkleData: {
    root: string;
    proofsByOwner: Record<
      string,
      { proof: string[]; cluster: Cluster; clusterId: string }
    >;
  },
  blockNum: number,
  effectiveBalance: number,
  selectedOwners?: string[]
): Promise<void> {
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

    const tx = await network.updateClusterBalance(
      blockNum,
      ownerAddr,
      operatorIdsBigInt,
      clusterStruct,
      effectiveBalance,
      proof
    );

    await tx.wait();
  }
}

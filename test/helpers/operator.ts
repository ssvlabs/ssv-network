import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import type { SSVNetwork, SSVNetworkViews } from '../../types/ethers-contracts/index.js';
import type { Cluster, OperatorTuple } from '../common/types.ts';
import { BPS_DENOMINATOR, DEFAULT_ETH_REGISTER_VALUE, DEFAULT_SHARES, EMPTY_CLUSTER, MINIMAL_OPERATOR_ETH_FEE, MINIMAL_OPERATOR_FEE_SSV, OPERATOR_FEE_PRECISION, VUNITS_PRECISION, } from '../common/constants.ts';
import { makePublicKey, makeOperatorKey } from './keys.ts';
import { getCurrentClusterState } from './cluster.ts';
import { setAccountBalance } from './blocks.ts';

export async function registerOperators(network: any, owner: any, count: number): Promise<number[]> {
  const operatorIds: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const expectedId = await network.connect(owner).registerOperator.staticCall(makeOperatorKey(i + 1), MINIMAL_OPERATOR_ETH_FEE, true);
    const tx = await network
      .connect(owner)
      .registerOperator(makeOperatorKey(i + 1), MINIMAL_OPERATOR_ETH_FEE, true);
    await tx.wait();
    operatorIds.push(expectedId);
  }
  return operatorIds;
}

export async function registerOperatorsSSV(network: any, owner: any, count: number): Promise<number[]> {
  const operatorIds: number[] = [];
  for (let i = 0; i < count; i += 1) {
    const expectedId = await network.connect(owner).registerOperator.staticCall(makeOperatorKey(i + 1), MINIMAL_OPERATOR_FEE_SSV, true);
    const tx = await network
      .connect(owner)
      .registerOperator(makeOperatorKey(i + 1), MINIMAL_OPERATOR_FEE_SSV, true);
    await tx.wait();
    operatorIds.push(expectedId);
  }
  return operatorIds;
}

export async function whitelistAddresses(network: any, signer: HardhatEthersSigner, operators: number[], addresses: string[]): Promise<void> {
  const tx = await network.connect(signer).setOperatorsWhitelists(operators, addresses);
  await tx.wait();
}

type OperatorFeeViews = Pick<SSVNetworkViews, "getOperatorFee" | "getMaximumOperatorFee" | "getOperatorFeeIncreaseLimit">;
export async function getOperatorFeeBounds(views: OperatorFeeViews, operatorId: bigint): Promise<{
  currentRaw: bigint;
  maxOperatorRaw: bigint;
  maxAllowedRaw: bigint;
}> {
  const currentFee = await views.getOperatorFee(operatorId);
  const maxOperatorFee = await views.getMaximumOperatorFee();
  const increaseLimitBps = await views.getOperatorFeeIncreaseLimit();
  const currentRaw = currentFee / OPERATOR_FEE_PRECISION;
  const maxOperatorRaw = maxOperatorFee / OPERATOR_FEE_PRECISION;
  const maxAllowedRaw = (currentRaw * (BPS_DENOMINATOR + increaseLimitBps) + (BPS_DENOMINATOR - 1n)) / BPS_DENOMINATOR;
  return { currentRaw, maxOperatorRaw, maxAllowedRaw };
}

export async function getValidOperatorFeeIncrease(views: OperatorFeeViews, operatorId: bigint): Promise<bigint> {
  const { currentRaw, maxOperatorRaw, maxAllowedRaw } = await getOperatorFeeBounds(views, operatorId);
  const upperRaw = maxAllowedRaw < maxOperatorRaw ? maxAllowedRaw : maxOperatorRaw;
  if (upperRaw <= currentRaw) {
    throw new Error("No valid fee increase available for current fork configuration");
  }
  return upperRaw * OPERATOR_FEE_PRECISION;
}

export async function getFeeAboveIncreaseLimit(views: OperatorFeeViews, operatorId: bigint): Promise<bigint> {
  const { maxOperatorRaw, maxAllowedRaw } = await getOperatorFeeBounds(views, operatorId);
  const candidateRaw = maxAllowedRaw + 1n;
  if (candidateRaw > maxOperatorRaw) {
    throw new Error("Cannot construct FeeExceedsIncreaseLimit case without hitting FeeTooHigh first");
  }
  return candidateRaw * OPERATOR_FEE_PRECISION;
}

export async function calculateInitialBurnRate(views: SSVNetworkViews, operatorIds: number[] | bigint[], cluster: Cluster): Promise<bigint> {
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

export async function seedOperatorWithETHBalance(
  networkHelpers: any,
  connection: any,
  operators: any,
  operatorId: number,
  ethSnapshotBalance: bigint,
): Promise<void> {
  const harnessAddress = await operators.getAddress();
  await networkHelpers.setBalance(harnessAddress, connection.ethers.parseEther("1000"));
  await operators.mockSetOperatorBalances(operatorId, Number(ethSnapshotBalance), 0);
}

export async function registerDefaultCluster(connection: any, network: SSVNetwork, views: SSVNetworkViews, operatorOwner: HardhatEthersSigner, clusterOwner: HardhatEthersSigner): Promise<{
  cluster: Cluster;
  validatorKey: string;
  operatorIds: number[];
  receiptRegister: any;
}> {
  const validatorKey = makePublicKey(1);
  const operatorIds = await registerOperators(network, operatorOwner, 4);
  await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
  await setAccountBalance(connection.ethers.provider, clusterOwner.address, (DEFAULT_ETH_REGISTER_VALUE + 10n ** 18n));
  const tx = await network.connect(clusterOwner).registerValidator(validatorKey, operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: DEFAULT_ETH_REGISTER_VALUE });
  const receiptRegister = await tx.wait();
  const cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
  return { cluster, validatorKey, operatorIds, receiptRegister };
}

export async function registerDefaultClusters(connection: any, network: SSVNetwork, operatorIds: number[], operatorOwner: HardhatEthersSigner, n: number): Promise<{
  clusters: Array<{
    owner: HardhatEthersSigner;
    cluster: Cluster;
    validatorKey: string;
  }>;
  operatorIds: number[];
}> {
  const allSigners: HardhatEthersSigner[] = await connection.ethers.getSigners();
  const clusterOwners: HardhatEthersSigner[] = allSigners.slice(5, 5 + n);
  if (clusterOwners.length < n) {
    throw new Error(`Not enough signers available for ${n} clusters`);
  }
  const ownerAddresses = clusterOwners.map(owner => owner.address);
  await whitelistAddresses(network, operatorOwner, operatorIds, ownerAddresses);
  const results: Array<{
    owner: HardhatEthersSigner;
    cluster: Cluster;
    validatorKey: string;
  }> = [];
  for (let i = 0; i < n; i++) {
    const owner = clusterOwners[i];
    const validatorKey = makePublicKey(i + 1);
    await network.connect(owner).registerValidator(validatorKey, operatorIds, DEFAULT_SHARES, EMPTY_CLUSTER, { value: DEFAULT_ETH_REGISTER_VALUE });
    const cluster = await getCurrentClusterState(connection, network, owner.address, operatorIds);
    results.push({ owner, cluster, validatorKey });
  }
  return { clusters: results, operatorIds };
}

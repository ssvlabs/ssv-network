import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import type { Cluster } from "../../common/types.ts";
import type { FuzzContext, OperatorRecord, ClusterRecord } from "./types.ts";
import {
  MINIMAL_OPERATOR_ETH_FEE,
  DEFAULT_OPERATOR_ETH_FEE,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  ETH_DEDUCTED_DIGITS,
  DEDUCTED_DIGITS,
  STAKE_AMOUNT,
  MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
  MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
} from "../../common/constants.ts";
import { makePublicKey, makeOperatorKey } from "../../helpers/keys.ts";
import { getCurrentClusterState, parseClusterFromEvent } from "../../helpers/cluster.ts";
import { Events } from "../../common/events.ts";
import { setAccountBalance, mineBlocks } from "../../helpers/blocks.ts";
import { ssvNetworkFullPreUpgradeFixture, upgradeToStakingVersion } from "../../setup/fixtures.ts";

export function alignFee(raw: bigint): bigint {
  return (raw / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS;
}

export function alignSSVFee(raw: bigint): bigint {
  return (raw / DEDUCTED_DIGITS) * DEDUCTED_DIGITS;
}

export async function registerFuzzOperators(
  ctx: FuzzContext<any>,
  owner: HardhatEthersSigner,
  count: number,
  fees: bigint[],
): Promise<OperatorRecord[]> {
  const records: OperatorRecord[] = [];
  for (let i = 0; i < count; i++) {
    const fee = fees[i] ?? MINIMAL_OPERATOR_ETH_FEE;
    const key = makeOperatorKey(1000 + i);
    const id = await ctx.network.connect(owner).registerOperator.staticCall(key, fee, true);
    await ctx.network.connect(owner).registerOperator(key, fee, true);
    records.push({ id: Number(id), fee, owner });
  }
  return records;
}

export async function registerFuzzCluster(
  ctx: FuzzContext<any>,
  clusterOwner: HardhatEthersSigner,
  operatorOwner: HardhatEthersSigner,
  operatorIds: number[],
  validatorCount: number,
  depositValue: bigint = DEFAULT_ETH_REGISTER_VALUE,
  keyOffset: number = 2000,
): Promise<ClusterRecord> {
  await ctx.network.connect(operatorOwner).setOperatorsWhitelists(operatorIds, [clusterOwner.address]);

  const totalDeposit = depositValue * BigInt(validatorCount);
  await setAccountBalance(ctx.provider, clusterOwner.address, totalDeposit + 10n ** 18n);

  const validatorKeys: string[] = [];
  const sharesData: string[] = [];
  for (let i = 0; i < validatorCount; i++) {
    validatorKeys.push(makePublicKey(keyOffset + i));
    sharesData.push(DEFAULT_SHARES);
  }

  const tx = await ctx.network.connect(clusterOwner).bulkRegisterValidator(
    validatorKeys,
    operatorIds,
    sharesData,
    EMPTY_CLUSTER,
    { value: totalDeposit },
  );
  const receipt = await tx.wait();
  const cluster = parseClusterFromEvent(ctx.network, receipt, Events.VALIDATOR_ADDED);

  return { cluster, operatorIds, owner: clusterOwner, validatorKeys };
}

export interface LegacyMigrationSeedConfig {
  operatorCount: number;
  ssvFee: bigint;
  validatorCount: number;
  ssvDepositPerValidator: bigint;
  preUpgradeBlocks: number;
}

export interface LegacyMigrationSeedResult {
  operatorIds: number[];
  operators: OperatorRecord[];
  ssvFee: bigint;
  totalSsvDeposit: bigint;
  preUpgradeCluster: Cluster;
  validatorKeys: string[];
  clusterOwner: HardhatEthersSigner;
  operatorOwner: HardhatEthersSigner;
}

export async function setupLegacyMigrationSeed(
  ctx: FuzzContext<undefined>,
  config: LegacyMigrationSeedConfig,
): Promise<LegacyMigrationSeedResult> {
  const { connection } = ctx;
  const [, operatorOwner, clusterOwner] = ctx.signers;

  const { network: legacyNetwork, views: legacyViews, ssvToken } =
    await ssvNetworkFullPreUpgradeFixture(connection);

  const operatorIds: number[] = [];
  for (let i = 0; i < config.operatorCount; i++) {
    const key = makeOperatorKey(1000 + i);
    const id = await legacyNetwork.connect(operatorOwner)
      .registerOperator.staticCall(key, config.ssvFee, false);
    await legacyNetwork.connect(operatorOwner)
      .registerOperator(key, config.ssvFee, false);
    operatorIds.push(Number(id));
  }

  const totalSsvDeposit = config.ssvDepositPerValidator * BigInt(config.validatorCount);
  await ssvToken.mint(clusterOwner.address, totalSsvDeposit);
  await ssvToken.connect(clusterOwner).approve(
    await legacyNetwork.getAddress(), totalSsvDeposit,
  );

  const validatorKeys: string[] = [];
  let cluster: Cluster = EMPTY_CLUSTER;
  for (let i = 0; i < config.validatorCount; i++) {
    const key = makePublicKey(2000 + i);
    validatorKeys.push(key);
    await legacyNetwork.connect(clusterOwner).registerValidator(
      key, operatorIds, DEFAULT_SHARES, config.ssvDepositPerValidator, cluster,
    );
    cluster = await getCurrentClusterState(
      connection, legacyNetwork, clusterOwner.address, operatorIds,
    );
  }

  const preUpgradeCluster = { ...cluster };

  await mineBlocks(connection.ethers.provider, config.preUpgradeBlocks);

  const { cssv, newNetwork, newViews } = await upgradeToStakingVersion(
    connection, legacyNetwork, legacyViews,
  );

  (ctx as any).network = newNetwork;
  (ctx as any).views = newViews;
  (ctx as any).ssvToken = ssvToken;
  (ctx as any).cssvToken = cssv;

  const operators: OperatorRecord[] = operatorIds.map(id => ({
    id,
    fee: DEFAULT_OPERATOR_ETH_FEE,
    owner: operatorOwner,
  }));

  return {
    operatorIds,
    operators,
    ssvFee: config.ssvFee,
    totalSsvDeposit,
    preUpgradeCluster,
    validatorKeys,
    clusterOwner,
    operatorOwner,
  };
}

export interface RemovedOperatorLegacyMigrationSeedConfig {
  operatorCount: number;
  ssvFee: bigint;
  validatorCount: number;
  ssvDepositPerValidator: bigint;
  removedOperatorIndex: number;
}

export interface RemovedOperatorLegacyMigrationSeedResult extends LegacyMigrationSeedResult {
  removedOperator: OperatorRecord;
  removedOperatorId: number;
}

export async function setupRemovedOperatorLegacyMigrationSeed(
  ctx: FuzzContext<undefined>,
  config: RemovedOperatorLegacyMigrationSeedConfig,
): Promise<RemovedOperatorLegacyMigrationSeedResult> {
  const { connection } = ctx;
  const [, operatorOwner, clusterOwner] = ctx.signers;

  const { network: legacyNetwork, views: legacyViews, ssvToken } =
    await ssvNetworkFullPreUpgradeFixture(connection);

  const operatorIds: number[] = [];
  for (let i = 0; i < config.operatorCount; i++) {
    const key = makeOperatorKey(1000 + i);
    const id = await legacyNetwork.connect(operatorOwner)
      .registerOperator.staticCall(key, config.ssvFee, false);
    await legacyNetwork.connect(operatorOwner)
      .registerOperator(key, config.ssvFee, false);
    operatorIds.push(Number(id));
  }

  const totalSsvDeposit = config.ssvDepositPerValidator * BigInt(config.validatorCount);
  await ssvToken.mint(clusterOwner.address, totalSsvDeposit);
  await ssvToken.connect(clusterOwner).approve(
    await legacyNetwork.getAddress(), totalSsvDeposit,
  );

  const validatorKeys: string[] = [];
  let cluster: Cluster = EMPTY_CLUSTER;
  for (let i = 0; i < config.validatorCount; i++) {
    const key = makePublicKey(2000 + i);
    validatorKeys.push(key);
    await legacyNetwork.connect(clusterOwner).registerValidator(
      key, operatorIds, DEFAULT_SHARES, config.ssvDepositPerValidator, cluster,
    );
    cluster = await getCurrentClusterState(
      connection, legacyNetwork, clusterOwner.address, operatorIds,
    );
  }

  const removedId = operatorIds[config.removedOperatorIndex];
  await legacyNetwork.connect(operatorOwner).removeOperator(removedId);

  const preUpgradeCluster = { ...cluster };

  await mineBlocks(connection.ethers.provider, 50);

  const { cssv, newNetwork, newViews } = await upgradeToStakingVersion(
    connection, legacyNetwork, legacyViews,
  );

  (ctx as any).network = newNetwork;
  (ctx as any).views = newViews;
  (ctx as any).ssvToken = ssvToken;
  (ctx as any).cssvToken = cssv;

  const removedOperator: OperatorRecord = {
    id: removedId,
    fee: 0n,
    owner: operatorOwner,
  };

  const activeOperators: OperatorRecord[] = operatorIds
    .filter(id => id !== removedId)
    .map(id => ({ id, fee: DEFAULT_OPERATOR_ETH_FEE, owner: operatorOwner }));

  return {
    operatorIds,
    operators: activeOperators,
    removedOperator,
    removedOperatorId: removedId,
    ssvFee: config.ssvFee,
    totalSsvDeposit,
    preUpgradeCluster,
    validatorKeys,
    clusterOwner,
    operatorOwner,
  };
}

export interface AllRemovedOperatorsLegacyMigrationSeedConfig {
  operatorCount: number;
  ssvFee: bigint;
  validatorCount: number;
  ssvDepositPerValidator: bigint;
}

export interface AllRemovedOperatorsLegacyMigrationSeedResult extends LegacyMigrationSeedResult {
  removedOperators: OperatorRecord[];
}

export async function setupAllRemovedOperatorsLegacyMigrationSeed(
  ctx: FuzzContext<undefined>,
  config: AllRemovedOperatorsLegacyMigrationSeedConfig,
): Promise<AllRemovedOperatorsLegacyMigrationSeedResult> {
  const { connection } = ctx;
  const [, operatorOwner, clusterOwner] = ctx.signers;

  const { network: legacyNetwork, views: legacyViews, ssvToken } =
    await ssvNetworkFullPreUpgradeFixture(connection);

  const operatorIds: number[] = [];
  for (let i = 0; i < config.operatorCount; i++) {
    const key = makeOperatorKey(1000 + i);
    const id = await legacyNetwork.connect(operatorOwner)
      .registerOperator.staticCall(key, config.ssvFee, false);
    await legacyNetwork.connect(operatorOwner)
      .registerOperator(key, config.ssvFee, false);
    operatorIds.push(Number(id));
  }

  const totalSsvDeposit = config.ssvDepositPerValidator * BigInt(config.validatorCount);
  await ssvToken.mint(clusterOwner.address, totalSsvDeposit);
  await ssvToken.connect(clusterOwner).approve(
    await legacyNetwork.getAddress(), totalSsvDeposit,
  );

  const validatorKeys: string[] = [];
  let cluster: Cluster = EMPTY_CLUSTER;
  for (let i = 0; i < config.validatorCount; i++) {
    const key = makePublicKey(2000 + i);
    validatorKeys.push(key);
    await legacyNetwork.connect(clusterOwner).registerValidator(
      key, operatorIds, DEFAULT_SHARES, config.ssvDepositPerValidator, cluster,
    );
    cluster = await getCurrentClusterState(
      connection, legacyNetwork, clusterOwner.address, operatorIds,
    );
  }

  for (const opId of operatorIds) {
    await legacyNetwork.connect(operatorOwner).removeOperator(opId);
  }

  const preUpgradeCluster = { ...cluster };

  await mineBlocks(connection.ethers.provider, 50);

  const { cssv, newNetwork, newViews } = await upgradeToStakingVersion(
    connection, legacyNetwork, legacyViews,
  );

  (ctx as any).network = newNetwork;
  (ctx as any).views = newViews;
  (ctx as any).ssvToken = ssvToken;
  (ctx as any).cssvToken = cssv;

  const removedOperators: OperatorRecord[] = operatorIds.map(id => ({
    id,
    fee: 0n,
    owner: operatorOwner,
  }));

  return {
    operatorIds,
    operators: [],
    removedOperators,
    ssvFee: config.ssvFee,
    totalSsvDeposit,
    preUpgradeCluster,
    validatorKeys,
    clusterOwner,
    operatorOwner,
  };
}

export interface LiquidatedLegacyMigrationSeedConfig {
  operatorCount: number;
  ssvFee: bigint;
  validatorCount: number;
  ssvDepositPerValidator: bigint;
  postLiquidationBlocks: number;
}

export async function setupLiquidatedLegacyMigrationSeed(
  ctx: FuzzContext<undefined>,
  config: LiquidatedLegacyMigrationSeedConfig,
): Promise<LegacyMigrationSeedResult> {
  const { connection } = ctx;
  const [, operatorOwner, clusterOwner] = ctx.signers;

  const { network: legacyNetwork, views: legacyViews, ssvToken } =
    await ssvNetworkFullPreUpgradeFixture(connection);

  const operatorIds: number[] = [];
  for (let i = 0; i < config.operatorCount; i++) {
    const key = makeOperatorKey(1000 + i);
    const id = await legacyNetwork.connect(operatorOwner)
      .registerOperator.staticCall(key, config.ssvFee, false);
    await legacyNetwork.connect(operatorOwner)
      .registerOperator(key, config.ssvFee, false);
    operatorIds.push(Number(id));
  }

  const totalSsvDeposit = config.ssvDepositPerValidator * BigInt(config.validatorCount);
  await ssvToken.mint(clusterOwner.address, totalSsvDeposit);
  await ssvToken.connect(clusterOwner).approve(
    await legacyNetwork.getAddress(), totalSsvDeposit,
  );

  const validatorKeys: string[] = [];
  let cluster: Cluster = EMPTY_CLUSTER;
  for (let i = 0; i < config.validatorCount; i++) {
    const key = makePublicKey(2000 + i);
    validatorKeys.push(key);
    await legacyNetwork.connect(clusterOwner).registerValidator(
      key, operatorIds, DEFAULT_SHARES, config.ssvDepositPerValidator, cluster,
    );
    cluster = await getCurrentClusterState(
      connection, legacyNetwork, clusterOwner.address, operatorIds,
    );
  }

  const balance = BigInt(
    await legacyViews.getBalance(clusterOwner.address, operatorIds, cluster),
  );
  const burnRate = BigInt(
    await legacyViews.getBurnRate(clusterOwner.address, operatorIds, cluster),
  );
  const blocksToDeplete = burnRate > 0n
    ? Number((balance + burnRate - 1n) / burnRate)
    : 0;
  if (blocksToDeplete > 0) {
    await mineBlocks(connection.ethers.provider, blocksToDeplete);
  }

  const liqTx = await legacyNetwork.connect(clusterOwner).liquidate(
    clusterOwner.address, operatorIds, cluster,
  );
  await liqTx.wait();
  cluster = await getCurrentClusterState(
    connection, legacyNetwork, clusterOwner.address, operatorIds,
  );

  const liquidatedCluster = { ...cluster };

  if (config.postLiquidationBlocks > 0) {
    await mineBlocks(connection.ethers.provider, config.postLiquidationBlocks);
  }

  const { cssv, newNetwork, newViews } = await upgradeToStakingVersion(
    connection, legacyNetwork, legacyViews,
  );

  (ctx as any).network = newNetwork;
  (ctx as any).views = newViews;
  (ctx as any).ssvToken = ssvToken;
  (ctx as any).cssvToken = cssv;

  const operators: OperatorRecord[] = operatorIds.map(id => ({
    id,
    fee: DEFAULT_OPERATOR_ETH_FEE,
    owner: operatorOwner,
  }));

  return {
    operatorIds,
    operators,
    ssvFee: config.ssvFee,
    totalSsvDeposit,
    preUpgradeCluster: liquidatedCluster,
    validatorKeys,
    clusterOwner,
    operatorOwner,
  };
}

export interface MixedFeeLegacyMigrationSeedConfig {
  ssvFees: bigint[];
  validatorCount: number;
  ssvDepositPerValidator: bigint;
  preUpgradeBlocks: number;
}

export interface MixedFeeLegacyMigrationSeedResult {
  operatorIds: number[];
  operators: OperatorRecord[];
  ssvFees: bigint[];
  totalSsvDeposit: bigint;
  preUpgradeCluster: Cluster;
  validatorKeys: string[];
  clusterOwner: HardhatEthersSigner;
  operatorOwner: HardhatEthersSigner;
}

export async function setupMixedFeeLegacyMigrationSeed(
  ctx: FuzzContext<undefined>,
  config: MixedFeeLegacyMigrationSeedConfig,
): Promise<MixedFeeLegacyMigrationSeedResult> {
  const { connection } = ctx;
  const [, operatorOwner, clusterOwner] = ctx.signers;

  const { network: legacyNetwork, views: legacyViews, ssvToken } =
    await ssvNetworkFullPreUpgradeFixture(connection);

  const operatorIds: number[] = [];
  for (let i = 0; i < config.ssvFees.length; i++) {
    const key = makeOperatorKey(1000 + i);
    const id = await legacyNetwork.connect(operatorOwner)
      .registerOperator.staticCall(key, config.ssvFees[i], false);
    await legacyNetwork.connect(operatorOwner)
      .registerOperator(key, config.ssvFees[i], false);
    operatorIds.push(Number(id));
  }

  const totalSsvDeposit = config.ssvDepositPerValidator * BigInt(config.validatorCount);
  await ssvToken.mint(clusterOwner.address, totalSsvDeposit);
  await ssvToken.connect(clusterOwner).approve(
    await legacyNetwork.getAddress(), totalSsvDeposit,
  );

  const validatorKeys: string[] = [];
  let cluster: Cluster = EMPTY_CLUSTER;
  for (let i = 0; i < config.validatorCount; i++) {
    const key = makePublicKey(2000 + i);
    validatorKeys.push(key);
    await legacyNetwork.connect(clusterOwner).registerValidator(
      key, operatorIds, DEFAULT_SHARES, config.ssvDepositPerValidator, cluster,
    );
    cluster = await getCurrentClusterState(
      connection, legacyNetwork, clusterOwner.address, operatorIds,
    );
  }

  const preUpgradeCluster = { ...cluster };

  await mineBlocks(connection.ethers.provider, config.preUpgradeBlocks);

  const { cssv, newNetwork, newViews } = await upgradeToStakingVersion(
    connection, legacyNetwork, legacyViews,
  );

  (ctx as any).network = newNetwork;
  (ctx as any).views = newViews;
  (ctx as any).ssvToken = ssvToken;
  (ctx as any).cssvToken = cssv;

  const operators: OperatorRecord[] = operatorIds.map((id, i) => ({
    id,
    fee: config.ssvFees[i] === 0n ? 0n : DEFAULT_OPERATOR_ETH_FEE,
    owner: operatorOwner,
  }));

  return {
    operatorIds,
    operators,
    ssvFees: config.ssvFees,
    totalSsvDeposit,
    preUpgradeCluster,
    validatorKeys,
    clusterOwner,
    operatorOwner,
  };
}

export interface NearLiquidationLegacyMigrationSeedConfig {
  operatorCount: number;
  ssvFee: bigint;
  validatorCount: number;
  ssvDepositPerValidator: bigint;
  remainingRunway: number;
}

export interface NearLiquidationLegacyMigrationSeedResult extends LegacyMigrationSeedResult {
  ssvBalanceAtMigration: bigint;
}

export async function setupNearLiquidationLegacyMigrationSeed(
  ctx: FuzzContext<undefined>,
  config: NearLiquidationLegacyMigrationSeedConfig,
): Promise<NearLiquidationLegacyMigrationSeedResult> {
  const { connection } = ctx;
  const [, operatorOwner, clusterOwner] = ctx.signers;

  const { network: legacyNetwork, views: legacyViews, ssvToken } =
    await ssvNetworkFullPreUpgradeFixture(connection);

  const operatorIds: number[] = [];
  for (let i = 0; i < config.operatorCount; i++) {
    const key = makeOperatorKey(1000 + i);
    const id = await legacyNetwork.connect(operatorOwner)
      .registerOperator.staticCall(key, config.ssvFee, false);
    await legacyNetwork.connect(operatorOwner)
      .registerOperator(key, config.ssvFee, false);
    operatorIds.push(Number(id));
  }

  const totalSsvDeposit = config.ssvDepositPerValidator * BigInt(config.validatorCount);
  await ssvToken.mint(clusterOwner.address, totalSsvDeposit);
  await ssvToken.connect(clusterOwner).approve(
    await legacyNetwork.getAddress(), totalSsvDeposit,
  );

  const validatorKeys: string[] = [];
  let cluster: Cluster = EMPTY_CLUSTER;
  for (let i = 0; i < config.validatorCount; i++) {
    const key = makePublicKey(2000 + i);
    validatorKeys.push(key);
    await legacyNetwork.connect(clusterOwner).registerValidator(
      key, operatorIds, DEFAULT_SHARES, config.ssvDepositPerValidator, cluster,
    );
    cluster = await getCurrentClusterState(
      connection, legacyNetwork, clusterOwner.address, operatorIds,
    );
  }

  const balance = BigInt(
    await legacyViews.getBalance(clusterOwner.address, operatorIds, cluster),
  );
  const burnRate = BigInt(
    await legacyViews.getBurnRate(clusterOwner.address, operatorIds, cluster),
  );

  const packedBurnRate = burnRate / DEDUCTED_DIGITS;
  const ssvThreshold = MINIMUM_BLOCKS_BEFORE_LIQUIDATION * packedBurnRate * DEDUCTED_DIGITS;
  const effectiveThreshold = ssvThreshold > MINIMUM_LIQUIDATION_PERIOD_COLLATERAL
    ? ssvThreshold : MINIMUM_LIQUIDATION_PERIOD_COLLATERAL;

  const blocksToThreshold = burnRate > 0n
    ? Number((balance - effectiveThreshold) / burnRate)
    : 0;
  const blocksToMine = Math.max(0, blocksToThreshold - config.remainingRunway);

  if (blocksToMine > 0) {
    await mineBlocks(connection.ethers.provider, blocksToMine);
  }

  const ssvBalanceAtMigration = BigInt(
    await legacyViews.getBalance(clusterOwner.address, operatorIds, cluster),
  );

  const preUpgradeCluster = { ...cluster };

  const { cssv, newNetwork, newViews } = await upgradeToStakingVersion(
    connection, legacyNetwork, legacyViews,
  );

  (ctx as any).network = newNetwork;
  (ctx as any).views = newViews;
  (ctx as any).ssvToken = ssvToken;
  (ctx as any).cssvToken = cssv;

  const operators: OperatorRecord[] = operatorIds.map(id => ({
    id,
    fee: DEFAULT_OPERATOR_ETH_FEE,
    owner: operatorOwner,
  }));

  return {
    operatorIds,
    operators,
    ssvFee: config.ssvFee,
    totalSsvDeposit,
    preUpgradeCluster,
    validatorKeys,
    clusterOwner,
    operatorOwner,
    ssvBalanceAtMigration,
  };
}

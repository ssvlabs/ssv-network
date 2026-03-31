import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import type { Cluster } from "../../common/types.ts";
import type { FuzzContext, OperatorRecord, ClusterRecord } from "./types.ts";
import {
  DEFAULT_OPERATOR_ETH_FEE,
  MINIMAL_OPERATOR_ETH_FEE,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  ETH_DEDUCTED_DIGITS,
  STAKE_AMOUNT,
  TOKEN_REGISTER_AMOUNT,
} from "../../common/constants.ts";
import { makePublicKey, makeOperatorKey } from "../../helpers/keys.ts";
import { parseClusterFromEvent } from "../../helpers/cluster.ts";
import { Events } from "../../common/events.ts";
import { mineBlocks, getCurrentClusterState, registerOperatorsSSV, whitelistAddresses } from "../../helpers/index.ts";
import { setAccountBalance } from "../../helpers/blocks.ts";
import { ssvNetworkFullPreUpgradeFixture, upgradeToStakingVersion } from "../../setup/fixtures.ts";

export function alignFee(raw: bigint): bigint {
  return (raw / ETH_DEDUCTED_DIGITS) * ETH_DEDUCTED_DIGITS;
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
  clusterOwner: HardhatEthersSigner;
  operatorOwner: HardhatEthersSigner;
  totalSsvDeposit: bigint;
  preUpgradeBlocks: bigint;
}

export interface LegacyMigrationSeed {
  operators: OperatorRecord[];
  cluster: ClusterRecord;
  operatorIds: number[];
  legacyValidatorKeys: string[];
  ssvToken: any;
}

export async function setupLegacyMigrationSeed(
  ctx: FuzzContext<any>,
  config: LegacyMigrationSeedConfig,
): Promise<LegacyMigrationSeed> {
  const { clusterOwner, operatorOwner, totalSsvDeposit, preUpgradeBlocks } = config;
  const minimumRequiredDeposit = TOKEN_REGISTER_AMOUNT * 3n;
  if (totalSsvDeposit < minimumRequiredDeposit) {
    throw new Error(`Legacy migration seed requires at least ${minimumRequiredDeposit} SSV`);
  }

  const { network: legacyNetwork, views: legacyViews, ssvToken } =
    await ssvNetworkFullPreUpgradeFixture(ctx.connection);

  const operatorIds = await registerOperatorsSSV(legacyNetwork, operatorOwner, 4);
  await whitelistAddresses(legacyNetwork, operatorOwner, operatorIds, [clusterOwner.address]);

  await ssvToken.mint(clusterOwner.address, totalSsvDeposit);
  await ssvToken.connect(clusterOwner).approve(await legacyNetwork.getAddress(), totalSsvDeposit);

  const legacyValidatorKeys = [makePublicKey(7101), makePublicKey(7102), makePublicKey(7103)];
  const deposits = [
    TOKEN_REGISTER_AMOUNT,
    TOKEN_REGISTER_AMOUNT,
    totalSsvDeposit - (TOKEN_REGISTER_AMOUNT * 2n),
  ];

  let cluster = EMPTY_CLUSTER;
  for (let i = 0; i < legacyValidatorKeys.length; i++) {
    await legacyNetwork.connect(clusterOwner).registerValidator(
      legacyValidatorKeys[i],
      operatorIds,
      DEFAULT_SHARES,
      deposits[i],
      cluster,
    );
    cluster = await getCurrentClusterState(ctx.connection, legacyNetwork, clusterOwner.address, operatorIds);
  }

  await mineBlocks(ctx.provider, Number(preUpgradeBlocks));

  const { cssv, newNetwork, newViews } = await upgradeToStakingVersion(
    ctx.connection,
    legacyNetwork,
    legacyViews,
  );

  // The fuzz runner seeds an ETH fixture by default; swap to the upgraded legacy context for migration flows.
  ctx.network = newNetwork;
  ctx.views = newViews;
  ctx.ssvToken = ssvToken;
  ctx.cssvToken = cssv;

  return {
    operators: operatorIds.map((id) => ({ id, fee: DEFAULT_OPERATOR_ETH_FEE, owner: operatorOwner })),
    cluster: { cluster, operatorIds, owner: clusterOwner, validatorKeys: [...legacyValidatorKeys] },
    operatorIds,
    legacyValidatorKeys,
    ssvToken,
  };
}

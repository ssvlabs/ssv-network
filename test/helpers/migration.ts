import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullPreUpgradeFixture, upgradeToStakingVersion } from "../setup/fixtures.ts";
import { getCurrentClusterState, makePublicKey, registerOperatorsSSV, whitelistAddresses } from "./index.ts";
import { DEFAULT_SHARES, EMPTY_CLUSTER, TOKEN_REGISTER_AMOUNT } from "../common/constants.ts";
import { mineBlocks } from "./blocks.ts";

export interface SetupLegacyClusterAndUpgradeOptions {
  validatorCount?: number;
  keyOffset?: number;
  preUpgradeBlocks?: bigint;
  removedOperatorIndices?: number[];
}

export async function setupLegacyClusterAndUpgrade(
  connection: NetworkConnection<"generic">,
  operatorOwner: HardhatEthersSigner,
  clusterOwner: HardhatEthersSigner,
  fixtureLoader: () => Promise<{ network: any; views: any; ssvToken: any }>,
) {
  const { network, views, ssvToken } = await fixtureLoader();
  await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
  await ssvToken.connect(clusterOwner).approve(await network.getAddress(), TOKEN_REGISTER_AMOUNT);
  const operatorIds = await registerOperatorsSSV(network, operatorOwner, 4);
  await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);
  await network.connect(clusterOwner).registerValidator(
    makePublicKey(123), operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
  );
  const cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
  const { newNetwork, newViews } = await upgradeToStakingVersion(connection, network, views);
  return { network, newNetwork, newViews, ssvToken, operatorIds, cluster };
}

export async function setupLegacyClusterAndUpgradeWithOptions(
  connection: NetworkConnection<"generic">,
  operatorOwner: HardhatEthersSigner,
  clusterOwner: HardhatEthersSigner,
  options: SetupLegacyClusterAndUpgradeOptions = {},
) {
  const {
    validatorCount = 1,
    keyOffset = 123,
    preUpgradeBlocks = 0n,
    removedOperatorIndices = [],
  } = options;

  const { network, views, ssvToken } = await ssvNetworkFullPreUpgradeFixture(connection);
  const ssvDeposit = TOKEN_REGISTER_AMOUNT * BigInt(validatorCount);

  await ssvToken.mint(clusterOwner.address, ssvDeposit);
  await ssvToken.connect(clusterOwner).approve(await network.getAddress(), ssvDeposit);
  const operatorIds = await registerOperatorsSSV(network, operatorOwner, 4);
  await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

  const validatorKeys: string[] = [];
  let cluster = EMPTY_CLUSTER;
  for (let i = 0; i < validatorCount; i++) {
    const validatorKey = makePublicKey(keyOffset + i);
    await network.connect(clusterOwner).registerValidator(
      validatorKey,
      operatorIds,
      DEFAULT_SHARES,
      TOKEN_REGISTER_AMOUNT,
      cluster,
    );
    cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
    validatorKeys.push(validatorKey);
  }

  const removedOperatorIds: number[] = [];
  for (const idx of removedOperatorIndices) {
    const operatorId = operatorIds[idx];
    if (operatorId === undefined) {
      throw new Error(`Invalid removed operator index: ${idx}`);
    }
    await network.connect(operatorOwner).removeOperator(operatorId);
    removedOperatorIds.push(operatorId);
  }

  if (preUpgradeBlocks > 0n) {
    await mineBlocks(connection.ethers.provider, Number(preUpgradeBlocks));
  }

  cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
  const { newNetwork, newViews } = await upgradeToStakingVersion(connection, network, views);
  return { network, newNetwork, newViews, ssvToken, operatorIds, cluster, validatorKeys, removedOperatorIds };
}

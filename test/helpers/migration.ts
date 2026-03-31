import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ssvNetworkFullPreUpgradeFixture, upgradeToStakingVersion } from "../setup/fixtures.ts";
import { getCurrentClusterState, makePublicKey, registerOperatorsSSV, whitelistAddresses } from "./index.ts";
import { DEFAULT_SHARES, EMPTY_CLUSTER, TOKEN_REGISTER_AMOUNT } from "../common/constants.ts";
import { mineBlocks } from "./blocks.ts";

export async function setupLegacyClusterAndUpgrade(
  connection: NetworkConnection<"generic">,
  operatorOwner: HardhatEthersSigner,
  clusterOwner: HardhatEthersSigner,
) {
  const { network, views, ssvToken } = await ssvNetworkFullPreUpgradeFixture(connection);
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

export async function setupLiquidatedLegacyClusterAndUpgrade(
  connection: NetworkConnection<"generic">,
  operatorOwner: HardhatEthersSigner,
  clusterOwner: HardhatEthersSigner,
  blocksAfterUpgradeBeforeMigration: bigint = 0n,
) {
  const { network, views, ssvToken } = await ssvNetworkFullPreUpgradeFixture(connection);
  await ssvToken.mint(clusterOwner.address, TOKEN_REGISTER_AMOUNT);
  await ssvToken.connect(clusterOwner).approve(await network.getAddress(), TOKEN_REGISTER_AMOUNT);

  const operatorIds = await registerOperatorsSSV(network, operatorOwner, 4);
  await whitelistAddresses(network, operatorOwner, operatorIds, [clusterOwner.address]);

  const validatorKey = makePublicKey(123);
  await network.connect(clusterOwner).registerValidator(
    validatorKey, operatorIds, DEFAULT_SHARES, TOKEN_REGISTER_AMOUNT, EMPTY_CLUSTER,
  );

  const registeredCluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);
  const balanceSSV = BigInt(await views.getBalance(clusterOwner.address, operatorIds, registeredCluster));
  const burnRateSSV = BigInt(await views.getBurnRate(clusterOwner.address, operatorIds, registeredCluster));
  const blocksUntilDepleted = burnRateSSV === 0n
    ? 0n
    : (balanceSSV + burnRateSSV - 1n) / burnRateSSV;

  if (blocksUntilDepleted > 0n) {
    await mineBlocks(connection.ethers.provider, Number(blocksUntilDepleted));
  }

  await network.connect(clusterOwner).liquidate(clusterOwner.address, operatorIds, registeredCluster);
  const cluster = await getCurrentClusterState(connection, network, clusterOwner.address, operatorIds);

  const { newNetwork, newViews } = await upgradeToStakingVersion(connection, network, views);

  if (blocksAfterUpgradeBeforeMigration > 0n) {
    await mineBlocks(connection.ethers.provider, Number(blocksAfterUpgradeBeforeMigration));
  }

  return { network, newNetwork, newViews, ssvToken, operatorIds, cluster, validatorKey };
}

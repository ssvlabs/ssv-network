import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { upgradeToStakingVersion } from "../setup/fixtures.ts";
import { getCurrentClusterState, makePublicKey, registerOperatorsSSV, whitelistAddresses } from "./index.ts";
import { DEFAULT_SHARES, EMPTY_CLUSTER, TOKEN_REGISTER_AMOUNT } from "../common/constants.ts";

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

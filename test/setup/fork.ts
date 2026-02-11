import hre from "hardhat";
import type { NetworkConnection } from "hardhat/types/network";
import type { NetworkHelpersType } from "../common/types.ts";

export async function getForkedConnection(): Promise<{
  connection: NetworkConnection<"generic">;
  ethers: NetworkConnection<"generic">["ethers"];
  networkHelpers: NetworkHelpersType;
}> {
  const selectedForkNetwork = process.env.FORK_TEST_NETWORK ?? "hardhat_forked";
  const connection = await hre.network.connect(selectedForkNetwork as any);

  return {
    connection,
    ethers: connection.ethers,
    networkHelpers: connection.networkHelpers,
  };
}

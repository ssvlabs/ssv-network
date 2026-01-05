import hre from "hardhat";
import type { NetworkConnection } from "hardhat/types/network";
import type { NetworkHelpersType } from "../common/types.ts";

export async function getTestConnection(): Promise<{
  connection: NetworkConnection<"generic">;
  ethers: NetworkConnection<"generic">["ethers"];
  networkHelpers: NetworkHelpersType;
}> {
  const connection = await hre.network.connect("hardhat");

  return {
    connection,
    ethers: connection.ethers,
    networkHelpers: connection.networkHelpers,
  };
}
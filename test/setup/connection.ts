import hre from "hardhat";

export async function getTestConnection() {
  const connection = await hre.network.connect();

  return {
    connection,
    ethers: connection.ethers,
    networkHelpers: connection.networkHelpers,
  };
}
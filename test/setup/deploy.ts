export async function deployToken(connection: any) {
  const { ethers } = connection;
  const [deployer] = await ethers.getSigners();

  return ethers.deployContract(
    "ERC20Mock",
    ["SSV", "SSV", deployer.address, ethers.parseEther("1000000")]
  );
}

export async function deployModule(
  connection: any,
  moduleName: string
) {
  return connection.ethers.deployContract(moduleName);
}
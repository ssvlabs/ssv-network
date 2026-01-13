import type { NetworkConnection } from "hardhat/types/network";
import { Contract } from "ethers";
import { SSVModules } from '../common/types.ts';
import { SSV_MODULE_CONTRACTS } from '../common/constants.ts';
import { getHarnessName } from '../common/helpers.ts';

export async function deployToken(
  connection: NetworkConnection<"generic">
): Promise<Contract> {
  const { ethers } = connection;
  const [deployer] = await ethers.getSigners();

  return ethers.deployContract(
    "ERC20Mock",
    ["SSV", "SSV", deployer.address, ethers.parseEther("1000000")]
  );
}

export async function deployModule(
  connection: NetworkConnection<"generic">,
  module: SSVModules
): Promise<Contract> {
  return connection.ethers.deployContract(
    SSV_MODULE_CONTRACTS[module]
  );
}

export async function deployHarnessModule(
  connection: NetworkConnection<"generic">,
  module: SSVModules
): Promise<Contract> {
  return connection.ethers.deployContract(
    getHarnessName(module)
  );
}
import { network, artifacts } from "hardhat";
import { Contract, ContractFactory, Signer } from "ethers";
import type { HardhatEthersHelpers } from "@nomicfoundation/hardhat-ethers/types";
import { SSVModules } from "./modules.ts";

export function parseArg(argName: string): string {
  const index = process.argv.indexOf(`--${argName}`);
  if (index === -1) throw new Error(`Missing: --${argName}`);
  const value = process.argv[index + 1];
  if (!value) throw new Error(`Missing value for --${argName}`);
  return value;
}

export async function getEthers(targetNetwork: string): Promise<HardhatEthersHelpers> {
  return (await network.connect({ network: targetNetwork })).ethers;
}

export async function getDeployer(ethers: HardhatEthersHelpers): Promise<Signer> {
  const [deployer] = await ethers.getSigners();
  console.log(`Deployer: ${deployer.address}`);
  return deployer;
}

export async function deployContract(
  ethers: HardhatEthersHelpers,
  contractName: string,
  args: any[] = []
): Promise<{ contract: any; address: string }> {
  const factory = await ethers.getContractFactory(contractName);
  const contract = await factory.deploy(...args);
  await contract.waitForDeployment();
  const address = await contract.getAddress();
  console.log(`${contractName} at: ${address}`);
  return { contract, address };
}

export async function deployProxy(
  ethers: HardhatEthersHelpers,
  deployer: Signer,
  implAddress: string,
  initData: string
): Promise<{ proxy: any; address: string }> {
  const proxyArtifact = await artifacts.readArtifact("ERC1967Proxy");
  const proxyFactory = new ContractFactory(proxyArtifact.abi, proxyArtifact.bytecode, deployer);
  const proxy = await proxyFactory.deploy(implAddress, initData);
  await proxy.waitForDeployment();
  const address = await proxy.getAddress();
  console.log(`Proxy at: ${address}`);
  return { proxy, address };
}

export async function attachModule(
  ethers: HardhatEthersHelpers,
  proxyAddress: string,
  moduleName: string,
  moduleAddress: string
): Promise<void> {
  const moduleEnumKey = moduleName as keyof typeof SSVModules;
  if (SSVModules[moduleEnumKey] === undefined) {
    throw new Error(`Invalid module: ${moduleName}`);
  }
  const networkFactory = await ethers.getContractFactory("SSVNetwork");
  const ssvNetwork = networkFactory.attach(proxyAddress);
  console.log(`Attaching ${moduleName} (${moduleAddress})...`);
  const tx = await ssvNetwork.updateModule(SSVModules[moduleEnumKey], moduleAddress);
  await tx.wait();
  console.log(`Attached ${moduleName} at ${moduleAddress}`);
}

export async function upgradeProxy(
  ethers: HardhatEthersHelpers,
  deployer: Signer,
  proxyAddress: string,
  implAddress: string,
  contractName: string,
  initFunction?: string,
  params: any[] = []
): Promise<void> {
  const factory = await ethers.getContractFactory(contractName);
  const proxy = await ethers.getContractAt("SSVNetwork", proxyAddress, deployer);

  if (initFunction) {
    let fragment;
    if (initFunction.includes("(")) {
      fragment = factory.interface.getFunction(initFunction);
    } else {
      fragment = factory.interface.getFunction(initFunction);
    }
    const initData = factory.interface.encodeFunctionData(fragment, params);

    const tx = await proxy.upgradeToAndCall(implAddress, initData);
    await tx.wait();
    console.log("Upgrade with init done");
  } else {
    const tx = await proxy.upgradeTo(implAddress);
    await tx.wait();
    console.log("Upgrade done");
  }

  console.log(`Proxy now uses: ${implAddress}`);
}
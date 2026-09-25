import { attachModule, deployContract, getDeployer, getEthers, parseArg } from "./common/helpers.ts";
import { SSVModules } from "./common/modules.ts";

async function main() {
  const moduleName = parseArg("module");
  const proxyAddress = parseArg("proxy-address");
  const targetNetwork = parseArg("network");

  const moduleEnumKey = moduleName as keyof typeof SSVModules;
  if (SSVModules[moduleEnumKey] === undefined) {
    throw new Error(`Invalid module: ${moduleName}. Valid: ${Object.keys(SSVModules).join(", ")}`);
  }

  const ethers = await getEthers(targetNetwork);
  await getDeployer(ethers);

  const { address: moduleAddress } = await deployContract(ethers, moduleName);
  await attachModule(ethers, proxyAddress, moduleName, moduleAddress);

  console.log(`Done: ${moduleName} deployed at ${moduleAddress} and attached to proxy ${proxyAddress}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

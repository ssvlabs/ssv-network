import { parseArg, getEthers, getDeployer, deployContract, attachModule } from "./common/helpers.ts";
import { SSVModules } from "./common/modules.ts";
import { saveImplementation } from "./common/address-book.js";

async function main() {
  const targetNetwork = parseArg("network");
  const ethers = await getEthers(targetNetwork);
  await getDeployer(ethers);

  const moduleName = parseArg("module");
  const proxyAddress = parseArg("proxy-address");

  const moduleEnumKey = moduleName as keyof typeof SSVModules;
  if (SSVModules[moduleEnumKey] === undefined) {
    throw new Error(`Invalid module: ${moduleName}`);
  }

  const { address: moduleAddress } = await deployContract(ethers, moduleName);
  await attachModule(ethers, proxyAddress, moduleName, moduleAddress);
  saveImplementation(targetNetwork, moduleName, moduleAddress);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
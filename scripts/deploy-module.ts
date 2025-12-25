import { parseArg, getEthers, getDeployer, deployContract } from "./common/helpers.ts";
import { SSVModules } from "./common/modules.ts";

async function main() {
  const targetNetwork = parseArg("network");
  const ethers = await getEthers(targetNetwork);
  await getDeployer(ethers);

  const moduleName = parseArg("module");

  const moduleEnumKey = moduleName as keyof typeof SSVModules;
  if (SSVModules[moduleEnumKey] === undefined) {
    throw new Error(`Invalid module: ${moduleName}`);
  }

  // do not save the new address here, should be saved after being attached
  await deployContract(ethers, moduleName);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
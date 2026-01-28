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

  let args: any[] = [];
  const argsIndex = process.argv.indexOf("--args");
  if (argsIndex !== -1) {
    const argsValue = process.argv[argsIndex + 1];
    if (argsValue) {
      try {
        args = JSON.parse(argsValue);
        if (!Array.isArray(args)) {
          throw new Error("Args must be a JSON array");
        }
      } catch (err) {
        throw new Error(`Invalid --args JSON: ${argsValue}. Expected array like [1, "hello", true]`);
      }
    }
  }

  const { address: moduleAddress } = await deployContract(ethers, moduleName, args);
  await attachModule(ethers, proxyAddress, moduleName, moduleAddress);
  saveImplementation(targetNetwork, moduleName, moduleAddress);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
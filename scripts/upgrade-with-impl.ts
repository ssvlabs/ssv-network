import { parseArg, getEthers, getDeployer, upgradeProxy } from "./common/helpers.ts";
import { saveImplementation } from "./common/address-book.js";

async function main() {
  const targetNetwork = parseArg("network");
  const ethers = await getEthers(targetNetwork);
  const deployer = await getDeployer(ethers);

  const proxyAddress = parseArg("proxy-address");
  const implAddress = parseArg("impl-address");
  const contractName = parseArg("contract");

  const initFunction = process.argv.includes("--init") ? process.argv[process.argv.indexOf("--init") + 1] : undefined;
  const paramsIdx = process.argv.indexOf("--params");
  const params: string[] = paramsIdx !== -1 ? process.argv.slice(paramsIdx + 1) : [];

  console.log(`Upgrading proxy ${proxyAddress} with impl ${implAddress} on ${targetNetwork}`);

  saveImplementation(targetNetwork, contractName, implAddress);

  await upgradeProxy(ethers, deployer, proxyAddress, implAddress, contractName, initFunction, params);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
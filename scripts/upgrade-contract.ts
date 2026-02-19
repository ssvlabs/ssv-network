import { parseArg, getEthers, getDeployer, deployContract, upgradeProxy } from "./common/helpers.ts";
import { parseOptionalArg } from "./common/config.ts";

async function main() {
  const targetNetwork = parseArg("network");
  const ethers = await getEthers(targetNetwork);
  const deployer = await getDeployer(ethers);

  const proxyAddress = parseArg("proxy-address");
  const contractName = parseArg("contract");
  const preDeployedImpl = parseOptionalArg("impl-address");

  const initFunction = process.argv.includes("--init") ? process.argv[process.argv.indexOf("--init") + 1] : undefined;
  const paramsIdx = process.argv.indexOf("--params");
  const params: string[] = paramsIdx !== -1 ? process.argv.slice(paramsIdx + 1) : [];

  let implAddress: string;
  if (preDeployedImpl) {
    implAddress = preDeployedImpl;
    console.log(`Using pre-deployed ${contractName} at ${implAddress} on ${targetNetwork}`);
  } else {
    console.log(`Deploying new ${contractName} and upgrading proxy ${proxyAddress} on ${targetNetwork}`);
    implAddress = (await deployContract(ethers, contractName)).address;
  }

  await upgradeProxy(ethers, deployer, proxyAddress, implAddress, contractName, initFunction, params);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

import { parseArg, getEthers, getDeployer, deployContract } from "./common/helpers.ts";

async function main() {
  const targetNetwork = parseArg("network");
  const ethers = await getEthers(targetNetwork);
  await getDeployer(ethers);

  const contractName = parseArg("contract");

  console.log(`Deploying impl ${contractName} on ${targetNetwork}`);

  // do not save the new address here, should be saved after being attached
  await deployContract(ethers, contractName);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
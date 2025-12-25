import { parseArg, getEthers, getDeployer, deployContract, deployProxy } from "./common/helpers.ts";
import { saveImplementation } from "./common/address-book.js";

async function main() {
  const targetNetwork = parseArg("network");
  const ethers = await getEthers(targetNetwork);
  const deployer = await getDeployer(ethers);

  const ssvNetworkAddress = parseArg("ssv-network");

  console.log(`Deploying SSVNetworkViews proxy on ${targetNetwork}`);

  const { address: implAddress } = await deployContract(ethers, "SSVNetworkViews");
  saveImplementation(targetNetwork, "SSVNetworkViews", implAddress);

  const Factory = await ethers.getContractFactory("SSVNetworkViews");
  const initData = Factory.interface.encodeFunctionData("initialize", [ssvNetworkAddress]);

  const { address: proxyAddress } = await deployProxy(ethers, deployer, implAddress, initData);
  saveImplementation(targetNetwork, "SSVNetworkViewsProxy", proxyAddress);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
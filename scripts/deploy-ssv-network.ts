import { parseArg, getEthers, getDeployer, deployContract, deployProxy } from "./common/helpers.ts";
import { saveImplementation } from "./common/address-book.js";

async function main() {
  const targetNetwork = parseArg("network");
  const ethers = await getEthers(targetNetwork);
  const deployer = await getDeployer(ethers);

  const operatorsModAddress = parseArg("operators-mod");
  const clustersModAddress = parseArg("clusters-mod");
  const daoModAddress = parseArg("dao-mod");
  const viewsModAddress = parseArg("views-mod");
  const ssvTokenAddress = parseArg("ssv-token");
  const quorumBps = Number(process.env.QUORUM_BPS ?? "6700");

  if (!Number.isInteger(quorumBps) || quorumBps <= 0 || quorumBps > 10000) {
    throw new Error("Invalid QUORUM_BPS value");
  }

  console.log(`Deploying SSVNetwork proxy on ${targetNetwork}`);

  const { address: implAddress } = await deployContract(ethers, "SSVNetwork");
  saveImplementation(targetNetwork, "SSVNetwork", implAddress);

  const Factory = await ethers.getContractFactory("SSVNetwork");
  const initData = Factory.interface.encodeFunctionData("initialize", [
    ssvTokenAddress,
    operatorsModAddress,
    clustersModAddress,
    daoModAddress,
    viewsModAddress,
    process.env.MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
    process.env.MINIMUM_LIQUIDATION_COLLATERAL,
    process.env.VALIDATORS_PER_OPERATOR_LIMIT,
    process.env.DECLARE_OPERATOR_FEE_PERIOD,
    process.env.EXECUTE_OPERATOR_FEE_PERIOD,
    process.env.OPERATOR_MAX_FEE_INCREASE,
  ]);

  const { address: proxyAddress } = await deployProxy(ethers, deployer, implAddress, initData);
  saveImplementation(targetNetwork, "SSVNetworkProxy", proxyAddress);

  const ssvNetwork = Factory.attach(proxyAddress);
  const tx = await ssvNetwork.connect(deployer).setQuorumBps(quorumBps);
  await tx.wait();
  console.log(`Default quorumBps set to ${quorumBps}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

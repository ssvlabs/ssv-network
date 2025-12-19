import hre from "hardhat";
import { parseArg, getEthers, getDeployer, deployContract, deployProxy, attachModule, upgradeProxy } from "./common/helpers.ts";
import { saveImplementation } from "./common/address-book.js";

async function main() {
  const targetNetwork = parseArg("network");
  const ethers = await getEthers(targetNetwork);
  const deployer = await getDeployer(ethers);

  console.log(`Deploying all on ${targetNetwork}`);

  let ssvTokenAddress: string;
  const tokenAddressFromConfig: string | undefined = (hre.userConfig.networks![targetNetwork] as any).ssvToken;
  if (tokenAddressFromConfig) {
    ssvTokenAddress = tokenAddressFromConfig;
    console.log(`Using SSVToken at: ${ssvTokenAddress}`);
  } else {
    throw new Error("Missing SSVToken address in config");
  }

  const moduleNames = ["SSVOperators", "SSVClusters", "SSVDAO", "SSVViews", "SSVOperatorsWhitelist", "SSVStaking"];
  const moduleAddresses: { [key: string]: string } = {};
  for (const mod of moduleNames) {
    const { address } = await deployContract(ethers, mod);
    moduleAddresses[mod] = address;
    saveImplementation(targetNetwork, mod, address);
  }

  const { address: networkImplAddr } = await deployContract(ethers, "SSVNetwork");
  saveImplementation(targetNetwork, "SSVNetwork", networkImplAddr);

  const networkFactory = await ethers.getContractFactory("SSVNetwork");
  const networkInitData = networkFactory.interface.encodeFunctionData("initialize", [
    ssvTokenAddress,
    moduleAddresses["SSVOperators"],
    moduleAddresses["SSVClusters"],
    moduleAddresses["SSVDAO"],
    moduleAddresses["SSVViews"],
    process.env.MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
    process.env.MINIMUM_LIQUIDATION_COLLATERAL,
    process.env.VALIDATORS_PER_OPERATOR_LIMIT,
    process.env.DECLARE_OPERATOR_FEE_PERIOD,
    process.env.EXECUTE_OPERATOR_FEE_PERIOD,
    process.env.OPERATOR_MAX_FEE_INCREASE,
  ]);

  const { address: networkProxyAddr } = await deployProxy(ethers, deployer, networkImplAddr, networkInitData);
  saveImplementation(targetNetwork, "SSVNetworkProxy", networkProxyAddr);

  await attachModule(ethers, networkProxyAddr, "SSVOperatorsWhitelist", moduleAddresses["SSVOperatorsWhitelist"]);

  const { address: viewsImplAddr } = await deployContract(ethers, "SSVNetworkViews");
  saveImplementation(targetNetwork, "SSVNetworkViews", viewsImplAddr);

  const viewsFactory = await ethers.getContractFactory("SSVNetworkViews");
  const viewsInitData = viewsFactory.interface.encodeFunctionData("initialize", [networkProxyAddr]);

  const { address: viewsProxyAddr } = await deployProxy(ethers, deployer, viewsImplAddr, viewsInitData);
  saveImplementation(targetNetwork, "SSVNetworkViewsProxy", viewsProxyAddr);

  // --- Start Staking Deployment & Upgrade ---

  // 1. Deploy cSSVToken (passing SSVNetworkProxy address)
  const { address: cssvTokenAddr } = await deployContract(ethers, "CSSVToken", [networkProxyAddr]);
  saveImplementation(targetNetwork, "CSSVToken", cssvTokenAddr);

  // 2. SSVStaking implementation was deployed in the loop above

  // 3. Attach SSVStaking module to SSVNetwork
  await attachModule(ethers, networkProxyAddr, "SSVStaking", moduleAddresses["SSVStaking"]);

  // 4. Deploy and Upgrade SSVNetwork with initialization
  const { address: upgradeImplAddr } = await deployContract(ethers, "SSVNetworkSSVStakingUpgrade");
  saveImplementation(targetNetwork, "SSVNetworkSSVStakingUpgrade", upgradeImplAddr);

  await upgradeProxy(
    ethers,
    deployer,
    networkProxyAddr,
    upgradeImplAddr,
    "SSVNetworkSSVStakingUpgrade",
    "initializeSSVStaking",
    [cssvTokenAddr, 7 * 24 * 60 * 60]
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
const { ethers, upgrades } = require("hardhat");

require("dotenv").config();

async function main() {
    const MINIMUM_BLOCKS_BEFORE_LIQUIDATION=214800;
    const MINIMUM_LIQUIDATION_COLLATERAL="1000000000000000000";
    const OPERATOR_MAX_FEE_INCREASE=1000;
    const DECLARE_OPERATOR_FEE_PERIOD=604800;
    const EXECUTE_OPERATOR_FEE_PERIOD=604800;
    const VALIDATORS_PER_OPERATOR_LIMIT=1000;

  const ssvTokenAddress = '0xa13014Afa3b0DFfd2773Bb7BF2467F2A06ea223B';
  
    // Retrieve the contract to deploy
  const SSVOperators = await ethers.getContractFactory("SSVOperators");
  const SSVClusters = await ethers.getContractFactory("SSVClusters");
  const SSVDAO = await ethers.getContractFactory("SSVDAO");
  const SSVViews = await ethers.getContractFactory("SSVViews");
  const SSVOperatorsWhitelist = await ethers.getContractFactory("SSVOperatorsWhitelist");

  // Deploy the contract
  const ssvOperators = await SSVOperators.deploy();
  const ssvClusters = await SSVClusters.deploy();
  const ssvDAO = await SSVDAO.deploy();
  const ssvViews = await SSVViews.deploy();
  const ssvOperatorsWhitelist = await SSVOperatorsWhitelist.deploy();

  // Wait for the deployment to be mined
  await ssvOperators.waitForDeployment();
  await ssvClusters.waitForDeployment();
  await ssvDAO.waitForDeployment();
  await ssvViews.waitForDeployment();
  await ssvOperatorsWhitelist.waitForDeployment();

  // Get the deployed address
  const operatorsModAddress = await ssvOperators.getAddress();
  const clustersModAddress = await ssvClusters.getAddress();
  const daoModAddress = await ssvDAO.getAddress();
  const viewsModAddress = await ssvViews.getAddress();
  const opWhitelistingModAddress = await ssvOperatorsWhitelist.getAddress();

  console.log("ssvOperators deployed to:", operatorsModAddress);
  console.log("ssvClusters deployed to:", clustersModAddress);
  console.log("ssvDAO deployed to:", daoModAddress);
  console.log("ssvViews deployed to:", viewsModAddress);
  console.log("ssvOperatorsWhitelist deployed to:", opWhitelistingModAddress);

  const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');

  // deploy SSVNetwork
  console.log(`Deploying SSVNetwork with ssvToken ${ssvTokenAddress}`);
  const ssvNetwork = await upgrades.deployProxy(
    ssvNetworkFactory,
    [
      ssvTokenAddress,
      operatorsModAddress,
      clustersModAddress,
      daoModAddress,
      viewsModAddress,
      MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
      MINIMUM_LIQUIDATION_COLLATERAL,
      VALIDATORS_PER_OPERATOR_LIMIT,
      DECLARE_OPERATOR_FEE_PERIOD,
      EXECUTE_OPERATOR_FEE_PERIOD,
      OPERATOR_MAX_FEE_INCREASE,
    ],
    {
      kind: 'uups',
    },
  );
  await ssvNetwork.waitForDeployment();

  const ssvNetworkProxyAddress = await ssvNetwork.getAddress();
  const ssvNetworkImplAddress = await upgrades.erc1967.getImplementationAddress(ssvNetworkProxyAddress);

  console.log(`SSVNetwork proxy deployed to: ${ssvNetworkProxyAddress}`);
  console.log(`SSVNetwork implementation deployed to: ${ssvNetworkImplAddress}`);

  const ssvNetworkViewsFactory = await ethers.getContractFactory('SSVNetworkViews');

  // deploy SSVNetwork
  const ssvNetworkViews = await upgrades.deployProxy(ssvNetworkViewsFactory, [ssvNetworkProxyAddress], {
    kind: 'uups',
  });
  await ssvNetworkViews.waitForDeployment();

  const ssvNetworkViewsProxyAddress = await ssvNetworkViews.getAddress();
  const ssvNetworkViewsImplAddress = await upgrades.erc1967.getImplementationAddress(ssvNetworkViewsProxyAddress);

  console.log(`SSVNetworkViews proxy deployed to: ${ssvNetworkViewsProxyAddress}`);
  console.log(`SSVNetworkViews implementation deployed to: ${ssvNetworkViewsImplAddress}`);

}

// Handle errors and run the main function
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Error deploying contract:", error);
    process.exit(1);
  });
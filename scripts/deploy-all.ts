import { ethers, upgrades } from 'hardhat';

async function deploy() {
  const ssvTokenAddress = process.env.SSV_TOKEN_ADDRESS;

  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with the account:${deployer.address}`);

  // Initialize contract
  const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
  const ssvViewsFactory = await ethers.getContractFactory('SSVNetworkViews');

  const ssvViewsModFactory = await ethers.getContractFactory('contracts/modules/SSVViews.sol:SSVViews');
  const ssvOperatorsModFactory = await ethers.getContractFactory('SSVOperators');
  const ssvClustersModFactory = await ethers.getContractFactory('SSVClusters');
  const ssvDAOModFactory = await ethers.getContractFactory('SSVDAO');


  // Deploy ssvOperatorsMod
  const ssvOperatorsMod = await ssvOperatorsModFactory.deploy();
  await ssvOperatorsMod.deployed();
  console.log(`SSVOperators module deployed to: ${ssvOperatorsMod.address}`);


  // Deploy ssvClustersMod
  const ssvClustersMod = await ssvClustersModFactory.deploy();
  await ssvClustersMod.deployed();
  console.log(`SSVClusters module deployed to: ${ssvClustersMod.address}`);

  // Deploy ssvDAOMod
  const ssvDAOMod = await ssvDAOModFactory.deploy();
  await ssvDAOMod.deployed();
  console.log(`SSVDAO module deployed to: ${ssvDAOMod.address}`);

  // Deploy ssvViewsMod
  const ssvViewsMod = await ssvViewsModFactory.deploy();
  await ssvViewsMod.deployed();
  console.log(`SSVViews module deployed to: ${ssvViewsMod.address}`);

  // deploy SSVNetwork
  console.log(`Deploying SSVNetwork with ssvToken ${ssvTokenAddress}`);
  const ssvNetwork = await upgrades.deployProxy(ssvNetworkFactory, [
    ssvTokenAddress,
    ssvOperatorsMod.address,
    ssvClustersMod.address,
    ssvDAOMod.address,
    ssvViewsMod.address,
    process.env.MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
    process.env.MINIMUM_LIQUIDATION_COLLATERAL,
    process.env.VALIDATORS_PER_OPERATOR_LIMIT,
    process.env.DECLARE_OPERATOR_FEE_PERIOD,
    process.env.EXECUTE_OPERATOR_FEE_PERIOD,
    process.env.OPERATOR_MAX_FEE_INCREASE
  ],
    {
      kind: "uups"
    });
  await ssvNetwork.deployed();
  console.log(`SSVNetwork proxy deployed to: ${ssvNetwork.address}`);

  let implAddress = await upgrades.erc1967.getImplementationAddress(ssvNetwork.address);
  console.log(`SSVNetwork implementation deployed to: ${implAddress}`);

  // deploy SSVNetworkViews
  console.log(`Deploying SSVNetworkViews with SSVNetwork ${ssvNetwork.address}...`);
  const viewsContract = await upgrades.deployProxy(ssvViewsFactory, [
    ssvNetwork.address
  ],
    {
      kind: "uups"
    });
  await viewsContract.deployed();
  console.log(`SSVNetworkViews proxy deployed to: ${viewsContract.address}`);

  implAddress = await upgrades.erc1967.getImplementationAddress(viewsContract.address);
  console.log(`SSVNetworkViews implementation deployed to: ${implAddress}`);
}

deploy()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

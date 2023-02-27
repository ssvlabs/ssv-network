import { ethers, upgrades } from 'hardhat';
import { getEnvVar } from './utils';

async function deploy() {
  const ssvTokenAddress = getEnvVar('SSVTOKEN_ADDRESS');

  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with the account:${deployer.address}`);

  // deploy SSVNetwork
  const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
  console.log(`Deploying SSVNetwork with ssvToken ${ssvTokenAddress}`);
  const ssvNetwork = await upgrades.deployProxy(ssvNetworkFactory, [
    process.env.INITIAL_VERSION,
    ssvTokenAddress,
    getEnvVar('OPERATOR_MAX_FEE_INCREASE'),
    getEnvVar('DECLARE_OPERATOR_FEE_PERIOD'),
    getEnvVar('EXECUTE_OPERATOR_FEE_PERIOD'),
    getEnvVar('MINIMUM_BLOCKS_BEFORE_LIQUIDATION')
  ],
    {
      kind: "uups"
    });
  await ssvNetwork.deployed();
  console.log(`SSVNetwork proxy deployed to: ${ssvNetwork.address}`);

  let implAddress = await upgrades.erc1967.getImplementationAddress(ssvNetwork.address);
  console.log(`SSVNetwork implementation deployed to: ${implAddress}`);

  // deploy SSVNetworkViews
  const ssvViewsFactory = await ethers.getContractFactory('SSVNetworkViews');
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

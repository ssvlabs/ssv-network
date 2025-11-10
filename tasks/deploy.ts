import { task, subtask, types } from 'hardhat/config';
import { SSVModules } from './config';


/**
@title Hardhat task to deploy all required contracts for SSVNetwork.
This task deploys the main SSVNetwork and SSVNetworkViews contracts, along with their associated modules.
It uses the Hardhat Runtime Environment (HRE) to execute the deployment tasks and handle errors.
@returns {void} This function doesn't return anything. If the deployment process encounters an error, 
it will be printed to the console, and the process will exit with a non-zero status code.
@example
// Deploy all contracts with the default deployer account
npx hardhat --network holesky_testnet deploy:all
@remarks
The deployer account used will be the first one returned by ethers.getSigners().
Therefore, it should be appropriately configured in your Hardhat network configuration.
This task assumes that the SSVModules enum and deployment tasks for individual contracts have been properly defined.
*/
task('deploy:all', 'Deploy SSVNetwork, SSVNetworkViews and module contracts')
.addOptionalParam('machine', 'outputs the machine readable output', false, types.boolean)
.setAction(async (args, hre) => {
  if (!args.machine) {
     // Triggering compilation if this is manual
    await hre.run('compile');
  }

  if (!args.machine){
    const [deployer] = await ethers.getSigners();
    deployer.address = deployer.address.toLowerCase();
    console.log(`Deploying contracts with the account:${deployer.address}`);
  }

  const ssvTokenAddress = await hre.run('deploy:token', { machine: args.machine });
  const operatorsModAddress = await hre.run('deploy:module', { module: SSVModules[SSVModules.SSVOperators], machine: args.machine });
  const clustersModAddress = await hre.run('deploy:module', { module: SSVModules[SSVModules.SSVClusters], machine: args.machine });
  const daoModAddress = await hre.run('deploy:module', { module: SSVModules[SSVModules.SSVDAO], machine: args.machine });
  const viewsModAddress = await hre.run('deploy:module', { module: SSVModules[SSVModules.SSVViews],  machine: args.machine });

  const { ssvNetworkProxyAddress: ssvNetworkAddress } = await hre.run('deploy:ssv-network', {
    operatorsModAddress,
    clustersModAddress,
    daoModAddress,
    viewsModAddress,
    ssvTokenAddress,
    machine: args.machine,
  });

  await hre.run('deploy:ssv-network-views', {
    ssvNetworkAddress,
    machine: args.machine,
  });

  if (args.machine) {
    const jsonData = {
      ssvTokenAddress,
      operatorsModAddress,
      clustersModAddress,
      daoModAddress,
      viewsModAddress,
      ssvNetworkAddress,
    }
    console.log(JSON.stringify(jsonData));
  }
});

/**
@title Hardhat task to deploy a main implementation contract for SSVNetwork or SSVNetworkViews.
The contract parameter specifies the name of the contract implementation to be deployed.
@param {string} contract - The name of the contract implementation to deploy.
@returns {void} This function doesn't return anything. If the deployment process encounters an error, 
it will be printed to the console, and the process will exit with a non-zero status code.
@example
// Deploy SSVNetwork implementation contract with the default deployer account
npx hardhat --network holesky_testnet deploy:main-impl --contract SSVNetwork
@remarks
The deployer account used will be the first one returned by ethers.getSigners().
Therefore, it should be appropriately configured in your Hardhat network configuration.
This task uses the "deploy:impl" subtask for the actual deployment.
*/
task('deploy:main-impl', 'Deploys SSVNetwork / SSVNetworkViews implementation contract')
  .addParam('contract', 'New contract implemetation', null, types.string)
  .setAction(async ({ contract }, hre) => {
    await hre.run('deploy:impl', { contract });
  });

/**
@title Hardhat task to deploy a basic whitelisting contract implementation.
The deployment process involves running a subtask that handles the actual deployment.
@returns {void} This function doesn't return anything. If the deployment process encounters an error, 
it will be printed to the console, and the process will exit with a non-zero status code.
@example
// Deploy BasicWhitelisting contract with the default deployer account
npx hardhat --network holesky_testnet deploy:whitelisting-contract
@remarks
The deployer account used will be the first one returned by ethers.getSigners().
Therefore, it should be appropriately configured in your Hardhat network configuration.
This task uses the "deploy:impl" subtask for the actual deployment, specifying 'BasicWhitelisting' as the contract name.
*/
task('deploy:whitelisting-contract', 'Deploys a basic whitelisting contract').setAction(async (_, hre) => {
  await hre.run('deploy:impl', { contract: 'BasicWhitelisting' });
});

/**
@title Hardhat subtask to deploy an SSV module contract.
The module parameter specifies the name of the SSV module to be deployed.
The name must be one of the pre-specified values in the SSVModules object.
If the specified module doesn't match any of the available SSVModules, an error will be thrown.
@param {string} module - The name of the SSV module to deploy.
@returns {string} The address of the newly deployed module contract.
@remarks
The deployer account used will be the first one returned by ethers.getSigners().
Therefore, it should be appropriately configured in your Hardhat network configuration.
This subtask uses the "deploy:impl" subtask for the actual deployment.
*/
subtask('deploy:module', 'Deploys a new module contract')
  .addParam('module', 'SSV Module', null, types.string)
  .addOptionalParam('machine', 'outputs the machine readable output', false, types.boolean)
  .setAction(async ({ module, machine }, hre) => {
    const moduleValues = Object.values(SSVModules);
    if (!moduleValues.includes(module)) {
      throw new Error(`Invalid SSVModule: ${module}. Expected one of: ${moduleValues.join(', ')}`);
    }

    const moduleAddress = await hre.run('deploy:impl', { contract: module, machine: machine });
    return moduleAddress;
  });

task('deploy:token', 'Deploys SSV Token')
.addOptionalParam('machine', 'outputs the machine readable output', false, types.boolean)
.setAction(async (args, hre) => {
  if (!args.machine){
    // Triggering compilation if this is manual
    await hre.run('compile');
    console.log('Deploying SSV Network Token');
  }

  const ssvTokenFactory = await ethers.getContractFactory('SSVToken');
  const ssvToken = await ssvTokenFactory.deploy();
  await ssvToken.waitForDeployment();

  if (!args.machine){
    console.log(`SSV Network Token deployed to: ${ssvToken.address}`);
  } 

  return await ssvToken.getAddress()
});

/**
 * @title Hardhat subtask to deploy or fetch an SSV Token contract.
 * The ssvToken parameter in the hardhat's network section, specifies the address of the SSV Token contract.
 * If not provided, it will deploy a new MockToken contract.
 * @returns {string} The address of the deployed or fetched SSV Token contract.
 */
subtask('deploy:mock-token', 'Deploys / fetch SSV Token').setAction(async ({}, hre) => {
  const tokenAddress = hre.network.config.ssvToken;
  if (tokenAddress) return tokenAddress;

  // Local networks, deploy mock token
  // const ssvToken = await hre.viem.deployContract('SSVToken');
  const ssvTokenFactory = await ethers.getContractFactory('SSVToken');
  const ssvToken = await ssvTokenFactory.deployContract();
  await ssvToken.waitForDeployment();

  return await ssvToken.getAddress();
});

/**
@title Hardhat subtask to deploy a new implementation contract.
This subtask deploys a new implementation contract. 
The contract parameter specifies the name of the contract to be deployed.
@param {string} contract - The name of the contract to deploy.
@returns {string} The address of the newly deployed implementation contract.
@remarks
The deployer account used will be the first one returned by ethers.getSigners().
Therefore, it should be appropriately configured in your Hardhat network configuration.
The contract specified should be already compiled and exist in the 'artifacts' directory.
*/
subtask('deploy:impl', 'Deploys an implementation contract')
  .addParam('contract', 'New contract implemetation', null, types.string)
  .addOptionalParam('machine', 'outputs the machine readable output', false, types.boolean)
  .setAction(async (args, hre) => {
    if (!args.machine){
      // Triggering compilation if this is manual
      await hre.run('compile');
    }
    // Deploy implemetation contract
    const contractFactory = await ethers.getContractFactory(args.contract);
    const contractImpl = await contractFactory.deploy();
    await contractImpl.waitForDeployment();

    if (!args.machine){
      console.log(`${args.contract} implementation deployed to: ${await contractImpl.getAddress()}`);
    } 

    return await contractImpl.getAddress();
  });

/**
@title Hardhat subtask to deploy the SSVNetwork contract.
This subtask deploys the SSVNetwork contract as a Proxy using the UUPS (Universal Upgradeable Proxy Standard) pattern.
The parameters required are the addresses of the Operators, Clusters, DAO, and Views modules.
These addresses should be for contracts that have already been deployed on the network.
Environment variables are used to initialize SSVNetwork contract parameters, 
these should be configured prior to running the subtask.
@param {string} operatorsModAddress - The address of the deployed Operators module.
@param {string} clustersModAddress - The address of the deployed Clusters module.
@param {string} daoModAddress - The address of the deployed DAO module.
@param {string} viewsModAddress - The address of the deployed Views module.
@returns {Object} An object containing the addresses of the deployed SSVNetwork Proxy and the Implementation.
@remarks
The deployer account used will be the first one returned by ethers.getSigners().
Therefore, it should be appropriately configured in your Hardhat network configuration.
The 'SSVNetwork' contract specified should be already compiled and exist in the 'artifacts' directory.
*/
subtask('deploy:ssv-network', 'Deploys SSVNetwork contract')
  .addPositionalParam('operatorsModAddress', 'Operators module address', null, types.string)
  .addPositionalParam('clustersModAddress', 'Clusters module address', null, types.string)
  .addPositionalParam('daoModAddress', 'DAO module address', null, types.string)
  .addPositionalParam('viewsModAddress', 'Views module address', null, types.string)
  .addPositionalParam('ssvTokenAddress', 'SSV Token address', null, types.string)
  .addOptionalParam('machine', 'outputs the machine readable output', false, types.boolean)
  .setAction(async ({ operatorsModAddress, clustersModAddress, daoModAddress, viewsModAddress, ssvTokenAddress, machine }) => {
    const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');

    // deploy SSVNetwork
    if (!machine){
      console.log(`Deploying SSVNetwork with ssvToken ${ssvTokenAddress}`);
    }
    
    const ssvNetwork = await upgrades.deployProxy(
      ssvNetworkFactory,
      [
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
      ],
      {
        kind: 'uups',
      },
    );
    await ssvNetwork.waitForDeployment();

    const ssvNetworkProxyAddress = await ssvNetwork.getAddress();
    const ssvNetworkImplAddress = await upgrades.erc1967.getImplementationAddress(ssvNetworkProxyAddress);

    if (!machine) {
      console.log(`SSVNetwork proxy deployed to: ${ssvNetworkProxyAddress}`);
      console.log(`SSVNetwork implementation deployed to: ${ssvNetworkImplAddress}`);
    }

    return { ssvNetworkProxyAddress, ssvNetworkImplAddress };
  });

/**
@title Hardhat subtask to deploy the SSVNetworkViews contract.
This subtask deploys the SSVNetworkViews contract as a Proxy using the UUPS (Universal Upgradeable Proxy Standard) pattern.
The only parameter required is the address of the SSVNetwork proxy contract which should have been already deployed on the network.
@param {string} ssvNetworkAddress - The address of the deployed SSVNetwork contract.
@returns {Object} An object containing the addresses of the deployed SSVNetworkViews Proxy and the Implementation.
@remarks
The deployer account used will be the first one returned by ethers.getSigners().
Therefore, it should be appropriately configured in your Hardhat network configuration.
The 'SSVNetworkViews' contract specified should be already compiled and exist in the 'artifacts' directory.
*/
subtask('deploy:ssv-network-views', 'Deploys SSVNetworkViews contract')
  .addParam('ssvNetworkAddress', 'SSVNetwork address', null, types.string)
  .addOptionalParam('machine', 'outputs the machine readable output', false, types.boolean)
  .setAction(async ({ ssvNetworkAddress, machine }) => {
    const ssvNetworkViewsFactory = await ethers.getContractFactory('SSVNetworkViews');

    // deploy SSVNetwork
    const ssvNetworkViews = await upgrades.deployProxy(ssvNetworkViewsFactory, [ssvNetworkAddress], {
      kind: 'uups',
    });
    await ssvNetworkViews.waitForDeployment();

    const ssvNetworkViewsProxyAddress = await ssvNetworkViews.getAddress();
    const ssvNetworkViewsImplAddress = await upgrades.erc1967.getImplementationAddress(ssvNetworkViewsProxyAddress);

    if (!machine){
      console.log(`SSVNetworkViews proxy deployed to: ${ssvNetworkViewsProxyAddress}`);
      console.log(`SSVNetworkViews implementation deployed to: ${ssvNetworkViewsImplAddress}`);
    }

    return { ssvNetworkViewsProxyAddress, ssvNetworkViewsImplAddress };
  });

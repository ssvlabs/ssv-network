import { ethers } from 'hardhat';
import ssvModules from './ssvModules';

async function deploy() {
  const proxyAddress = process.env.SSVNETWORK_PROXY_ADDRESS;
  if (!proxyAddress) throw new Error("SSVNETWORK_PROXY_ADDRESS not set.");

  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with the account:${deployer.address}`);

  // Initialize contract
  const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
  const ssvOperatorsModFactory = await ethers.getContractFactory('SSVOperators');

  // Deploy ssvOperatorsMod
  const ssvOperatorsMod = await ssvOperatorsModFactory.deploy();
  await ssvOperatorsMod.deployed();
  console.log(`SSVOperators module deployed to: ${ssvOperatorsMod.address}`);

  const ssvNetwork = await ssvNetworkFactory.attach(proxyAddress);

  await ssvNetwork.upgradeModule(ssvModules.SSV_OPERATORS, ssvOperatorsMod.address);
  console.log(`SSVOperators module attached to SSVNetwork succesfully`);

}

deploy()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

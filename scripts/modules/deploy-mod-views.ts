import { ethers } from 'hardhat';
import ssvModules from './ssvModules';

async function deploy() {
  const proxyAddress = process.env.SSVNETWORK_PROXY_ADDRESS;
  if (!proxyAddress) throw new Error("SSVNETWORK_PROXY_ADDRESS not set.");

  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with the account:${deployer.address}`);

  // Initialize contract
  const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
  const ssvViewsModFactory = await ethers.getContractFactory('SSVViews');

  // Deploy ssvViewsMod
  const ssvViewsMod = await ssvViewsModFactory.deploy();
  await ssvViewsMod.deployed();
  console.log(`SSVViewsMod module deployed to: ${ssvViewsMod.address}`);

  const ssvNetwork = await ssvNetworkFactory.attach(proxyAddress);

  await ssvNetwork.upgradeModule(ssvModules.SSV_VIEWS, ssvViewsMod.address);
  console.log(`SSVViews module attached to SSVNetwork succesfully`);

}

deploy()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

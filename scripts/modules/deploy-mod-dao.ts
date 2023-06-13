import { ethers } from 'hardhat';
import ssvModules from './ssvModules';

async function deploy() {
  const proxyAddress = process.env.SSVNETWORK_PROXY_ADDRESS;
  if (!proxyAddress) throw new Error("SSVNETWORK_PROXY_ADDRESS not set.");

  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with the account:${deployer.address}`);

  // Initialize contract
  const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
  const ssvDAOModFactory = await ethers.getContractFactory('SSVDAO');

  // Deploy ssvDAOMod
  const ssvDAOMod = await ssvDAOModFactory.deploy();
  await ssvDAOMod.deployed();
  console.log(`SSVDAOMod module deployed to: ${ssvDAOMod.address}`);

  const ssvNetwork = await ssvNetworkFactory.attach(proxyAddress);

  await ssvNetwork.upgradeModule(ssvModules.SSV_DAO, ssvDAOMod.address);
  console.log(`SSVDAO module attached to SSVNetwork succesfully`);

}

deploy()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

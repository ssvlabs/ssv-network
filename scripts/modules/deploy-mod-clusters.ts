import { ethers } from 'hardhat';
import ssvModules from './ssvModules';

async function deploy() {
  const proxyAddress = process.env.SSVNETWORK_PROXY_ADDRESS;
  if (!proxyAddress) throw new Error("SSVNETWORK_PROXY_ADDRESS not set.");

  const [deployer] = await ethers.getSigners();
  console.log(`Deploying contracts with the account:${deployer.address}`);

  // Initialize contract
  const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
  const ssvClustersModFactory = await ethers.getContractFactory('SSVClusters');

  // Deploy ssvClustersMod
  const ssvClustersMod = await ssvClustersModFactory.deploy();
  await ssvClustersMod.deployed();
  console.log(`SSVClusters module deployed to: ${ssvClustersMod.address}`);

  const ssvNetwork = await ssvNetworkFactory.attach(proxyAddress);

  await ssvNetwork.upgradeModule(ssvModules.SSV_CLUSTERS, ssvClustersMod.address);
  console.log(`SSVClsuters module attached to SSVNetwork succesfully`);

}

deploy()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

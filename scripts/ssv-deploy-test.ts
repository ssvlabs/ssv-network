import { ethers, upgrades } from 'hardhat';

async function main() {
  console.log('Deploying SSVToken...');
  const ssvTokenFactory = await ethers.getContractFactory('SSVToken');
  const ssvToken = await upgrades.deployProxy(ssvTokenFactory, []);
  await ssvToken.deployed();

  console.log('Deploying SSVRegistry...');
  const ssvRegistryFactory = await ethers.getContractFactory('SSVRegistry');
  const ssvRegistry = await upgrades.deployProxy(ssvRegistryFactory, { initializer: false });
  await ssvRegistry.deployed();

  console.log('Deploying SSVNetwork...');
  const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
  const ssvNetwork = await upgrades.deployProxy(ssvNetworkFactory, [ssvRegistry.address, ssvToken.address]);
  await ssvNetwork.deployed();
  console.log(`SSVToken: ${ssvToken.address}\nSSVRegistry: ${ssvRegistry.address}\nSSVNetwork: ${ssvNetwork.address}`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

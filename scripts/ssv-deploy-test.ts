import { ethers, upgrades } from 'hardhat';

async function main() {
  console.log('Deploying OLDToken...');
  const oldTokenFactory = await ethers.getContractFactory('OldTokenMock');
  const oldToken = await oldTokenFactory.deploy();
  await oldToken.deployed();
  console.log('Deploying SSVToken...');
  const ssvTokenFactory = await ethers.getContractFactory('SSVToken');
  const ssvToken = await ssvTokenFactory.deploy();
  await ssvToken.deployed();
  console.log('Deploying DEX...');
  const dexFactory = await ethers.getContractFactory('DEX');
  const dex = await upgrades.deployProxy(
    dexFactory,
    [oldToken.address, ssvToken.address, 100]
  );
  await dex.deployed();
  console.log('Deploying SSVRegistry...');
  const ssvRegistryFactory = await ethers.getContractFactory('SSVRegistry');
  const ssvRegistry = await upgrades.deployProxy(ssvRegistryFactory, { initializer: false });
  await ssvRegistry.deployed();
  console.log('Deploying SSVNetwork...');
  const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
  const ssvNetwork = await upgrades.deployProxy(ssvNetworkFactory, [ssvRegistry.address, ssvToken.address, process.env.MINIMUM_BLOCKS_BEFORE_LIQUIDATION, process.env.OPERATOR_MAX_FEE_INCREASE]);
  await ssvNetwork.deployed();
  console.log(`SSVToken: ${ssvToken.address}\nSSVRegistry: ${ssvRegistry.address}\nSSVNetwork: ${ssvNetwork.address}\n`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

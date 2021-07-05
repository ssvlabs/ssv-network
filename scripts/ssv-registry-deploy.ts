import { ethers, upgrades } from 'hardhat';

async function main() {
  const ssvRegistryFactory = await ethers.getContractFactory('SSVRegistry');
  console.log('Deploying ssvRegistryFactory...');
  const contract = await upgrades.deployProxy(ssvRegistryFactory, { initializer: false });
  await contract.deployed();
  // const contractDev = await upgrades.deployProxy(Contract);
  // await contractDev.deployed();
  console.log(`SSVRegistry deployed to: ${contract.address}`); // , ${contractDev.address}`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

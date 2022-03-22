import { ethers, upgrades } from 'hardhat';
import { publishAbi } from './utils';

async function main() {
  await publishAbi('SSVRegistry');

  const ssvRegistryFactory = await ethers.getContractFactory('SSVRegistry');
  console.log('Deploying ssvRegistryFactory...');
  const contract = await upgrades.deployProxy(ssvRegistryFactory, { initializer: false });
  await contract.deployed();
  console.log(`SSVRegistry deployed to: ${contract.address}`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

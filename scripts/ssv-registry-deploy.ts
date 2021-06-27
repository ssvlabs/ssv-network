import { ethers, upgrades } from 'hardhat';

async function main() {
  const Contract = await ethers.getContractFactory('SSVRegistry');
  console.log('Deploying SSVRegistry...');
  const contract = await upgrades.deployProxy(Contract);
  await contract.deployed();
  const contractDev = await upgrades.deployProxy(Contract);
  await contractDev.deployed();
  console.log(`SSVRegistry deployed to: ${contract.address}, ${contractDev.address}`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

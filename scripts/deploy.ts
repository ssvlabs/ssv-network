import { ethers, upgrades } from 'hardhat';

async function main() {
  const Contract = await ethers.getContractFactory('SSVNetwork');
  console.log('Deploying SSVNetwork...');
  const contract = await upgrades.deployProxy(Contract);
  await contract.deployed();
  console.log(`Contract deployed to: ${contract.address}`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

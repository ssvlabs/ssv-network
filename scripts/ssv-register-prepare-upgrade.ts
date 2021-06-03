import { ethers, upgrades } from 'hardhat';

async function main() {
  const proxyAddress = process.env.PROXY_ADDRESS;
  const ContractUpgraded = await ethers.getContractFactory('SSVNetwork');
  console.log('Preparing upgrade...');
  const address = await upgrades.prepareUpgrade(proxyAddress, ContractUpgraded);
  console.log(`New contract implementation at: ${address}`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

import { ethers, upgrades } from 'hardhat';

async function main() {
  const proxyAddress = process.env.PROXY_ADDRESS;
  const BloxV2 = await ethers.getContractFactory('BloxV2');
  console.log('Running upgrade...');
  const bloxV2 = await upgrades.upgradeProxy(proxyAddress, BloxV2);
  console.log(`BloxV2 upgraded at: ${bloxV2.address}`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

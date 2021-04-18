import { ethers, upgrades } from 'hardhat';

async function main() {
  const proxyAddress = process.env.PROXY_ADDRESS;
  const BloxV2 = await ethers.getContractFactory('BloxV2');
  console.log('Preparing upgrade...');
  const bloxV2Address = await upgrades.prepareUpgrade(proxyAddress, BloxV2);
  console.log(`BloxV2 at: ${bloxV2Address}`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

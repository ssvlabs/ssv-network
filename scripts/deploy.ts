import { ethers, upgrades } from 'hardhat';

async function main() {
  const Blox = await ethers.getContractFactory('Blox');
  console.log('Deploying Blox...');
  const blox = await upgrades.deployProxy(Blox, [42], { initializer: 'store' });
  await blox.deployed();
  console.log(`Blox deployed to: ${blox.address}`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

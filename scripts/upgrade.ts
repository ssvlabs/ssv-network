import { ethers, upgrades } from 'hardhat';

async function main() {
const GreeterV2 = await ethers.getContractFactory('GreeterV2');
  const greeter = await upgrades.upgradeProxy(BOX_ADDRESS, GreeterV2);
  console.log('Greeter upgraded to the address address: ', greeter.address);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

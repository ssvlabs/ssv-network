import { ethers, upgrades } from 'hardhat';

async function main() {
  // ethers is avaialble in the global scope
  const [deployer] = await ethers.getSigners();
  console.log(
    'Deploying the contracts with the account:',
    await deployer.getAddress()
  );

  console.log('Account balance:', (await deployer.getBalance()).toString());

  const Contract = await ethers.getContractFactory('DEX');
  const contract = await upgrades.deployProxy(
    Contract,
    ['0x75DA56880f9C01f873854556387DCE5d106f9444', '0x21Bd07D624AdE51D68b4a8e880dC3c20bF9ca2FC'],
    { initializer: 'init' }
  );
  await contract.deployed();

  console.log('DEX contract address:', contract.address);
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
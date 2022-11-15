import { ethers, upgrades } from 'hardhat';

async function main() {
  const config = {
    operatorMaxFeeIncrease: 1000,
    declareOperatorFeePeriod: 3600, // HOUR
    executeOperatorFeePeriod: 86400, // DAY
  };

  const [deployer] = await ethers.getSigners();
  console.log(
    'Deploying the contracts with the account:',
    await deployer.getAddress()
  );
  console.log('Account balance:', (await deployer.getBalance()).toString());

  // Define accounts
  const ssvNetwork = await ethers.getContractFactory('SSVNetwork');
  const deployArguments = [
    process.env.SSV_TOKEN_ADDRESS,
    config.operatorMaxFeeIncrease,
    config.declareOperatorFeePeriod,
    config.executeOperatorFeePeriod
  ];
  console.log('Deploy arguments: ', deployArguments);
  const contract = await upgrades.deployProxy(ssvNetwork, deployArguments);

  await contract.deployed();
  console.log(`SSVNetwork deployed to: ${contract.address}`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

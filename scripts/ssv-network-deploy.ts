import { ethers, upgrades } from 'hardhat';
import { publishAbi } from './utils';

async function main() {
  await publishAbi('SSVNetwork');

  const ssvRegistryAddress = process.env.SSVREGISTRY_ADDRESS;
  const ssvTokenAddress = process.env.SSVTOKEN_ADDRESS;
  const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
  console.log(`Deploying SSVNetwork with ssvRegistry ${ssvRegistryAddress} and ssvToken ${ssvTokenAddress}...`);
  const contract = await upgrades.deployProxy(ssvNetworkFactory, [
    ssvRegistryAddress,
    ssvTokenAddress,
    process.env.MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
    process.env.OPERATOR_MAX_FEE_INCREASE,
    process.env.SET_OPERATOR_FEE_PERIOD,
    process.env.APPROVE_OPERATOR_FEE_PERIOD,
    process.env.VALIDATORS_PER_OPERATOR_LIMIT,
    process.env.OPERATORS_PER_OWNER_LIMIT,
    process.env.OPERATORS_PER_VALIDATOR_LIMIT
  ]);
  await contract.deployed();
  console.log(`SSVNetwork deployed to: ${contract.address}`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

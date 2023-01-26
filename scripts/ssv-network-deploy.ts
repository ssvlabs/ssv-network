import { ethers, upgrades } from 'hardhat';

async function main() {
  const ssvTokenAddress = process.env.SSVTOKEN_ADDRESS;
  const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
  console.log(`Deploying SSVNetwork with ssvToken ${ssvTokenAddress}...`);
  const contract = await upgrades.deployProxy(ssvNetworkFactory, [
    ssvTokenAddress,
    process.env.OPERATOR_MAX_FEE_INCREASE,
    process.env.DECLARE_OPERATOR_FEE_PERIOD,
    process.env.EXECUTE_OPERATOR_FEE_PERIOD,
    process.env.MINIMUM_BLOCKS_BEFORE_LIQUIDATION
  ],
    {
      kind: "uups"
    });
  await contract.deployed();
  console.log(`SSVNetwork deployed to: ${contract.address}`);

  const ssvViewsFactory = await ethers.getContractFactory('SSVNetworkViews');
  console.log(`Deploying SSVNetworkViews with SSVNetwork ${contract.address}...`);
  const viewsContract = await upgrades.deployProxy(ssvViewsFactory, [
    contract.address
  ],
    {
      kind: "uups"
    });
  await viewsContract.deployed();
  console.log(`SSVNetworkViews deployed to: ${viewsContract.address}`);
}

main()
  .then(() => process.exit(0))
  .catch(error => {
    console.error(error);
    process.exit(1);
  });

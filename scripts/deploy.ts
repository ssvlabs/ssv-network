import hre from "hardhat";
import { ethers, upgrades } from 'hardhat';
import { Address } from 'viem';

const CONFIG = {
  operatorMaxFeeIncrease: 1000,
  declareOperatorFeePeriod: 3600, // HOUR
  executeOperatorFeePeriod: 86400, // DAY
  minimalOperatorFee: 100000000n,
  minimalBlocksBeforeLiquidation: 100800,
  minimumLiquidationCollateral: 200000000,
  validatorsPerOperatorLimit: 500,
  maximumOperatorFee: BigInt(76528650000000),
};

async function main() {
  const ssvToken = await hre.viem.deployContract("SSVToken");
  const ssvOperatorsMod = await hre.viem.deployContract("SSVOperators");
  const ssvClustersMod = await hre.viem.deployContract("SSVClusters");
  const ssvDAOMod = await hre.viem.deployContract("SSVDAO");
  const ssvViewsMod = await hre.viem.deployContract("SSVViews");

  const ssvNetworkFactory = await ethers.getContractFactory("SSVNetwork");
  const ssvNetworkProxy = await await upgrades.deployProxy(
    ssvNetworkFactory,
    [
      ssvToken.address,
      ssvOperatorsMod.address,
      ssvClustersMod.address,
      ssvDAOMod.address,
      ssvViewsMod.address,
      CONFIG.minimalBlocksBeforeLiquidation,
      CONFIG.minimumLiquidationCollateral,
      CONFIG.validatorsPerOperatorLimit,
      CONFIG.declareOperatorFeePeriod,
      CONFIG.executeOperatorFeePeriod,
      CONFIG.operatorMaxFeeIncrease,
    ],
    {
      kind: "uups",
      unsafeAllow: ["delegatecall"],
    }
  );
  await ssvNetworkProxy.waitForDeployment();
  const ssvNetworkAddress = await ssvNetworkProxy.getAddress();
  const ssvNetwork = await hre.viem.getContractAt(
    "SSVNetwork",
    ssvNetworkAddress as Address
  );

  const ssvNetworkViewsFactory = await ethers.getContractFactory(
    "SSVNetworkViews"
  );
  const ssvNetworkViewsProxy = await await upgrades.deployProxy(
    ssvNetworkViewsFactory,
    [ssvNetworkAddress],
    {
      kind: "uups",
      unsafeAllow: ["delegatecall"],
    }
  );
  await ssvNetworkViewsProxy.waitForDeployment();
  const ssvNetworkViewsAddress = await ssvNetworkViewsProxy.getAddress();
  const ssvNetworkViews = await hre.viem.getContractAt(
    "SSVNetworkViews",
    ssvNetworkViewsAddress as Address
  );

  await ssvNetwork.write.updateMaximumOperatorFee([
    CONFIG.maximumOperatorFee as bigint,
  ]);

  console.log("SSV Network deployed to:", ssvNetworkAddress);
  console.log("SSV Network Views deployed to:", ssvNetworkViewsAddress);

  // SSV Network contract -> ssvNetwork
  // SSV Network Views contract -> ssvNetworkViews
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });

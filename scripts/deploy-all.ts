import hre from "hardhat";
import { parseArg, getEthers, getDeployer, deployContract, deployProxy, attachModule, upgradeProxy } from "./common/helpers.ts";
import { saveImplementation } from "./common/address-book.js";
import { DEFAULT_UNSTAKE_COOLDOWN } from "../test/common/constants.ts";

async function main() {
  const targetNetwork = parseArg("network");
  const ethers = await getEthers(targetNetwork);
  const deployer = await getDeployer(ethers);
  const quorumEnv = process.env.QUORUM_BPS;
  if (!quorumEnv) {
    throw new Error("Missing QUORUM_BPS env variable");
  }
  const quorumBps = Number(quorumEnv);
  const defaultOracleIds = (process.env.DEFAULT_ORACLE_IDS ?? "1,2,3,4")
    .split(",")
    .map(v => Number(v.trim()))
    .filter(v => !Number.isNaN(v));

  if (!Number.isInteger(quorumBps) || quorumBps <= 0 || quorumBps > 10000) {
    throw new Error("Invalid QUORUM_BPS value");
  }
  if (
    defaultOracleIds.length !== 4 ||
    !defaultOracleIds.every(id => Number.isInteger(id) && id > 0 && id <= 0xffffffff)
  ) {
    throw new Error("Invalid DEFAULT_ORACLE_IDS value");
  }

  console.log(`Deploying all on ${targetNetwork}`);

  let ssvTokenAddress: string;
  const tokenAddressFromConfig: string | undefined = (hre.userConfig.networks![targetNetwork] as any).ssvToken;
  if (tokenAddressFromConfig) {
    ssvTokenAddress = tokenAddressFromConfig;
    console.log(`Using SSVToken at: ${ssvTokenAddress}`);
  } else {
    throw new Error("Missing SSVToken address in config");
  }

  const moduleNames = ["SSVClusters", "SSVDAO", "SSVViews", "SSVOperatorsWhitelist", "SSVStaking", "SSVValidators"];
  const moduleAddresses: { [key: string]: string } = {};

  const upgradeTimestamp = process.env.UPGRADE_TIMESTAMP ? Number(process.env.UPGRADE_TIMESTAMP) : 0;
  const { address: ssvOperatorsAddr } = await deployContract(ethers, "SSVOperators", [upgradeTimestamp]);
  moduleAddresses["SSVOperators"] = ssvOperatorsAddr;
  saveImplementation(targetNetwork, "SSVOperators", ssvOperatorsAddr);

  for (const mod of moduleNames) {
    const { address } = await deployContract(ethers, mod);
    moduleAddresses[mod] = address;
    saveImplementation(targetNetwork, mod, address);
  }

  const { address: networkImplAddr } = await deployContract(ethers, "SSVNetwork");
  saveImplementation(targetNetwork, "SSVNetwork", networkImplAddr);

  const networkFactory = await ethers.getContractFactory("SSVNetwork");
  const networkInitData = networkFactory.interface.encodeFunctionData("initialize", [
    ssvTokenAddress,
    moduleAddresses["SSVOperators"],
    moduleAddresses["SSVClusters"],
    moduleAddresses["SSVDAO"],
    moduleAddresses["SSVViews"],
    {
      minimumBlocksBeforeLiquidation: process.env.MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
      minimumLiquidationCollateral: process.env.MINIMUM_LIQUIDATION_COLLATERAL,
      validatorsPerOperatorLimit: process.env.VALIDATORS_PER_OPERATOR_LIMIT,
      declareOperatorFeePeriod: process.env.DECLARE_OPERATOR_FEE_PERIOD,
      executeOperatorFeePeriod: process.env.EXECUTE_OPERATOR_FEE_PERIOD,
      operatorMaxFeeIncrease: process.env.OPERATOR_MAX_FEE_INCREASE,
      defaultOracleIds,
      quorumBps,
    },
  ]);

  const { address: networkProxyAddr } = await deployProxy(ethers, deployer, networkImplAddr, networkInitData);
  saveImplementation(targetNetwork, "SSVNetworkProxy", networkProxyAddr);

  await attachModule(ethers, networkProxyAddr, "SSVOperatorsWhitelist", moduleAddresses["SSVOperatorsWhitelist"]);

  const { address: viewsImplAddr } = await deployContract(ethers, "SSVNetworkViews");
  saveImplementation(targetNetwork, "SSVNetworkViews", viewsImplAddr);

  const viewsFactory = await ethers.getContractFactory("SSVNetworkViews");
  const viewsInitData = viewsFactory.interface.encodeFunctionData("initialize", [networkProxyAddr]);

  const { address: viewsProxyAddr } = await deployProxy(ethers, deployer, viewsImplAddr, viewsInitData);
  saveImplementation(targetNetwork, "SSVNetworkViewsProxy", viewsProxyAddr);

  const { address: cssvTokenAddr } = await deployContract(ethers, "CSSVToken", [networkProxyAddr]);
  saveImplementation(targetNetwork, "CSSVToken", cssvTokenAddr);

  await attachModule(ethers, networkProxyAddr, "SSVStaking", moduleAddresses["SSVStaking"]);
  await attachModule(ethers, networkProxyAddr, "SSVValidators", moduleAddresses["SSVValidators"]);

  const { address: upgradeImplAddr } = await deployContract(ethers, "SSVNetworkSSVStakingUpgrade");
  saveImplementation(targetNetwork, "SSVNetworkSSVStakingUpgrade", upgradeImplAddr);

  const cooldown = DEFAULT_UNSTAKE_COOLDOWN;

  await upgradeProxy(
    ethers,
    deployer,
    networkProxyAddr,
    upgradeImplAddr,
    "SSVNetworkSSVStakingUpgrade",
    "initializeSSVStaking(uint64,uint32[4],uint16)",
    [cooldown, defaultOracleIds, quorumBps]
  );
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

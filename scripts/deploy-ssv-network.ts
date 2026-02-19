import { parseArg, getEthers, getDeployer, deployContract, deployProxy } from "./common/helpers.ts";

async function main() {
  const targetNetwork = parseArg("network");
  const ethers = await getEthers(targetNetwork);
  const deployer = await getDeployer(ethers);

  const operatorsModAddress = parseArg("operators-mod");
  const clustersModAddress = parseArg("clusters-mod");
  const daoModAddress = parseArg("dao-mod");
  const viewsModAddress = parseArg("views-mod");
  const ssvTokenAddress = parseArg("ssv-token");
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

  console.log(`Deploying SSVNetwork proxy on ${targetNetwork}`);

  const { address: implAddress } = await deployContract(ethers, "SSVNetwork");

  const Factory = await ethers.getContractFactory("SSVNetwork");
  const initData = Factory.interface.encodeFunctionData("initialize", [
    ssvTokenAddress,
    operatorsModAddress,
    clustersModAddress,
    daoModAddress,
    viewsModAddress,
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

  const { address: proxyAddress } = await deployProxy(ethers, deployer, implAddress, initData);
  console.log(`SSVNetwork impl: ${implAddress}`);
  console.log(`SSVNetwork proxy: ${proxyAddress}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

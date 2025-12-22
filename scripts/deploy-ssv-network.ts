import { parseArg, getEthers, getDeployer, deployContract, deployProxy } from "./common/helpers.ts";
import { saveImplementation } from "./common/address-book.js";

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
  saveImplementation(targetNetwork, "SSVNetwork", implAddress);

  const Factory = await ethers.getContractFactory("SSVNetwork");
  const initData = Factory.interface.encodeFunctionData("initialize", [
    ssvTokenAddress,
    operatorsModAddress,
    clustersModAddress,
    daoModAddress,
    viewsModAddress,
    process.env.MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
    process.env.MINIMUM_LIQUIDATION_COLLATERAL,
    process.env.VALIDATORS_PER_OPERATOR_LIMIT,
    process.env.DECLARE_OPERATOR_FEE_PERIOD,
    process.env.EXECUTE_OPERATOR_FEE_PERIOD,
    process.env.OPERATOR_MAX_FEE_INCREASE,
    defaultOracleIds,
    quorumBps,
  ]);

  const { address: proxyAddress } = await deployProxy(ethers, deployer, implAddress, initData);
  saveImplementation(targetNetwork, "SSVNetworkProxy", proxyAddress);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});

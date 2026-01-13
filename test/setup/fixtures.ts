import type { NetworkConnection } from "hardhat/types/network";
import { Contract } from "ethers";
import { deployHarnessModule } from './deploy.ts';
import { SSVModules } from '../common/types.ts';
import { makeOperatorKey } from '../common/helpers.ts';
import {
  getDeployer,
  deployContract,
  deployProxy,
  attachModule,
  upgradeProxy,
} from "../../scripts/common/helpers.ts";
import { CSSVToken, SSVNetwork, SSVNetworkViews, SSVToken } from '../../types/ethers-contracts/index.js';
import {
  DECLARE_OPERATOR_FEE_PERIOD, EXECUTE_OPERATOR_FEE_PERIOD,
  MAXIMUM_OPERATORS_FEE,
  MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
  MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
  NETWORK_FEE, OPERATOR_MAX_FEE_INCREASE, VALIDATORS_PER_OPERATOR_LIMIT,
} from '../common/constants.js';

export async function ssvClustersHarnessFixture(
  connection: NetworkConnection<"generic">,
  operatorCount = 4,
  operatorFee = 0n
): Promise<{
  clusters: Contract;
  operatorIds: bigint[];
}> {
  const clusters = await deployHarnessModule(
    connection,
    SSVModules.SSVClusters
  );
  await clusters.waitForDeployment();

  await clusters.mockValidatorsPerOperatorLimit(3000);

  const [owner] = await connection.ethers.getSigners();

  const operatorIds: bigint[] = [];

  for (let i = 0; i < operatorCount; i++) {
    const operatorKey = makeOperatorKey(i);

    const operatorId: bigint =
      await clusters.mockOperator.staticCall(
        operatorKey,
        owner.address,
        operatorFee, // Use the fee param
        false
      );

    await clusters.mockOperator(
      operatorKey,
      owner.address,
      operatorFee,
      false
    );

    operatorIds.push(operatorId);
  }

  return {
    clusters,
    operatorIds,
  };
}

export async function ssvOperatorsHarnessFixture(
  connection: NetworkConnection<"generic">,
  operatorMaxFee = MAXIMUM_OPERATORS_FEE,
  declarePeriod = 0n,
  executePeriod = 1_000n,
  maxFeeIncrease = OPERATOR_MAX_FEE_INCREASE
): Promise<{ operators: Contract; }> {
  const operators = await deployHarnessModule(connection, SSVModules.SSVOperators);
  await operators.waitForDeployment();

  await operators.mockSetOperatorMaxFee(Number(operatorMaxFee));
  await operators.mockSetFeePeriods(Number(declarePeriod), Number(executePeriod));
  await operators.mockSetOperatorMaxFeeIncrease(Number(maxFeeIncrease));

  return { operators };
}

export async function ssvDAOHarnessFixture(
  connection: NetworkConnection<"generic">
): Promise<{ dao: Contract; }> {
  const dao = await deployHarnessModule(connection, SSVModules.SSVDAO);
  await dao.waitForDeployment();

  return { dao };
}

export async function ssvStakingHarnessFixture(
  connection: NetworkConnection<"generic">,
  cooldownDuration = 604800n // 7 days in seconds
): Promise<{
  staking: Contract;
  ssvToken: Contract;
  cssvToken: Contract;
}> {
  const staking = await deployHarnessModule(connection, SSVModules.SSVStaking);
  await staking.waitForDeployment();

  const [deployer] = await connection.ethers.getSigners();

  // Deploy mock SSV token using MockToken
  const ssvToken = await connection.ethers.deployContract("MockToken");
  await ssvToken.waitForDeployment();

  // Mint tokens to deployer
  await ssvToken.mint(deployer.address, connection.ethers.parseEther("1000000"));

  // Deploy cSSV token
  const cssvToken = await connection.ethers.deployContract(
    "CSSVToken",
    [await staking.getAddress()]
  );
  await cssvToken.waitForDeployment();

  // Set up the staking contract
  await staking.mockSetToken(await ssvToken.getAddress());
  await staking.mockSetCSSVToken(await cssvToken.getAddress());
  await staking.mockSetCooldownDuration(cooldownDuration);

  // Set default oracle IDs
  await staking.mockSetDefaultOracleIds([1, 2, 3, 4]);

  return {
    staking,
    ssvToken,
    cssvToken,
  };
}

const QUORUM_BPS = 7500;
const DEFAULT_ORACLE_IDS = [1, 2, 3, 4];

const params = {
  minimumBlocksBeforeLiquidation: MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
  minimumLiquidationCollateral: MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
  validatorsPerOperatorLimit: VALIDATORS_PER_OPERATOR_LIMIT,
  declareOperatorFeePeriod: DECLARE_OPERATOR_FEE_PERIOD,
  executeOperatorFeePeriod: EXECUTE_OPERATOR_FEE_PERIOD,
  operatorMaxFeeIncrease: OPERATOR_MAX_FEE_INCREASE,
  defaultOracleIds: DEFAULT_ORACLE_IDS,
  quorumBps: QUORUM_BPS,
};

export async function ssvNetworkFullFixture(
  connection: NetworkConnection<"generic">
): Promise<{
  network: SSVNetwork;
  views: SSVNetworkViews;
  cssvToken: CSSVToken;
  ssvToken: SSVToken;
  modules: { [key: string]: string };
}> {
  const deployer = await getDeployer(connection.ethers);

  const { contract: ssvToken } = await deployContract(connection.ethers, "SSVToken");

  const moduleNames = [
    "SSVOperators",
    "SSVClusters",
    "SSVDAO",
    "SSVViews",
    "SSVOperatorsWhitelist",
    "SSVStaking",
  ];
  const moduleAddresses: { [key: string]: string } = {};

  for (const mod of moduleNames) {
    const { address } = await deployContract(connection.ethers, mod);
    moduleAddresses[mod] = address;
  }

  const { address: networkImplAddr } = await deployContract(connection.ethers, "SSVNetwork");

  const networkFactory = await connection.ethers.getContractFactory("SSVNetwork");
  const networkInitData = networkFactory.interface.encodeFunctionData("initialize", [
    await ssvToken.getAddress(),
    moduleAddresses["SSVOperators"],
    moduleAddresses["SSVClusters"],
    moduleAddresses["SSVDAO"],
    moduleAddresses["SSVViews"],
    params,
  ]);

  const { address: networkProxyAddr } = await deployProxy(
    connection.ethers,
    deployer,
    networkImplAddr,
    networkInitData
  );

  const network = networkFactory.attach(networkProxyAddr);

  await attachModule(connection.ethers, networkProxyAddr, "SSVOperatorsWhitelist", moduleAddresses["SSVOperatorsWhitelist"]);
  await attachModule(connection.ethers, networkProxyAddr, "SSVStaking", moduleAddresses["SSVStaking"]);

  const { address: viewsImplAddr } = await deployContract(connection.ethers, "SSVNetworkViews");

  const viewsFactory = await connection.ethers.getContractFactory("SSVNetworkViews");
  const viewsInitData = viewsFactory.interface.encodeFunctionData("initialize", [networkProxyAddr]);

  const { address: viewsProxyAddr } = await deployProxy(
    connection.ethers,
    deployer,
    viewsImplAddr,
    viewsInitData
  );

  const views = viewsFactory.attach(viewsProxyAddr);

  const { contract: cssvToken } = await deployContract(connection.ethers, "CSSVToken", [networkProxyAddr]);

  const { address: upgradeImplAddr } = await deployContract(connection.ethers, "SSVNetworkSSVStakingUpgrade");

  const cooldown = 7n * 24n * 60n * 60n;

  await upgradeProxy(
    connection.ethers,
    deployer,
    networkProxyAddr,
    upgradeImplAddr,
    "SSVNetworkSSVStakingUpgrade",
    "initializeSSVStaking(address,uint64)",
    [await cssvToken.getAddress(), cooldown]
  );

  await network.updateNetworkFeeSSV(NETWORK_FEE);
  await network.updateNetworkFee(NETWORK_FEE);

  await network.updateMaximumOperatorFee(MAXIMUM_OPERATORS_FEE);

  return {
    network,
    views,
    cssvToken,
    ssvToken,
    modules: moduleAddresses,
  };
}

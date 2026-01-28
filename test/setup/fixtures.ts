import type { NetworkConnection } from "hardhat/types/network";
import { SSVClustersHarness, SSVValidatorsHarness, SSVOperatorsHarness, SSVDAOHarness, SSVStakingHarness } from '../../types/ethers-contracts/index.js';
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
  MAXIMUM_OPERATORS_FEE, MINIMAL_LIQUIDATION_THRESHOLD,
  MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
  MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
  NETWORK_FEE, OPERATOR_MAX_FEE_INCREASE, VALIDATORS_PER_OPERATOR_LIMIT,
} from '../common/constants.js';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import { ForkConfig } from '../test-forked/v2.0.0/config.ts';

export async function ssvClustersHarnessFixture(
  connection: NetworkConnection<"generic">,
  operatorCount = 4,
  operatorFee = 0n
): Promise<{
  clusters: SSVClustersHarness;
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

export async function ssvValidatorsHarnessFixture(
  connection: NetworkConnection<"generic">,
  operatorCount = 4,
  operatorFee = 0n
): Promise<{
  validators: SSVValidatorsHarness;
  operatorIds: bigint[];
}> {
  const validators = await deployHarnessModule(
    connection,
    SSVModules.SSVValidators
  );
  await validators.waitForDeployment();

  await validators.mockValidatorsPerOperatorLimit(3000);

  const [owner] = await connection.ethers.getSigners();

  const operatorIds: bigint[] = [];

  for (let i = 0; i < operatorCount; i++) {
    const operatorKey = makeOperatorKey(i);

    const operatorId: bigint =
      await validators.mockOperator.staticCall(
        operatorKey,
        owner.address,
        operatorFee, // Use the fee param
        false
      );

    await validators.mockOperator(
      operatorKey,
      owner.address,
      operatorFee,
      false
    );

    operatorIds.push(operatorId);
  }

  return {
    validators,
    operatorIds,
  };
}

export const getValidatorsHarnessFixture = (
  connection: NetworkConnection<"generic">,
  operatorCount: number
) =>
  async function validatorsHarnessFixtureWithOperators() {
    return ssvValidatorsHarnessFixture(connection, operatorCount);
  };

export const getClustersHarnessFixture = (
  connection: NetworkConnection<"generic">,
  operatorCount: number
) =>
  async function clustersHarnessFixtureWithOperators() {
    return ssvClustersHarnessFixture(connection, operatorCount);
  };


export async function ssvOperatorsHarnessFixture(
  connection: NetworkConnection<"generic">,
  operatorMaxFee = MAXIMUM_OPERATORS_FEE,
  declarePeriod = 0n,
  executePeriod = 1_000n,
  maxFeeIncrease = OPERATOR_MAX_FEE_INCREASE,
  upgradeTimestamp = 0n
): Promise<{ operators: SSVOperatorsHarness; }> {
  const operators = await deployHarnessModule(connection, SSVModules.SSVOperators, [upgradeTimestamp]);
  await operators.waitForDeployment();

  await operators.mockSetOperatorMaxFee(Number(operatorMaxFee));
  await operators.mockSetFeePeriods(Number(declarePeriod), Number(executePeriod));
  await operators.mockSetOperatorMaxFeeIncrease(Number(maxFeeIncrease));

  return { operators };
}

export async function ssvDAOHarnessFixture(
  connection: NetworkConnection<"generic">
): Promise<{ dao: SSVDAOHarness; }> {
  const dao = await deployHarnessModule(connection, SSVModules.SSVDAO);
  await dao.waitForDeployment();

  return { dao };
}

export async function ssvStakingHarnessFixture(
  connection: NetworkConnection<"generic">,
  cooldownDuration = 604800n // 7 days in seconds
): Promise<{
  staking: SSVStakingHarness;
  ssvToken: SSVToken;
  cssvToken: CSSVToken;
}> {
  const staking = await deployHarnessModule(connection, SSVModules.SSVStaking);
  await staking.waitForDeployment();

  const [deployer] = await connection.ethers.getSigners();

  const ssvToken = await connection.ethers.deployContract("MockToken");
  await ssvToken.waitForDeployment();

  await ssvToken.mint(deployer.address, connection.ethers.parseEther("1000000"));

  const cssvToken = await connection.ethers.deployContract(
    "CSSVToken",
    [await staking.getAddress()]
  );
  await cssvToken.waitForDeployment();

  await staking.mockSetToken(await ssvToken.getAddress());
  await staking.mockSetCSSVToken(await cssvToken.getAddress());
  await staking.mockSetCooldownDuration(cooldownDuration);

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
    "SSVClusters",
    "SSVDAO",
    "SSVViews",
    "SSVOperatorsWhitelist",
    "SSVStaking",
    "SSVValidators",
  ];
  const moduleAddresses: { [key: string]: string } = {};

  const { address: ssvOperatorsAddr } = await deployContract(connection.ethers, "SSVOperators", [0]);
  moduleAddresses["SSVOperators"] = ssvOperatorsAddr;

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
  await attachModule(connection.ethers, networkProxyAddr, "SSVValidators", moduleAddresses["SSVValidators"]);

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
    "initializeSSVStaking(address,uint64,uint32[4])",
    [
      await cssvToken.getAddress(),
      cooldown,
      DEFAULT_ORACLE_IDS
    ]
  );

  await network.updateNetworkFeeSSV(NETWORK_FEE);
  await network.updateNetworkFee(NETWORK_FEE);
  await network.updateMinimumLiquidationCollateral(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL);
  await network.updateLiquidationThresholdPeriod(MINIMAL_LIQUIDATION_THRESHOLD);
  await network.updateMaximumOperatorFee(MAXIMUM_OPERATORS_FEE);

  return {
    network,
    views,
    cssvToken,
    ssvToken,
    modules: moduleAddresses,
  };
}

export async function ssvNetworkFullForkedFixture(
  connection: NetworkConnection<"generic">
): Promise<{
  network: SSVNetwork;
  views: SSVNetworkViews;
  cssvToken: CSSVToken;
  ssvToken: SSVToken;
  modules: { [key: string]: string };
  daoSigner: HardhatEthersSigner
}> {
  const ethers = connection.ethers;

  await ethers.provider.send("hardhat_impersonateAccount", [ForkConfig.DAO_ADDRESS]);
  const daoSigner = await ethers.getSigner(ForkConfig.DAO_ADDRESS);
  await ethers.provider.send("hardhat_setBalance", [ForkConfig.DAO_ADDRESS, "0x" + (BigInt(1e18) * 100n).toString(16)]);

  const { contract: cssvToken, address: cssvAddr } = await deployContract(ethers, "CSSVToken", [ForkConfig.SSV_NETWORK_ADDRESS]);

  const moduleNames = [
    "SSVClusters",
    "SSVDAO",
    "SSVViews",
    "SSVOperatorsWhitelist",
    "SSVStaking",
    "SSVValidators",
  ];
  const modules: { [key: string]: string } = {};

  const { address: ssvOperatorsAddr } = await deployContract(ethers, "SSVOperators", [0]);
  modules["SSVOperators"] = ssvOperatorsAddr;

  for (const mod of moduleNames) {
    const { address } = await deployContract(ethers, mod);
    modules[mod] = address;
  }

  const { address: networkImplAddr } = await deployContract(ethers, "SSVNetwork");

  const networkFactory = await ethers.getContractFactory("SSVNetwork");
  let network = networkFactory.attach(ForkConfig.SSV_NETWORK_ADDRESS);

  const daoNetwork = network.connect(daoSigner);
  await daoNetwork.upgradeTo(networkImplAddr);

  const { address: stakingUpgradeImplAddr } = await deployContract(ethers, "SSVNetworkSSVStakingUpgrade");
  const cooldown = 7n * 24n * 60n * 60n; // 7 days
  const upgradeFactory = await ethers.getContractFactory("SSVNetworkSSVStakingUpgrade");
  const initData = upgradeFactory.interface.encodeFunctionData(
    "initializeSSVStaking(address,uint64,uint32[4])",
    [
      cssvAddr,
      cooldown,
      DEFAULT_ORACLE_IDS
    ]
  );

  await daoNetwork.upgradeToAndCall(stakingUpgradeImplAddr, initData);

  const { address: viewsImplAddr } = await deployContract(ethers, "SSVNetworkViews");
  const viewsFactory = await ethers.getContractFactory("SSVNetworkViews");
  let views = viewsFactory.attach(ForkConfig.SSV_NETWORK_VIEWS);
  const daoViews = views.connect(daoSigner);
  await daoViews.upgradeTo(viewsImplAddr);

  for (const mod of moduleNames) {
    const moduleEnumKey = mod as keyof typeof SSVModules;
    if (SSVModules[moduleEnumKey] === undefined) {
      throw new Error(`Invalid module: ${mod}`);
    }
    const tx = await daoNetwork.updateModule(SSVModules[moduleEnumKey], modules[mod]);
    await tx.wait();
  }
  await daoNetwork.updateModule(SSVModules.SSVOperators, ssvOperatorsAddr);

  const ssvTokenFactory = await ethers.getContractFactory("SSVToken");
  let ssvToken = ssvTokenFactory.attach(ForkConfig.SSV_TOKEN);

  await daoNetwork.updateNetworkFeeSSV(NETWORK_FEE);
  await daoNetwork.updateNetworkFee(NETWORK_FEE);
  await daoNetwork.updateMinimumLiquidationCollateral(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL);
  await daoNetwork.updateLiquidationThresholdPeriod(MINIMAL_LIQUIDATION_THRESHOLD);
  await daoNetwork.updateMaximumOperatorFee(MAXIMUM_OPERATORS_FEE);

  return { network, views, cssvToken, ssvToken, modules, daoSigner };
}
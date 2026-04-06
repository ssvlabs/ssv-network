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
  DEFAULT_UNSTAKE_COOLDOWN,
  MAXIMUM_OPERATORS_FEE, MINIMAL_LIQUIDATION_THRESHOLD,
  MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
  MINIMUM_LIQUIDATION_PERIOD_COLLATERAL,
  MINIMAL_OPERATOR_ETH_FEE,
  NETWORK_FEE, NETWORK_FEE_ETH, OPERATOR_MAX_FEE_INCREASE, VALIDATORS_PER_OPERATOR_LIMIT,
} from '../common/constants.js';
import { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import { ForkConfig } from '../test-forked/v2.0.0/config.ts';
import { ethers } from 'ethers';
import legacyNetworkArtifact from './artifacts/SSVNetworkLegacy.json' assert { type: 'json' };
import legacySSVNetworkViewsArtifact from "./artifacts/SSVNetworkViewsLegacy.json" assert { type: 'json' };
import legacyClustersArtifact from "./artifacts/SSVClustersLegacy.json" assert { type: "json" };
import legacyOperatorsArtifact from "./artifacts/SSVOperatorsLegacy.json" assert { type: "json" };
import legacyDAOLegacyArtifact from "./artifacts/SSVDAOLegacy.json" assert { type: "json" };
import legacyOperatorsWhitelistArtifact from "./artifacts/SSVOperatorsWhitelistLegacy.json" assert { type: "json" };
import legacyViewsModuleArtifact from "./artifacts/SSVViewsLegacy.json" assert { type: "json" };

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
        operatorFee,
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
        operatorFee,
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
  declarePeriod = DECLARE_OPERATOR_FEE_PERIOD,
  executePeriod = EXECUTE_OPERATOR_FEE_PERIOD,
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
): Promise<{ dao: SSVDAOHarness; cssv: any }> {
  const { contract: cssv, address: cssvTokenAddress } = await deployContract(connection.ethers, "MockCSSV");
  const dao = await deployHarnessModule(connection, SSVModules.SSVDAO, [cssvTokenAddress]);
  await dao.waitForDeployment();

  return { dao, cssv };
}

export async function ssvStakingHarnessFixture(
  connection: NetworkConnection<"generic">,
  cooldownDuration = DEFAULT_UNSTAKE_COOLDOWN
): Promise<{
  staking: SSVStakingHarness;
  ssvToken: SSVToken;
  cssvToken: CSSVToken;
}> {
  const { contract: cssvToken, address: cssvTokenAddress } = await deployContract(connection.ethers, "MockCSSV")

  const staking = await deployHarnessModule(connection, SSVModules.SSVStaking, [cssvTokenAddress]);
  await staking.waitForDeployment();

  const [deployer] = await connection.ethers.getSigners();

  const ssvToken = await connection.ethers.deployContract("MockToken");
  await ssvToken.waitForDeployment();

  await ssvToken.mint(deployer.address, connection.ethers.parseEther("1000000"));

  await staking.mockSetToken(await ssvToken.getAddress());
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

  const { address: networkImplAddr } = await deployContract(connection.ethers, "SSVNetwork");

  const networkFactory = await connection.ethers.getContractFactory("SSVNetwork");
  const networkInitData = networkFactory.interface.encodeFunctionData("initialize", [
    await ssvToken.getAddress(),
    ethers.ZeroAddress,
    ethers.ZeroAddress,
    ethers.ZeroAddress,
    ethers.ZeroAddress,
    params,
  ]);

  const { address: networkProxyAddr } = await deployProxy(
    connection.ethers,
    deployer,
    networkImplAddr,
    networkInitData
  );

  const { contract: cssvToken } = await deployContract(connection.ethers, "CSSVToken", [networkProxyAddr]);

  const moduleNames = [
    "SSVClusters",
    "SSVOperatorsWhitelist",
    "SSVValidators",
  ];
  const moduleAddresses: { [key: string]: string } = {};

  const { address: ssvOperatorsAddr } = await deployContract(connection.ethers, "SSVOperators", [0]);
  moduleAddresses["SSVOperators"] = ssvOperatorsAddr;

  const { address: ssvDaoAddr } = await deployContract(connection.ethers, "SSVDAO", [await cssvToken.getAddress()]);
  moduleAddresses["SSVDAO"] = ssvDaoAddr;

  const { address: ssvViewsAddr } = await deployContract(connection.ethers, "SSVViews", [await cssvToken.getAddress()]);
  moduleAddresses["SSVViews"] = ssvViewsAddr;

  const { address: ssvStakingAddr } = await deployContract(connection.ethers, "SSVStaking", [await cssvToken.getAddress()]);
  moduleAddresses["SSVStaking"] = ssvStakingAddr;

  for (const mod of moduleNames) {
    const { address } = await deployContract(connection.ethers, mod);
    moduleAddresses[mod] = address;
  }

  const network = networkFactory.attach(networkProxyAddr);

  await attachModule(connection.ethers, networkProxyAddr, "SSVOperatorsWhitelist", moduleAddresses["SSVOperatorsWhitelist"]);
  await attachModule(connection.ethers, networkProxyAddr, "SSVStaking", moduleAddresses["SSVStaking"]);
  await attachModule(connection.ethers, networkProxyAddr, "SSVValidators", moduleAddresses["SSVValidators"]);
  await attachModule(connection.ethers, networkProxyAddr, "SSVViews", moduleAddresses["SSVViews"]);
  await attachModule(connection.ethers, networkProxyAddr, "SSVDAO", moduleAddresses["SSVDAO"]);
  await attachModule(connection.ethers, networkProxyAddr, "SSVOperators", moduleAddresses["SSVOperators"]);
  await attachModule(connection.ethers, networkProxyAddr, "SSVClusters", moduleAddresses["SSVClusters"]);


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

  const { address: upgradeImplAddr } = await deployContract(connection.ethers, "SSVNetworkSSVStakingUpgrade");

  const cooldown = DEFAULT_UNSTAKE_COOLDOWN;

  await upgradeProxy(
    connection.ethers,
    deployer,
    networkProxyAddr,
    upgradeImplAddr,
    "SSVNetworkSSVStakingUpgrade",
    "initializeSSVStaking(uint64,uint32[4],uint16)",
    [
      cooldown,
      DEFAULT_ORACLE_IDS,
      QUORUM_BPS,
    ]
  );

  await network.updateNetworkFeeSSV(NETWORK_FEE);
  await network.updateNetworkFee(NETWORK_FEE);
  await network.updateMinimumLiquidationCollateral(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL);
  await network.updateLiquidationThresholdPeriod(MINIMAL_LIQUIDATION_THRESHOLD);
  await network.updateMaximumOperatorFee(MAXIMUM_OPERATORS_FEE);
  await network.updateOperatorFeeIncreaseLimit(OPERATOR_MAX_FEE_INCREASE);
  await network.updateMinimumOperatorEthFee(MINIMAL_OPERATOR_ETH_FEE);

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
  const useDeployedState = process.env.FORK_USE_DEPLOYED_STATE === "true";
  const strictDeployedState = process.env.FORK_STRICT_DEPLOYED_STATE === "true";
  const allowDeployedFallback = process.env.FORK_ALLOW_DEPLOYED_FALLBACK !== "false";

  await ethers.provider.send("hardhat_impersonateAccount", [ForkConfig.DAO_ADDRESS]);
  const daoSigner = await ethers.getSigner(ForkConfig.DAO_ADDRESS);
  await ethers.provider.send("hardhat_setBalance", [ForkConfig.DAO_ADDRESS, "0x" + (BigInt(1e18) * 100n).toString(16)]);

  const runInTestUpgradePath = async () => {
    const { contract: cssvToken } = await deployContract(ethers, "CSSVToken", [ForkConfig.SSV_NETWORK_ADDRESS]);
    const modules: { [key: string]: string } = {};

    const { address: ssvOperatorsAddr } = await deployContract(ethers, "SSVOperators", [0]);
    modules["SSVOperators"] = ssvOperatorsAddr;

    const { address: ssvClustersAddr } = await deployContract(ethers, "SSVClusters");
    modules["SSVClusters"] = ssvClustersAddr;

    const { address: ssvDaoAddr } = await deployContract(ethers, "SSVDAO", [await cssvToken.getAddress()]);
    modules["SSVDAO"] = ssvDaoAddr;

    const { address: ssvViewsAddr } = await deployContract(ethers, "SSVViews", [await cssvToken.getAddress()]);
    modules["SSVViews"] = ssvViewsAddr;

    const { address: ssvOperatorsWhitelistAddr } = await deployContract(ethers, "SSVOperatorsWhitelist");
    modules["SSVOperatorsWhitelist"] = ssvOperatorsWhitelistAddr;

    const { address: ssvStakingAddr } = await deployContract(ethers, "SSVStaking", [await cssvToken.getAddress()]);
    modules["SSVStaking"] = ssvStakingAddr;

    const { address: ssvValidatorsAddr } = await deployContract(ethers, "SSVValidators");
    modules["SSVValidators"] = ssvValidatorsAddr;

    const { address: networkImplAddr } = await deployContract(ethers, "SSVNetwork");
    const { address: stakingUpgradeImplAddr } = await deployContract(ethers, "SSVNetworkSSVStakingUpgrade");
    const { address: viewsImplAddr } = await deployContract(ethers, "SSVNetworkViews");

    const networkFactory = await ethers.getContractFactory("SSVNetwork");
    const network = networkFactory.attach(ForkConfig.SSV_NETWORK_ADDRESS);
    const daoNetwork = network.connect(daoSigner);

    const cooldown = DEFAULT_UNSTAKE_COOLDOWN;
    const upgradeFactory = await ethers.getContractFactory("SSVNetworkSSVStakingUpgrade");
    const initData = upgradeFactory.interface.encodeFunctionData(
      "initializeSSVStaking(uint64,uint32[4],uint16)",
      [cooldown, DEFAULT_ORACLE_IDS, QUORUM_BPS]
    );

    try {
      await (await daoNetwork.upgradeToAndCall(stakingUpgradeImplAddr, initData)).wait();
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      if (!message.includes("Initializable: contract is already initialized")) {
        throw err;
      }
      console.warn(
        "[FORK] initializeSSVStaking already executed on this proxy; continuing with non-init upgrade path."
      );
      await (await daoNetwork.upgradeTo(stakingUpgradeImplAddr)).wait();
    }
    await (await daoNetwork.upgradeTo(networkImplAddr)).wait();

    const viewsFactory = await ethers.getContractFactory("SSVNetworkViews");
    const views = viewsFactory.attach(ForkConfig.SSV_NETWORK_VIEWS);
    const daoViews = views.connect(daoSigner);
    await (await daoViews.upgradeTo(viewsImplAddr)).wait();

    for (const [moduleName, moduleAddress] of Object.entries(modules)) {
      const moduleEnumKey = moduleName as keyof typeof SSVModules;
      if (SSVModules[moduleEnumKey] === undefined) {
        throw new Error(`Invalid module: ${moduleName}`);
      }
      const tx = await daoNetwork.updateModule(SSVModules[moduleEnumKey], moduleAddress);
      await tx.wait();
    }

    const ssvTokenFactory = await ethers.getContractFactory("SSVToken");
    const ssvToken = ssvTokenFactory.attach(ForkConfig.SSV_TOKEN);

    await (await daoNetwork.updateNetworkFeeSSV(NETWORK_FEE)).wait();
    await (await daoNetwork.updateNetworkFee(NETWORK_FEE_ETH)).wait();
    await (await daoNetwork.updateMinimumLiquidationCollateral(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL)).wait();
    await (await daoNetwork.updateMinimumLiquidationCollateralSSV(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL)).wait();
    await (await daoNetwork.updateLiquidationThresholdPeriod(MINIMUM_BLOCKS_BEFORE_LIQUIDATION)).wait();
    await (await daoNetwork.updateLiquidationThresholdPeriodSSV(MINIMUM_BLOCKS_BEFORE_LIQUIDATION)).wait();
    await (await daoNetwork.updateMaximumOperatorFee(MAXIMUM_OPERATORS_FEE)).wait();
    await (await daoNetwork.updateOperatorFeeIncreaseLimit(OPERATOR_MAX_FEE_INCREASE)).wait();
    await (await daoNetwork.updateMinimumOperatorEthFee(MINIMAL_OPERATOR_ETH_FEE)).wait();
    await (await daoNetwork.updateDeclareOperatorFeePeriod(DECLARE_OPERATOR_FEE_PERIOD)).wait();
    await (await daoNetwork.updateExecuteOperatorFeePeriod(EXECUTE_OPERATOR_FEE_PERIOD)).wait();

    return { network, views, cssvToken, ssvToken, modules, daoSigner };
  };

  if (!useDeployedState) {
    return runInTestUpgradePath();
  }

  if (!ForkConfig.CSSV_TOKEN) {
    throw new Error(
      "FORK_USE_DEPLOYED_STATE=true requires cssvToken in FORK_CONFIG_PATH or FORK_CSSV_TOKEN env var"
    );
  }

  const networkFactory = await ethers.getContractFactory("SSVNetwork");
  const network = networkFactory.attach(ForkConfig.SSV_NETWORK_ADDRESS);

  const viewsFactory = await ethers.getContractFactory("SSVNetworkViews");
  const views = viewsFactory.attach(ForkConfig.SSV_NETWORK_VIEWS);

  const cssvTokenFactory = await ethers.getContractFactory("CSSVToken");
  const cssvToken = cssvTokenFactory.attach(ForkConfig.CSSV_TOKEN);

  const ssvTokenFactory = await ethers.getContractFactory("SSVToken");
  const ssvToken = ssvTokenFactory.attach(ForkConfig.SSV_TOKEN);

  try {
    await views.getVersion();
    await views.getNetworkFee();
    await views.getActiveOracleIds();
  } catch (err) {
    if (strictDeployedState || !allowDeployedFallback) {
      throw new Error(
        "FORK_USE_DEPLOYED_STATE=true but deployed instances are not readable via SSVNetworkViews. " +
        "Re-run `just upgrade-test-fork` against the same local Anvil endpoint and ensure no stale FORK_BLOCK_NUMBER.",
        { cause: err as Error }
      );
    }

    console.warn(
      "[FORK] Deployed state is unreadable via SSVNetworkViews; falling back to in-test upgrade path. " +
      "Set FORK_STRICT_DEPLOYED_STATE=true to enforce strict mode."
    );
    return runInTestUpgradePath();
  }

  const modules: { [key: string]: string } = { ...ForkConfig.MODULES };
  return { network, views, cssvToken, ssvToken, modules, daoSigner };
}

export async function ssvNetworkFullPreUpgradeFixture(
  connection: NetworkConnection<"generic">
): Promise<{
  network: any;
  views: any;
  ssvToken: SSVToken;
}> {
  const deployer = await getDeployer(connection.ethers);

  const { contract: ssvToken } = await deployContract(
    connection.ethers,
    "SSVToken"
  );

  const oldNetworkFactory =
    await connection.ethers.getContractFactoryFromArtifact(
      legacyNetworkArtifact
    );

  const legacyNetworkImpl = await oldNetworkFactory.deploy();
  await legacyNetworkImpl.waitForDeployment();

  const networkInitData = oldNetworkFactory.interface.encodeFunctionData(
    "initialize",
    [
      await ssvToken.getAddress(),
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      ethers.ZeroAddress,
      params.minimumBlocksBeforeLiquidation,
      params.minimumLiquidationCollateral,
      params.validatorsPerOperatorLimit,
      params.declareOperatorFeePeriod,
      params.executeOperatorFeePeriod,
      params.operatorMaxFeeIncrease,
    ]
  );

  const { address: networkProxyAddr } = await deployProxy(
    connection.ethers,
    deployer,
    await legacyNetworkImpl.getAddress(),
    networkInitData
  );

  const legacyModules = {
    SSVOperators: legacyOperatorsArtifact,
    SSVClusters: legacyClustersArtifact,
    SSVDAO: legacyDAOLegacyArtifact,
    SSVViews: legacyViewsModuleArtifact,
    SSVOperatorsWhitelist: legacyOperatorsWhitelistArtifact,
  };

  const moduleAddresses: Record<string, string> = {};

  for (const [moduleName, artifact] of Object.entries(legacyModules)) {
    const factory =
      await connection.ethers.getContractFactoryFromArtifact(artifact);

    const impl = await factory.deploy();
    await impl.waitForDeployment();

    moduleAddresses[moduleName] = await impl.getAddress();
  }

  const network = oldNetworkFactory.attach(networkProxyAddr);

  for (const [moduleName, moduleAddress] of Object.entries(moduleAddresses)) {
    await attachModule(
      connection.ethers,
      networkProxyAddr,
      moduleName,
      moduleAddress
    );
  }

  const oldViewsFactory =
    await connection.ethers.getContractFactoryFromArtifact(
      legacySSVNetworkViewsArtifact
    );

  const legacyViewsImpl = await oldViewsFactory.deploy();
  await legacyViewsImpl.waitForDeployment();

  const viewsInitData = oldViewsFactory.interface.encodeFunctionData(
    "initialize",
    [networkProxyAddr]
  );

  const { address: viewsProxyAddr } = await deployProxy(
    connection.ethers,
    deployer,
    await legacyViewsImpl.getAddress(),
    viewsInitData
  );

  const views = oldViewsFactory.attach(viewsProxyAddr);

  await (await network.updateNetworkFee(NETWORK_FEE)).wait();
  await (await network.updateMinimumLiquidationCollateral(MINIMUM_LIQUIDATION_PERIOD_COLLATERAL)).wait();
  await (await network.updateLiquidationThresholdPeriod(MINIMUM_BLOCKS_BEFORE_LIQUIDATION)).wait();
  await (await network.updateMaximumOperatorFee(MAXIMUM_OPERATORS_FEE)).wait();
  await (await network.updateOperatorFeeIncreaseLimit(OPERATOR_MAX_FEE_INCREASE)).wait();

  return {
    network,
    views,
    ssvToken,
  };
}

export async function upgradeToStakingVersion(
  connection: any,
  network: any,
  views: any,
): Promise<{
  cssv: any;
  newNetwork: SSVNetwork;
  newViews: SSVNetworkViews;
}> {
  const deployer = await getDeployer(connection.ethers);
  const networkAddress = await network.getAddress();

  const { contract: cssv, address: cssvTokenAddress } =
    await deployContract(connection.ethers, "CSSVToken", [networkAddress]);

  const latestBlock = await connection.ethers.provider.getBlock("latest");
  const upgradeTimestamp = BigInt(latestBlock!.timestamp);

  const { address: upgradeImplAddr } =
    await deployContract(connection.ethers, "SSVNetworkSSVStakingUpgrade");

  await upgradeProxy(
    connection.ethers,
    deployer,
    networkAddress,
    upgradeImplAddr,
    "SSVNetworkSSVStakingUpgrade",
    "initializeSSVStaking(uint64,uint32[4],uint16)",
    [DEFAULT_UNSTAKE_COOLDOWN, DEFAULT_ORACLE_IDS, QUORUM_BPS]
  );

  const networkFactory =
    await connection.ethers.getContractFactory("SSVNetwork");
  const upgradedNetwork = networkFactory.attach(networkAddress);

  const moduleNames = [
    "SSVClusters",
    "SSVOperatorsWhitelist",
    "SSVValidators",
  ];
  const moduleAddresses: Record<string, string> = {};

  const { address: ssvOperatorsAddr } =
    await deployContract(connection.ethers, "SSVOperators", [upgradeTimestamp]);
  moduleAddresses["SSVOperators"] = ssvOperatorsAddr;

  const { address: ssvDaoAddr } =
    await deployContract(connection.ethers, "SSVDAO", [cssvTokenAddress]);
  moduleAddresses["SSVDAO"] = ssvDaoAddr;

  const { address: ssvViewsAddr } =
    await deployContract(connection.ethers, "SSVViews", [cssvTokenAddress]);
  moduleAddresses["SSVViews"] = ssvViewsAddr;

  const { address: ssvStakingAddr } =
    await deployContract(connection.ethers, "SSVStaking", [cssvTokenAddress]);
  moduleAddresses["SSVStaking"] = ssvStakingAddr;

  for (const mod of moduleNames) {
    const { address } = await deployContract(connection.ethers, mod);
    moduleAddresses[mod] = address;
  }

  for (const [name, addr] of Object.entries(moduleAddresses)) {
    await attachModule(connection.ethers, networkAddress, name, addr);
  }

  const { address: newViewsImpl } =
    await deployContract(connection.ethers, "SSVNetworkViews");

  await views.upgradeTo(newViewsImpl);

  const viewsFactory =
    await connection.ethers.getContractFactory("SSVNetworkViews");
  const upgradedViews = viewsFactory.attach(await views.getAddress());

  await (await upgradedNetwork.updateNetworkFeeSSV(NETWORK_FEE)).wait();
  await (await upgradedNetwork.updateNetworkFee(NETWORK_FEE_ETH)).wait();
  await (await upgradedNetwork.updateMinimumLiquidationCollateral(
    MINIMUM_LIQUIDATION_PERIOD_COLLATERAL
  )).wait();
  await (await upgradedNetwork.updateMinimumLiquidationCollateralSSV(
    MINIMUM_LIQUIDATION_PERIOD_COLLATERAL
  )).wait();
  await (await upgradedNetwork.updateLiquidationThresholdPeriod(
    MINIMUM_BLOCKS_BEFORE_LIQUIDATION
  )).wait();
  await (await upgradedNetwork.updateLiquidationThresholdPeriodSSV(
    MINIMUM_BLOCKS_BEFORE_LIQUIDATION
  )).wait();
  await (await upgradedNetwork.updateMaximumOperatorFee(
    MAXIMUM_OPERATORS_FEE
  )).wait();
  await (await upgradedNetwork.updateOperatorFeeIncreaseLimit(
    OPERATOR_MAX_FEE_INCREASE
  )).wait();
  await (await upgradedNetwork.updateMinimumOperatorEthFee(
    MINIMAL_OPERATOR_ETH_FEE
  )).wait();

  return {
    cssv,
    newNetwork: upgradedNetwork,
    newViews: upgradedViews,
  };
}

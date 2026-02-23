import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { ethers as ethersLib } from "ethers";
import { deployContract, deployProxy, getDeployer, getEthers, parseArg } from "./common/helpers.ts";
import { SSVModules } from "./common/modules.ts";
import {
  parseOptionalArg,
  parseUint,
  resolveConfigPath,
  MODULE_ORDER,
} from "./common/config.ts";

type LocalConfig = {
  ssvToken?: string;
  protocolParams?: {
    liquidationThresholdPeriod?: string | number;
    minBlocksBetweenUpdates?: string | number;
    minimumLiquidationCollateralEth?: string | number;
    validatorsPerOperatorLimit?: string | number;
    declareOperatorFeePeriod?: string | number;
    executeOperatorFeePeriod?: string | number;
    operatorFeeIncreaseLimit?: string | number;
  };
  quorumBps?: number;
  defaultOracleIds?: number[];
  cooldownDuration?: string | number;
  upgradeTimestamp?: string | number;
};

async function main() {
  const targetNetwork = parseArg("network");
  const envFlag = parseOptionalArg("env") ?? "local";
  const configPath = resolveConfigPath(envFlag);

  let config: LocalConfig;
  try {
    const raw = await readFile(configPath, "utf8");
    config = JSON.parse(raw) as LocalConfig;
  } catch {
    console.log(`No config found at ${configPath}, using defaults`);
    config = {};
  }

  const ethers = await getEthers(targetNetwork);
  const deployer = await getDeployer(ethers);
  const deployerAddress = await deployer.getAddress();
  const providerNetwork = await ethers.provider.getNetwork();

  const pp = config.protocolParams ?? {};
  const quorumBps = config.quorumBps ?? 7500;
  const defaultOracleIds = config.defaultOracleIds ?? [1, 2, 3, 4];
  const cooldown = parseUint(config.cooldownDuration, "cooldownDuration") ?? 604800n;
  const upgradeTimestamp = parseUint(config.upgradeTimestamp, "upgradeTimestamp") ?? 0n;

  if (defaultOracleIds.length !== 4) {
    throw new Error("defaultOracleIds must contain exactly 4 ids");
  }

  console.log(`Fresh deployment on ${targetNetwork}`);
  console.log(`Deployer: ${deployerAddress}`);

  // ── 0. Deploy SSVToken (or use existing) ──
  let ssvTokenAddress: string;
  if (config.ssvToken) {
    ssvTokenAddress = config.ssvToken;
    console.log(`Using existing SSVToken: ${ssvTokenAddress}`);
  } else {
    console.log("[0/7] Deploying SSVToken (mock for local/test)");
    const { address } = await deployContract(ethers, "SSVToken");
    ssvTokenAddress = address;
  }

  // ── 1. Deploy modules that don't need CSSVToken ──
  console.log("[1/7] Deploying cssv-independent modules...");
  const { address: ssvOperatorsAddr } = await deployContract(ethers, "SSVOperators", [upgradeTimestamp]);
  const { address: ssvClustersAddr } = await deployContract(ethers, "SSVClusters");
  const { address: ssvOperatorsWhitelistAddr } = await deployContract(ethers, "SSVOperatorsWhitelist");
  const { address: ssvValidatorsAddr } = await deployContract(ethers, "SSVValidators");

  // ── 2. Deploy SSVNetwork implementation + proxy ──
  // initialize() with address(0) for dao/views — they'll be attached after CSSVToken exists.
  console.log("[2/7] Deploying SSVNetwork implementation + proxy...");
  const { address: networkImplAddr } = await deployContract(ethers, "SSVNetwork");

  const networkFactory = await ethers.getContractFactory("SSVNetwork");
  const networkInitData = networkFactory.interface.encodeFunctionData("initialize", [
    ssvTokenAddress,
    ssvOperatorsAddr,
    ssvClustersAddr,
    ethersLib.ZeroAddress, // SSVDAO placeholder — replaced in step 7
    ethersLib.ZeroAddress, // SSVViews placeholder — replaced in step 7
    {
      minimumBlocksBeforeLiquidation: parseUint(pp.liquidationThresholdPeriod, "liquidationThresholdPeriod") ?? 214800n,
      minimumLiquidationCollateral: parseUint(pp.minimumLiquidationCollateralEth, "minimumLiquidationCollateralEth") ?? 1_000_000_000_000_000n,
      validatorsPerOperatorLimit: parseUint(pp.validatorsPerOperatorLimit, "validatorsPerOperatorLimit") ?? 3000n,
      declareOperatorFeePeriod: parseUint(pp.declareOperatorFeePeriod, "declareOperatorFeePeriod") ?? 604800n,
      executeOperatorFeePeriod: parseUint(pp.executeOperatorFeePeriod, "executeOperatorFeePeriod") ?? 604800n,
      operatorMaxFeeIncrease: parseUint(pp.operatorFeeIncreaseLimit, "operatorFeeIncreaseLimit") ?? 10000n,
      defaultOracleIds,
      quorumBps,
    },
  ]);

  const { address: networkProxyAddr } = await deployProxy(ethers, deployer, networkImplAddr, networkInitData);
  console.log(`SSVNetwork proxy: ${networkProxyAddr}`);

  // ── 3. Deploy CSSVToken (needs proxy address) ──
  console.log("[3/7] Deploying CSSVToken...");
  const { address: cssvTokenAddr } = await deployContract(ethers, "CSSVToken", [networkProxyAddr]);

  // ── 4. Deploy cssv-dependent modules ──
  console.log("[4/7] Deploying cssv-dependent modules (SSVDAO, SSVViews, SSVStaking)...");
  const { address: ssvDaoAddr } = await deployContract(ethers, "SSVDAO", [cssvTokenAddr]);
  const { address: ssvViewsAddr } = await deployContract(ethers, "SSVViews", [cssvTokenAddr]);
  const { address: ssvStakingAddr } = await deployContract(ethers, "SSVStaking", [cssvTokenAddr]);

  // ── 5. Run staking upgrade (reinitializer) ──
  console.log("[5/7] Running SSVStaking upgrade (upgradeToAndCall)...");
  const { address: stakingUpgradeImplAddr } = await deployContract(ethers, "SSVNetworkSSVStakingUpgrade");

  const stakingUpgradeFactory = await ethers.getContractFactory("SSVNetworkSSVStakingUpgrade");
  const stakingInitData = stakingUpgradeFactory.interface.encodeFunctionData(
    "initializeSSVStaking(uint64,uint32[4],uint16)",
    [cooldown, defaultOracleIds, quorumBps]
  );

  const networkWithSigner = await ethers.getContractAt("SSVNetwork", networkProxyAddr, deployer);
  await (await networkWithSigner.upgradeToAndCall(stakingUpgradeImplAddr, stakingInitData)).wait();

  // ── 6. Deploy SSVNetworkViews implementation + proxy ──
  console.log("[6/7] Deploying SSVNetworkViews implementation + proxy...");
  const { address: viewsImplAddr } = await deployContract(ethers, "SSVNetworkViews");
  const viewsFactory = await ethers.getContractFactory("SSVNetworkViews");
  const viewsInitData = viewsFactory.interface.encodeFunctionData("initialize", [networkProxyAddr]);

  const { address: viewsProxyAddr } = await deployProxy(ethers, deployer, viewsImplAddr, viewsInitData);
  console.log(`SSVNetworkViews proxy: ${viewsProxyAddr}`);

  // ── 7. Attach all modules ──
  console.log("[7/7] Attaching all modules...");
  const modules = {
    SSVOperators: ssvOperatorsAddr,
    SSVClusters: ssvClustersAddr,
    SSVDAO: ssvDaoAddr,
    SSVViews: ssvViewsAddr,
    SSVOperatorsWhitelist: ssvOperatorsWhitelistAddr,
    SSVStaking: ssvStakingAddr,
    SSVValidators: ssvValidatorsAddr,
  };

  for (const mod of MODULE_ORDER) {
    const moduleId = SSVModules[mod];
    await (await networkWithSigner.updateModule(moduleId, modules[mod])).wait();
  }

  // Optional override for EB update frequency cooldown (initializer defaults to 7200 blocks)
  const minBlocksBetweenUpdates = parseUint(pp.minBlocksBetweenUpdates, "minBlocksBetweenUpdates");
  if (minBlocksBetweenUpdates !== undefined) {
    await (await networkWithSigner.setMinBlocksBetweenUpdates(minBlocksBetweenUpdates)).wait();
  }

  const blockNumber = await ethers.provider.getBlockNumber();

  const result = {
    deployer: deployerAddress,
    chainId: providerNetwork.chainId.toString(),
    network: targetNetwork,
    deployedAt: new Date().toISOString(),
    blockNumber,
    ssvToken: ssvTokenAddress,
    ssvNetworkProxy: networkProxyAddr,
    ssvNetworkViews: viewsProxyAddr,
    cssvToken: cssvTokenAddr,
    implementations: {
      SSVNetwork: networkImplAddr,
      SSVNetworkSSVStakingUpgrade: stakingUpgradeImplAddr,
      SSVNetworkViews: viewsImplAddr,
    },
    modules,
  };

  const outputPath = resolve("deployments", envFlag, "deploy-result.json");
  await writeFile(outputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");

  console.log("Fresh deployment complete");
  console.log(`Result: ${outputPath}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

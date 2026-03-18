import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { deployContract, getDeployer, getEthers } from "./common/helpers.ts";
import { SSVModules } from "./common/modules.ts";
import {
  type UpgradeConfig,
  type ModuleAddresses,
  MODULE_ORDER,
  parseOptionalArg,
  parseOptionalBooleanArg,
  requireAddress,
  parseQuorum,
  normalizeOracles,
  resolveDefaultOracleIds,
  toOracleConfig,
  resolveProtocolParams,
  resolveCooldownDuration,
  resolveUpgradeTimestamp,
  bigintToJsonNumberOrString,
  resolveDeployedConfigPath,
  resolveConfigPath,
  resolveUpgradeResultPath,
  resolveVersionedUpgradeResultPath,
  resolveNetworkFromEnv,
  updateLatestSymlink,
  loadDeployResult,
} from "./common/config.ts";
import { readOnChainValues } from "./common/verify.ts";
import {
  getSignerForAddress,
  canImpersonateOnNetwork,
  resolveRpcUrl,
} from "./common/impersonation.ts";

async function main() {
  // ── Resolve config source ──
  // New: --env flag resolves to deployments/<env>/config.json
  // Legacy: --config flag for direct path (backward compat)
  const envFlag = parseOptionalArg("env");
  const configFlag = parseOptionalArg("config");
  const forkFlag = parseOptionalBooleanArg("fork", false);
  const useGetImpersonatedSigner = parseOptionalBooleanArg("use-get-impersonated-signer", true);

  let initConfigPath: string;
  let resultPath: string;

  if (envFlag) {
    initConfigPath = resolveConfigPath(envFlag);
    resultPath = resolveUpgradeResultPath(envFlag);
  } else if (configFlag) {
    initConfigPath = resolve(configFlag);
    resultPath = resolveDeployedConfigPath(initConfigPath, parseOptionalArg("output-config"));
  } else {
    throw new Error("Provide --env <environment> or --config <path> to specify the config source");
  }

  const targetNetwork = parseOptionalArg("network") ?? resolveNetworkFromEnv(envFlag);
  if (!targetNetwork && !forkFlag) {
    throw new Error("Provide --network <name> or --fork to specify the target network");
  }

  const raw = await readFile(initConfigPath, "utf8");
  const config = JSON.parse(raw) as UpgradeConfig;

  const ssvNetworkProxy = requireAddress(config.ssvNetworkProxy, "ssvNetworkProxy");
  const ssvNetworkViews = requireAddress(config.ssvNetworkViews, "ssvNetworkViews");
  const ssvToken = requireAddress(config.ssvToken, "ssvToken");

  const params = resolveProtocolParams(config);
  const cooldownDuration = resolveCooldownDuration(config);
  const upgradeTimestamp = resolveUpgradeTimestamp(config);
  const quorumBps = parseQuorum(config.quorumBps);
  const oracles = normalizeOracles(config.oracles);
  const defaultOracleIds = resolveDefaultOracleIds(config, oracles);

  // ── Determine network and mode ──
  const effectiveNetwork = forkFlag ? (targetNetwork ?? "local") : (targetNetwork ?? "local");
  const ethers = await getEthers(effectiveNetwork);
  const providerNetwork = await ethers.provider.getNetwork();

  const networkCode = await ethers.provider.getCode(ssvNetworkProxy);
  if (networkCode === "0x") {
    throw new Error(
      `No contract code at ssvNetworkProxy ${ssvNetworkProxy} on ${effectiveNetwork}. ` +
      `Check your RPC URL and fork/network selection.`
    );
  }
  const viewsCode = await ethers.provider.getCode(ssvNetworkViews);
  if (viewsCode === "0x") {
    throw new Error(
      `No contract code at ssvNetworkViews ${ssvNetworkViews} on ${effectiveNetwork}. ` +
      `Check your RPC URL and fork/network selection.`
    );
  }

  const network = await ethers.getContractAt("SSVNetwork", ssvNetworkProxy);
  const viewsProxy = await ethers.getContractAt("SSVNetworkViews", ssvNetworkViews);

  // ── Version pre-flight check ──
  let onChainVersion: string;
  try {
    onChainVersion = await network.getVersion();
  } catch {
    throw new Error(`Could not read on-chain version from proxy ${ssvNetworkProxy}`);
  }
  if (onChainVersion !== config.currentVersion) {
    throw new Error(
      `Version mismatch: config.currentVersion is "${config.currentVersion}" but proxy reports "${onChainVersion}". ` +
      `Wrong config or proxy address?`
    );
  }
  console.log(`[PRE-FLIGHT] currentVersion = ${onChainVersion} ✓`);

  // ── targetVersion pre-flight: parse version from CoreLib.sol source (no deployment, no gas) ──
  {
    const coreLibPath = resolve(process.cwd(), "contracts/libraries/CoreLib.sol");
    const coreLibSrc = await readFile(coreLibPath, "utf8");
    const match = coreLibSrc.match(/function getVersion\(\)[^{]*\{\s*return\s*"([^"]+)"/);
    if (!match) {
      throw new Error("Could not parse version from CoreLib.sol — check getVersion() format");
    }
    const localImplVersion = match[1];
    if (localImplVersion !== config.targetVersion) {
      throw new Error(
        `targetVersion mismatch: config expects "${config.targetVersion}" but CoreLib.sol ` +
        `getVersion() returns "${localImplVersion}". ` +
        `Wrong contract compiled or wrong targetVersion in config?`
      );
    }
    console.log(`[PRE-FLIGHT] targetVersion  = ${localImplVersion} ✓`);
  }

  const ownerAddr = config.owner ? requireAddress(config.owner, "owner address") : await network.owner();
  const viewsOwnerAddr = config.viewsOwner
    ? requireAddress(config.viewsOwner, "viewsOwner address")
    : await viewsProxy.owner();

  const deployerSigner = await getDeployer(ethers);
  const deployerAddress = ((await deployerSigner.getAddress()) as string).toLowerCase();
  const ownerAddressLower = ownerAddr.toLowerCase();
  const viewsOwnerAddressLower = viewsOwnerAddr.toLowerCase();
  const targetRpcUrl = resolveRpcUrl(effectiveNetwork);
  const canImpersonate = forkFlag || canImpersonateOnNetwork(effectiveNetwork, targetRpcUrl);

  // ── Resolve signers ──
  let ownerSigner = deployerSigner;
  let viewsOwnerSigner = deployerSigner;
  let networkOwnerImpersonated = false;
  let viewsOwnerImpersonated = false;

  if (deployerAddress !== ownerAddressLower || deployerAddress !== viewsOwnerAddressLower) {
    if (!canImpersonate) {
      throw new Error(
        `Deployer ${deployerAddress} is not the required owner(s). ` +
        `network.owner=${ownerAddressLower}, views.owner=${viewsOwnerAddressLower}. ` +
        `Use the owner private key in env (e.g. HOODI_PRIVATE_KEY) or use --fork for impersonation.`
      );
    }

    const ownerResolved = await getSignerForAddress(ethers, ownerAddr, useGetImpersonatedSigner);
    ownerSigner = ownerResolved.signer;
    networkOwnerImpersonated = ownerResolved.impersonated;

    if (viewsOwnerAddressLower === ownerAddressLower) {
      viewsOwnerSigner = ownerSigner;
      viewsOwnerImpersonated = networkOwnerImpersonated;
    } else {
      const viewsResolved = await getSignerForAddress(ethers, viewsOwnerAddr, useGetImpersonatedSigner);
      viewsOwnerSigner = viewsResolved.signer;
      viewsOwnerImpersonated = viewsResolved.impersonated;
    }
  }

  const networkOwner = network.connect(ownerSigner);
  const viewsOwner = viewsProxy.connect(viewsOwnerSigner);
  const views = viewsProxy.connect(ownerSigner);

  console.log(`Network owner: ${ownerAddr}${networkOwnerImpersonated ? " (impersonated)" : ""}`);
  console.log(`Views owner:   ${viewsOwnerAddr}${viewsOwnerImpersonated ? " (impersonated)" : ""}`);
  if (canImpersonate) {
    console.log(`Impersonation mode: ${useGetImpersonatedSigner ? "getImpersonatedSigner+fallback" : "manual RPC only"}`);
  }

  // ── Check for pre-deployed addresses from deploy-result.json ──
  const deployResult = envFlag ? await loadDeployResult(envFlag) : undefined;

  // ── Deploy implementations ──
  console.log("[1/6] Deploying implementations (staking upgrade, SSVNetworkViews)");
  const stakingUpgradeImplAddr = deployResult?.ssvNetworkStakingUpgradeImplementation
    ?? (await deployContract(ethers, "SSVNetworkSSVStakingUpgrade", [], ownerSigner)).address;
  const viewsImplAddr = deployResult?.ssvNetworkViewsImplementation
    ?? (await deployContract(ethers, "SSVNetworkViews", [], ownerSigner)).address;

  if (deployResult?.ssvNetworkStakingUpgradeImplementation) {
    console.log(`  Using pre-deployed SSVNetworkSSVStakingUpgrade: ${stakingUpgradeImplAddr}`);
  }
  if (deployResult?.ssvNetworkViewsImplementation) {
    console.log(`  Using pre-deployed SSVNetworkViews impl: ${viewsImplAddr}`);
  }

  // ── Deploy CSSVToken (conditional) ──
  console.log(`[2/6] Resolving CSSVToken for ${ssvNetworkProxy}`);
  let cssvAddr: string;
  const existingCssv = config.cssvToken ?? deployResult?.cssvToken;
  if (existingCssv) {
    const cssvCode = await ethers.provider.getCode(existingCssv);
    if (cssvCode !== "0x") {
      cssvAddr = existingCssv;
      console.log(`  Using existing CSSVToken: ${cssvAddr}`);
    } else {
      console.log(`  CSSVToken at ${existingCssv} has no code, deploying new one`);
      cssvAddr = (await deployContract(ethers, "CSSVToken", [ssvNetworkProxy], ownerSigner)).address;
    }
  } else {
    cssvAddr = (await deployContract(ethers, "CSSVToken", [ssvNetworkProxy], ownerSigner)).address;
  }

  // ── Deploy modules ──
  console.log("[3/6] Deploying all module implementations");
  const preDeployedModules = deployResult?.modules ?? {};

  async function resolveModule(name: string, args: any[]): Promise<string> {
    const existing = preDeployedModules[name as keyof typeof preDeployedModules];
    if (existing) {
      console.log(`  Using pre-deployed ${name}: ${existing}`);
      return existing;
    }
    return (await deployContract(ethers, name, args, ownerSigner)).address;
  }

  const ssvOperatorsAddr = await resolveModule("SSVOperators", [upgradeTimestamp]);
  const ssvClustersAddr = await resolveModule("SSVClusters", []);
  const ssvDaoAddr = await resolveModule("SSVDAO", [cssvAddr]);
  const ssvViewsAddr = await resolveModule("SSVViews", [cssvAddr]);
  const ssvOperatorsWhitelistAddr = await resolveModule("SSVOperatorsWhitelist", []);
  const ssvStakingAddr = await resolveModule("SSVStaking", [cssvAddr]);
  const ssvValidatorsAddr = await resolveModule("SSVValidators", []);

  const modules: ModuleAddresses = {
    SSVOperators: ssvOperatorsAddr,
    SSVClusters: ssvClustersAddr,
    SSVDAO: ssvDaoAddr,
    SSVViews: ssvViewsAddr,
    SSVOperatorsWhitelist: ssvOperatorsWhitelistAddr,
    SSVStaking: ssvStakingAddr,
    SSVValidators: ssvValidatorsAddr,
  };

  // ── Upgrade proxies ──
  console.log("[4/6] Upgrading network proxy and views proxy");
  const minBlocksBetweenUpdates = params.minBlocksBetweenUpdates;
  if (config.skipInitializer) {
    console.log("  skipInitializer=true: using upgradeTo (no initializer call)");
    await (await networkOwner.upgradeTo(stakingUpgradeImplAddr)).wait();
  } else {
    const upgradeFactory = await ethers.getContractFactory("SSVNetworkSSVStakingUpgrade");
    const initData = upgradeFactory.interface.encodeFunctionData(
      "initializeSSVStaking(uint64,uint32[4],uint16)",
      [cooldownDuration, defaultOracleIds, quorumBps]
    );
    await (await networkOwner.upgradeToAndCall(stakingUpgradeImplAddr, initData)).wait();
  }
  await (await viewsOwner.upgradeTo(viewsImplAddr)).wait();

  // ── Attach modules ──
  console.log("[5/6] Attaching all modules");
  for (const mod of MODULE_ORDER) {
    const moduleId = SSVModules[mod];
    const moduleAddress = modules[mod];
    await (await networkOwner.updateModule(moduleId, moduleAddress)).wait();
  }

  // ── Apply protocol parameters ──
  console.log("[6/6] Applying configuration");
  if (params.networkFeeEth !== undefined) {
    await (await networkOwner.updateNetworkFee(params.networkFeeEth)).wait();
  }
  if (params.networkFeeSSV !== undefined) {
    await (await networkOwner.updateNetworkFeeSSV(params.networkFeeSSV)).wait();
  }
  if (params.liquidationThresholdPeriod !== undefined) {
    await (await networkOwner.updateLiquidationThresholdPeriod(params.liquidationThresholdPeriod)).wait();
  }
  if (params.liquidationThresholdPeriodSSV !== undefined) {
    await (await networkOwner.updateLiquidationThresholdPeriodSSV(params.liquidationThresholdPeriodSSV)).wait();
  }
  if (minBlocksBetweenUpdates !== undefined) {
    await (await networkOwner.updateMinBlocksBetweenUpdates(minBlocksBetweenUpdates)).wait();
  }
  if (params.minimumLiquidationCollateralEth !== undefined) {
    await (await networkOwner.updateMinimumLiquidationCollateral(params.minimumLiquidationCollateralEth)).wait();
  }
  if (params.minimumLiquidationCollateralSSV !== undefined) {
    await (await networkOwner.updateMinimumLiquidationCollateralSSV(params.minimumLiquidationCollateralSSV)).wait();
  }
  if (params.declareOperatorFeePeriod !== undefined) {
    await (await networkOwner.updateDeclareOperatorFeePeriod(params.declareOperatorFeePeriod)).wait();
  }
  if (params.executeOperatorFeePeriod !== undefined) {
    await (await networkOwner.updateExecuteOperatorFeePeriod(params.executeOperatorFeePeriod)).wait();
  }
  if (params.operatorFeeIncreaseLimit !== undefined) {
    await (await networkOwner.updateOperatorFeeIncreaseLimit(params.operatorFeeIncreaseLimit)).wait();
  }
  if (params.maxOperatorEthFee !== undefined) {
    await (await networkOwner.updateMaximumOperatorFee(params.maxOperatorEthFee)).wait();
  }
  if (params.minOperatorEthFee !== undefined) {
    await (await networkOwner.updateMinimumOperatorEthFee(params.minOperatorEthFee)).wait();
  }
  if (quorumBps !== undefined) {
    await (await networkOwner.updateQuorumBps(quorumBps)).wait();
  }
  if (params.unstakeCooldownDuration !== undefined) {
    await (await networkOwner.updateUnstakeCooldownDuration(params.unstakeCooldownDuration)).wait();
  }
  for (const { id, address } of oracles) {
    await (await networkOwner.replaceOracle(id, address)).wait();
  }

  // ── Write result JSON ──
  const onChainValues = await readOnChainValues(views);
  const blockNumber = await ethers.provider.getBlockNumber();

  const updatedConfig: UpgradeConfig = {
    ...config,
    owner: ownerAddr,
    ssvNetworkProxy,
    ssvNetworkViews,
    ssvToken,
    cssvToken: cssvAddr,
    deployBlockNumber: blockNumber,
    cooldownDuration: bigintToJsonNumberOrString(cooldownDuration),
    modules,
    protocolParams: {
      ...config.protocolParams,
      networkFeeEth: onChainValues.networkFeeEth,
      networkFeeSSV: onChainValues.networkFeeSSV,
      maxOperatorEthFee: onChainValues.maxOperatorEthFee,
      minOperatorEthFee: onChainValues.minOperatorEthFee,
      operatorFeeIncreaseLimit: onChainValues.operatorFeeIncreaseLimit,
      declareOperatorFeePeriod: onChainValues.declareOperatorFeePeriod,
      executeOperatorFeePeriod: onChainValues.executeOperatorFeePeriod,
      liquidationThresholdPeriod: onChainValues.liquidationThresholdPeriod,
      liquidationThresholdPeriodSSV: onChainValues.liquidationThresholdPeriodSSV,
      ...(params.minBlocksBetweenUpdates !== undefined
        ? { minBlocksBetweenUpdates: bigintToJsonNumberOrString(params.minBlocksBetweenUpdates) }
        : {}),
      minimumLiquidationCollateralEth: onChainValues.minimumLiquidationCollateralEth,
      minimumLiquidationCollateralSSV: onChainValues.minimumLiquidationCollateralSSV,
      validatorsPerOperatorLimit: onChainValues.validatorsPerOperatorLimit,
      unstakeCooldownDuration: onChainValues.unstakeCooldownDuration,
    },
    defaultOracleIds: onChainValues.defaultOracleIds,
    quorumBps: onChainValues.quorumBps,
    deployments: {
      ...(config.deployments ?? {}),
      ssvNetworkStakingUpgradeImplementation: stakingUpgradeImplAddr,
      ssvNetworkViewsImplementation: viewsImplAddr,
      cssvToken: cssvAddr,
      modules,
      targetNetwork: effectiveNetwork,
      deployBlockNumber: blockNumber,
      chainId: providerNetwork.chainId.toString(),
      updatedAt: new Date().toISOString(),
    },
  };
  if (oracles.length > 0) {
    updatedConfig.oracles = toOracleConfig(oracles);
  }

  // targetVersion already verified in pre-flight; use it as the result file suffix
  const contractVersion = config.targetVersion;

  const versionedResultPath = envFlag
    ? resolveVersionedUpgradeResultPath(envFlag, contractVersion)
    : resultPath;
  await writeFile(versionedResultPath, `${JSON.stringify(updatedConfig, null, 2)}\n`, "utf8");
  if (envFlag) {
    await updateLatestSymlink(versionedResultPath, resultPath);
  }

  console.log("Upgrade complete");
  console.log(`Config: ${initConfigPath}`);
  console.log(`Result: ${versionedResultPath}`);
  console.log(`Latest: ${resultPath} -> ${contractVersion}`);
  console.log(`Block: ${blockNumber}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

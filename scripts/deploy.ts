import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { isAddress } from "ethers";
import { deployContract, getDeployer, getEthers, parseArg } from "./common/helpers.ts";
import {
  type UpgradeConfig,
  type ModuleAddresses,
  type ModuleName,
  parseOptionalArg,
  parseUint,
  requireAddress,
  resolveConfigPath,
  resolveDeployResultPath,
  resolveVersionedDeployResultPath,
  resolveDeployedConfigPath,
  resolveNetworkFromEnv,
  updateLatestSymlink,
} from "./common/config.ts";

type DeployResult = {
  deployer: string;
  chainId: string;
  network: string;
  deployedAt: string;
  blockNumber: number;
  implementations: {
    SSVNetworkSSVStakingUpgrade: string;
    SSVNetworkViews: string;
  };
  cssvToken: {
    address: string;
    deployed: boolean;
  };
  modules: ModuleAddresses;
};

async function main() {
  // ── Resolve config ──
  const envFlag = parseOptionalArg("env");
  const configFlag = parseOptionalArg("config");

  let configPath: string;
  let outputPath: string;

  if (envFlag) {
    configPath = resolveConfigPath(envFlag);
    outputPath = resolveDeployResultPath(envFlag);
  } else if (configFlag) {
    configPath = resolve(configFlag);
    outputPath = resolveDeployedConfigPath(configPath, parseOptionalArg("output-config"));
  } else {
    throw new Error("Provide --env <environment> or --config <path>");
  }

  const targetNetwork = parseOptionalArg("network") ?? resolveNetworkFromEnv(envFlag) ?? "local";

  const raw = await readFile(configPath, "utf8");
  const config = JSON.parse(raw) as UpgradeConfig;
  const ssvNetworkProxy = requireAddress(config.ssvNetworkProxy, "ssvNetworkProxy");
  const upgradeTimestamp = parseUint(config.upgradeTimestamp, "upgradeTimestamp") ?? 0n;

  const ethers = await getEthers(targetNetwork);
  const deployer = await getDeployer(ethers);
  const deployerAddress = await deployer.getAddress();
  const providerNetwork = await ethers.provider.getNetwork();

  const proxyCode = await ethers.provider.getCode(ssvNetworkProxy);
  if (proxyCode === "0x") {
    throw new Error(
      `No contract code at ssvNetworkProxy ${ssvNetworkProxy} on ${targetNetwork}. ` +
      `Check your RPC URL and network selection.`
    );
  }

  console.log(`Deploying implementations and modules on ${targetNetwork}`);
  console.log(`Deployer: ${deployerAddress}`);
  console.log(`SSVNetwork proxy: ${ssvNetworkProxy}`);

  // ── Deploy implementations ──
  console.log("[1/4] Deploying SSVNetworkSSVStakingUpgrade implementation");
  const { address: stakingUpgradeImplAddr } = await deployContract(ethers, "SSVNetworkSSVStakingUpgrade", [], deployer);

  console.log("[2/4] Deploying SSVNetworkViews implementation");
  const { address: viewsImplAddr } = await deployContract(ethers, "SSVNetworkViews", [], deployer);

  // ── Deploy CSSVToken (conditional) ──
  console.log("[3/4] Resolving CSSVToken");
  let cssvAddr: string;
  let cssvDeployed = false;
  const existingCssv = config.cssvToken;
  if (existingCssv && isAddress(existingCssv)) {
    const cssvCode = await ethers.provider.getCode(existingCssv);
    if (cssvCode !== "0x") {
      cssvAddr = existingCssv;
      console.log(`  Using existing CSSVToken: ${cssvAddr}`);
    } else {
      console.log(`  CSSVToken at ${existingCssv} has no code, deploying new one`);
      cssvAddr = (await deployContract(ethers, "CSSVToken", [ssvNetworkProxy], deployer)).address;
      cssvDeployed = true;
    }
  } else {
    cssvAddr = (await deployContract(ethers, "CSSVToken", [ssvNetworkProxy], deployer)).address;
    cssvDeployed = true;
  }

  // ── Deploy modules ──
  console.log("[4/4] Deploying all module implementations");
  const { address: ssvOperatorsAddr } = await deployContract(ethers, "SSVOperators", [upgradeTimestamp], deployer);
  const { address: ssvClustersAddr } = await deployContract(ethers, "SSVClusters", [], deployer);
  const { address: ssvDaoAddr } = await deployContract(ethers, "SSVDAO", [cssvAddr], deployer);
  const { address: ssvViewsAddr } = await deployContract(ethers, "SSVViews", [cssvAddr], deployer);
  const { address: ssvOperatorsWhitelistAddr } = await deployContract(ethers, "SSVOperatorsWhitelist", [], deployer);
  const { address: ssvStakingAddr } = await deployContract(ethers, "SSVStaking", [cssvAddr], deployer);
  const { address: ssvValidatorsAddr } = await deployContract(ethers, "SSVValidators", [], deployer);

  const modules: ModuleAddresses = {
    SSVOperators: ssvOperatorsAddr,
    SSVClusters: ssvClustersAddr,
    SSVDAO: ssvDaoAddr,
    SSVViews: ssvViewsAddr,
    SSVOperatorsWhitelist: ssvOperatorsWhitelistAddr,
    SSVStaking: ssvStakingAddr,
    SSVValidators: ssvValidatorsAddr,
  };

  const blockNumber = await ethers.provider.getBlockNumber();

  // Read the deployed version from the staking upgrade impl (pure function, no proxy needed)
  let contractVersion = "unknown";
  try {
    const implContract = new (await import("ethers")).Contract(
      stakingUpgradeImplAddr,
      ["function getVersion() external pure returns (string)"],
      ethers.provider,
    );
    contractVersion = await implContract.getVersion();
  } catch {
    // non-fatal — versioned filename falls back to "unknown"
  }

  const result: DeployResult = {
    deployer: deployerAddress,
    chainId: providerNetwork.chainId.toString(),
    network: targetNetwork,
    deployedAt: new Date().toISOString(),
    blockNumber,
    implementations: {
      SSVNetworkSSVStakingUpgrade: stakingUpgradeImplAddr,
      SSVNetworkViews: viewsImplAddr,
    },
    cssvToken: {
      address: cssvAddr,
      deployed: cssvDeployed,
    },
    modules,
  };

  // Write versioned file and update the fixed-name symlink
  const versionedOutputPath = envFlag
    ? resolveVersionedDeployResultPath(envFlag, contractVersion)
    : outputPath;
  await writeFile(versionedOutputPath, `${JSON.stringify(result, null, 2)}\n`, "utf8");
  if (envFlag) {
    await updateLatestSymlink(versionedOutputPath, outputPath);
  }

  console.log("Deployment complete (no proxy upgrade performed)");
  console.log(`Config: ${configPath}`);
  console.log(`Result: ${versionedOutputPath}`);
  console.log(`Latest: ${outputPath} -> ${contractVersion}`);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

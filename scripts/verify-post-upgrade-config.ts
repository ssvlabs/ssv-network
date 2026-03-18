import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { getDeployer, getEthers } from "./common/helpers.ts";
import {
  type UpgradeConfig,
  parseOptionalArg,
  parseOptionalBooleanArg,
  requireAddress,
  parseQuorum,
  normalizeOracles,
  resolveDefaultOracleIds,
  resolveProtocolParams,
  resolveCooldownDuration,
  resolveConfigPath,
  resolveNetworkFromEnv,
} from "./common/config.ts";
import { verifyPostUpgradeState } from "./common/verify.ts";

async function main() {
  const envFlag = parseOptionalArg("env");
  const configFlag = parseOptionalArg("config");
  const forkFlag = parseOptionalBooleanArg("fork", false);

  let initConfigPath: string;
  if (envFlag) {
    initConfigPath = resolveConfigPath(envFlag);
  } else if (configFlag) {
    initConfigPath = resolve(configFlag);
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

  const params = resolveProtocolParams(config);
  const cooldownDuration = resolveCooldownDuration(config);
  const quorumBps = parseQuorum(config.quorumBps);
  const oracles = normalizeOracles(config.oracles);
  const defaultOracleIds = resolveDefaultOracleIds(config, oracles);

  const effectiveNetwork = forkFlag ? (targetNetwork ?? "local") : (targetNetwork ?? "local");
  const ethers = await getEthers(effectiveNetwork);

  const networkCode = await ethers.provider.getCode(ssvNetworkProxy);
  if (networkCode === "0x") {
    throw new Error(
      `No contract code at ssvNetworkProxy ${ssvNetworkProxy} on ${effectiveNetwork}. ` +
      "Check your RPC URL and fork/network selection."
    );
  }
  const viewsCode = await ethers.provider.getCode(ssvNetworkViews);
  if (viewsCode === "0x") {
    throw new Error(
      `No contract code at ssvNetworkViews ${ssvNetworkViews} on ${effectiveNetwork}. ` +
      "Check your RPC URL and fork/network selection."
    );
  }

  const network = await ethers.getContractAt("SSVNetwork", ssvNetworkProxy);
  const viewsProxy = await ethers.getContractAt("SSVNetworkViews", ssvNetworkViews);

  let onChainVersion: string;
  try {
    onChainVersion = await network.getVersion();
  } catch {
    throw new Error(`Could not read on-chain version from proxy ${ssvNetworkProxy}`);
  }
  if (onChainVersion !== config.currentVersion) {
    throw new Error(
      `Version mismatch: config.currentVersion is "${config.currentVersion}" but proxy reports "${onChainVersion}". ` +
      "Wrong config or proxy address?"
    );
  }
  console.log(`[PRE-FLIGHT] currentVersion = ${onChainVersion} ✓`);

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
        "Wrong contract compiled or wrong targetVersion in config?"
      );
    }
    console.log(`[PRE-FLIGHT] targetVersion  = ${localImplVersion} ✓`);
  }

  const deployerSigner = await getDeployer(ethers);
  const views = viewsProxy.connect(deployerSigner);

  console.log("Running post-upgrade config verification");
  await verifyPostUpgradeState({
    views,
    params,
    cooldownDuration,
    defaultOracleIds,
    quorumBps,
    oracles,
  });
  console.log("Verification complete");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { keccak256 } from "ethers";
import {
  type UpgradeConfig,
  parseOptionalArg,
  resolveConfigPath,
  resolveDeployResultPath,
  resolveEnvDir,
  resolveUpgradeTimestamp,
  requireAddress,
} from "./common/config.ts";
import { getEthers, parseArg } from "./common/helpers.ts";

type DeployResultFile = {
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
  modules: Record<string, string>;
};

type ContractEntry = {
  address: string;
  constructorArgs: Record<string, string>;
  initializerArgs?: Record<string, string>;
  bytecodeHash: string;
};

type Attestation = {
  generatedAt: string;
  deployment: {
    deployer: string;
    chainId: string;
    network: string;
    deployedAt: string;
    blockNumber: number;
  };
  config: {
    currentVersion: string;
    targetVersion: string;
    ssvNetworkProxy: string;
    ssvNetworkViews: string;
    ssvToken: string;
    cooldownDuration: number;
    upgradeTimestamp: number;
    quorumBps: number;
    defaultOracleIds: number[];
    initialStakeAmount: string;
    protocolParams: Record<string, string>;
    oracles: Record<string, string>;
  };
  contracts: Record<string, ContractEntry>;
};

async function fetchBytecodeHash(provider: any, address: string): Promise<string> {
  const code = await provider.getCode(address);
  if (code === "0x") {
    throw new Error(`No contract code at ${address}`);
  }
  return keccak256(code);
}

async function main() {
  const envFlag = parseArg("env");
  const networkOverride = parseOptionalArg("network");

  // Load config and deploy result
  const configPath = resolveConfigPath(envFlag);
  const resultPath = resolveDeployResultPath(envFlag);

  const config = JSON.parse(await readFile(configPath, "utf8")) as UpgradeConfig;
  const deployResult = JSON.parse(await readFile(resultPath, "utf8")) as DeployResultFile;

  // Resolve network for RPC connection
  const targetNetwork = networkOverride ?? deployResult.network ?? "mainnet";
  const ethers = await getEthers(targetNetwork);

  console.log(`Generating deployment attestation for ${envFlag} on ${targetNetwork}...`);

  // Collect all deployed addresses
  const allContracts: Record<string, { address: string; constructorArgs: Record<string, string>; initializerArgs?: Record<string, string> }> = {};

  const upgradeTimestamp = resolveUpgradeTimestamp(config);
  const cssvAddr = deployResult.cssvToken.address;
  const proxyAddr = requireAddress(config.ssvNetworkProxy, "ssvNetworkProxy");

  // Implementations
  const cooldownDuration = config.cooldownDuration ?? 604800;
  const defaultOracleIds = config.defaultOracleIds ?? [1, 2, 3, 4];
  const quorumBps = config.quorumBps ?? 7500;
  const skipInitializer = config.skipInitializer ?? false;

  allContracts["SSVNetworkSSVStakingUpgrade"] = {
    address: deployResult.implementations.SSVNetworkSSVStakingUpgrade,
    constructorArgs: {},
    ...(!skipInitializer && {
      initializerArgs: {
        function: "initializeSSVStaking(uint64,uint32[4],uint16)",
        cooldownDuration: String(cooldownDuration),
        defaultOracleIds: JSON.stringify(defaultOracleIds),
        quorumBps: String(quorumBps),
      },
    }),
  };
  allContracts["SSVNetworkViews"] = {
    address: deployResult.implementations.SSVNetworkViews,
    constructorArgs: {},
  };

  // CSSVToken
  allContracts["CSSVToken"] = {
    address: cssvAddr,
    constructorArgs: deployResult.cssvToken.deployed
      ? { ssvNetworkProxy: proxyAddr }
      : {},
  };

  // Modules — constructor args mirror deploy.ts
  const moduleArgs: Record<string, Record<string, string>> = {
    SSVOperators: { upgradeTimestamp: upgradeTimestamp.toString() },
    SSVClusters: {},
    SSVDAO: { cssvToken: cssvAddr },
    SSVViews: { cssvToken: cssvAddr },
    SSVOperatorsWhitelist: {},
    SSVStaking: { cssvToken: cssvAddr },
    SSVValidators: {},
  };

  for (const [name, address] of Object.entries(deployResult.modules)) {
    allContracts[name] = {
      address,
      constructorArgs: moduleArgs[name] ?? {},
    };
  }

  // Fetch bytecode hashes in parallel
  console.log(`Fetching bytecode hashes for ${Object.keys(allContracts).length} contracts...`);
  const entries = Object.entries(allContracts);
  const hashes = await Promise.all(
    entries.map(([name, { address }]) =>
      fetchBytecodeHash(ethers.provider, address).then(
        (hash) => ({ name, hash, error: null }),
        (err) => ({ name, hash: null, error: (err as Error).message }),
      ),
    ),
  );

  const contracts: Record<string, ContractEntry> = {};
  for (const { name, hash, error } of hashes) {
    if (error) {
      console.error(`  ERROR fetching ${name}: ${error}`);
      continue;
    }
    const entry = allContracts[name];
    contracts[name] = {
      address: entry.address,
      constructorArgs: entry.constructorArgs,
      ...(entry.initializerArgs && { initializerArgs: entry.initializerArgs }),
      bytecodeHash: hash!,
    };
    console.log(`  ${name}: ${hash}`);
  }

  // Build attestation
  const pp = config.protocolParams ?? {};
  const oracles = (config.oracles ?? {}) as Record<string, string>;

  const attestation: Attestation = {
    generatedAt: new Date().toISOString(),
    deployment: {
      deployer: deployResult.deployer,
      chainId: deployResult.chainId,
      network: deployResult.network,
      deployedAt: deployResult.deployedAt,
      blockNumber: deployResult.blockNumber,
    },
    config: {
      currentVersion: config.currentVersion,
      targetVersion: config.targetVersion,
      ssvNetworkProxy: config.ssvNetworkProxy,
      ssvNetworkViews: config.ssvNetworkViews,
      ssvToken: config.ssvToken,
      cooldownDuration: Number(config.cooldownDuration ?? 604800),
      upgradeTimestamp: Number(config.upgradeTimestamp ?? 0),
      quorumBps: config.quorumBps ?? 7500,
      defaultOracleIds: config.defaultOracleIds ?? [1, 2, 3, 4],
      initialStakeAmount: String(config.initialStakeAmount ?? "0"),
      protocolParams: Object.fromEntries(
        Object.entries(pp).map(([k, v]) => [k, String(v)]),
      ),
      oracles,
    },
    contracts,
  };

  // Write JSON attestation
  const outputPath = join(resolveEnvDir(envFlag), "deployment-attestation.json");
  await writeFile(outputPath, `${JSON.stringify(attestation, null, 2)}\n`, "utf8");
  console.log(`\nAttestation written to: ${outputPath}`);

  // Compute file hashes for committee verification
  const attestationContent = await readFile(outputPath, "utf8");
  const attestationFileHash = keccak256(new TextEncoder().encode(attestationContent));

  const batchPath = join(resolveEnvDir(envFlag), "multisig-batch.json");
  let batchFileHash: string | null = null;
  try {
    const batchContent = await readFile(batchPath, "utf8");
    batchFileHash = keccak256(new TextEncoder().encode(batchContent));
  } catch {
    console.warn(`Warning: ${batchPath} not found — run 'just generate-safe-batch' first to include its hash.`);
  }

  // Print human-readable summary
  console.log("\n" + "=".repeat(80));
  console.log("SSV Network Deployment Attestation");
  console.log("=".repeat(80));
  console.log(`Version:   ${config.currentVersion} -> ${config.targetVersion}`);
  console.log(`Network:   ${deployResult.network} (chain ${deployResult.chainId})`);
  console.log(`Deployer:  ${deployResult.deployer}`);
  console.log(`Deployed:  ${deployResult.deployedAt}`);
  console.log(`Block:     ${deployResult.blockNumber}`);
  console.log("");
  console.log("Deployed Contracts:");
  console.log("-".repeat(80));
  const nameWidth = Math.max(...Object.keys(contracts).map((n) => n.length));
  for (const [name, entry] of Object.entries(contracts)) {
    console.log(`  ${name.padEnd(nameWidth)}  ${entry.address}`);
    console.log(`  ${"".padEnd(nameWidth)}  bytecodeHash: ${entry.bytecodeHash}`);
    if (Object.keys(entry.constructorArgs).length > 0) {
      console.log(
        `  ${"".padEnd(nameWidth)}  args: ${JSON.stringify(entry.constructorArgs)}`,
      );
    }
    if (entry.initializerArgs) {
      console.log(
        `  ${"".padEnd(nameWidth)}  initializer: ${JSON.stringify(entry.initializerArgs)}`,
      );
    }
  }
  console.log("");
  console.log("Protocol Parameters:");
  console.log("-".repeat(80));
  for (const [key, value] of Object.entries(attestation.config.protocolParams)) {
    console.log(`  ${key}: ${value}`);
  }
  console.log("");
  console.log("Oracles:");
  console.log("-".repeat(80));
  for (const [id, addr] of Object.entries(oracles)) {
    console.log(`  Oracle ${id}: ${addr}`);
  }
  console.log("");
  console.log("File Hashes (keccak256 — for committee verification):");
  console.log("-".repeat(80));
  console.log(`  deployment-attestation.json: ${attestationFileHash}`);
  if (batchFileHash) {
    console.log(`  multisig-batch.json:         ${batchFileHash}`);
  }
  console.log("=".repeat(80));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import "dotenv/config";
import { isAddress, JsonRpcProvider, keccak256 } from "ethers";
import {
  type UpgradeConfig,
  parseOptionalArg,
  requireAddress,
  resolveConfigPath,
  resolveEnvDir,
  resolveNetworkFromEnv,
} from "./common/config.ts";
import { SSVModules } from "./common/modules.ts";

type HotfixContractEntry = {
  address: string;
  moduleId: number;
  constructorArgs: Record<string, string>;
  bytecodeHash: string;
};

type HotfixAttestation = {
  generatedAt: string;
  hotfix: {
    env: string;
    network: string;
    chainId: string;
    ssvNetworkProxy: string;
    owner: string;
    description: string;
  };
  contracts: {
    SSVClusters: HotfixContractEntry;
    SSVValidators: HotfixContractEntry;
  };
  intendedSafeTransactions: Array<{
    target: string;
    function: string;
    moduleName: "SSVClusters" | "SSVValidators";
    moduleId: number;
    moduleAddress: string;
  }>;
  relatedFileHashes: {
    "hotfix-multisig-batch.json"?: string;
  };
};

function resolveRpcUrl(targetNetwork: string): string | undefined {
  if (targetNetwork === "mainnet") return process.env.MAINNET_RPC_URL;
  if (targetNetwork === "hoodi") return process.env.HOODI_RPC_URL;
  if (targetNetwork === "local" || targetNetwork === "localhost") return "http://127.0.0.1:8545";
  return undefined;
}

function parseRequiredAddress(argName: string): string {
  const value = parseOptionalArg(argName);
  if (!value) throw new Error(`Missing --${argName}`);
  if (!isAddress(value)) throw new Error(`Invalid --${argName}: ${value}`);
  return value;
}

async function fetchBytecodeHash(provider: any, address: string): Promise<string> {
  const code = await provider.getCode(address);
  if (code === "0x") {
    throw new Error(`No contract code at ${address}`);
  }
  return keccak256(code);
}

async function maybeReadHash(path: string): Promise<string | undefined> {
  try {
    const content = await readFile(path, "utf8");
    return keccak256(new TextEncoder().encode(content));
  } catch {
    return undefined;
  }
}

async function main() {
  const envFlag = parseOptionalArg("env") ?? "mainnet";
  const networkOverride = parseOptionalArg("network");
  const targetNetwork = networkOverride ?? resolveNetworkFromEnv(envFlag) ?? "mainnet";
  const rpcUrl = parseOptionalArg("rpc-url") ?? resolveRpcUrl(targetNetwork);
  if (!rpcUrl) {
    throw new Error(
      `Missing RPC URL for network '${targetNetwork}'. ` +
      "Set MAINNET_RPC_URL/HOODI_RPC_URL or pass --rpc-url <url>.",
    );
  }

  const clusters = parseRequiredAddress("clusters");
  const validators = parseRequiredAddress("validators");

  const config = JSON.parse(await readFile(resolveConfigPath(envFlag), "utf8")) as UpgradeConfig;
  const ssvNetworkProxy = requireAddress(config.ssvNetworkProxy, "ssvNetworkProxy");
  if (!config.owner) {
    throw new Error(`Missing owner in deployments/${envFlag}/config.json; required for hotfix attestation.`);
  }
  const ownerAddr = requireAddress(config.owner, "owner");

  const provider = new JsonRpcProvider(rpcUrl);
  const network = await provider.getNetwork();

  console.log(`Generating hotfix deployment attestation for ${envFlag} on ${targetNetwork}...`);
  const [clustersHash, validatorsHash] = await Promise.all([
    fetchBytecodeHash(provider, clusters),
    fetchBytecodeHash(provider, validators),
  ]);

  const attestationWithoutHashes = {
    generatedAt: new Date().toISOString(),
    hotfix: {
      env: envFlag,
      network: targetNetwork,
      chainId: network.chainId.toString(),
      ssvNetworkProxy,
      owner: ownerAddr,
      description:
        "Hotfix deployment attestation for replacing only SSVClusters and SSVValidators module pointers.",
    },
    contracts: {
      SSVClusters: {
        address: clusters,
        moduleId: SSVModules.SSVClusters,
        constructorArgs: {},
        bytecodeHash: clustersHash,
      },
      SSVValidators: {
        address: validators,
        moduleId: SSVModules.SSVValidators,
        constructorArgs: {},
        bytecodeHash: validatorsHash,
      },
    },
    intendedSafeTransactions: [
      {
        target: ssvNetworkProxy,
        function: "updateModule(uint8,address)",
        moduleName: "SSVClusters" as const,
        moduleId: SSVModules.SSVClusters,
        moduleAddress: clusters,
      },
      {
        target: ssvNetworkProxy,
        function: "updateModule(uint8,address)",
        moduleName: "SSVValidators" as const,
        moduleId: SSVModules.SSVValidators,
        moduleAddress: validators,
      },
    ],
  };

  const outputPath = join(resolveEnvDir(envFlag), "hotfix-deployment-attestation.json");
  const batchPath = join(resolveEnvDir(envFlag), "hotfix-multisig-batch.json");
  const batchHash = await maybeReadHash(batchPath);
  const attestation: HotfixAttestation = {
    ...attestationWithoutHashes,
    relatedFileHashes: {
      ...(batchHash && { "hotfix-multisig-batch.json": batchHash }),
    },
  };
  const content = `${JSON.stringify(attestation, null, 2)}\n`;
  await writeFile(outputPath, content, "utf8");
  const attestationFileHash = keccak256(new TextEncoder().encode(content));

  console.log(`\nHotfix attestation written to: ${outputPath}`);
  if (!batchHash) {
    console.warn(`Warning: ${batchPath} not found. Generate the SAFE batch to include its hash in the attestation.`);
  }

  console.log("\n" + "=".repeat(80));
  console.log("SSV Network Hotfix Deployment Attestation");
  console.log("=".repeat(80));
  console.log(`Scope:     SSVClusters + SSVValidators module replacement`);
  console.log(`Env:       ${envFlag}`);
  console.log(`Network:   ${targetNetwork} (chain ${network.chainId.toString()})`);
  console.log(`SAFE:      ${ownerAddr}`);
  console.log(`Proxy:     ${ssvNetworkProxy}`);
  console.log("");
  console.log("Deployed Modules:");
  console.log("-".repeat(80));
  const moduleNameWidth = Math.max(...Object.keys(attestation.contracts).map((name) => name.length));
  for (const [name, entry] of Object.entries(attestation.contracts)) {
    console.log(`  ${name.padEnd(moduleNameWidth)}  moduleId: ${entry.moduleId}`);
    console.log(`  ${"".padEnd(moduleNameWidth)}  address:  ${entry.address}`);
    console.log(`  ${"".padEnd(moduleNameWidth)}  bytecodeHash: ${entry.bytecodeHash}`);
  }
  console.log("");
  console.log("Intended SAFE Calls:");
  console.log("-".repeat(80));
  for (const [index, tx] of attestation.intendedSafeTransactions.entries()) {
    console.log(`  ${index + 1}. ${tx.function}`);
    console.log(`     target:        ${tx.target}`);
    console.log(`     moduleName:    ${tx.moduleName}`);
    console.log(`     moduleId:      ${tx.moduleId}`);
    console.log(`     moduleAddress: ${tx.moduleAddress}`);
  }
  console.log("");
  console.log("File Hashes (keccak256 — for committee verification):");
  console.log("-".repeat(80));
  console.log(`  hotfix-deployment-attestation.json: ${attestationFileHash}`);
  if (batchHash) {
    console.log(`  hotfix-multisig-batch.json:         ${batchHash}`);
  }
  console.log("=".repeat(80));
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

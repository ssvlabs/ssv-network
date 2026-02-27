import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { JsonRpcProvider } from "ethers";
import { parseArg } from "./common/helpers.ts";
import {
  parseOptionalArg,
  resolveUpgradeResultPath,
} from "./common/config.ts";
import {
  type ForkConfigFile,
  resolveSourceRpcUrl,
  preflightSourceRpc,
  buildForkTestEnv,
} from "./common/fork-test.ts";

async function main() {
  // Support both --env and --config
  const envFlag = parseOptionalArg("env");
  let configPath: string;
  if (envFlag) {
    configPath = resolveUpgradeResultPath(envFlag);
  } else {
    configPath = resolve(parseArg("config"));
  }

  const testPath = parseOptionalArg("test") ?? "test/test-forked/v2.0.0/fullIntegrationForked.test.ts";
  const forkNetwork = parseOptionalArg("fork-network") ?? "hardhat_forked";
  const useDeployedState = parseOptionalArg("use-deployed-state") ?? "true";
  const noGasEnforce = parseOptionalArg("no-gas-enforce") ?? "true";
  const strictDeployedState = parseOptionalArg("strict-deployed-state") ?? "false";
  const allowDeployedFallback = parseOptionalArg("allow-deployed-fallback") ?? "true";
  const forkBlockNumberArg = parseOptionalArg("fork-block-number");

  const rawConfig = await readFile(configPath, "utf8");
  const config = JSON.parse(rawConfig) as ForkConfigFile;
  const envForkBlockNumber = process.env.FORK_BLOCK_NUMBER?.trim();
  let forkBlockNumber = forkBlockNumberArg ?? (envForkBlockNumber && envForkBlockNumber.length > 0 ? envForkBlockNumber : undefined);
  if (!forkBlockNumber) {
    const provider = new JsonRpcProvider(resolveSourceRpcUrl());
    forkBlockNumber = String(await provider.getBlockNumber());
  }

  if (useDeployedState === "true") {
    if (strictDeployedState === "true" || allowDeployedFallback === "false") {
      await preflightSourceRpc(config);
    } else {
      try {
        await preflightSourceRpc(config);
      } catch (err: any) {
        const message = err?.message ?? String(err);
        console.warn(`[FORK] Source-RPC preflight failed, continuing because fallback is enabled: ${message}`);
      }
    }
  }

  const env = buildForkTestEnv(config, {
    configPath,
    forkNetwork,
    useDeployedState,
    strictDeployedState,
    allowDeployedFallback,
    noGasEnforce,
    forkBlockNumber: forkBlockNumber ?? "",
  });

  const args = ["hardhat", "test", testPath];
  console.log(`Running forked tests via: npx ${args.join(" ")}`);
  console.log(`FORK_TEST_NETWORK=${forkNetwork}`);
  console.log(`FORK_CONFIG_PATH=${configPath}`);
  console.log(`FORK_USE_DEPLOYED_STATE=${useDeployedState}`);
  console.log(`FORK_STRICT_DEPLOYED_STATE=${strictDeployedState}`);
  console.log(`FORK_ALLOW_DEPLOYED_FALLBACK=${allowDeployedFallback}`);
  console.log(`NO_GAS_ENFORCE=${noGasEnforce}`);
  console.log(`FORK_BLOCK_NUMBER=${forkBlockNumber}`);

  await new Promise<void>((resolvePromise, rejectPromise) => {
    const child = spawn("npx", args, {
      stdio: "inherit",
      env,
    });

    child.on("error", rejectPromise);
    child.on("close", (code) => {
      if (code === 0) {
        resolvePromise();
        return;
      }
      rejectPromise(new Error(`Forked tests failed with exit code ${code}`));
    });
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});

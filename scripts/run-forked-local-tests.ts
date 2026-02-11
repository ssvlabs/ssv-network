import { spawn } from "node:child_process";
import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { Contract, JsonRpcProvider } from "ethers";
import { parseArg } from "./common/helpers.ts";

type ForkConfigFile = {
  ssvNetworkProxy?: string;
  ssvNetworkAddress?: string;
  ssvNetworkViews?: string;
  forkBlockNumber?: string | number;
  deployments?: {
    forkBlockNumber?: string | number;
  };
  networkFeeSSV?: string | number;
  networkFeeEth?: string | number;
  maxOperatorEthFee?: string | number;
  minOperatorEthFee?: string | number;
  operatorFeeIncreaseLimit?: string | number;
  declareOperatorFeePeriod?: string | number;
  executeOperatorFeePeriod?: string | number;
  liquidationThresholdPeriod?: string | number;
  minimumLiquidationCollateralEth?: string | number;
  minimumLiquidationCollateralSSV?: string | number;
  validatorsPerOperatorLimit?: string | number;
  defaultOracleIds?: number[];
  unstakeCooldownDuration?: string | number;
  cooldownDuration?: string | number;
};

function parseOptionalArg(argName: string): string | undefined {
  const index = process.argv.indexOf(`--${argName}`);
  if (index === -1) return undefined;
  const value = process.argv[index + 1];
  if (!value) throw new Error(`Missing value for --${argName}`);
  return value;
}

function toEnvValue(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return String(value);
}

async function preflightSourceRpc(config: ForkConfigFile): Promise<void> {
  const sourceRpcUrl = process.env.HOODI_LOCAL_RPC_URL ?? "http://127.0.0.1:8545";
  const viewsAddress = config.ssvNetworkViews;
  const networkAddress = config.ssvNetworkProxy ?? config.ssvNetworkAddress;

  if (!viewsAddress || !networkAddress) {
    throw new Error(
      "Deployed config is missing ssvNetworkViews or ssvNetworkProxy/ssvNetworkAddress"
    );
  }

  const provider = new JsonRpcProvider(sourceRpcUrl);
  const viewsCode = await provider.getCode(viewsAddress);
  const networkCode = await provider.getCode(networkAddress);
  if (viewsCode === "0x") {
    throw new Error(`No code at ssvNetworkViews=${viewsAddress} on source RPC ${sourceRpcUrl}`);
  }
  if (networkCode === "0x") {
    throw new Error(`No code at ssvNetworkProxy=${networkAddress} on source RPC ${sourceRpcUrl}`);
  }

  const views = new Contract(
    viewsAddress,
    [
      "function getVersion() view returns (string)",
      "function getNetworkFee() view returns (uint256)",
      "function getActiveOracleIds() view returns (uint32[4])",
    ],
    provider
  );

  try {
    await views.getVersion();
    await views.getNetworkFee();
    await views.getActiveOracleIds();
  } catch (err: any) {
    const block = await provider.getBlockNumber();
    const shortMessage = err?.shortMessage ?? err?.message ?? "unknown error";
    const data = err?.data ? ` data=${err.data}` : "";
    throw new Error(
      `Source RPC preflight failed at block ${block} for SSVNetworkViews=${viewsAddress}. ` +
      `Cannot read getVersion/getNetworkFee/getActiveOracleIds. ${shortMessage}${data}`
    );
  }
}

async function main() {
  const configPath = resolve(parseArg("config"));
  const testPath = parseOptionalArg("test") ?? "test/test-forked/v2.0.0/fullIntegrationForked.test.ts";
  const forkNetwork = parseOptionalArg("fork-network") ?? "hardhat_forked_hoodi_local";
  const useDeployedState = parseOptionalArg("use-deployed-state") ?? "true";
  const noGasEnforce = parseOptionalArg("no-gas-enforce") ?? "true";
  const strictDeployedState = parseOptionalArg("strict-deployed-state") ?? "false";
  const allowDeployedFallback = parseOptionalArg("allow-deployed-fallback") ?? "true";
  const forkBlockNumberArg = parseOptionalArg("fork-block-number");

  const rawConfig = await readFile(configPath, "utf8");
  const config = JSON.parse(rawConfig) as ForkConfigFile;
  const forkBlockNumber =
    forkBlockNumberArg ??
    toEnvValue(config.forkBlockNumber ?? config.deployments?.forkBlockNumber);

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

  const env = {
    ...process.env,
    RUN_FORK: "true",
    FORK_TEST_NETWORK: forkNetwork,
    FORK_CONFIG_PATH: configPath,
    FORK_USE_DEPLOYED_STATE: useDeployedState,
    FORK_STRICT_DEPLOYED_STATE: strictDeployedState,
    FORK_ALLOW_DEPLOYED_FALLBACK: allowDeployedFallback,
    NO_GAS_ENFORCE: noGasEnforce,
    FORK_BLOCK_NUMBER: forkBlockNumber ?? "",
    FORK_NETWORK_FEE_ETH: toEnvValue(config.networkFeeEth),
    FORK_NETWORK_FEE_SSV: toEnvValue(config.networkFeeSSV),
    FORK_MAX_OPERATOR_ETH_FEE: toEnvValue(config.maxOperatorEthFee),
    FORK_MIN_OPERATOR_ETH_FEE: toEnvValue(config.minOperatorEthFee),
    FORK_OPERATOR_MAX_FEE_INCREASE: toEnvValue(config.operatorFeeIncreaseLimit),
    FORK_DECLARE_OPERATOR_FEE_PERIOD: toEnvValue(config.declareOperatorFeePeriod),
    FORK_EXECUTE_OPERATOR_FEE_PERIOD: toEnvValue(config.executeOperatorFeePeriod),
    FORK_MIN_LIQ_COLLATERAL: toEnvValue(
      config.minimumLiquidationCollateralSSV ?? config.minimumLiquidationCollateralEth
    ),
    FORK_VALIDATORS_PER_OPERATOR_LIMIT: toEnvValue(config.validatorsPerOperatorLimit),
    FORK_DEFAULT_ORACLE_IDS: config.defaultOracleIds?.join(","),
    FORK_DEFAULT_UNSTAKE_COOLDOWN: toEnvValue(config.unstakeCooldownDuration ?? config.cooldownDuration),
  };

  const args = ["hardhat", "test", testPath];
  console.log(`Running forked tests via: npx ${args.join(" ")}`);
  console.log(`FORK_TEST_NETWORK=${forkNetwork}`);
  console.log(`FORK_CONFIG_PATH=${configPath}`);
  console.log(`FORK_USE_DEPLOYED_STATE=${useDeployedState}`);
  console.log(`FORK_STRICT_DEPLOYED_STATE=${strictDeployedState}`);
  console.log(`FORK_ALLOW_DEPLOYED_FALLBACK=${allowDeployedFallback}`);
  console.log(`NO_GAS_ENFORCE=${noGasEnforce}`);
  console.log(`FORK_BLOCK_NUMBER=${forkBlockNumber ?? "<latest>"}`);

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

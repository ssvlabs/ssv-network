import { Contract, JsonRpcProvider } from "ethers";
import { LOCAL_FORK_RPC_URL } from "./config.ts";

export type ForkConfigFile = {
  ssvNetworkProxy?: string;
  ssvNetworkAddress?: string;
  ssvNetworkViews?: string;
  forkBlockNumber?: string | number;
  deployments?: {
    forkBlockNumber?: string | number;
  };
  protocolParams?: {
    networkFeeSSV?: string | number;
    networkFeeEth?: string | number;
    maxOperatorEthFee?: string | number;
    minOperatorEthFee?: string | number;
    operatorFeeIncreaseLimit?: string | number;
    declareOperatorFeePeriod?: string | number;
    executeOperatorFeePeriod?: string | number;
    liquidationThresholdPeriod?: string | number;
    liquidationThresholdPeriodSSV?: string | number;
    minimumLiquidationCollateralEth?: string | number;
    minimumLiquidationCollateralSSV?: string | number;
    validatorsPerOperatorLimit?: string | number;
    unstakeCooldownDuration?: string | number;
  };
  // Legacy flat fields (backward compat with older result files)
  networkFeeSSV?: string | number;
  networkFeeEth?: string | number;
  maxOperatorEthFee?: string | number;
  minOperatorEthFee?: string | number;
  operatorFeeIncreaseLimit?: string | number;
  declareOperatorFeePeriod?: string | number;
  executeOperatorFeePeriod?: string | number;
  liquidationThresholdPeriod?: string | number;
  liquidationThresholdPeriodSSV?: string | number;
  minimumLiquidationCollateralEth?: string | number;
  minimumLiquidationCollateralSSV?: string | number;
  validatorsPerOperatorLimit?: string | number;
  defaultOracleIds?: number[];
  unstakeCooldownDuration?: string | number;
  cooldownDuration?: string | number;
};

export function toEnvValue(value: string | number | undefined): string | undefined {
  if (value === undefined) return undefined;
  return String(value);
}

export function resolveSourceRpcUrl(): string {
  return LOCAL_FORK_RPC_URL;
}

export async function preflightSourceRpc(config: ForkConfigFile): Promise<void> {
  const sourceRpcUrl = resolveSourceRpcUrl();
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

/**
 * Builds the environment variables block for the forked test runner.
 * Reads from protocolParams (preferred) with fallback to legacy flat fields.
 */
export function buildForkTestEnv(
  config: ForkConfigFile,
  opts: {
    configPath: string;
    forkNetwork: string;
    useDeployedState: string;
    strictDeployedState: string;
    allowDeployedFallback: string;
    noGasEnforce: string;
    forkBlockNumber: string;
  }
): Record<string, string | undefined> {
  const pp = config.protocolParams ?? {};
  return {
    ...process.env,
    RUN_FORK: "true",
    FORK_TEST_NETWORK: opts.forkNetwork,
    FORK_CONFIG_PATH: opts.configPath,
    FORK_USE_DEPLOYED_STATE: opts.useDeployedState,
    FORK_STRICT_DEPLOYED_STATE: opts.strictDeployedState,
    FORK_ALLOW_DEPLOYED_FALLBACK: opts.allowDeployedFallback,
    NO_GAS_ENFORCE: opts.noGasEnforce,
    FORK_BLOCK_NUMBER: opts.forkBlockNumber,
    FORK_NETWORK_FEE_ETH: toEnvValue(pp.networkFeeEth ?? config.networkFeeEth),
    FORK_NETWORK_FEE_SSV: toEnvValue(pp.networkFeeSSV ?? config.networkFeeSSV),
    FORK_MAX_OPERATOR_ETH_FEE: toEnvValue(pp.maxOperatorEthFee ?? config.maxOperatorEthFee),
    FORK_MIN_OPERATOR_ETH_FEE: toEnvValue(pp.minOperatorEthFee ?? config.minOperatorEthFee),
    FORK_OPERATOR_MAX_FEE_INCREASE: toEnvValue(pp.operatorFeeIncreaseLimit ?? config.operatorFeeIncreaseLimit),
    FORK_DECLARE_OPERATOR_FEE_PERIOD: toEnvValue(pp.declareOperatorFeePeriod ?? config.declareOperatorFeePeriod),
    FORK_EXECUTE_OPERATOR_FEE_PERIOD: toEnvValue(pp.executeOperatorFeePeriod ?? config.executeOperatorFeePeriod),
    FORK_MIN_LIQ_COLLATERAL: toEnvValue(
      pp.minimumLiquidationCollateralSSV ?? pp.minimumLiquidationCollateralEth
        ?? config.minimumLiquidationCollateralSSV ?? config.minimumLiquidationCollateralEth
    ),
    FORK_VALIDATORS_PER_OPERATOR_LIMIT: toEnvValue(pp.validatorsPerOperatorLimit ?? config.validatorsPerOperatorLimit),
    FORK_DEFAULT_ORACLE_IDS: config.defaultOracleIds?.join(","),
    FORK_DEFAULT_UNSTAKE_COOLDOWN: toEnvValue(
      pp.unstakeCooldownDuration ?? config.unstakeCooldownDuration ?? config.cooldownDuration
    ),
  };
}

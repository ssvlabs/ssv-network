import type { OracleEntry, ResolvedProtocolParams } from "./config.ts";

// ── Formatting helpers ──

export function normalizeComparable(value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((v) => normalizeComparable(v));
  return value;
}

export function formatValue(value: unknown): string {
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return `[${value.map((v) => formatValue(v)).join(", ")}]`;
  return String(value);
}

export function assertEqual(label: string, expected: unknown, actual: unknown): void {
  const expectedComparable = normalizeComparable(expected);
  const actualComparable = normalizeComparable(actual);
  if (JSON.stringify(expectedComparable) !== JSON.stringify(actualComparable)) {
    throw new Error(
      `[VERIFY] ${label} mismatch. expected=${formatValue(expected)} actual=${formatValue(actual)}`
    );
  }
  console.log(`[VERIFY] ${label} = ${formatValue(actual)}`);
}

function assertEqualAndCollect(
  label: string,
  expected: unknown,
  actual: unknown,
  mismatches: string[]
): void {
  const expectedComparable = normalizeComparable(expected);
  const actualComparable = normalizeComparable(actual);
  if (JSON.stringify(expectedComparable) !== JSON.stringify(actualComparable)) {
    const mismatch = `${label}: expected=${formatValue(expected)} actual=${formatValue(actual)}`;
    console.log(`[VERIFY][MISMATCH] ${mismatch}`);
    mismatches.push(mismatch);
    return;
  }
  console.log(`[VERIFY] ${label} = ${formatValue(actual)}`);
}

export function logObserved(label: string, value: unknown): void {
  console.log(`[VERIFY] ${label} = ${formatValue(value)}`);
}

// ── Post-upgrade verification ──

export type VerifyOptions = {
  views: any; // SSVNetworkViews contract instance
  params: ResolvedProtocolParams;
  cooldownDuration: bigint;
  defaultOracleIds: [number, number, number, number];
  quorumBps?: number;
  oracles: OracleEntry[];
};

/**
 * Queries SSVViews and verifies on-chain state matches expected config.
 * Logs all mismatches and throws once at the end; logs observed values when
 * no expectation is configured.
 */
export async function verifyPostUpgradeState(opts: VerifyOptions): Promise<void> {
  const { views, params, cooldownDuration, defaultOracleIds, quorumBps, oracles } = opts;
  const mismatches: string[] = [];

  console.log("[VERIFY] Querying SSVViews for post-upgrade parameters");

  const viewsVersion = await views.getVersion();
  const actualCooldownDuration = await views.cooldownDuration();
  const actualDefaultOracleIds = await views.getActiveOracleIds();
  const actualQuorumBps = await views.getQuorumBps();
  const actualNetworkFeeEth = await views.getNetworkFee();
  const actualNetworkFeeSSV = await views.getNetworkFeeSSV();
  const actualOperatorFeeIncreaseLimit = await views.getOperatorFeeIncreaseLimit();
  const actualOperatorFeePeriods = await views.getOperatorFeePeriods();
  const actualLiquidationThresholdPeriod = await views.getLiquidationThresholdPeriod();
  const actualLiquidationThresholdPeriodSSV = await views.getLiquidationThresholdPeriodSSV();
  const actualMinimumLiquidationCollateralEth = await views.getMinimumLiquidationCollateral();
  const actualMinimumLiquidationCollateralSSV = await views.getMinimumLiquidationCollateralSSV();
  const actualMaxOperatorEthFee = await views.getMaximumOperatorFee();
  const actualMinOperatorEthFee = await views.getMinimumOperatorEthFee();

  const expectedCooldownDuration = params.unstakeCooldownDuration ?? cooldownDuration;

  logObserved("views.version", viewsVersion);
  assertEqualAndCollect("cooldownDuration", expectedCooldownDuration, actualCooldownDuration, mismatches);
  assertEqualAndCollect(
    "defaultOracleIds",
    defaultOracleIds.map((id) => BigInt(id)),
    Array.from(actualDefaultOracleIds),
    mismatches
  );

  const checks: Array<{
    label: string;
    expected: bigint | undefined;
    actual: bigint;
  }> = [
    { label: "networkFeeEth", expected: params.networkFeeEth, actual: actualNetworkFeeEth },
    { label: "networkFeeSSV", expected: params.networkFeeSSV, actual: actualNetworkFeeSSV },
    {
      label: "operatorFeeIncreaseLimit",
      expected: params.operatorFeeIncreaseLimit,
      actual: actualOperatorFeeIncreaseLimit,
    },
    {
      label: "declareOperatorFeePeriod",
      expected: params.declareOperatorFeePeriod,
      actual: actualOperatorFeePeriods.declarePeriod,
    },
    {
      label: "executeOperatorFeePeriod",
      expected: params.executeOperatorFeePeriod,
      actual: actualOperatorFeePeriods.executePeriod,
    },
    {
      label: "liquidationThresholdPeriod",
      expected: params.liquidationThresholdPeriod,
      actual: actualLiquidationThresholdPeriod,
    },
    {
      label: "liquidationThresholdPeriodSSV",
      expected: params.liquidationThresholdPeriodSSV,
      actual: actualLiquidationThresholdPeriodSSV,
    },
    {
      label: "minimumLiquidationCollateralEth",
      expected: params.minimumLiquidationCollateralEth,
      actual: actualMinimumLiquidationCollateralEth,
    },
    {
      label: "minimumLiquidationCollateralSSV",
      expected: params.minimumLiquidationCollateralSSV,
      actual: actualMinimumLiquidationCollateralSSV,
    },
    { label: "maxOperatorEthFee", expected: params.maxOperatorEthFee, actual: actualMaxOperatorEthFee },
    { label: "minOperatorEthFee", expected: params.minOperatorEthFee, actual: actualMinOperatorEthFee },
  ];

  if (quorumBps !== undefined) {
    assertEqualAndCollect("quorumBps", BigInt(quorumBps), actualQuorumBps, mismatches);
  } else {
    logObserved("quorumBps", actualQuorumBps);
  }

  if (params.minBlocksBetweenUpdates !== undefined) {
    console.log(
      `[VERIFY] minBlocksBetweenUpdates configured=${params.minBlocksBetweenUpdates.toString()} ` +
      "(not verifiable via SSVViews; no getter exposed)"
    );
  }

  for (const { label, expected, actual } of checks) {
    if (expected !== undefined) {
      assertEqualAndCollect(label, expected, actual, mismatches);
    } else {
      logObserved(label, actual);
    }
  }

  for (const oracleId of defaultOracleIds) {
    const actualOracleAddress = await views.getOracle(oracleId);
    const expectedOracleAddress = oracles.find((oracle) => oracle.id === oracleId)?.address;
    if (expectedOracleAddress) {
      assertEqualAndCollect(
        `oracle[${oracleId}]`,
        expectedOracleAddress.toLowerCase(),
        actualOracleAddress.toLowerCase(),
        mismatches
      );
    } else {
      logObserved(`oracle[${oracleId}]`, actualOracleAddress);
    }
  }

  if (mismatches.length > 0) {
    throw new Error(
      `[VERIFY] Found ${mismatches.length} mismatch(es):\n` +
      mismatches.map((mismatch) => `- ${mismatch}`).join("\n")
    );
  }

  console.log("[VERIFY] All configured checks passed");
}

/**
 * Returns the actual on-chain values for result JSON output.
 */
export async function readOnChainValues(views: any): Promise<{
  networkFeeEth: string;
  networkFeeSSV: string;
  maxOperatorEthFee: string;
  minOperatorEthFee: string;
  operatorFeeIncreaseLimit: string;
  declareOperatorFeePeriod: string;
  executeOperatorFeePeriod: string;
  liquidationThresholdPeriod: string;
  liquidationThresholdPeriodSSV: string;
  minimumLiquidationCollateralEth: string;
  minimumLiquidationCollateralSSV: string;
  validatorsPerOperatorLimit: string;
  unstakeCooldownDuration: string;
  quorumBps: number;
  defaultOracleIds: number[];
}> {
  const actualNetworkFeeEth = await views.getNetworkFee();
  const actualNetworkFeeSSV = await views.getNetworkFeeSSV();
  const actualOperatorFeeIncreaseLimit = await views.getOperatorFeeIncreaseLimit();
  const actualOperatorFeePeriods = await views.getOperatorFeePeriods();
  const actualLiquidationThresholdPeriod = await views.getLiquidationThresholdPeriod();
  const actualLiquidationThresholdPeriodSSV = await views.getLiquidationThresholdPeriodSSV();
  const actualMinimumLiquidationCollateralEth = await views.getMinimumLiquidationCollateral();
  const actualMinimumLiquidationCollateralSSV = await views.getMinimumLiquidationCollateralSSV();
  const actualMaxOperatorEthFee = await views.getMaximumOperatorFee();
  const actualMinOperatorEthFee = await views.getMinimumOperatorEthFee();
  const actualValidatorsPerOperatorLimit = await views.getValidatorsPerOperatorLimit();
  const actualCooldownDuration = await views.cooldownDuration();
  const actualQuorumBps = await views.getQuorumBps();
  const actualDefaultOracleIds = await views.getActiveOracleIds();

  return {
    networkFeeEth: actualNetworkFeeEth.toString(),
    networkFeeSSV: actualNetworkFeeSSV.toString(),
    maxOperatorEthFee: actualMaxOperatorEthFee.toString(),
    minOperatorEthFee: actualMinOperatorEthFee.toString(),
    operatorFeeIncreaseLimit: actualOperatorFeeIncreaseLimit.toString(),
    declareOperatorFeePeriod: actualOperatorFeePeriods.declarePeriod.toString(),
    executeOperatorFeePeriod: actualOperatorFeePeriods.executePeriod.toString(),
    liquidationThresholdPeriod: actualLiquidationThresholdPeriod.toString(),
    liquidationThresholdPeriodSSV: actualLiquidationThresholdPeriodSSV.toString(),
    minimumLiquidationCollateralEth: actualMinimumLiquidationCollateralEth.toString(),
    minimumLiquidationCollateralSSV: actualMinimumLiquidationCollateralSSV.toString(),
    validatorsPerOperatorLimit: actualValidatorsPerOperatorLimit.toString(),
    unstakeCooldownDuration: actualCooldownDuration.toString(),
    quorumBps: Number(actualQuorumBps),
    defaultOracleIds: Array.from(actualDefaultOracleIds).map((id: any) => Number(id)),
  };
}

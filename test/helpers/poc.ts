import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import type { NetworkHelpersType, Cluster } from "../common/types.ts";
import { ssvNetworkFullFixture } from "../setup/fixtures.ts";
import { Events } from "../common/events.ts";
import {
  DECLARE_OPERATOR_FEE_PERIOD,
  DEFAULT_NETWORK_FEE_RAW,
  DEFAULT_NETWORK_FEE_UNPACKED,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  ETH_DEDUCTED_DIGITS,
  MINIMAL_LIQUIDATION_THRESHOLD,
  MINIMUM_BLOCKS_BEFORE_LIQUIDATION,
  OP_ETH_FEE_RAW,
} from "../common/constants.ts";
import {
  DEFAULT_POC_SEEDS,
  genBalanceMove,
  genEBMode,
  genEffectiveBalance,
  genFeePhase,
  genInitialDepositAmount,
  genPocSeedsFromEnv,
  genSafeWithdrawalAmount,
  genSolvencyTarget,
  genThresholdEdgeWithdrawalAmount,
  genTimingPlan,
  genTopology,
  genUnsafeWithdrawalAmount,
  genValidatorBucket,
  genOperatorSetSize,
  type BalanceMove,
  type EBMode,
  type FeePhase,
  type SolvencyTarget,
  type Topology,
} from "./generators.ts";
import { parseClusterFromEvent } from "./cluster.ts";
import { getValidOperatorFeeIncrease, registerOperators, whitelistAddresses } from "./operator.ts";
import { makePublicKey } from "./keys.ts";
import { setupOracles, generateMerkleForClusterEB, commitEBRoot, computeClusterId } from "./oracle.ts";
import { mineBlocks } from "./blocks.ts";
import {
  assertClusterLiquidationExpectation,
  assertFinalClusterETHConservation,
  assertOperatorEarningsLowerBound,
  getEffectiveVUnits,
} from "./eth-core-assertions.ts";
import { calcClusterBurn, calcLiquidationThreshold, calcOperatorFeeAccrual, defaultVUnits } from "./fee.ts";
import { SeededRNG } from "../simulation/rng.ts";
import {
  CoverageTracker,
  buildStateTag,
  type EBModeTag,
  type FeePhaseTag,
  type StateTag,
  type TopologyTag,
} from "../simulation/coverage.ts";

const BPS_DENOMINATOR = 10_000n;

export type ScenarioFamilyName =
  | "singleClusterLifecycle"
  | "sharedOperatorsTwoClusters"
  | "liquidationWindow"
  | "removedOperatorLiquidationRegression";

export interface PocRoles {
  operatorOwner: HardhatEthersSigner;
  clusterOwnerA: HardhatEthersSigner;
  clusterOwnerB: HardhatEthersSigner;
  liquidator: HardhatEthersSigner;
  staker: HardhatEthersSigner;
  oracles: [HardhatEthersSigner, HardhatEthersSigner, HardhatEthersSigner, HardhatEthersSigner];
}

export interface ScenarioAxes {
  operatorSetSize: 4 | 7 | 10 | 13;
  validatorCount: bigint;
  ebMode: EBMode;
  solvencyTarget: SolvencyTarget;
  feePhase: FeePhase;
  topology: Topology;
  balanceMove: BalanceMove;
  timingPlan: ReturnType<typeof genTimingPlan>;
}

export interface ScenarioCase {
  familyName: ScenarioFamilyName;
  seed: bigint;
  axes: ScenarioAxes;
  replay: string;
}

export interface ScenarioContext {
  connection: NetworkConnection<"generic">;
  networkHelpers: NetworkHelpersType;
  roles: PocRoles;
  tracker: CoverageTracker;
}

interface RuntimeClusterState {
  owner: HardhatEthersSigner;
  cluster: Cluster;
  operatorIds: number[];
  validatorKeys: string[];
  ebMode: EBModeTag;
}

interface FixtureState {
  network: any;
  views: any;
  provider: any;
  networkAddress: string;
  operatorIds: number[];
}

function normalizeBalanceMove(
  familyName: ScenarioFamilyName,
  solvencyTarget: SolvencyTarget,
  balanceMove: BalanceMove,
): BalanceMove {
  if (familyName === "liquidationWindow") {
    return solvencyTarget === "liquidatable" ? "unsafe-withdraw" : "safe-withdraw";
  }
  if (solvencyTarget === "liquidatable") {
    return "unsafe-withdraw";
  }
  if (solvencyTarget === "threshold-edge") {
    return balanceMove === "deposit" ? "safe-withdraw" : balanceMove;
  }
  return balanceMove === "unsafe-withdraw" ? "deposit" : balanceMove;
}

function normalizeEBMode(
  familyName: ScenarioFamilyName,
  solvencyTarget: SolvencyTarget,
  ebMode: EBMode,
): EBMode {
  const liquidationIntended = familyName === "liquidationWindow" || solvencyTarget !== "healthy";
  if (liquidationIntended && ebMode === "explicit-max-safe") {
    return "explicit-high";
  }
  return ebMode;
}

export function buildScenarioCase(familyName: ScenarioFamilyName, seed: bigint): ScenarioCase {
  const rng = new SeededRNG(seed);
  const topology = familyName === "sharedOperatorsTwoClusters"
    ? "dual-cluster-shared-operators"
    : genTopology(rng);
  const solvencyTarget = genSolvencyTarget(rng);
  const balanceMove = normalizeBalanceMove(familyName, solvencyTarget, genBalanceMove(rng));
  const ebMode = normalizeEBMode(familyName, solvencyTarget, genEBMode(rng));

  const axes: ScenarioAxes = {
    operatorSetSize: genOperatorSetSize(rng),
    validatorCount: genValidatorBucket(rng),
    ebMode,
    solvencyTarget,
    feePhase: genFeePhase(rng),
    topology,
    balanceMove,
    timingPlan: genTimingPlan(rng),
  };

  return {
    familyName,
    seed,
    axes,
    replay: [
      `POC_SEEDS=${seed}`,
      `family=${familyName}`,
      `operatorSetSize=${axes.operatorSetSize}`,
      `validatorCount=${axes.validatorCount}`,
      `ebMode=${axes.ebMode}`,
      `solvencyTarget=${axes.solvencyTarget}`,
      `feePhase=${axes.feePhase}`,
      `topology=${axes.topology}`,
      `balanceMove=${axes.balanceMove}`,
      `timing=${axes.timingPlan.bucket}`,
    ].join(" "),
  };
}

export function describeScenarioCase(scenarioCase: ScenarioCase): string {
  const { familyName, seed, axes } = scenarioCase;
  return `${familyName} seed=${seed} ops=${axes.operatorSetSize} validators=${axes.validatorCount} eb=${axes.ebMode} fee=${axes.feePhase} solvency=${axes.solvencyTarget} move=${axes.balanceMove}`;
}

export function getPocSeeds(): bigint[] {
  return genPocSeedsFromEnv(DEFAULT_POC_SEEDS);
}

function makeRoles(signers: HardhatEthersSigner[]): PocRoles {
  if (signers.length < 9) {
    throw new Error(`expected at least 9 signers, received ${signers.length}`);
  }
  return {
    operatorOwner: signers[0],
    clusterOwnerA: signers[1],
    clusterOwnerB: signers[2],
    liquidator: signers[3],
    staker: signers[4],
    oracles: [signers[5], signers[6], signers[7], signers[8]],
  };
}

export async function createPocRoles(
  connection: NetworkConnection<"generic">,
): Promise<PocRoles> {
  return makeRoles(await connection.ethers.getSigners());
}

async function deployPocFixture(
  connection: NetworkConnection<"generic">,
  roles: PocRoles,
  operatorCount: number,
  topology: Topology,
): Promise<FixtureState> {
  const { network, views, ssvToken } = await ssvNetworkFullFixture(connection);
  await setupOracles(network, ssvToken, roles.staker, roles.oracles);

  const operatorIds = await registerOperators(network, roles.operatorOwner, operatorCount);
  const whitelisted = topology === "dual-cluster-shared-operators"
    ? [roles.clusterOwnerA.address, roles.clusterOwnerB.address]
    : [roles.clusterOwnerA.address];
  await whitelistAddresses(network, roles.operatorOwner, operatorIds, whitelisted);

  return {
    network,
    views,
    provider: connection.ethers.provider,
    networkAddress: await network.getAddress(),
    operatorIds,
  };
}

async function advanceTime(
  provider: any,
  timingPlan: ScenarioAxes["timingPlan"],
): Promise<void> {
  if (timingPlan.seconds > 0n) {
    await provider.send("evm_increaseTime", [Number(timingPlan.seconds)]);
  }
  if (timingPlan.blocks > 0n) {
    await mineBlocks(provider, Number(timingPlan.blocks));
  } else if (timingPlan.seconds > 0n) {
    await mineBlocks(provider, 1);
  }
}

async function registerCluster(
  network: any,
  owner: HardhatEthersSigner,
  operatorIds: number[],
  validatorCount: bigint,
  deposit: bigint,
  keyBase: number,
): Promise<RuntimeClusterState> {
  let cluster = EMPTY_CLUSTER;
  const validatorKeys: string[] = [];

  for (let index = 0; index < Number(validatorCount); index++) {
    const validatorKey = makePublicKey(keyBase + index);
    const tx = await network.connect(owner).registerValidator(
      validatorKey,
      operatorIds,
      DEFAULT_SHARES,
      cluster,
      { value: index === 0 ? deposit : 0n },
    );
    const receipt = await tx.wait();
    cluster = parseClusterFromEvent(network, receipt, Events.VALIDATOR_ADDED);
    validatorKeys.push(validatorKey);
  }

  return {
    owner,
    cluster,
    operatorIds,
    validatorKeys,
    ebMode: "implicit",
  };
}

async function getTotalOperatorFeeRaw(
  views: any,
  operatorIds: number[],
): Promise<bigint> {
  let total = 0n;
  for (const operatorId of operatorIds) {
    total += BigInt(await views.getOperatorFee(BigInt(operatorId))) / ETH_DEDUCTED_DIGITS;
  }
  return total;
}

async function getClusterMath(
  views: any,
  runtimeCluster: RuntimeClusterState,
): Promise<{
  effectiveVUnits: bigint;
  totalOperatorFeeRaw: bigint;
  networkFeeRaw: bigint;
  burnPerBlock: bigint;
  liquidationThreshold: bigint;
}> {
  let effectiveVUnits: bigint;
  try {
    effectiveVUnits = await getEffectiveVUnits(
      views,
      runtimeCluster.owner.address,
      runtimeCluster.operatorIds,
      runtimeCluster.cluster,
    );
  } catch {
    effectiveVUnits = defaultVUnits(
      runtimeCluster.cluster.validatorCount === 0n ? 1n : runtimeCluster.cluster.validatorCount,
    );
  }
  const totalOperatorFeeRaw = await getTotalOperatorFeeRaw(views, runtimeCluster.operatorIds);
  const networkFeeRaw = BigInt(await views.getNetworkFee()) / ETH_DEDUCTED_DIGITS;
  const minimumBlocksBeforeLiquidation = BigInt(await views.getLiquidationThresholdPeriod());
  const burnPerBlock = (((totalOperatorFeeRaw + networkFeeRaw) * effectiveVUnits) / BPS_DENOMINATOR) * ETH_DEDUCTED_DIGITS;
  const blockBasedThreshold =
    (((minimumBlocksBeforeLiquidation * (totalOperatorFeeRaw + networkFeeRaw)) * effectiveVUnits) / BPS_DENOMINATOR) *
    ETH_DEDUCTED_DIGITS;
  const minimumCollateral = BigInt(await views.getMinimumLiquidationCollateral());
  const liquidationThreshold = blockBasedThreshold > minimumCollateral ? blockBasedThreshold : minimumCollateral;

  return {
    effectiveVUnits,
    totalOperatorFeeRaw,
    networkFeeRaw,
    burnPerBlock,
    liquidationThreshold,
  };
}

async function getLiveClusterBalance(
  views: any,
  runtimeCluster: RuntimeClusterState,
): Promise<bigint> {
  if (!runtimeCluster.cluster.active) {
    return runtimeCluster.cluster.balance;
  }

  return BigInt(
    await views.getBalance(
      runtimeCluster.owner.address,
      runtimeCluster.operatorIds.map((id) => BigInt(id)),
      runtimeCluster.cluster,
    ),
  );
}

async function captureTag(
  views: any,
  runtimeCluster: RuntimeClusterState,
  feePhase: FeePhaseTag,
  topology: TopologyTag,
  lastAction: string,
): Promise<StateTag> {
  const { liquidationThreshold } = await getClusterMath(views, runtimeCluster);
  return buildStateTag({
    cluster: runtimeCluster.cluster,
    operatorCount: runtimeCluster.operatorIds.length,
    liquidationThreshold,
    ebMode: runtimeCluster.ebMode,
    feePhase,
    topology,
    lastAction,
  });
}

async function recordTransition(
  tracker: CoverageTracker,
  scenarioCase: ScenarioCase,
  views: any,
  runtimeCluster: RuntimeClusterState,
  feePhase: FeePhaseTag,
  topology: TopologyTag,
  actionName: string,
  mutate: () => Promise<void>,
): Promise<void> {
  const preTag = await captureTag(views, runtimeCluster, feePhase, topology, `before-${actionName}`);
  try {
    await mutate();
  } catch (error) {
    if (error instanceof Error) {
      error.message = `[step:${actionName}] ${error.message}`;
      throw error;
    }
    throw new Error(`[step:${actionName}] ${String(error)}`);
  }
  const postTag = await captureTag(views, runtimeCluster, feePhase, topology, actionName);
  tracker.recordTransition({
    family: scenarioCase.familyName,
    seed: scenarioCase.seed,
    action: actionName,
    preTag,
    postTag,
  });
}

async function applyExplicitEBUpdateWithOracles(
  connection: NetworkConnection<"generic">,
  fixture: FixtureState,
  oracles: PocRoles["oracles"],
  scenarioCase: ScenarioCase,
  runtimeCluster: RuntimeClusterState,
): Promise<void> {
  const effectiveBalance = genEffectiveBalance(
    new SeededRNG(scenarioCase.seed + 1n),
    runtimeCluster.cluster.validatorCount,
    scenarioCase.axes.ebMode,
  );
  if (effectiveBalance === undefined) {
    runtimeCluster.ebMode = "implicit";
    return;
  }

  const clusterId = computeClusterId(runtimeCluster.owner.address, runtimeCluster.operatorIds);
  const { root, proofs } = generateMerkleForClusterEB(connection, [
    {
      clusterId,
      effectiveBalance: Number(effectiveBalance),
    },
  ]);

  await mineBlocks(fixture.provider, 1);
  const blockNumber = await fixture.provider.getBlockNumber();
  await commitEBRoot(fixture.network, root, blockNumber, oracles.slice(0, 3));

  const tx = await fixture.network.connect(runtimeCluster.owner).updateClusterBalance(
    blockNumber,
    runtimeCluster.owner.address,
    runtimeCluster.operatorIds,
    runtimeCluster.cluster,
    Number(effectiveBalance),
    proofs[clusterId] ?? [],
  );
  const receipt = await tx.wait();
  runtimeCluster.cluster = parseClusterFromEvent(
    fixture.network,
    receipt,
    Events.CLUSTER_BALANCE_UPDATED,
  );
  runtimeCluster.ebMode = scenarioCase.axes.ebMode;
}

async function applyFixedExplicitEBUpdateWithOracles(
  connection: NetworkConnection<"generic">,
  fixture: FixtureState,
  oracles: PocRoles["oracles"],
  runtimeCluster: RuntimeClusterState,
  effectiveBalance: bigint,
  mode: EBModeTag,
): Promise<void> {
  const clusterId = computeClusterId(runtimeCluster.owner.address, runtimeCluster.operatorIds);
  const { root, proofs } = generateMerkleForClusterEB(connection, [
    {
      clusterId,
      effectiveBalance: Number(effectiveBalance),
    },
  ]);

  await mineBlocks(fixture.provider, 1);
  const blockNumber = await fixture.provider.getBlockNumber();
  await commitEBRoot(fixture.network, root, blockNumber, oracles.slice(0, 3));

  const tx = await fixture.network.connect(runtimeCluster.owner).updateClusterBalance(
    blockNumber,
    runtimeCluster.owner.address,
    runtimeCluster.operatorIds,
    runtimeCluster.cluster,
    Number(effectiveBalance),
    proofs[clusterId] ?? [],
  );
  const receipt = await tx.wait();
  runtimeCluster.cluster = parseClusterFromEvent(
    fixture.network,
    receipt,
    Events.CLUSTER_BALANCE_UPDATED,
  );
  runtimeCluster.ebMode = mode;
}

async function removeOperatorFromCluster(
  fixture: FixtureState,
  operatorOwner: HardhatEthersSigner,
  operatorId: number,
): Promise<void> {
  const tx = await fixture.network.connect(operatorOwner).removeOperator(operatorId);
  await tx.wait();
}

async function applyFeePhase(
  fixture: FixtureState,
  roles: PocRoles,
  runtimeCluster: RuntimeClusterState,
  feePhase: FeePhase,
): Promise<FeePhaseTag> {
  if (feePhase === "flat") {
    return "flat";
  }

  const newFee = await getValidOperatorFeeIncrease(fixture.views, BigInt(runtimeCluster.operatorIds[0]));
  await fixture.network.connect(roles.operatorOwner).declareOperatorFee(
    runtimeCluster.operatorIds[0],
    newFee,
  );

  if (feePhase === "declared") {
    return "declared";
  }

  await fixture.provider.send("evm_increaseTime", [Number(DECLARE_OPERATOR_FEE_PERIOD + 1n)]);
  await mineBlocks(fixture.provider, 1);
  await fixture.network.connect(roles.operatorOwner).executeOperatorFee(runtimeCluster.operatorIds[0]);
  return "executed";
}

async function depositToCluster(
  fixture: FixtureState,
  runtimeCluster: RuntimeClusterState,
  amount: bigint,
): Promise<void> {
  const tx = await fixture.network.connect(runtimeCluster.owner).deposit(
    runtimeCluster.owner.address,
    runtimeCluster.operatorIds,
    runtimeCluster.cluster,
    { value: amount },
  );
  const receipt = await tx.wait();
  runtimeCluster.cluster = parseClusterFromEvent(fixture.network, receipt, Events.CLUSTER_DEPOSITED);
}

async function withdrawFromCluster(
  fixture: FixtureState,
  runtimeCluster: RuntimeClusterState,
  amount: bigint,
): Promise<void> {
  const tx = await fixture.network.connect(runtimeCluster.owner).withdraw(
    runtimeCluster.operatorIds,
    amount,
    runtimeCluster.cluster,
  );
  const receipt = await tx.wait();
  runtimeCluster.cluster = parseClusterFromEvent(fixture.network, receipt, Events.CLUSTER_WITHDRAWN);
}

async function canWithdrawAmount(
  fixture: FixtureState,
  runtimeCluster: RuntimeClusterState,
  amount: bigint,
): Promise<boolean> {
  try {
    await fixture.network.connect(runtimeCluster.owner).withdraw.staticCall(
      runtimeCluster.operatorIds,
      amount,
      runtimeCluster.cluster,
    );
    return true;
  } catch {
    return false;
  }
}

async function findMaxSafeWithdrawalAmount(
  fixture: FixtureState,
  runtimeCluster: RuntimeClusterState,
): Promise<bigint> {
  const liveBalance = await getLiveClusterBalance(fixture.views, runtimeCluster);
  let low = 0n;
  let high = liveBalance;

  while (low < high) {
    const mid = (low + high + 1n) / 2n;
    if (await canWithdrawAmount(fixture, runtimeCluster, mid)) {
      low = mid;
    } else {
      high = mid - 1n;
    }
  }

  return low;
}

async function findBufferedSafeWithdrawalAmount(
  fixture: FixtureState,
  runtimeCluster: RuntimeClusterState,
): Promise<bigint> {
  let maxSafeAmount = await findMaxSafeWithdrawalAmount(fixture, runtimeCluster);
  if (maxSafeAmount <= 0n) {
    const math = await getClusterMath(fixture.views, runtimeCluster);
    const liveBalance = await getLiveClusterBalance(fixture.views, runtimeCluster);
    const targetBalance = math.liquidationThreshold + (math.burnPerBlock > 0n ? math.burnPerBlock * 8n : 1n);
    const topUp = targetBalance > liveBalance ? targetBalance - liveBalance : 1n;
    await depositToCluster(fixture, runtimeCluster, topUp);
    maxSafeAmount = await findMaxSafeWithdrawalAmount(fixture, runtimeCluster);
  }

  if (maxSafeAmount <= 0n) {
    throw new Error("failed to derive a safe withdrawal amount");
  }

  const { burnPerBlock } = await getClusterMath(fixture.views, runtimeCluster);
  const buffer = burnPerBlock > 0n ? burnPerBlock : 1n;

  if (maxSafeAmount > buffer) {
    return maxSafeAmount - buffer;
  }
  if (maxSafeAmount > 1n) {
    return maxSafeAmount - 1n;
  }
  return maxSafeAmount;
}

async function liquidateCluster(
  fixture: FixtureState,
  runtimeCluster: RuntimeClusterState,
  liquidator: HardhatEthersSigner,
): Promise<void> {
  const tx = await fixture.network.connect(liquidator).liquidate(
    runtimeCluster.owner.address,
    runtimeCluster.operatorIds,
    runtimeCluster.cluster,
  );
  const receipt = await tx.wait();
  runtimeCluster.cluster = parseClusterFromEvent(fixture.network, receipt, Events.CLUSTER_LIQUIDATED);
}

async function reactivateCluster(
  fixture: FixtureState,
  scenarioCase: ScenarioCase,
  runtimeCluster: RuntimeClusterState,
): Promise<void> {
  const amount = (BigInt(runtimeCluster.operatorIds.length) * 100n * 10n ** 18n);
  const tx = await fixture.network.connect(runtimeCluster.owner).reactivate(
    runtimeCluster.operatorIds,
    runtimeCluster.cluster,
    { value: amount },
  );
  const receipt = await tx.wait();
  runtimeCluster.cluster = parseClusterFromEvent(fixture.network, receipt, Events.CLUSTER_REACTIVATED);
}

async function finalizeClusterAssertions(
  fixture: FixtureState,
  runtimeCluster: RuntimeClusterState,
  expected: "healthy" | "threshold-edge" | "liquidatable" | "liquidated",
): Promise<void> {
  await assertClusterLiquidationExpectation(
    fixture.views,
    runtimeCluster.owner.address,
    runtimeCluster.operatorIds,
    runtimeCluster.cluster,
    expected,
  );
  if (expected !== "liquidated") {
    expect(runtimeCluster.cluster.validatorCount).to.be.greaterThan(0n);
  }
}

async function mineUntilLiquidatable(
  fixture: FixtureState,
  runtimeCluster: RuntimeClusterState,
): Promise<void> {
  const liquidatableNow = await fixture.views.isLiquidatable(
    runtimeCluster.owner.address,
    runtimeCluster.operatorIds.map((id) => BigInt(id)),
    runtimeCluster.cluster,
  );
  if (Boolean(liquidatableNow)) {
    return;
  }

  const math = await getClusterMath(fixture.views, runtimeCluster);
  if (math.burnPerBlock === 0n) {
    throw new Error("cannot advance to liquidatable state when burnPerBlock is zero");
  }

  const liveBalance = await getLiveClusterBalance(fixture.views, runtimeCluster);
  const gap = liveBalance > math.liquidationThreshold ? liveBalance - math.liquidationThreshold : 0n;
  const blocksNeeded = Number(gap / math.burnPerBlock + 1n);

  await mineBlocks(fixture.provider, Math.max(1, blocksNeeded));

  const extraBudget = Math.max(1_024, Math.min(Math.max(1, blocksNeeded) * 4, 200_000));
  let minedExtra = 0;
  let chunkSize = 256;

  while (minedExtra <= extraBudget) {
    const liquidatable = await fixture.views.isLiquidatable(
      runtimeCluster.owner.address,
      runtimeCluster.operatorIds.map((id) => BigInt(id)),
      runtimeCluster.cluster,
    );
    if (Boolean(liquidatable)) {
      return;
    }
    const nextChunk = Math.min(chunkSize, extraBudget - minedExtra);
    if (nextChunk <= 0) {
      break;
    }
    await mineBlocks(fixture.provider, nextChunk);
    minedExtra += nextChunk;
    chunkSize = Math.min(chunkSize * 2, 8_192);
  }

  throw new Error("cluster did not become liquidatable within the bounded mining window");
}

async function runSingleClusterLifecycle(
  context: ScenarioContext,
  scenarioCase: ScenarioCase,
): Promise<void> {
  const fixture = await deployPocFixture(
    context.connection,
    context.roles,
    scenarioCase.axes.operatorSetSize,
    "single-cluster",
  );
  const thresholdSeed = new SeededRNG(scenarioCase.seed + 2n);
  const bootstrapCluster: RuntimeClusterState = {
    owner: context.roles.clusterOwnerA,
    cluster: EMPTY_CLUSTER,
    operatorIds: fixture.operatorIds,
    validatorKeys: [],
    ebMode: "implicit",
  };
  const bootstrapMath = await getClusterMath(fixture.views, {
    ...bootstrapCluster,
    cluster: {
      ...EMPTY_CLUSTER,
      validatorCount: scenarioCase.axes.validatorCount,
    },
  });
  const initialDeposit = genInitialDepositAmount(
    thresholdSeed,
    bootstrapMath.liquidationThreshold,
    scenarioCase.axes.solvencyTarget,
  );
  const runtimeCluster = await registerCluster(
    fixture.network,
    context.roles.clusterOwnerA,
    fixture.operatorIds,
    scenarioCase.axes.validatorCount,
    initialDeposit,
    Number(scenarioCase.seed % 10_000n) + 1,
  );

  let currentFeePhase: FeePhaseTag = "flat";

  await recordTransition(
    context.tracker,
    scenarioCase,
    fixture.views,
    runtimeCluster,
    currentFeePhase,
    "single-cluster",
    "register",
    async () => {},
  );

  if (scenarioCase.axes.ebMode !== "implicit") {
    await recordTransition(
      context.tracker,
      scenarioCase,
      fixture.views,
      runtimeCluster,
      currentFeePhase,
      "single-cluster",
      "updateClusterBalance",
      async () => {
        await applyExplicitEBUpdateWithOracles(
          context.connection,
          fixture,
          context.roles.oracles,
          scenarioCase,
          runtimeCluster,
        );
      },
    );
  }

  currentFeePhase = await applyFeePhase(
    fixture,
    context.roles,
    runtimeCluster,
    scenarioCase.axes.feePhase,
  );

  await recordTransition(
    context.tracker,
    scenarioCase,
    fixture.views,
    runtimeCluster,
    currentFeePhase,
    "single-cluster",
    currentFeePhase === "flat" ? "flatFeePhase" : "feePhaseChange",
    async () => {},
  );

  await advanceTime(fixture.provider, scenarioCase.axes.timingPlan);

  const math = await getClusterMath(fixture.views, runtimeCluster);
  const liveBalance = await getLiveClusterBalance(fixture.views, runtimeCluster);
  if (currentFeePhase === "executed") {
    const currentFeeRaw = BigInt(await fixture.views.getOperatorFee(BigInt(runtimeCluster.operatorIds[0]))) / ETH_DEDUCTED_DIGITS;
    const lowerBound = calcOperatorFeeAccrual(1n, currentFeeRaw, math.effectiveVUnits) * ETH_DEDUCTED_DIGITS;
    await assertOperatorEarningsLowerBound(
      fixture.views,
      BigInt(runtimeCluster.operatorIds[0]),
      lowerBound,
    );
  }

  if (scenarioCase.axes.balanceMove === "deposit") {
    await recordTransition(
      context.tracker,
      scenarioCase,
      fixture.views,
      runtimeCluster,
      currentFeePhase,
      "single-cluster",
      "deposit",
      async () => {
        await depositToCluster(
          fixture,
          runtimeCluster,
          genInitialDepositAmount(new SeededRNG(scenarioCase.seed + 50n), math.liquidationThreshold, "healthy"),
        );
      },
    );
    await finalizeClusterAssertions(fixture, runtimeCluster, "healthy");
  } else if (scenarioCase.axes.balanceMove === "safe-withdraw") {
    const amount = scenarioCase.axes.solvencyTarget === "threshold-edge"
      ? await findBufferedSafeWithdrawalAmount(fixture, runtimeCluster)
      : genSafeWithdrawalAmount(
        new SeededRNG(scenarioCase.seed + 51n),
        liveBalance,
        math.liquidationThreshold,
      );

    await recordTransition(
      context.tracker,
      scenarioCase,
      fixture.views,
      runtimeCluster,
      currentFeePhase,
      "single-cluster",
      "withdraw",
      async () => {
        await withdrawFromCluster(fixture, runtimeCluster, amount);
      },
    );

    const expected = scenarioCase.axes.solvencyTarget === "threshold-edge"
      ? "threshold-edge"
      : "healthy";
    await finalizeClusterAssertions(fixture, runtimeCluster, expected);

    if (scenarioCase.axes.solvencyTarget === "threshold-edge") {
      await mineUntilLiquidatable(fixture, runtimeCluster);
      await finalizeClusterAssertions(fixture, runtimeCluster, "liquidatable");
      await recordTransition(
        context.tracker,
        scenarioCase,
        fixture.views,
        runtimeCluster,
        currentFeePhase,
        "single-cluster",
        "liquidate",
        async () => {
          await liquidateCluster(fixture, runtimeCluster, context.roles.liquidator);
        },
      );
      await finalizeClusterAssertions(fixture, runtimeCluster, "liquidated");
    }
  } else {
    const amount = await findBufferedSafeWithdrawalAmount(fixture, runtimeCluster);
    await recordTransition(
      context.tracker,
      scenarioCase,
      fixture.views,
      runtimeCluster,
      currentFeePhase,
      "single-cluster",
      "unsafeWithdraw",
      async () => {
        await withdrawFromCluster(fixture, runtimeCluster, amount);
      },
    );
    await finalizeClusterAssertions(fixture, runtimeCluster, "threshold-edge");
    await mineUntilLiquidatable(fixture, runtimeCluster);
    await finalizeClusterAssertions(fixture, runtimeCluster, "liquidatable");
    await recordTransition(
      context.tracker,
      scenarioCase,
      fixture.views,
      runtimeCluster,
      currentFeePhase,
      "single-cluster",
      "liquidate",
        async () => {
          await liquidateCluster(fixture, runtimeCluster, context.roles.liquidator);
        },
      );
    await finalizeClusterAssertions(fixture, runtimeCluster, "liquidated");
  }

  await assertFinalClusterETHConservation({
    networkAddress: fixture.networkAddress,
    provider: fixture.provider,
    views: fixture.views,
    trackedClusters: [
      {
        owner: runtimeCluster.owner.address,
        operatorIds: runtimeCluster.operatorIds.map((id) => BigInt(id)),
        cluster: runtimeCluster.cluster,
      },
    ],
  });
}

async function runSharedOperatorsTwoClusters(
  context: ScenarioContext,
  scenarioCase: ScenarioCase,
): Promise<void> {
  const fixture = await deployPocFixture(
    context.connection,
    context.roles,
    scenarioCase.axes.operatorSetSize,
    "dual-cluster-shared-operators",
  );

  const bootstrapA = await getClusterMath(fixture.views, {
    owner: context.roles.clusterOwnerA,
    cluster: {
      ...EMPTY_CLUSTER,
      validatorCount: scenarioCase.axes.validatorCount,
    },
    operatorIds: fixture.operatorIds,
    validatorKeys: [],
    ebMode: "implicit",
  });
  const bootstrapB = await getClusterMath(fixture.views, {
    owner: context.roles.clusterOwnerB,
    cluster: {
      ...EMPTY_CLUSTER,
      validatorCount: 1n,
    },
    operatorIds: fixture.operatorIds,
    validatorKeys: [],
    ebMode: "implicit",
  });

  const clusterA = await registerCluster(
    fixture.network,
    context.roles.clusterOwnerA,
    fixture.operatorIds,
    scenarioCase.axes.validatorCount,
    genInitialDepositAmount(new SeededRNG(scenarioCase.seed + 60n), bootstrapA.liquidationThreshold, "healthy"),
    Number(scenarioCase.seed % 10_000n) + 100,
  );
  const clusterB = await registerCluster(
    fixture.network,
    context.roles.clusterOwnerB,
    fixture.operatorIds,
    1n,
    genInitialDepositAmount(new SeededRNG(scenarioCase.seed + 61n), bootstrapB.liquidationThreshold, "healthy"),
    Number(scenarioCase.seed % 10_000n) + 500,
  );

  let currentFeePhase: FeePhaseTag = "flat";

  await recordTransition(context.tracker, scenarioCase, fixture.views, clusterA, currentFeePhase, "dual-cluster-shared-operators", "register-cluster-a", async () => {});
  await recordTransition(context.tracker, scenarioCase, fixture.views, clusterB, currentFeePhase, "dual-cluster-shared-operators", "register-cluster-b", async () => {});

  if (scenarioCase.axes.ebMode !== "implicit") {
    await recordTransition(
      context.tracker,
      scenarioCase,
      fixture.views,
      clusterA,
      currentFeePhase,
      "dual-cluster-shared-operators",
      "updateClusterBalance",
      async () => {
        await applyExplicitEBUpdateWithOracles(
          context.connection,
          fixture,
          context.roles.oracles,
          scenarioCase,
          clusterA,
        );
      },
    );
  }

  currentFeePhase = await applyFeePhase(fixture, context.roles, clusterA, scenarioCase.axes.feePhase);
  await advanceTime(fixture.provider, scenarioCase.axes.timingPlan);

  const mathA = await getClusterMath(fixture.views, clusterA);
  const liveBalanceA = await getLiveClusterBalance(fixture.views, clusterA);
  await recordTransition(
    context.tracker,
    scenarioCase,
    fixture.views,
    clusterA,
    currentFeePhase,
    "dual-cluster-shared-operators",
    "cluster-a-balance-move",
    async () => {
      if (scenarioCase.axes.balanceMove === "deposit") {
        await depositToCluster(fixture, clusterA, genInitialDepositAmount(new SeededRNG(scenarioCase.seed + 62n), mathA.liquidationThreshold, "healthy"));
      } else {
        await withdrawFromCluster(
          fixture,
          clusterA,
          genSafeWithdrawalAmount(new SeededRNG(scenarioCase.seed + 63n), liveBalanceA, mathA.liquidationThreshold),
        );
      }
    },
  );

  await recordTransition(
    context.tracker,
    scenarioCase,
    fixture.views,
    clusterB,
    currentFeePhase,
    "dual-cluster-shared-operators",
    "cluster-b-diverge",
    async () => {
      const unsafeAmount = await findBufferedSafeWithdrawalAmount(fixture, clusterB);
      await withdrawFromCluster(fixture, clusterB, unsafeAmount);
    },
  );

  await finalizeClusterAssertions(fixture, clusterA, "healthy");
  await finalizeClusterAssertions(fixture, clusterB, "threshold-edge");
  await mineUntilLiquidatable(fixture, clusterB);
  await finalizeClusterAssertions(fixture, clusterB, "liquidatable");

  await recordTransition(
    context.tracker,
    scenarioCase,
    fixture.views,
    clusterB,
    currentFeePhase,
    "dual-cluster-shared-operators",
    "liquidate",
    async () => {
      await liquidateCluster(fixture, clusterB, context.roles.liquidator);
    },
  );

  const operatorData = await fixture.views.getOperatorById(BigInt(fixture.operatorIds[0]));
  expect(BigInt(operatorData.validatorCount)).to.be.greaterThanOrEqual(clusterA.cluster.validatorCount);

  await assertFinalClusterETHConservation({
    networkAddress: fixture.networkAddress,
    provider: fixture.provider,
    views: fixture.views,
    trackedClusters: [
      {
        owner: clusterA.owner.address,
        operatorIds: clusterA.operatorIds.map((id) => BigInt(id)),
        cluster: clusterA.cluster,
      },
      {
        owner: clusterB.owner.address,
        operatorIds: clusterB.operatorIds.map((id) => BigInt(id)),
        cluster: clusterB.cluster,
      },
    ],
  });
}

async function runLiquidationWindow(
  context: ScenarioContext,
  scenarioCase: ScenarioCase,
): Promise<void> {
  const fixture = await deployPocFixture(
    context.connection,
    context.roles,
    scenarioCase.axes.operatorSetSize,
    "single-cluster",
  );

  const bootstrapMath = await getClusterMath(fixture.views, {
    owner: context.roles.clusterOwnerA,
    cluster: {
      ...EMPTY_CLUSTER,
      validatorCount: scenarioCase.axes.validatorCount,
    },
    operatorIds: fixture.operatorIds,
    validatorKeys: [],
    ebMode: "implicit",
  });

  const runtimeCluster = await registerCluster(
    fixture.network,
    context.roles.clusterOwnerA,
    fixture.operatorIds,
    scenarioCase.axes.validatorCount,
    genInitialDepositAmount(new SeededRNG(scenarioCase.seed + 70n), bootstrapMath.liquidationThreshold, "healthy"),
    Number(scenarioCase.seed % 10_000n) + 1000,
  );

  if (scenarioCase.axes.ebMode !== "implicit") {
    await recordTransition(
      context.tracker,
      scenarioCase,
      fixture.views,
      runtimeCluster,
      "flat",
      "single-cluster",
      "updateClusterBalance",
      async () => {
        await applyExplicitEBUpdateWithOracles(
          context.connection,
          fixture,
          context.roles.oracles,
          scenarioCase,
          runtimeCluster,
        );
      },
    );
  }

  const amount = await findBufferedSafeWithdrawalAmount(fixture, runtimeCluster);

  await recordTransition(
    context.tracker,
    scenarioCase,
    fixture.views,
    runtimeCluster,
    "flat",
    "single-cluster",
    scenarioCase.axes.solvencyTarget === "liquidatable" ? "unsafeWithdraw" : "thresholdWithdraw",
    async () => {
      await withdrawFromCluster(fixture, runtimeCluster, amount);
    },
  );

  await finalizeClusterAssertions(fixture, runtimeCluster, "threshold-edge");
  await mineUntilLiquidatable(fixture, runtimeCluster);
  await finalizeClusterAssertions(fixture, runtimeCluster, "liquidatable");

  await recordTransition(
    context.tracker,
    scenarioCase,
    fixture.views,
    runtimeCluster,
    "flat",
    "single-cluster",
    "liquidate",
    async () => {
      await liquidateCluster(fixture, runtimeCluster, context.roles.liquidator);
    },
  );
  await finalizeClusterAssertions(fixture, runtimeCluster, "liquidated");
  await assertFinalClusterETHConservation({
    networkAddress: fixture.networkAddress,
    provider: fixture.provider,
    views: fixture.views,
    trackedClusters: [
      {
        owner: runtimeCluster.owner.address,
        operatorIds: runtimeCluster.operatorIds.map((id) => BigInt(id)),
        cluster: runtimeCluster.cluster,
      },
    ],
  });
}

export async function runSeededReactivationRegression(
  context: ScenarioContext,
  seed: bigint = 9001n,
): Promise<void> {
  const scenarioCase: ScenarioCase = {
    familyName: "liquidationWindow",
    seed,
    replay: `POC_SEEDS=${seed} family=seeded-reactivation-regression`,
    axes: {
      operatorSetSize: 4,
      validatorCount: 1n,
      ebMode: "implicit",
      solvencyTarget: "liquidatable",
      feePhase: "flat",
      topology: "single-cluster",
      balanceMove: "unsafe-withdraw",
      timingPlan: genTimingPlan(new SeededRNG(seed), "same-block"),
    },
  };

  const fixture = await deployPocFixture(
    context.connection,
    context.roles,
    4,
    "single-cluster",
  );
  await fixture.network.updateNetworkFee(DEFAULT_NETWORK_FEE_UNPACKED);
  await fixture.network.updateMinimumLiquidationCollateral(0n);

  const vUnits = defaultVUnits(1n);
  const burnPerBlock = calcClusterBurn({
    blockDiff: 1n,
    numOperators: 4n,
    ethFee: OP_ETH_FEE_RAW,
    networkFee: DEFAULT_NETWORK_FEE_RAW,
    effectiveVUnits: vUnits,
  });
  const liquidationThreshold = calcLiquidationThreshold({
    minimumBlocksBeforeLiquidation: MINIMAL_LIQUIDATION_THRESHOLD,
    numOperators: 4n,
    ethFee: OP_ETH_FEE_RAW,
    networkFee: DEFAULT_NETWORK_FEE_RAW,
    effectiveVUnits: vUnits,
  });
  const deposit = liquidationThreshold + burnPerBlock * 5n;
  const runtimeCluster = await registerCluster(
    fixture.network,
    context.roles.clusterOwnerA,
    fixture.operatorIds,
    1n,
    deposit,
    20_001,
  );

  await recordTransition(
    context.tracker,
    scenarioCase,
    fixture.views,
    runtimeCluster,
    "flat",
    "single-cluster",
    "register",
    async () => {},
  );

  const blocksUntilLiquidatable = Number((deposit - liquidationThreshold) / burnPerBlock);
  await mineBlocks(fixture.provider, blocksUntilLiquidatable);

  await recordTransition(
    context.tracker,
    scenarioCase,
    fixture.views,
    runtimeCluster,
    "flat",
    "single-cluster",
    "liquidate",
    async () => {
      await liquidateCluster(fixture, runtimeCluster, context.roles.liquidator);
    },
  );

  await mineBlocks(fixture.provider, 76);

  await recordTransition(
    context.tracker,
    scenarioCase,
    fixture.views,
    runtimeCluster,
    "flat",
    "single-cluster",
    "reactivate",
    async () => {
      const tx = await fixture.network.connect(runtimeCluster.owner).reactivate(
        runtimeCluster.operatorIds,
        runtimeCluster.cluster,
        { value: context.connection.ethers.parseEther("5") },
      );
      const receipt = await tx.wait();
      runtimeCluster.cluster = parseClusterFromEvent(
        fixture.network,
        receipt,
        Events.CLUSTER_REACTIVATED,
      );
    },
  );

  await finalizeClusterAssertions(fixture, runtimeCluster, "healthy");
}

export async function runRemovedOperatorLiquidationRegression(
  context: ScenarioContext,
  operatorSetSize: 4 | 7 | 10 | 13,
  seed: bigint = 21n,
): Promise<void> {
  const scenarioCase: ScenarioCase = {
    familyName: "removedOperatorLiquidationRegression",
    seed,
    replay: `POC_SEEDS=${seed} regression=BUG-21 operatorSetSize=${operatorSetSize}`,
    axes: {
      operatorSetSize,
      validatorCount: 1n,
      ebMode: "explicit-high",
      solvencyTarget: "liquidatable",
      feePhase: "flat",
      topology: "single-cluster",
      balanceMove: "unsafe-withdraw",
      timingPlan: genTimingPlan(new SeededRNG(seed), "same-block"),
    },
  };

  const fixture = await deployPocFixture(
    context.connection,
    context.roles,
    operatorSetSize,
    "single-cluster",
  );
  const bootstrapCluster: RuntimeClusterState = {
    owner: context.roles.clusterOwnerA,
    cluster: {
      ...EMPTY_CLUSTER,
      validatorCount: 1n,
    },
    operatorIds: fixture.operatorIds,
    validatorKeys: [],
    ebMode: "implicit",
  };
  const bootstrapMath = await getClusterMath(fixture.views, bootstrapCluster);
  const initialDeposit = bootstrapMath.liquidationThreshold + bootstrapMath.burnPerBlock * 8n;

  const runtimeCluster = await registerCluster(
    fixture.network,
    context.roles.clusterOwnerA,
    fixture.operatorIds,
    1n,
    initialDeposit,
    Number(seed % 10_000n) + 30_001,
  );

  await fixture.network.updateNetworkFee(100_000n * ETH_DEDUCTED_DIGITS);
  await fixture.network.updateLiquidationThresholdPeriod(MINIMAL_LIQUIDATION_THRESHOLD);
  await fixture.network.updateMinimumLiquidationCollateral(0n);

  await recordTransition(
    context.tracker,
    scenarioCase,
    fixture.views,
    runtimeCluster,
    "flat",
    "single-cluster",
    "register",
    async () => {},
  );

  await recordTransition(
    context.tracker,
    scenarioCase,
    fixture.views,
    runtimeCluster,
    "flat",
    "single-cluster",
    "updateClusterBalance",
    async () => {
      await applyFixedExplicitEBUpdateWithOracles(
        context.connection,
        fixture,
        context.roles.oracles,
        runtimeCluster,
        64n * runtimeCluster.cluster.validatorCount,
        "explicit-high",
      );
    },
  );

  const removedOperatorId = fixture.operatorIds[0];
  await recordTransition(
    context.tracker,
    scenarioCase,
    fixture.views,
    runtimeCluster,
    "flat",
    "single-cluster",
    "removeOperator",
    async () => {
      await removeOperatorFromCluster(
        fixture,
        context.roles.operatorOwner,
        removedOperatorId,
      );
    },
  );

  const removedOperator = await fixture.views.getOperatorById(BigInt(removedOperatorId));
  expect(removedOperator[5]).to.equal(false, "removed operator should be inactive");
  await mineUntilLiquidatable(fixture, runtimeCluster);
  await finalizeClusterAssertions(fixture, runtimeCluster, "liquidatable");

  await recordTransition(
    context.tracker,
    scenarioCase,
    fixture.views,
    runtimeCluster,
    "flat",
    "single-cluster",
    "liquidate",
    async () => {
      await liquidateCluster(fixture, runtimeCluster, context.roles.liquidator);
    },
  );

  await finalizeClusterAssertions(fixture, runtimeCluster, "liquidated");
  await assertFinalClusterETHConservation({
    networkAddress: fixture.networkAddress,
    provider: fixture.provider,
    views: fixture.views,
    trackedClusters: [
      {
        owner: runtimeCluster.owner.address,
        operatorIds: runtimeCluster.operatorIds.map((id) => BigInt(id)),
        cluster: runtimeCluster.cluster,
      },
    ],
  });
}

export async function runScenarioCase(
  context: ScenarioContext,
  scenarioCase: ScenarioCase,
): Promise<void> {
  try {
    if (scenarioCase.familyName === "singleClusterLifecycle") {
      await runSingleClusterLifecycle(context, scenarioCase);
    } else if (scenarioCase.familyName === "sharedOperatorsTwoClusters") {
      await runSharedOperatorsTwoClusters(context, scenarioCase);
    } else {
      await runLiquidationWindow(context, scenarioCase);
    }
  } catch (error) {
    const prefix = `[${describeScenarioCase(scenarioCase)}] replay: ${scenarioCase.replay}`;
    if (error instanceof Error) {
      error.message = `${prefix}\n${error.message}`;
      throw error;
    }
    throw new Error(`${prefix}\n${String(error)}`);
  }
}

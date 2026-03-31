/**
 * Monte Carlo Upgrade Simulation
 *
 * Stress-tests the SSV Network v2.0.0 upgrade (ETH payments, effective balance,
 * SSV staking) on a mainnet fork under randomized workloads.
 *
 * Guard: only runs when RUN_FORK=true — will not execute in normal CI.
 */

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { ethers } from "ethers";

import { ssvNetworkFullForkedFixture } from "../setup/fixtures.ts";
import { getForkedConnection } from "../setup/fork.ts";
import {
  EMPTY_CLUSTER,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  STAKE_AMOUNT,
  DECLARE_OPERATOR_FEE_PERIOD,
  EXECUTE_OPERATOR_FEE_PERIOD,
  MINIMAL_OPERATOR_ETH_FEE,
  ETH_DEDUCTED_DIGITS
} from "../common/constants.ts";
import { makePublicKey, makeOperatorKey } from "../common/helpers.ts";

import type {
  SimulationState,
  ClusterRecord,
  OperatorRecord,
  StakerRecord,
  ActionResult,
} from "./types.ts";
import { VERSION_SSV, VERSION_ETH } from "./types.ts";
import { SeededRNG } from "./rng.ts";
import { SimLogger } from "./sim-logger.ts";
import {
  clusterKey,
  parseClusterFromReceipt,
  updateClusterFromReceipt,
  trackEthFlow,
  emptyTotals,
} from "./bookkeeping.ts";
import {
  discoverOperators,
  discoverClusters,
  sampleOperators,
} from "./state-discovery.ts";
import {
  runPeriodicInvariants,
  runFinalInvariants,
  createInvariantContext,
  type InvariantResult,
  type InvariantContext,
} from "./invariants.ts";
import {
  CoverageTracker,
  buildStateTag,
  type TopologyTag,
} from "./coverage.ts";
import { WeightedActionSelector } from "./actions/index.ts";
import { calcVUnits, defaultVUnits } from "../helpers/fee.ts";

async function mineBlocks(provider: any, n: number): Promise<void> {
  if (n <= 0) return;
  await provider.send("hardhat_mine", ["0x" + n.toString(16)]);
}

async function provisionStakers(
  connection: NetworkConnection<"generic">,
  fixture: Awaited<ReturnType<typeof ssvNetworkFullForkedFixture>>,
  count: number,
): Promise<StakerRecord[]> {
  const allSigners = await connection.ethers.getSigners();
  const signers = allSigners.slice(10, 10 + count);

  if (signers.length < count) {
    throw new Error(`Not enough signers for ${count} stakers (have ${signers.length})`);
  }

  const networkAddr = await fixture.network.getAddress();
  const ssvTokenAddr = await fixture.ssvToken.getAddress();

  const stakerRecords: StakerRecord[] = [];

  for (const signer of signers) {
    await connection.ethers.provider.send("hardhat_setBalance", [
      signer.address,
      "0x" + (BigInt(100e18)).toString(16),
    ]);
    const ssvAmount = connection.ethers.parseEther("100000");
    const tokenOwner = await fixture.ssvToken.owner();
    await connection.ethers.provider.send("hardhat_impersonateAccount", [tokenOwner]);
    await connection.ethers.provider.send("hardhat_setBalance", [
      tokenOwner,
      "0x" + BigInt(1e18).toString(16),
    ]);
    const ownerSigner = await connection.ethers.getSigner(tokenOwner);
    await fixture.ssvToken.connect(ownerSigner).mint(signer.address, ssvAmount);
    await connection.ethers.provider.send("hardhat_stopImpersonatingAccount", [tokenOwner]);
    await fixture.ssvToken.connect(signer).approve(networkAddr, ethers.MaxUint256);

    stakerRecords.push({
      signer,
      cssvBalance: 0n,
      pendingRequests: [],
    });
  }

  return stakerRecords;
}

async function registerSimOperators(
  network: any,
  owner: HardhatEthersSigner,
  count: number,
  startSeed: number,
): Promise<OperatorRecord[]> {
  const records: OperatorRecord[] = [];
  for (let i = 0; i < count; i++) {
    const key = makeOperatorKey(startSeed + i);
    try {
      const id = await network.connect(owner).registerOperator.staticCall(
        key,
        MINIMAL_OPERATOR_ETH_FEE,
        false,
      );
      await network.connect(owner).registerOperator(key, MINIMAL_OPERATOR_ETH_FEE, false);
      records.push({
        id: BigInt(id),
        owner: owner.address,
        ownerSigner: owner,
        fee: MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS,
        initialFee: MINIMAL_OPERATOR_ETH_FEE / ETH_DEDUCTED_DIGITS,
        isActive: true,
      });
    } catch {
    }
  }
  return records;
}

function cloneClusterRecord(record: ClusterRecord): ClusterRecord {
  return {
    ...record,
    operatorIds: [...record.operatorIds],
    validatorKeys: [...record.validatorKeys],
    cluster: { ...record.cluster },
  };
}

function snapshotClusterBook(clusterBook: Map<string, ClusterRecord>): Map<string, ClusterRecord> {
  return new Map(
    [...clusterBook.entries()].map(([key, record]) => [key, cloneClusterRecord(record)]),
  );
}

function inferTopology(
  clusterBook: Map<string, ClusterRecord>,
  target: ClusterRecord,
): TopologyTag {
  for (const record of clusterBook.values()) {
    if (
      record.owner !== target.owner &&
      record.version === VERSION_ETH &&
      record.operatorIds.length === target.operatorIds.length &&
      record.operatorIds.every((id, index) => id === target.operatorIds[index])
    ) {
      return "dual-cluster-shared-operators";
    }
  }
  return "single-cluster";
}

async function getClusterLiquidationThreshold(
  state: SimulationState,
  record: ClusterRecord,
): Promise<bigint> {
  let effectiveBalance = 0n;
  try {
    effectiveBalance = BigInt(
      await state.views.getEffectiveBalance(record.owner, record.operatorIds, record.cluster),
    );
  } catch {
  }
  const effectiveVUnits = effectiveBalance === 0n
    ? defaultVUnits(record.cluster.validatorCount === 0n ? 1n : record.cluster.validatorCount)
    : calcVUnits(effectiveBalance);

  let totalOperatorFeeRaw = 0n;
  for (const operatorId of record.operatorIds) {
    try {
      totalOperatorFeeRaw += BigInt(await state.views.getOperatorFee(operatorId)) / ETH_DEDUCTED_DIGITS;
    } catch {
    }
  }

  const networkFeeRaw = BigInt(await state.views.getNetworkFee()) / ETH_DEDUCTED_DIGITS;
  const minBlocks = BigInt(await state.views.getLiquidationThresholdPeriod());
  const minCollateral = BigInt(await state.views.getMinimumLiquidationCollateral());
  const blockThreshold =
    ((minBlocks * (totalOperatorFeeRaw + networkFeeRaw) * effectiveVUnits) / 10_000n) * ETH_DEDUCTED_DIGITS;

  return blockThreshold > minCollateral ? blockThreshold : minCollateral;
}

async function captureCoverageTag(
  state: SimulationState,
  clusterBook: Map<string, ClusterRecord>,
  record: ClusterRecord,
  actionName: string,
) {
  const threshold = await getClusterLiquidationThreshold(state, record);
  let feePhase: "flat" | "declared" | "executed" = "flat";

  for (const operatorId of record.operatorIds) {
    try {
      const declared = await state.views.getOperatorDeclaredFee(operatorId);
      if (declared.isFeeDeclared) {
        feePhase = "declared";
        break;
      }
    } catch {
    }
  }

  if (feePhase === "flat") {
    for (const operatorId of record.operatorIds) {
      const tracked = state.operatorPool.get(operatorId);
      if (!tracked) {
        continue;
      }
      try {
        const currentFeeRaw = BigInt(await state.views.getOperatorFee(operatorId)) / ETH_DEDUCTED_DIGITS;
        if (currentFeeRaw !== tracked.initialFee) {
          feePhase = "executed";
          break;
        }
      } catch {
      }
    }
  }

  return buildStateTag({
    cluster: record.cluster,
    operatorCount: record.operatorIds.length,
    liquidationThreshold: threshold,
    ebMode: record.ebModeHint ?? "implicit",
    feePhase,
    topology: inferTopology(clusterBook, record),
    lastAction: actionName,
  });
}

async function recordCoverageTransition(
  tracker: CoverageTracker,
  state: SimulationState,
  preSnapshot: Map<string, ClusterRecord>,
  result: ActionResult,
): Promise<void> {
  const targetKey = result.clusterKeyUpdated;
  if (!targetKey) {
    return;
  }

  const postRecord = state.clusterBook.get(targetKey);
  const preRecord = preSnapshot.get(targetKey);
  const reference = postRecord ?? preRecord;
  if (!reference || reference.version !== VERSION_ETH) {
    return;
  }

  const preTag = await captureCoverageTag(
    state,
    preSnapshot,
    preRecord ?? {
      ...cloneClusterRecord(reference),
      cluster: { ...EMPTY_CLUSTER, active: true },
      ebModeHint: reference.ebModeHint ?? "implicit",
    },
    `before-${result.name}`,
  );
  const postTag = await captureCoverageTag(
    state,
    state.clusterBook,
    postRecord ?? reference,
    result.name,
  );

  tracker.recordTransition({
    family: "fork-simulation",
    seed: state.rng.getInitialSeed(),
    action: result.name,
    preTag,
    postTag,
  });
}

async function actionEthDeposit(state: SimulationState): Promise<ActionResult> {
  const ethClusters = [...state.clusterBook.entries()].filter(
    ([, c]) => c.version === VERSION_ETH && c.cluster.active,
  );
  if (ethClusters.length === 0) return { name: "ethDeposit", success: true };

  const [, record] = state.rng.pick(ethClusters);
  const amount = state.rng.nextInRange(
    ethers.parseEther("0.1"),
    ethers.parseEther("1"),
  );

  try {
    await state.provider.send("hardhat_impersonateAccount", [record.owner]);
    await state.provider.send("hardhat_setBalance", [
      record.owner,
      "0x" + (amount + BigInt(1e18)).toString(16),
    ]);
    const ownerSigner = record.ownerSigner;

    const tx = await state.network.connect(ownerSigner).deposit(
      record.owner,
      record.operatorIds,
      record.cluster,
      { value: amount },
    );
    const receipt = await tx.wait();
    const updated = parseClusterFromReceipt(state.network, receipt, "ClusterDeposited");
    if (updated) {
      record.cluster = updated;
      trackEthFlow(state, "in", amount);
    }

    return { name: "ethDeposit", success: true };
  } catch (err) {
    return { name: "ethDeposit", success: false, revertReason: String(err).slice(0, 120) };
  }
}

async function actionEthWithdraw(state: SimulationState): Promise<ActionResult> {
  const ethClusters = [...state.clusterBook.entries()].filter(
    ([, c]) => c.version === VERSION_ETH && c.cluster.active && c.cluster.balance > 0n,
  );
  if (ethClusters.length === 0) return { name: "ethWithdraw", success: true };

  const [, record] = state.rng.pick(ethClusters);

  try {
    const currentBalance = BigInt(
      await state.views.getBalance(record.owner, record.operatorIds, record.cluster),
    );
    if (currentBalance <= 0n) return { name: "ethWithdraw", success: true };

    const pct = Number(state.rng.nextInRange(10n, 50n));
    const amount = (currentBalance * BigInt(pct)) / 100n;
    if (amount === 0n) return { name: "ethWithdraw", success: true };

    await state.provider.send("hardhat_impersonateAccount", [record.owner]);
    await state.provider.send("hardhat_setBalance", [
      record.owner,
      "0x" + BigInt(1e18).toString(16),
    ]);

    const tx = await state.network.connect(record.ownerSigner).withdraw(
      record.operatorIds,
      amount,
      record.cluster,
    );
    const receipt = await tx.wait();
    const updated = parseClusterFromReceipt(state.network, receipt, "ClusterWithdrawn");
    if (updated) {
      record.cluster = updated;
      trackEthFlow(state, "out", amount);
    }

    return { name: "ethWithdraw", success: true };
  } catch (err) {
    return { name: "ethWithdraw", success: false, revertReason: String(err).slice(0, 120) };
  }
}

async function actionEthRegisterValidator(state: SimulationState): Promise<ActionResult> {
  const ethClusters = [...state.clusterBook.entries()].filter(
    ([, c]) => c.version === VERSION_ETH && c.cluster.active,
  );
  if (ethClusters.length === 0) return { name: "ethRegisterValidator", success: true };

  const [, record] = state.rng.pick(ethClusters);
  const keySeed = state.currentBlock + Number(state.rng.next() % 1000000n);
  const pubkey = makePublicKey(keySeed);

  try {
    await state.provider.send("hardhat_impersonateAccount", [record.owner]);
    await state.provider.send("hardhat_setBalance", [
      record.owner,
      "0x" + (DEFAULT_ETH_REGISTER_VALUE + BigInt(1e18)).toString(16),
    ]);

    const tx = await state.network.connect(record.ownerSigner).registerValidator(
      pubkey,
      record.operatorIds,
      DEFAULT_SHARES,
      record.cluster,
      { value: DEFAULT_ETH_REGISTER_VALUE },
    );
    const receipt = await tx.wait();
    const updated = parseClusterFromReceipt(state.network, receipt, "ValidatorAdded");
    if (updated) {
      record.cluster = updated;
      record.validatorKeys.push(pubkey);
      trackEthFlow(state, "in", DEFAULT_ETH_REGISTER_VALUE);
    }

    return { name: "ethRegisterValidator", success: true };
  } catch (err) {
    return { name: "ethRegisterValidator", success: false, revertReason: String(err).slice(0, 120) };
  }
}

async function actionMigrateClusterToETH(state: SimulationState): Promise<ActionResult> {
  const ssvClusters = [...state.clusterBook.entries()].filter(
    ([, c]) => c.version === VERSION_SSV && c.cluster.active,
  );
  if (ssvClusters.length === 0) return { name: "migrateClusterToETH", success: true };

  const [key, record] = state.rng.pick(ssvClusters);

  try {
    const validatorCount = Number(record.cluster.validatorCount);
    const minEth = ethers.parseEther("0.01") * BigInt(Math.max(validatorCount, 1));

    await state.provider.send("hardhat_impersonateAccount", [record.owner]);
    await state.provider.send("hardhat_setBalance", [
      record.owner,
      "0x" + (minEth + BigInt(10e18)).toString(16),
    ]);

    const tx = await state.network.connect(record.ownerSigner).migrateClusterToETH(
      record.operatorIds,
      record.cluster,
      { value: minEth },
    );
    const receipt = await tx.wait();
    const updated = parseClusterFromReceipt(state.network, receipt, "ClusterMigratedToETH");
    if (updated) {
      record.cluster = updated;
      record.version = VERSION_ETH;
      trackEthFlow(state, "in", minEth);
    }

    return { name: "migrateClusterToETH", success: true, clusterKeyUpdated: key };
  } catch (err) {
    return { name: "migrateClusterToETH", success: false, revertReason: String(err).slice(0, 120) };
  }
}

async function actionStake(state: SimulationState): Promise<ActionResult> {
  if (state.stakerPool.length === 0) return { name: "stake", success: true };

  const staker = state.rng.pick(state.stakerPool);

  try {
    const ssvBalance = BigInt(await state.ssvToken.balanceOf(staker.signer.address));
    if (ssvBalance < STAKE_AMOUNT) return { name: "stake", success: true };

    const tx = await state.network.connect(staker.signer).stake(STAKE_AMOUNT);
    await tx.wait();

    staker.cssvBalance = BigInt(await state.cssvToken.balanceOf(staker.signer.address));

    return { name: "stake", success: true };
  } catch (err) {
    return { name: "stake", success: false, revertReason: String(err).slice(0, 120) };
  }
}

async function actionRequestUnstake(state: SimulationState): Promise<ActionResult> {
  if (state.stakerPool.length === 0) return { name: "requestUnstake", success: true };

  const staker = state.rng.pick(state.stakerPool);

  try {
    const cssvBalance = BigInt(await state.cssvToken.balanceOf(staker.signer.address));
    if (cssvBalance === 0n) return { name: "requestUnstake", success: true };

    const pct = Number(state.rng.nextInRange(10n, 50n));
    const amount = (cssvBalance * BigInt(pct)) / 100n;
    if (amount === 0n) return { name: "requestUnstake", success: true };

    const tx = await state.network.connect(staker.signer).requestUnstake(amount);
    await tx.wait();

    staker.cssvBalance = BigInt(await state.cssvToken.balanceOf(staker.signer.address));

    return { name: "requestUnstake", success: true };
  } catch (err) {
    return { name: "requestUnstake", success: false, revertReason: String(err).slice(0, 120) };
  }
}

async function actionClaimEthRewards(state: SimulationState): Promise<ActionResult> {
  if (state.stakerPool.length === 0) return { name: "claimEthRewards", success: true };

  const staker = state.rng.pick(state.stakerPool);

  try {
    const claimable = BigInt(await state.views.previewClaimableEth(staker.signer.address));
    if (claimable === 0n) return { name: "claimEthRewards", success: true };

    const tx = await state.network.connect(staker.signer).claimEthRewards();
    await tx.wait();

    return { name: "claimEthRewards", success: true };
  } catch (err) {
    return { name: "claimEthRewards", success: false, revertReason: String(err).slice(0, 120) };
  }
}

async function actionEthLiquidate(state: SimulationState): Promise<ActionResult> {
  const ethClusters = [...state.clusterBook.entries()].filter(
    ([, c]) => c.version === VERSION_ETH && c.cluster.active,
  );
  if (ethClusters.length === 0) return { name: "ethLiquidate", success: true };

  const [, record] = state.rng.pick(ethClusters);

  try {
    const isLiquidatable = await state.views.isLiquidatable(
      record.owner,
      record.operatorIds,
      record.cluster,
    );
    if (!isLiquidatable) return { name: "ethLiquidate", success: true };

    const liquidator = state.rng.pick(state.stakerPool);
    const tx = await state.network.connect(liquidator.signer).liquidate(
      record.owner,
      record.operatorIds,
      record.cluster,
    );
    const receipt = await tx.wait();
    const updated = parseClusterFromReceipt(state.network, receipt, "ClusterLiquidated");
    if (updated) record.cluster = updated;

    return { name: "ethLiquidate", success: true };
  } catch (err) {
    return { name: "ethLiquidate", success: false, revertReason: String(err).slice(0, 120) };
  }
}

async function actionSyncFees(state: SimulationState): Promise<ActionResult> {
  if (state.stakerPool.length === 0) return { name: "syncFees", success: true };

  try {
    const signer = state.rng.pick(state.stakerPool);
    const tx = await state.network.connect(signer.signer).syncFees();
    await tx.wait();
    return { name: "syncFees", success: true };
  } catch (err) {
    return { name: "syncFees", success: false, revertReason: String(err).slice(0, 120) };
  }
}

async function actionMineBlocks(state: SimulationState): Promise<ActionResult> {
  const blocks = Number(state.rng.nextInRange(10n, 100n));
  await mineBlocks(state.provider, blocks);
  return { name: "mineBlocks", success: true };
}

const ACTION_DISPATCH: Record<string, (state: SimulationState) => Promise<ActionResult>> = {
  ethDeposit: actionEthDeposit,
  ethWithdraw: actionEthWithdraw,
  ethRegisterValidator: actionEthRegisterValidator,
  ethRemoveValidator: async (s) => ({ name: "ethRemoveValidator", success: true }),
  ethLiquidate: actionEthLiquidate,
  ethReactivate: async (s) => ({ name: "ethReactivate", success: true }),
  ssvDeposit: async (s) => ({ name: "ssvDeposit", success: true }),
  ssvWithdraw: async (s) => ({ name: "ssvWithdraw", success: true }),
  ssvLiquidate: async (s) => ({ name: "ssvLiquidate", success: true }),
  ssvRegisterValidator: async (s) => ({ name: "ssvRegisterValidator", success: true }),
  migrateClusterToETH: actionMigrateClusterToETH,
  commitRoot: async (s) => ({ name: "commitRoot", success: true }),
  updateClusterBalance: async (s) => ({ name: "updateClusterBalance", success: true }),
  stake: actionStake,
  requestUnstake: actionRequestUnstake,
  claimEthRewards: actionClaimEthRewards,
  syncFees: actionSyncFees,
  mineBlocks: actionMineBlocks,
};

async function forceMigrateRemaining(state: SimulationState): Promise<void> {
  const ssvClusters = [...state.clusterBook.entries()].filter(
    ([, c]) => c.version === VERSION_SSV && c.cluster.active,
  );

  for (const [key, record] of ssvClusters) {
    try {
      const validatorCount = Number(record.cluster.validatorCount);
      const minEth = ethers.parseEther("0.01") * BigInt(Math.max(validatorCount, 1));

      await state.provider.send("hardhat_impersonateAccount", [record.owner]);
      await state.provider.send("hardhat_setBalance", [
        record.owner,
        "0x" + (minEth + BigInt(10e18)).toString(16),
      ]);

      const tx = await state.network.connect(record.ownerSigner).migrateClusterToETH(
        record.operatorIds,
        record.cluster,
        { value: minEth },
      );
      const receipt = await tx.wait();
      const updated = parseClusterFromReceipt(state.network, receipt, "ClusterMigratedToETH");
      if (updated) {
        record.cluster = updated;
        record.version = VERSION_ETH;
        trackEthFlow(state, "in", minEth);
      }
    } catch (err) {
      console.warn(`  [forceMigrate] Failed for cluster ${key}: ${String(err).slice(0, 80)}`);
    }
  }
}

async function exhaustPendingFees(state: SimulationState): Promise<void> {
  const totalPeriod = Number(DECLARE_OPERATOR_FEE_PERIOD + EXECUTE_OPERATOR_FEE_PERIOD);
  await mineBlocks(state.provider, totalPeriod + 100);
}

function shouldExhaustPendingFees(state: SimulationState): boolean {
  if (process.env.SIM_EXHAUST_PENDING_FEES === "true") {
    return true;
  }

  const byAction = state.logger.summary().byAction;
  return (byAction.declareOperatorFee?.attempted ?? 0) > 0 || (byAction.executeOperatorFee?.attempted ?? 0) > 0;
}

async function claimAllRewards(state: SimulationState): Promise<void> {
  for (const staker of state.stakerPool) {
    try {
      const claimable = BigInt(await state.views.previewClaimableEth(staker.signer.address));
      if (claimable > 0n) {
        const tx = await state.network.connect(staker.signer).claimEthRewards();
        await tx.wait();
      }
    } catch {
    }

    try {
      const pending = await state.views.pendingUnstake(staker.signer.address);
      if (pending.length > 0) {
        const tx = await state.network.connect(staker.signer).withdrawUnlocked();
        await tx.wait();
      }
    } catch {
    }
  }
}

const RUN_FORK = process.env.RUN_FORK === "true";
const DEFAULT_SIM_TIMEOUT_MS = 30 * 60 * 1000;
const SIM_TIMEOUT_MS = Number(process.env.SIM_TIMEOUT_MS ?? DEFAULT_SIM_TIMEOUT_MS);

(RUN_FORK ? describe : describe.skip)("Monte Carlo Upgrade Simulation", function () {
  this.timeout(SIM_TIMEOUT_MS);

  let state: SimulationState;
  let invCtx: InvariantContext;
  let coverage: CoverageTracker;
  let selector: WeightedActionSelector;
  const replayLog: string[] = [];

  before(async function () {
    console.log("[SIM] Setting up forked environment...");
    const { connection } = await getForkedConnection();
    const provider = connection.ethers.provider;
    console.log("[SIM] Deploying v2.0.0 upgrade...");
    const fixture = await ssvNetworkFullForkedFixture(connection);
    const networkAddress = await fixture.network.getAddress();
    const rng = new SeededRNG();
    const logger = new SimLogger();
    coverage = new CoverageTracker();
    selector = new WeightedActionSelector();
    console.log(`[SIM] Seed: ${rng.getInitialSeed()}`);
    const [deployer, operatorOwner] = await connection.ethers.getSigners();
    await provider.send("hardhat_setBalance", [
      operatorOwner.address,
      "0x" + BigInt(100e18).toString(16),
    ]);
    console.log("[SIM] Registering simulation operators...");
    const simOpRecords = await registerSimOperators(fixture.network, operatorOwner, 8, 9000);
    if (simOpRecords.length < 4) {
      throw new Error(`Failed to register enough operators: got ${simOpRecords.length}`);
    }
    console.log("[SIM] Discovering mainnet operators...");
    const currentBlock = await provider.getBlockNumber();
    const scanFrom = Math.max(0, currentBlock - 50_000);
    let sampledOps: Awaited<ReturnType<typeof sampleOperators>> = [];
    try {
      const discovered = await discoverOperators(
        provider,
        connection.ethers,
        networkAddress,
        scanFrom,
        currentBlock,
      );
      console.log(`[SIM] Discovered ${discovered.size} operators`);
      sampledOps = await sampleOperators(discovered, fixture.views, 20, rng);
      console.log(`[SIM] Sampled ${sampledOps.length} active mainnet operators`);
    } catch (err) {
      console.warn(`[SIM] Operator discovery failed (${String(err).slice(0, 120)}); continuing with synthetic operators only`);
    }
    const operatorPool = new Map<bigint, OperatorRecord>();
    for (const rec of simOpRecords) {
      operatorPool.set(rec.id, rec);
    }
    for (const sampled of sampledOps) {
      await provider.send("hardhat_impersonateAccount", [sampled.owner]);
      await provider.send("hardhat_setBalance", [
        sampled.owner,
        "0x" + BigInt(10e18).toString(16),
      ]);
      const ownerSigner = await connection.ethers.getSigner(sampled.owner);
      operatorPool.set(sampled.id, { ...sampled, ownerSigner });
    }
    console.log("[SIM] Provisioning stakers...");
    const stakerPool = await provisionStakers(connection, fixture, 8);
    console.log("[SIM] Bootstrapping cSSV supply...");
    const bootstrapStaker = stakerPool[0];
    await fixture.ssvToken.connect(bootstrapStaker.signer).approve(networkAddress, ethers.MaxUint256);
    const stakeTx = await fixture.network.connect(bootstrapStaker.signer).stake(STAKE_AMOUNT);
    await stakeTx.wait();
    bootstrapStaker.cssvBalance = BigInt(
      await fixture.cssvToken.balanceOf(bootstrapStaker.signer.address),
    );
    console.log(`[SIM] Initial cSSV supply: ${await fixture.cssvToken.totalSupply()}`);
    const clusterBook = new Map<string, ClusterRecord>();

    console.log("[SIM] Discovering legacy clusters...");
    try {
      const discoveredClusters = await discoverClusters(
        provider,
        connection.ethers,
        networkAddress,
        scanFrom,
        currentBlock,
      );
      const sampledClusters = rng
        .shuffle(
          [...discoveredClusters.values()].filter(
            (cluster) => cluster.operatorIds.length > 0 && cluster.validatorCount > 0,
          ),
        )
        .slice(0, 8);

      for (const discovered of sampledClusters) {
        await provider.send("hardhat_impersonateAccount", [discovered.owner]);
        await provider.send("hardhat_setBalance", [
          discovered.owner,
          "0x" + BigInt(10e18).toString(16),
        ]);
        const ownerSigner = await connection.ethers.getSigner(discovered.owner);
        const key = clusterKey(connection.ethers, discovered.owner, discovered.operatorIds);
        clusterBook.set(key, {
          owner: discovered.owner,
          ownerSigner,
          operatorIds: discovered.operatorIds,
          cluster: { ...discovered.lastClusterTuple },
          version: VERSION_SSV,
          validatorKeys: [],
        });
      }
      console.log(`[SIM] Seeded ${sampledClusters.length} legacy clusters from fork state`);
    } catch (err) {
      console.warn(`[SIM] Cluster discovery failed (${String(err).slice(0, 120)}); continuing with synthetic ETH clusters only`);
    }

    console.log("[SIM] Creating synthetic clusters...");
    const simOpIds = simOpRecords.map((r) => r.id);

    const opGroups = [
      simOpIds.slice(0, 4),
      simOpIds.slice(4, 8),
    ].filter((g) => g.length === 4);

    for (const opGroup of opGroups) {
      for (let i = 0; i < 3; i++) {
        const staker = rng.pick(stakerPool);
        const keySeed = currentBlock + Number(rng.next() % 1000000n);
        const validatorKey = makePublicKey(keySeed);

        try {
          const tx = await fixture.network.connect(staker.signer).registerValidator(
            validatorKey,
            opGroup,
            DEFAULT_SHARES,
            EMPTY_CLUSTER,
            { value: DEFAULT_ETH_REGISTER_VALUE },
          );
          const receipt = await tx.wait();
          const cluster = parseClusterFromReceipt(fixture.network, receipt, "ValidatorAdded");

          if (cluster) {
            const key = clusterKey(connection.ethers, staker.signer.address, opGroup);
            clusterBook.set(key, {
              owner: staker.signer.address,
              ownerSigner: staker.signer,
              operatorIds: opGroup,
              cluster,
              version: VERSION_ETH,
              validatorKeys: [validatorKey],
            });
          }
        } catch (err) {
          console.warn(`[SIM] Failed to register cluster: ${String(err).slice(0, 80)}`);
        }
      }
    }
    console.log(`[SIM] Tracking ${clusterBook.size} total clusters after synthetic bootstrap`);
    const startBlock = await provider.getBlockNumber();

    const oracleAddresses = [
      "0xc61f7bd9ee5a3d011caf47aa0e5411f720593920",
      "0xc07332e05cec1c4896555a6d10361233fdf14422",
      "0x28bEa5B242362974d5DDb8f17a1E0e525446960B",
      "0x3A98EE5f80268Ed91F8A5880d93468b76a9F3bB4",
    ];
    const daoAddress = await fixture.daoSigner.getAddress();
    await provider.send("hardhat_impersonateAccount", [daoAddress]);
    await provider.send("hardhat_setBalance", [
      daoAddress,
      "0x" + (100n * 10n ** 18n).toString(16),
    ]);
    const daoSigner = await connection.ethers.getImpersonatedSigner(daoAddress);
    const oracleSigners = await Promise.all(
      oracleAddresses.map((addr) => connection.ethers.getImpersonatedSigner(addr))
    );
    for (let i = 0; i < oracleSigners.length; i++) {
      const oracleAddr = await oracleSigners[i].getAddress();
      await provider.send("hardhat_setBalance", [
        oracleAddr,
        "0x" + (10n ** 18n).toString(16),
      ]);
      try {
        const tx = await fixture.network.connect(daoSigner).replaceOracle(i + 1, oracleAddr);
        await tx.wait();
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (!message.includes("OracleAlreadyExists") && !message.includes("already")) {
          throw err;
        }
      }
    }

    state = {
      network: fixture.network,
      views: fixture.views,
      provider,
      rng,
      logger,
      clusterBook,
      operatorPool,
      stakerPool,
      totals: emptyTotals(),
      startBlock,
      currentBlock: startBlock,
      networkAddress,
      ssvToken: fixture.ssvToken,
      cssvToken: fixture.cssvToken,
      oracleSigners,
    };
    invCtx = createInvariantContext();
    try {
      invCtx.prevAccEthPerShare = BigInt(await fixture.views.accEthPerShare());
    } catch {
      invCtx.prevAccEthPerShare = 0n;
    }

    console.log("[SIM] Setup complete.");
  });

  it("runs 30-day simulation without invariant violations", async function () {
    const BLOCKS_PER_DAY = 7200;
    const TARGET_DAYS = 30;
    const TARGET_BLOCKS = TARGET_DAYS * BLOCKS_PER_DAY;
    const ACTIONS_PER_EPOCH = 20;
    const INVARIANT_CHECK_EVERY = 5;
    const BLOCKS_PER_EPOCH_MIN = 150;
    const BLOCKS_PER_EPOCH_MAX = 500;

    let epoch = 0;

    const printFailureContext = (results: InvariantResult[]) => {
      const failing = results.filter((result) => !result.passed);
      const forkBlock =
        process.env.FORK_BLOCK_NUMBER === undefined || process.env.FORK_BLOCK_NUMBER === ""
          ? "<latest>"
          : process.env.FORK_BLOCK_NUMBER;

      console.error(`[SIM] Reproduce: RUN_FORK=true SIMULATION_SEED=${state.rng.getInitialSeed()} FORK_BLOCK_NUMBER=${forkBlock} npx hardhat test test/simulation/monte-carlo.test.ts`);
      console.error(`[SIM] Invariant failure at epoch=${epoch} block=${state.currentBlock}`);
      console.error(`[SIM] Failed invariants: ${JSON.stringify(failing, null, 2)}`);
      console.error(coverage.formatReport(`[SIM] Coverage at failure seed=${state.rng.getInitialSeed()}`));
      console.error(`[SIM] Replay tail (${replayLog.length} entries): ${replayLog.join(" | ")}`);
      console.error(state.logger.formatRecent(25));
    };

    console.log(`[SIM] Starting simulation at block ${state.startBlock}`);
    console.log(`[SIM] Target: ${TARGET_DAYS} days (${TARGET_BLOCKS} blocks)`);
    {
      const legacyTotal = [...state.clusterBook.values()].filter(
        (c) => c.version === VERSION_SSV,
      ).length;
      const legacyActive = [...state.clusterBook.values()].filter(
        (c) => c.version === VERSION_SSV && c.cluster.active,
      ).length;
      const ethTotal = [...state.clusterBook.values()].filter(
        (c) => c.version === VERSION_ETH,
      ).length;
      console.log(
        `[SIM] Initial clusters | ` +
          `Legacy: ${legacyTotal} total / ${legacyActive} active | ` +
          `ETH: ${ethTotal}`,
      );
    }

    while (true) {
      for (let i = 0; i < ACTIONS_PER_EPOCH; i++) {
        const preSnapshot = snapshotClusterBook(state.clusterBook);
        const selected = selector.selectAction(state, state.currentBlock, state.startBlock);
        const result = await selected.action(state);
        state.logger.record(state.currentBlock, result);
        replayLog.push(
          `${state.currentBlock}:${selected.name}:${result.success ? "ok" : "revert"}:${state.rng.getState()}`,
        );
        if (replayLog.length > 64) {
          replayLog.shift();
        }
        await recordCoverageTransition(coverage, state, preSnapshot, result);
      }
      const blocksToMine = Number(state.rng.nextInRange(
        BigInt(BLOCKS_PER_EPOCH_MIN),
        BigInt(BLOCKS_PER_EPOCH_MAX),
      ));
      await mineBlocks(state.provider, blocksToMine);
      state.currentBlock = await state.provider.getBlockNumber();
      epoch++;

      if (epoch % INVARIANT_CHECK_EVERY === 0) {
        const results = await runPeriodicInvariants(state, invCtx);
        const failed = results.filter((result) => !result.passed);
        if (failed.length > 0) {
          printFailureContext(results);
        }

        for (const r of results) {
          expect(r.passed, r.message).to.be.true;
        }
        const elapsed = state.currentBlock - state.startBlock;
        const pct = Math.floor((elapsed * 100) / TARGET_BLOCKS);
        const legacyTotal = [...state.clusterBook.values()].filter(
          (c) => c.version === VERSION_SSV,
        ).length;
        const legacyActive = [...state.clusterBook.values()].filter(
          (c) => c.version === VERSION_SSV && c.cluster.active,
        ).length;
        const ethTotal = [...state.clusterBook.values()].filter(
          (c) => c.version === VERSION_ETH,
        ).length;
        console.log(
          `[SIM] Epoch ${epoch} | Block ${state.currentBlock} | ${pct}% | ` +
            `Clusters: ${state.clusterBook.size} | ` +
            `Legacy: ${legacyTotal} total / ${legacyActive} active | ` +
            `ETH: ${ethTotal} | Invariants: all passed`,
        );
      }
      const elapsed = state.currentBlock - state.startBlock;
      const allMigrated = [...state.clusterBook.values()].every(
        (c) => c.version === VERSION_ETH || !c.cluster.active,
      );
      if (allMigrated && elapsed >= TARGET_BLOCKS) {
        console.log("[SIM] Target reached — all clusters migrated.");
        break;
      }
      if (elapsed >= TARGET_BLOCKS * 2) {
        console.log("[SIM] Hard limit reached.");
        break;
      }
    }
    console.log("[SIM] Running final invariant checks at target...");
    const finals = await runFinalInvariants(state, invCtx);
    const failedFinals = finals.filter((result) => !result.passed);
    if (failedFinals.length > 0) {
      printFailureContext(finals);
    }

    for (const r of finals) {
      expect(r.passed, r.message).to.be.true;
    }

    console.log(coverage.formatReport(`[SIM] Coverage seed=${state.rng.getInitialSeed()}`));
    console.log(`[SIM] Replay tail (${replayLog.length} entries): ${replayLog.join(" | ")}`);
    console.log(state.logger.formatSummary());

    console.log("[SIM] Running post-validation cleanup...");

    console.log("[SIM]   Force-migrating remaining SSV clusters...");
    await forceMigrateRemaining(state);

    if (shouldExhaustPendingFees(state)) {
      console.log("[SIM]   Exhausting pending fee declarations...");
      await exhaustPendingFees(state);
    } else {
      console.log("[SIM]   Skipping fee-declaration exhaustion (no tracked fee declaration actions)");
    }

    console.log("[SIM]   Claiming all rewards...");
    await claimAllRewards(state);
  });
});

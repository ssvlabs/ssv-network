/**
 * Full Migration Simulation — All 1,397 Mainnet Clusters
 *
 * Forks Ethereum mainnet, upgrades to v2.0.0, loads ALL clusters from cache,
 * then migrates them in waves from SSV→ETH. Between waves, runs scenario picks
 * against mixed (migrated + unmigrated) state. After 100% migration, runs
 * post-migration scenario picks and final invariants.
 *
 * Guard: only runs when RUN_MIGRATION_SIM=true.
 *
 * Usage:
 *   FORK_BLOCK_NUMBER=24737260 RUN_MIGRATION_SIM=true npx hardhat test test/simulation/migration-sim.test.ts --network hardhat_forked
 *   FORK_BLOCK_NUMBER=24737260 RUN_MIGRATION_SIM=true MIGRATION_BATCH_SIZE=100 SCENARIOS_PER_WAVE=10 POST_MIGRATION_PICKS=20 npx hardhat test test/simulation/migration-sim.test.ts --network hardhat_forked
 */

import * as fs from "fs";
import * as path from "path";
import { fileURLToPath } from "url";
import { expect } from "chai";
import { ethers } from "ethers";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import type { SSVNetwork, SSVNetworkViews } from "../../types/ethers-contracts/index.js";

import { ssvNetworkFullForkedFixture } from "../setup/fixtures.ts";
import { getForkedConnection } from "../setup/fork.ts";
import {
  STAKE_AMOUNT,
  MINIMAL_OPERATOR_ETH_FEE,
} from "../common/constants.ts";
import { makeOperatorKey } from "../helpers/keys.ts";

import type {
  SimulationState,
  ClusterRecord,
  OperatorRecord,
  StakerRecord,
} from "./types.ts";
import { VERSION_SSV, VERSION_ETH } from "./types.ts";
import { SeededRNG } from "./rng.ts";
import { SimLogger } from "./sim-logger.ts";
import {
  parseClusterFromReceipt,
  trackEthFlow,
  emptyTotals,
} from "./bookkeeping.ts";
import {
  createInvariantContext,
  runFinalInvariants,
  type InvariantContext,
} from "./invariants.ts";
import { ScenarioRunner, type ScenarioPickInfo } from "./scenario-runner.ts";
import { ALL_SCENARIOS } from "../scenarios/index.ts";
import {
  sampleOperators,
  type DiscoveredCluster,
} from "./state-discovery.ts";

// --- Guard ---

const RUN_MIGRATION_SIM = process.env.RUN_MIGRATION_SIM === "true";

// --- Configuration ---

const MIGRATION_BATCH_SIZE = parseInt(process.env.MIGRATION_BATCH_SIZE ?? "50", 10);
const SCENARIOS_PER_WAVE = parseInt(process.env.SCENARIOS_PER_WAVE ?? "20", 10);
const POST_MIGRATION_PICKS = parseInt(process.env.POST_MIGRATION_PICKS ?? "100", 10);

// --- Cache loading (copied from scenario-mc-fork.test.ts) ---

const __filename_esm = fileURLToPath(import.meta.url);
const __dirname_esm = path.dirname(__filename_esm);
const CACHE_DIR = path.join(__dirname_esm, "output");

interface CachedOperator {
  id: string;
  owner: string;
  fee: string;
  isActive: boolean;
}

interface CachedCluster {
  key: string;
  owner: string;
  operatorIds: string[];
  validatorCount: number;
  clusterTuple: {
    validatorCount: string;
    networkFeeIndex: string;
    index: string;
    active: boolean;
    balance: string;
  };
}

interface StateCache {
  blockNumber: number;
  timestamp: string;
  operators: CachedOperator[];
  clusters: CachedCluster[];
}

function loadCache(blockNumber: number): StateCache | null {
  const cachePath = path.join(CACHE_DIR, `fork-state-cache-${blockNumber}.json`);
  if (!fs.existsSync(cachePath)) return null;
  try {
    const raw = fs.readFileSync(cachePath, "utf-8");
    return JSON.parse(raw) as StateCache;
  } catch {
    return null;
  }
}

function operatorsFromCache(
  cached: CachedOperator[],
): Map<bigint, Omit<OperatorRecord, "ownerSigner">> {
  const map = new Map<bigint, Omit<OperatorRecord, "ownerSigner">>();
  for (const op of cached) {
    const id = BigInt(op.id);
    map.set(id, { id, owner: op.owner, fee: BigInt(op.fee), isActive: op.isActive });
  }
  return map;
}

function clustersFromCache(cached: CachedCluster[]): Map<string, DiscoveredCluster> {
  const map = new Map<string, DiscoveredCluster>();
  for (const c of cached) {
    map.set(c.key, {
      owner: c.owner,
      operatorIds: c.operatorIds.map((id) => BigInt(id)),
      validatorCount: c.validatorCount,
      lastClusterTuple: {
        validatorCount: BigInt(c.clusterTuple.validatorCount),
        networkFeeIndex: BigInt(c.clusterTuple.networkFeeIndex),
        index: BigInt(c.clusterTuple.index),
        active: c.clusterTuple.active,
        balance: BigInt(c.clusterTuple.balance),
      },
    });
  }
  return map;
}

// --- Migration tracking ---

interface MigrationRecord {
  key: string;
  owner: string;
  operatorIds: bigint[];
  validatorCount: number;
  status: "success" | "failed" | "skipped";
  wave: number;
  failReason?: string;
}

interface WaveResult {
  wave: number;
  migratedThisWave: number;
  totalMigrated: number;
  totalClusters: number;
  scenariosRun: number;
  scenarioBugs: number;
  durationMs: number;
}

// --- Ops JSONL writer ---

interface OpsEvent {
  type: "migration" | "skip" | "migration_failed" | "retry" | "liquidation" | "scenario";
  timestamp: number;
  owner: string;
  clusterKey: string;
  wave?: number;
  [key: string]: any;
}

class OpsJsonlWriter {
  private fd: number;
  private filePath: string;
  private count: number = 0;

  constructor(outputDir: string) {
    if (!fs.existsSync(outputDir)) fs.mkdirSync(outputDir, { recursive: true });
    const ts = new Date().toISOString().replace(/[:.]/g, "-");
    this.filePath = path.join(outputDir, `migration-ops-${ts}.jsonl`);
    this.fd = fs.openSync(this.filePath, "w");
  }

  write(event: OpsEvent): void {
    fs.writeSync(this.fd, JSON.stringify(event) + "\n");
    this.count++;
  }

  close(): void {
    fs.closeSync(this.fd);
  }

  getFilePath(): string {
    return this.filePath;
  }

  getCount(): number {
    return this.count;
  }
}

// --- Helpers ---

async function registerSimOperators(
  network: any,
  owner: HardhatEthersSigner,
  count: number,
  startSeed: number,
  fee: bigint = MINIMAL_OPERATOR_ETH_FEE,
): Promise<OperatorRecord[]> {
  const records: OperatorRecord[] = [];
  for (let i = 0; i < count; i++) {
    const key = makeOperatorKey(startSeed + i);
    try {
      const id = await network.connect(owner).registerOperator.staticCall(
        key,
        fee,
        false,
      );
      await network.connect(owner).registerOperator(key, fee, false);
      records.push({
        id: BigInt(id),
        owner: owner.address,
        ownerSigner: owner,
        fee,
        isActive: true,
      });
    } catch {
      // Skip failed registrations
    }
  }
  return records;
}

async function provisionStakers(
  connection: any,
  fixture: Awaited<ReturnType<typeof ssvNetworkFullForkedFixture>>,
  signers: HardhatEthersSigner[],
): Promise<StakerRecord[]> {
  const networkAddr = await fixture.network.getAddress();
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

/**
 * Convert ALL discovered clusters into ClusterRecord entries.
 * Unlike the MC variant, this does NOT sample — it loads every single cluster.
 */
async function convertAllClusters(
  discovered: Map<string, DiscoveredCluster>,
  connection: any,
): Promise<Map<string, ClusterRecord>> {
  const clusterBook = new Map<string, ClusterRecord>();
  const provider = connection.ethers.provider;

  // Collect unique owners for batch impersonation
  const ownerSet = new Set<string>();
  for (const [, c] of discovered) {
    ownerSet.add(c.owner);
  }

  // Impersonate all unique owners in bulk
  console.log(`[MIG-SIM] Impersonating ${ownerSet.size} unique cluster owners...`);
  const ownerSigners = new Map<string, HardhatEthersSigner>();
  for (const owner of ownerSet) {
    try {
      await provider.send("hardhat_impersonateAccount", [owner]);
      await provider.send("hardhat_setBalance", [
        owner,
        "0x" + (BigInt(100e18)).toString(16),
      ]);
      const ownerSigner = await connection.ethers.getSigner(owner);
      ownerSigners.set(owner, ownerSigner);
    } catch {
      // Skip owners we can't impersonate
    }
  }
  console.log(`[MIG-SIM] Impersonated ${ownerSigners.size}/${ownerSet.size} owners`);

  // Convert all clusters
  for (const [key, disc] of discovered) {
    const signer = ownerSigners.get(disc.owner);
    if (!signer) continue;

    clusterBook.set(key, {
      owner: disc.owner,
      ownerSigner: signer,
      operatorIds: disc.operatorIds,
      cluster: {
        validatorCount: disc.lastClusterTuple.validatorCount,
        networkFeeIndex: disc.lastClusterTuple.networkFeeIndex,
        index: disc.lastClusterTuple.index,
        active: disc.lastClusterTuple.active,
        balance: disc.lastClusterTuple.balance,
      },
      version: VERSION_SSV,
      validatorKeys: [],
    });
  }

  return clusterBook;
}

/**
 * Migrate a single cluster from SSV to ETH.
 * Returns a MigrationRecord with the outcome.
 */
async function migrateCluster(
  state: SimulationState,
  key: string,
  record: ClusterRecord,
  wave: number,
): Promise<MigrationRecord> {
  const validatorCount = Number(record.cluster.validatorCount);
  const migRecord: MigrationRecord = {
    key,
    owner: record.owner,
    operatorIds: record.operatorIds,
    validatorCount,
    status: "failed",
    wave,
  };

  if (!record.cluster.active) {
    migRecord.status = "skipped";
    migRecord.failReason = "inactive";
    return migRecord;
  }

  try {
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
      migRecord.status = "success";
    } else {
      migRecord.failReason = "no event in receipt";
    }
  } catch (err) {
    migRecord.failReason = String(err).slice(0, 120);
  }

  return migRecord;
}

/**
 * Format a progress table row.
 */
function formatWaveRow(w: WaveResult): string {
  const pct = ((w.totalMigrated / w.totalClusters) * 100).toFixed(1);
  const label = w.wave === -1 ? "POST " : String(w.wave).padStart(5);
  return (
    `  ${label} | ` +
    `${String(w.totalMigrated).padStart(7)} | ` +
    `${String(w.totalClusters).padStart(5)} | ` +
    `${pct.padStart(6)}% | ` +
    `${String(w.scenariosRun).padStart(9)} | ` +
    `${String(w.scenarioBugs).padStart(4)} | ` +
    `${String(Math.round(w.durationMs / 1000)).padStart(4)}s`
  );
}

/**
 * Write the migration simulation report to a file.
 */
function writeReport(
  outputDir: string,
  waves: WaveResult[],
  migrationRecords: MigrationRecord[],
  totalBugs: number,
  totalDurationMs: number,
): string {
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir, { recursive: true });
  }

  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(outputDir, `migration-sim-report-${timestamp}.txt`);

  const lines: string[] = [];
  lines.push("=".repeat(72));
  lines.push("  FULL MIGRATION SIMULATION REPORT");
  lines.push("=".repeat(72));
  lines.push(`Timestamp: ${new Date().toISOString()}`);
  lines.push(`Total clusters: ${migrationRecords.length}`);
  lines.push(`Batch size: ${MIGRATION_BATCH_SIZE}`);
  lines.push(`Scenarios per wave: ${SCENARIOS_PER_WAVE}`);
  lines.push(`Post-migration picks: ${POST_MIGRATION_PICKS}`);
  lines.push(`Total duration: ${(totalDurationMs / 1000).toFixed(1)}s`);
  lines.push(`Total bug candidates: ${totalBugs}`);
  lines.push("");

  // Progress table
  lines.push("-".repeat(72));
  lines.push("  WAVE PROGRESS");
  lines.push("-".repeat(72));
  lines.push("  Wave  | Migrated | Total | %      | Scenarios | Bugs | Time");
  lines.push("  " + "-".repeat(65));
  for (const w of waves) {
    lines.push(formatWaveRow(w));
  }
  lines.push("");

  // Migration outcomes
  const succeeded = migrationRecords.filter((r) => r.status === "success").length;
  const failed = migrationRecords.filter((r) => r.status === "failed").length;
  const skipped = migrationRecords.filter((r) => r.status === "skipped").length;

  lines.push("-".repeat(72));
  lines.push("  MIGRATION OUTCOMES");
  lines.push("-".repeat(72));
  lines.push(`  Succeeded: ${succeeded}`);
  lines.push(`  Failed:    ${failed}`);
  lines.push(`  Skipped:   ${skipped}`);
  lines.push("");

  if (failed > 0) {
    lines.push("-".repeat(72));
    lines.push("  FAILED MIGRATIONS");
    lines.push("-".repeat(72));
    const failReasons = new Map<string, number>();
    for (const r of migrationRecords) {
      if (r.status === "failed") {
        const reason = r.failReason ?? "unknown";
        // Truncate to first meaningful part
        const short = reason.slice(0, 80);
        failReasons.set(short, (failReasons.get(short) ?? 0) + 1);
      }
    }
    for (const [reason, count] of [...failReasons.entries()].sort((a, b) => b[1] - a[1])) {
      lines.push(`  (x${count}) ${reason}`);
    }
    lines.push("");
  }

  lines.push("=".repeat(72));

  fs.writeFileSync(reportPath, lines.join("\n"), "utf-8");
  return reportPath;
}

// --- Test suite ---

(RUN_MIGRATION_SIM ? describe : describe.skip)("Full Migration Simulation", function () {
  this.timeout(3_600_000); // 60 minutes

  let state: SimulationState;
  let invCtx: InvariantContext;
  let connection: any;
  let fixture: Awaited<ReturnType<typeof ssvNetworkFullForkedFixture>>;

  before(async function () {
    console.log("[MIG-SIM] Setting up forked environment...");
    const forked = await getForkedConnection();
    connection = forked.connection;
    const provider = connection.ethers.provider;

    const forkBlock = await provider.getBlockNumber();
    console.log(`[MIG-SIM] Fork block: ${forkBlock}`);

    // --- Phase 1: Load cache (required) ---
    const cached = loadCache(forkBlock);
    if (!cached) {
      throw new Error(
        `[MIG-SIM] No cache found for block ${forkBlock}. ` +
        `Run the fork MC test first to generate the cache, or set FORK_BLOCK_NUMBER=24737260.`,
      );
    }

    const discoveredOps = operatorsFromCache(cached.operators);
    const discoveredClusters = clustersFromCache(cached.clusters);
    console.log(
      `[MIG-SIM] Loaded ${discoveredOps.size} operators + ${discoveredClusters.size} clusters from cache`,
    );

    // --- Phase 2: Deploy v2.0.0 upgrade ---
    console.log("[MIG-SIM] Deploying v2.0.0 upgrade on fork...");
    fixture = await ssvNetworkFullForkedFixture(connection);
    const networkAddress = await fixture.network.getAddress();

    const seed = process.env.SIMULATION_SEED
      ? BigInt(process.env.SIMULATION_SEED)
      : undefined;
    const rng = new SeededRNG(seed);

    // --- Phase 3: Convert ALL clusters ---
    console.log(`[MIG-SIM] Converting all ${discoveredClusters.size} clusters...`);
    const clusterBook = await convertAllClusters(discoveredClusters, connection);
    console.log(`[MIG-SIM] Loaded ${clusterBook.size} clusters into cluster book`);

    // --- Phase 4: Sample and impersonate mainnet operators ---
    const operatorPool = new Map<bigint, OperatorRecord>();
    try {
      const sampled = await sampleOperators(discoveredOps, fixture.views, 20, rng);
      console.log(`[MIG-SIM] Sampled ${sampled.length} active mainnet operators`);
      for (const op of sampled) {
        await provider.send("hardhat_impersonateAccount", [op.owner]);
        await provider.send("hardhat_setBalance", [
          op.owner,
          "0x" + BigInt(10e18).toString(16),
        ]);
        const ownerSigner = await connection.ethers.getSigner(op.owner);
        operatorPool.set(op.id, { ...op, ownerSigner });
      }
    } catch (err) {
      console.warn(
        `[MIG-SIM] Operator sampling failed: ${String(err).slice(0, 120)}; continuing`,
      );
    }

    // Register synthetic operators
    console.log("[MIG-SIM] Registering synthetic operators...");
    const signers = await connection.ethers.getSigners();
    const operatorOwner = signers[1];
    await provider.send("hardhat_setBalance", [
      operatorOwner.address,
      "0x" + BigInt(100e18).toString(16),
    ]);
    const simOpRecords = await registerSimOperators(
      fixture.network,
      operatorOwner,
      8,
      9000,
    );
    for (const rec of simOpRecords) {
      operatorPool.set(rec.id, rec);
    }
    console.log(`[MIG-SIM] Operator pool: ${operatorPool.size} total`);

    // --- Phase 5: Provision oracles ---
    console.log("[MIG-SIM] Provisioning oracle signers...");
    const oracleSigners = signers.slice(6, 9);
    for (let i = 0; i < oracleSigners.length; i++) {
      try {
        await fixture.network.connect(fixture.daoSigner).replaceOracle(
          i + 1,
          oracleSigners[i].address,
        );
      } catch {
        try {
          await fixture.network.replaceOracle(i + 1, oracleSigners[i].address);
        } catch {
          // Skip
        }
      }
    }

    // --- Phase 6: Provision stakers + bootstrap cSSV ---
    console.log("[MIG-SIM] Provisioning stakers...");
    const stakerSigners = signers.slice(2, 6);
    const stakerPool = await provisionStakers(connection, fixture, stakerSigners);

    console.log("[MIG-SIM] Bootstrapping cSSV supply...");
    const bootstrapStaker = stakerPool[0];
    await fixture.ssvToken
      .connect(bootstrapStaker.signer)
      .approve(networkAddress, ethers.MaxUint256);
    const stakeTx = await fixture.network
      .connect(bootstrapStaker.signer)
      .stake(STAKE_AMOUNT);
    await stakeTx.wait();
    bootstrapStaker.cssvBalance = BigInt(
      await fixture.cssvToken.balanceOf(bootstrapStaker.signer.address),
    );

    // --- Phase 7: Build SimulationState ---
    const startBlock = await provider.getBlockNumber();

    state = {
      network: fixture.network as unknown as SSVNetwork,
      views: fixture.views as unknown as SSVNetworkViews,
      provider,
      rng,
      logger: new SimLogger(),
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
      invCtx.prevAccEthPerShare = BigInt(
        await (fixture.views as unknown as SSVNetworkViews).accEthPerShare(),
      );
    } catch {
      invCtx.prevAccEthPerShare = 0n;
    }

    const ssvCount = [...clusterBook.values()].filter((c) => c.version === VERSION_SSV).length;
    const ethCount = [...clusterBook.values()].filter((c) => c.version === VERSION_ETH).length;
    console.log("[MIG-SIM] Setup complete.");
    console.log(
      `[MIG-SIM] Summary: ${operatorPool.size} operators, ${clusterBook.size} clusters (${ssvCount} SSV, ${ethCount} ETH), ${stakerPool.length} stakers`,
    );
  });

  it("migrates all clusters in waves with scenario picks", async function () {
    const allMigrationRecords: MigrationRecord[] = [];
    const waveResults: WaveResult[] = [];
    let totalMigrated = 0;
    let totalBugs = 0;
    const simStartMs = Date.now();

    // Initialize ops JSONL writer
    const opsWriter = new OpsJsonlWriter(CACHE_DIR);

    // Collect all SSV clusters to migrate
    const ssvEntries = [...state.clusterBook.entries()].filter(
      ([, c]) => c.version === VERSION_SSV,
    );
    const totalClusters = ssvEntries.length;

    console.log(`\n[MIG-SIM] Starting migration of ${totalClusters} SSV clusters`);
    console.log(`[MIG-SIM] Batch size: ${MIGRATION_BATCH_SIZE}, Scenarios/wave: ${SCENARIOS_PER_WAVE}`);
    console.log(`[MIG-SIM] Post-migration picks: ${POST_MIGRATION_PICKS}`);
    console.log("");
    console.log("  Wave  | Migrated | Total |      % | Scenarios | Bugs | Time");
    console.log("  " + "-".repeat(65));

    // --- Migration waves ---
    let waveNum = 0;
    let clusterIndex = 0;

    while (clusterIndex < ssvEntries.length) {
      waveNum++;
      const waveStartMs = Date.now();

      // Pick the next batch
      const batch = ssvEntries.slice(clusterIndex, clusterIndex + MIGRATION_BATCH_SIZE);
      clusterIndex += MIGRATION_BATCH_SIZE;

      let migratedThisWave = 0;

      // Migrate each cluster in this batch
      for (const [key, record] of batch) {
        const migRecord = await migrateCluster(state, key, record, waveNum);
        allMigrationRecords.push(migRecord);
        if (migRecord.status === "success") {
          migratedThisWave++;
          totalMigrated++;
          opsWriter.write({
            type: "migration",
            timestamp: Date.now(),
            owner: record.owner,
            clusterKey: key,
            wave: waveNum,
            validatorCount: Number(record.cluster.validatorCount),
          });
        } else if (migRecord.status === "skipped") {
          opsWriter.write({
            type: "skip",
            timestamp: Date.now(),
            owner: record.owner,
            clusterKey: key,
            wave: waveNum,
            reason: migRecord.failReason ?? "inactive",
          });
        } else {
          opsWriter.write({
            type: "migration_failed",
            timestamp: Date.now(),
            owner: record.owner,
            clusterKey: key,
            wave: waveNum,
            reason: migRecord.failReason ?? "unknown",
          });
        }
      }

      // Run scenario picks against the current mixed state
      let waveBugs = 0;
      let scenariosRun = 0;

      if (SCENARIOS_PER_WAVE > 0 && ALL_SCENARIOS.length > 0) {
        const runner = new ScenarioRunner({
          totalPicks: SCENARIOS_PER_WAVE,
          invariantEvery: 0, // Don't run invariants during wave scenarios
          seed: state.rng.next(),
          onScenarioPick: (info: ScenarioPickInfo) => {
            opsWriter.write({
              type: "scenario",
              timestamp: Date.now(),
              owner: info.owner,
              clusterKey: info.clusterKey,
              wave: waveNum,
              scenarioId: info.scenarioId,
              outcome: info.outcome,
              steps: info.steps,
            });
          },
        });
        runner.registerScenarios(ALL_SCENARIOS);
        const summary = await runner.run(state, invCtx);
        waveBugs = summary.totalBugs;
        scenariosRun = summary.totalPicks;
        totalBugs += waveBugs;
      }

      const waveDurationMs = Date.now() - waveStartMs;

      const waveResult: WaveResult = {
        wave: waveNum,
        migratedThisWave,
        totalMigrated,
        totalClusters,
        scenariosRun,
        scenarioBugs: waveBugs,
        durationMs: waveDurationMs,
      };
      waveResults.push(waveResult);
      console.log(formatWaveRow(waveResult));
    }

    // --- Post-migration phase ---
    console.log("");
    console.log(`[MIG-SIM] Migration complete: ${totalMigrated}/${totalClusters} migrated`);

    const failedCount = allMigrationRecords.filter((r) => r.status === "failed").length;
    const skippedCount = allMigrationRecords.filter((r) => r.status === "skipped").length;
    if (failedCount > 0 || skippedCount > 0) {
      console.log(`[MIG-SIM] Failed: ${failedCount}, Skipped: ${skippedCount}`);

      // Log top failure reasons
      const failReasons = new Map<string, number>();
      for (const r of allMigrationRecords) {
        if (r.status === "failed") {
          const reason = (r.failReason ?? "unknown").slice(0, 80);
          failReasons.set(reason, (failReasons.get(reason) ?? 0) + 1);
        }
      }
      const topReasons = [...failReasons.entries()]
        .sort((a, b) => b[1] - a[1])
        .slice(0, 5);
      for (const [reason, count] of topReasons) {
        console.log(`  (x${count}) ${reason}`);
      }
    }

    // Retry failed migrations with higher ETH value, then liquidate those that
    // still fail (their SSV balance is insufficient to cover accrued fees).
    const stillFailed = [...state.clusterBook.entries()].filter(
      ([, c]) => c.version === VERSION_SSV && c.cluster.active,
    );
    if (stillFailed.length > 0) {
      console.log(`\n[MIG-SIM] Retrying ${stillFailed.length} failed clusters with higher ETH...`);
      let retrySuccess = 0;
      for (const [retryKey, record] of stillFailed) {
        // Retry with 10x more ETH
        const vc = Number(record.cluster.validatorCount);
        const bigEth = ethers.parseEther("0.1") * BigInt(Math.max(vc, 1));
        try {
          await state.provider.send("hardhat_setBalance", [
            record.owner,
            "0x" + (bigEth + BigInt(100e18)).toString(16),
          ]);
          const tx = await state.network.connect(record.ownerSigner).migrateClusterToETH(
            record.operatorIds,
            record.cluster,
            { value: bigEth },
          );
          const receipt = await tx.wait();
          const updated = parseClusterFromReceipt(state.network, receipt, "ClusterMigratedToETH");
          if (updated) {
            record.cluster = updated;
            record.version = VERSION_ETH;
            trackEthFlow(state, "in", bigEth);
            retrySuccess++;
            totalMigrated++;
            opsWriter.write({
              type: "retry",
              timestamp: Date.now(),
              owner: record.owner,
              clusterKey: retryKey,
              validatorCount: vc,
              result: "success",
            });
          }
        } catch {
          // Still can't migrate — try liquidating to make inactive
          try {
            const tx = await state.network.connect(record.ownerSigner).liquidateSSV(
              record.owner,
              record.operatorIds,
              record.cluster,
            );
            const receipt = await tx.wait();
            const updated = parseClusterFromReceipt(state.network, receipt, "ClusterLiquidated");
            if (updated) {
              record.cluster = updated;
            } else {
              record.cluster.active = false;
            }
            opsWriter.write({
              type: "liquidation",
              timestamp: Date.now(),
              owner: record.owner,
              clusterKey: retryKey,
              validatorCount: vc,
            });
          } catch {
            // Force mark as inactive — the cluster is essentially dead
            record.cluster.active = false;
            opsWriter.write({
              type: "retry",
              timestamp: Date.now(),
              owner: record.owner,
              clusterKey: retryKey,
              validatorCount: vc,
              result: "force_inactive",
            });
          }
        }
      }
      const stillActive = [...state.clusterBook.values()].filter(
        (c) => c.version === VERSION_SSV && c.cluster.active,
      ).length;
      console.log(`[MIG-SIM] Retry: ${retrySuccess} migrated, ${stillActive} still active SSV`);
    }

    // Post-migration scenario picks
    if (POST_MIGRATION_PICKS > 0 && ALL_SCENARIOS.length > 0) {
      console.log(`\n[MIG-SIM] Running ${POST_MIGRATION_PICKS} post-migration scenario picks...`);
      const postStartMs = Date.now();

      const postRunner = new ScenarioRunner({
        totalPicks: POST_MIGRATION_PICKS,
        invariantEvery: 10,
        seed: state.rng.next(),
        onScenarioPick: (info: ScenarioPickInfo) => {
          opsWriter.write({
            type: "scenario",
            timestamp: Date.now(),
            owner: info.owner,
            clusterKey: info.clusterKey,
            wave: -1,
            scenarioId: info.scenarioId,
            outcome: info.outcome,
            steps: info.steps,
          });
        },
      });
      postRunner.registerScenarios(ALL_SCENARIOS);
      const postSummary = await postRunner.run(state, invCtx);

      const postDurationMs = Date.now() - postStartMs;
      totalBugs += postSummary.totalBugs;

      const postWave: WaveResult = {
        wave: -1, // Sentinel for "POST"
        migratedThisWave: 0,
        totalMigrated,
        totalClusters,
        scenariosRun: postSummary.totalPicks,
        scenarioBugs: postSummary.totalBugs,
        durationMs: postDurationMs,
      };
      waveResults.push(postWave);

      console.log("");
      console.log("  Wave  | Migrated | Total |      % | Scenarios | Bugs | Time");
      console.log("  " + "-".repeat(65));
      console.log(formatWaveRow(postWave));

      // Print post-migration coverage summary
      console.log(`\n[MIG-SIM] Post-migration: ${postSummary.totalCompleted} completed, ${postSummary.totalStopped} stopped, ${postSummary.totalBugs} bugs`);

      // Write JSONL report
      try {
        postRunner.generateReport();
        const postReportPath = postRunner.generateReportFile();
        console.log(`[MIG-SIM] Post-migration report: ${postReportPath}`);
      } catch {
        // Report generation may fail
      }
    }

    // --- Final invariants ---
    console.log("\n[MIG-SIM] Running final invariants...");
    const finals = await runFinalInvariants(state, invCtx);
    const invariantFailures: string[] = [];
    for (const r of finals) {
      const status = r.passed ? "OK" : "FAIL";
      console.log(`  ${r.id}: ${status} — ${r.message.slice(r.message.indexOf(":") + 2)}`);
      if (!r.passed) {
        invariantFailures.push(r.message);
      }
    }

    // --- Write report file ---
    const totalDurationMs = Date.now() - simStartMs;
    const reportPath = writeReport(
      CACHE_DIR,
      waveResults,
      allMigrationRecords,
      totalBugs,
      totalDurationMs,
    );
    console.log(`\n[MIG-SIM] Report written to: ${reportPath}`);
    console.log(`[MIG-SIM] Total duration: ${(totalDurationMs / 1000).toFixed(1)}s`);

    // Close and report ops JSONL
    opsWriter.close();
    console.log(`[MIG-SIM] Ops JSONL: ${opsWriter.getFilePath()} (${opsWriter.getCount()} events)`);

    // --- Assertions ---
    // Assert no bug candidates found
    expect(totalBugs, "Bug candidates found during migration simulation").to.equal(0);

    // Assert all invariants passed
    expect(invariantFailures.length, `Invariant failures: ${invariantFailures.join("; ")}`).to.equal(0);
  });
});

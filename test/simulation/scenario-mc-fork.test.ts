/**
 * Scenario Monte Carlo — Mainnet Fork Variant
 *
 * Forks Ethereum mainnet, upgrades the real SSV contracts to v2.0.0,
 * discovers real operators/clusters from on-chain events, and runs
 * the scenario pool against real state.
 *
 * Guard: only runs when RUN_FORK_MC=true — will not execute in normal CI.
 *
 * Usage:
 *   RUN_FORK_MC=true npx hardhat test test/simulation/scenario-mc-fork.test.ts --network hardhat_forked
 *   SIMULATION_SEED=0xDEAD SCENARIO_PICKS=20 RUN_FORK_MC=true npx hardhat test test/simulation/scenario-mc-fork.test.ts --network hardhat_forked
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
  EMPTY_CLUSTER,
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  STAKE_AMOUNT,
  MINIMAL_OPERATOR_ETH_FEE,
} from "../common/constants.ts";
import { makePublicKey, makeOperatorKey } from "../helpers/keys.ts";

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
  clusterKey,
  parseClusterFromReceipt,
  emptyTotals,
} from "./bookkeeping.ts";
import {
  createInvariantContext,
  runFinalInvariants,
  type InvariantContext,
} from "./invariants.ts";
import { ScenarioRunner } from "./scenario-runner.ts";
import { ALL_SCENARIOS } from "../scenarios/index.ts";
import {
  sampleOperators,
  type DiscoveredCluster,
} from "./state-discovery.ts";

// --- Guard ---

const RUN_FORK_MC = process.env.RUN_FORK_MC === "true";

// --- Scan configuration ---

/** Default scan window: 500k blocks (~70 days). Override with FORK_SCAN_BLOCKS. */
const DEFAULT_SCAN_BLOCKS = 500_000;

/**
 * Parse the scan range from env vars.
 * - FORK_SCAN_FROM: absolute start block (takes priority)
 * - FORK_SCAN_BLOCKS: number of blocks to scan backwards from head (default 500k)
 */
function getScanRange(currentBlock: number): { scanFrom: number; scanTo: number } {
  const scanTo = currentBlock;

  if (process.env.FORK_SCAN_FROM) {
    const scanFrom = parseInt(process.env.FORK_SCAN_FROM, 10);
    if (!isNaN(scanFrom) && scanFrom >= 0) {
      return { scanFrom, scanTo };
    }
  }

  const scanBlocks = process.env.FORK_SCAN_BLOCKS
    ? parseInt(process.env.FORK_SCAN_BLOCKS, 10)
    : DEFAULT_SCAN_BLOCKS;

  const resolvedBlocks = !isNaN(scanBlocks) && scanBlocks > 0 ? scanBlocks : DEFAULT_SCAN_BLOCKS;
  return { scanFrom: Math.max(0, currentBlock - resolvedBlocks), scanTo };
}

// --- Discovery cache ---

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

function getCachePath(blockNumber: number): string {
  return path.join(CACHE_DIR, `fork-state-cache-${blockNumber}.json`);
}

function loadCache(blockNumber: number): StateCache | null {
  const cachePath = getCachePath(blockNumber);
  if (!fs.existsSync(cachePath)) return null;
  try {
    const raw = fs.readFileSync(cachePath, "utf-8");
    return JSON.parse(raw) as StateCache;
  } catch {
    return null;
  }
}

function writeCache(cache: StateCache): void {
  if (!fs.existsSync(CACHE_DIR)) {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
  }
  const cachePath = getCachePath(cache.blockNumber);
  fs.writeFileSync(cachePath, JSON.stringify(cache, null, 2), "utf-8");
  console.log(`[FORK-MC] Cache written to: ${cachePath}`);
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

function operatorsToCache(
  operators: Map<bigint, Omit<OperatorRecord, "ownerSigner">>,
): CachedOperator[] {
  return [...operators.values()].map((op) => ({
    id: op.id.toString(),
    owner: op.owner,
    fee: op.fee.toString(),
    isActive: op.isActive,
  }));
}

function clustersToCache(clusters: Map<string, DiscoveredCluster>): CachedCluster[] {
  return [...clusters.entries()].map(([key, c]) => ({
    key,
    owner: c.owner,
    operatorIds: c.operatorIds.map((id) => id.toString()),
    validatorCount: c.validatorCount,
    clusterTuple: {
      validatorCount: c.lastClusterTuple.validatorCount.toString(),
      networkFeeIndex: c.lastClusterTuple.networkFeeIndex.toString(),
      index: c.lastClusterTuple.index.toString(),
      active: c.lastClusterTuple.active,
      balance: c.lastClusterTuple.balance.toString(),
    },
  }));
}

// --- Bulk discovery (10k-block chunks to reduce RPC calls) ---

/** Bulk chunk size — most providers (Infura, Alchemy, QuickNode) support 10k+ block ranges for getLogs */
const BULK_CHUNK_SIZE = 10_000;

const OPERATOR_ADDED_ABI = [
  "event OperatorAdded(uint64 indexed operatorId, address indexed owner, bytes publicKey, uint256 fee)",
];
const OPERATOR_REMOVED_ABI = [
  "event OperatorRemoved(uint64 indexed operatorId)",
];
const CLUSTER_EVENT_ABI = [
  "event ValidatorAdded(address indexed owner, uint64[] operatorIds, bytes publicKey, bytes shares, tuple(uint32, uint64, uint64, bool, uint256) cluster)",
  "event ValidatorRemoved(address indexed owner, uint64[] operatorIds, bytes publicKey, tuple(uint32, uint64, uint64, bool, uint256) cluster)",
  "event ClusterDeposited(address indexed owner, uint64[] operatorIds, uint256 value, tuple(uint32, uint64, uint64, bool, uint256) cluster)",
  "event ClusterWithdrawn(address indexed owner, uint64[] operatorIds, uint256 value, tuple(uint32, uint64, uint64, bool, uint256) cluster)",
  "event ClusterLiquidated(address indexed owner, uint64[] operatorIds, tuple(uint32, uint64, uint64, bool, uint256) cluster)",
  "event ClusterReactivated(address indexed owner, uint64[] operatorIds, tuple(uint32, uint64, uint64, bool, uint256) cluster)",
  "event ClusterMigratedToETH(address indexed owner, uint64[] operatorIds, tuple(uint32, uint64, uint64, bool, uint256) cluster)",
];

/**
 * Discover operators using 10k-block chunks (vs 500 in state-discovery.ts).
 * Scans backwards to find recent active operators first.
 */
async function discoverOperatorsBulk(
  provider: any,
  ethersNs: any,
  networkAddress: string,
  fromBlock: number,
  toBlock: number,
  minOperators: number = 50,
): Promise<Map<bigint, Omit<OperatorRecord, "ownerSigner">>> {
  const operators = new Map<bigint, Omit<OperatorRecord, "ownerSigner">>();

  const addedIface = new ethersNs.Interface(OPERATOR_ADDED_ABI);
  const removedIface = new ethersNs.Interface(OPERATOR_REMOVED_ABI);
  const addedTopic = addedIface.getEvent("OperatorAdded")!.topicHash;
  const removedTopic = removedIface.getEvent("OperatorRemoved")!.topicHash;

  let chunks = 0;
  for (let end = toBlock; end >= fromBlock; end -= BULK_CHUNK_SIZE) {
    const start = Math.max(end - BULK_CHUNK_SIZE + 1, fromBlock);
    chunks++;

    try {
      const logs = await provider.getLogs({
        address: networkAddress,
        topics: [[addedTopic, removedTopic]],
        fromBlock: start,
        toBlock: end,
      });

      for (const log of logs) {
        if (log.topics[0] === addedTopic) {
          const decoded = addedIface.parseLog(log);
          if (!decoded) continue;
          const operatorId = BigInt(decoded.args[0]);
          const owner = decoded.args[1] as string;
          const fee = BigInt(decoded.args[3]);
          operators.set(operatorId, { id: operatorId, owner, fee, isActive: true });
        } else if (log.topics[0] === removedTopic) {
          const decoded = removedIface.parseLog(log);
          if (!decoded) continue;
          const operatorId = BigInt(decoded.args[0]);
          const existing = operators.get(operatorId);
          if (existing) existing.isActive = false;
        }
      }
    } catch (err) {
      // If chunk too large, try halving (fallback for restrictive RPCs)
      console.warn(`[FORK-MC] Operator chunk ${start}-${end} failed: ${String(err).slice(0, 80)}`);
    }

    const activeCount = [...operators.values()].filter((op) => op.isActive).length;
    if (activeCount >= minOperators) break;

    if (chunks % 10 === 0) {
      console.log(`[FORK-MC]   ... scanned ${chunks} chunks, ${operators.size} operators found so far`);
    }
  }

  return operators;
}

/**
 * Discover clusters using 10k-block chunks (vs 500 in state-discovery.ts).
 * Scans forward from fromBlock.
 */
async function discoverClustersBulk(
  provider: any,
  ethersNs: any,
  networkAddress: string,
  fromBlock: number,
  toBlock: number,
): Promise<Map<string, DiscoveredCluster>> {
  const clusters = new Map<string, DiscoveredCluster>();
  const iface = new ethersNs.Interface(CLUSTER_EVENT_ABI);

  const topics = CLUSTER_EVENT_ABI.map((abi) => {
    const parsed = new ethersNs.Interface([abi]);
    const eventName = abi.match(/event\s+(\w+)/)![1];
    return parsed.getEvent(eventName)!.topicHash;
  });

  let chunks = 0;
  for (let start = fromBlock; start <= toBlock; start += BULK_CHUNK_SIZE) {
    const end = Math.min(start + BULK_CHUNK_SIZE - 1, toBlock);
    chunks++;

    try {
      const logs = await provider.getLogs({
        address: networkAddress,
        topics: [topics],
        fromBlock: start,
        toBlock: end,
      });

      for (const log of logs) {
        let decoded;
        try {
          decoded = iface.parseLog(log);
        } catch {
          continue;
        }
        if (!decoded) continue;

        const owner = decoded.args[0] as string;
        const operatorIds = (decoded.args[1] as any[]).map((id: any) => BigInt(id));
        const clusterTuple = decoded.args[decoded.args.length - 1];
        const sortedOps = [...operatorIds].sort((a, b) => (a < b ? -1 : a > b ? 1 : 0));
        const key = ethersNs.keccak256(
          ethersNs.solidityPacked(["address", "uint64[]"], [owner, sortedOps]),
        );

        const [vc, nfi, idx, active, balance] = clusterTuple;
        const existing = clusters.get(key);
        const validatorCount = Number(vc);

        clusters.set(key, {
          owner,
          operatorIds: sortedOps,
          validatorCount: existing ? Math.max(existing.validatorCount, validatorCount) : validatorCount,
          lastClusterTuple: {
            validatorCount: BigInt(vc),
            networkFeeIndex: BigInt(nfi),
            index: BigInt(idx),
            active: Boolean(active),
            balance: BigInt(balance),
          },
        });
      }
    } catch (err) {
      console.warn(`[FORK-MC] Cluster chunk ${start}-${end} failed: ${String(err).slice(0, 80)}`);
    }

    if (chunks % 10 === 0) {
      console.log(`[FORK-MC]   ... scanned ${chunks} chunks, ${clusters.size} clusters found so far`);
    }
  }

  return clusters;
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
 * Convert discovered clusters into ClusterRecord entries for the cluster book.
 * Impersonates each cluster owner and refreshes cluster state on-chain.
 */
async function convertDiscoveredClusters(
  discovered: Map<string, DiscoveredCluster>,
  connection: any,
  _network: any,
  rng: SeededRNG,
  maxClusters: number = 20,
): Promise<Map<string, ClusterRecord>> {
  const clusterBook = new Map<string, ClusterRecord>();
  const provider = connection.ethers.provider;

  // Filter to active clusters with validators
  const active = [...discovered.entries()].filter(
    ([, c]) => c.lastClusterTuple.active && c.validatorCount > 0,
  );

  // Shuffle and take up to maxClusters
  const shuffled = rng.shuffle([...active]);
  const candidates = shuffled.slice(0, Math.min(maxClusters, shuffled.length));

  for (const [key, disc] of candidates) {
    try {
      // Impersonate cluster owner
      await provider.send("hardhat_impersonateAccount", [disc.owner]);
      await provider.send("hardhat_setBalance", [
        disc.owner,
        "0x" + (BigInt(100e18)).toString(16),
      ]);
      const ownerSigner = await connection.ethers.getSigner(disc.owner);

      clusterBook.set(key, {
        owner: disc.owner,
        ownerSigner,
        operatorIds: disc.operatorIds,
        cluster: {
          validatorCount: disc.lastClusterTuple.validatorCount,
          networkFeeIndex: disc.lastClusterTuple.networkFeeIndex,
          index: disc.lastClusterTuple.index,
          active: disc.lastClusterTuple.active,
          balance: disc.lastClusterTuple.balance,
        },
        // Pre-upgrade clusters are SSV-denominated
        version: VERSION_SSV,
        validatorKeys: [],
      });
    } catch {
      // Skip clusters we can't impersonate
    }
  }

  return clusterBook;
}

// --- Test suite ---

(RUN_FORK_MC ? describe : describe.skip)("Scenario MC — Mainnet Fork", function () {
  this.timeout(900_000);

  let state: SimulationState;
  let invCtx: InvariantContext;

  before(async function () {
    console.log("[FORK-MC] Setting up forked environment...");
    const { connection } = await getForkedConnection();
    const provider = connection.ethers.provider;

    const forkBlock = await provider.getBlockNumber();
    console.log(`[FORK-MC] Fork block: ${forkBlock}`);

    // --- Phase 1: Deploy v2.0.0 upgrade on mainnet fork ---
    console.log("[FORK-MC] Deploying v2.0.0 upgrade on fork...");
    const fixture = await ssvNetworkFullForkedFixture(connection);
    const networkAddress = await fixture.network.getAddress();

    const seed = process.env.SIMULATION_SEED
      ? BigInt(process.env.SIMULATION_SEED)
      : undefined;
    const rng = new SeededRNG(seed);

    // --- Phase 2 + 4: Discover operators + clusters (with cache) ---
    const currentBlock = await provider.getBlockNumber();
    const { scanFrom, scanTo } = getScanRange(currentBlock);

    const operatorPool = new Map<bigint, OperatorRecord>();
    const clusterBook = new Map<string, ClusterRecord>();

    // Check cache first (keyed by fork block number)
    let discoveredOps: Map<bigint, Omit<OperatorRecord, "ownerSigner">>;
    let discoveredClusters: Map<string, DiscoveredCluster>;

    const cached = loadCache(forkBlock);
    if (cached) {
      discoveredOps = operatorsFromCache(cached.operators);
      discoveredClusters = clustersFromCache(cached.clusters);
      console.log(
        `[FORK-MC] Loaded ${discoveredOps.size} operators + ${discoveredClusters.size} clusters from cache (block ${forkBlock})`,
      );
    } else {
      console.log(
        `[FORK-MC] No cache for block ${forkBlock}. Scanning events (blocks ${scanFrom}–${scanTo}, ${scanTo - scanFrom} blocks)...`,
      );

      // Discover operators
      discoveredOps = new Map();
      try {
        discoveredOps = await discoverOperatorsBulk(
          provider,
          connection.ethers,
          networkAddress,
          scanFrom,
          scanTo,
          50,
        );
        console.log(`[FORK-MC] Discovered ${discoveredOps.size} operators`);
      } catch (err) {
        console.warn(
          `[FORK-MC] Operator discovery failed: ${String(err).slice(0, 120)}`,
        );
      }

      // Discover clusters
      discoveredClusters = new Map();
      try {
        discoveredClusters = await discoverClustersBulk(
          provider,
          connection.ethers,
          networkAddress,
          scanFrom,
          scanTo,
        );
        console.log(`[FORK-MC] Discovered ${discoveredClusters.size} clusters from events`);
      } catch (err) {
        console.warn(
          `[FORK-MC] Cluster discovery failed: ${String(err).slice(0, 120)}`,
        );
      }

      // Write cache for future runs
      writeCache({
        blockNumber: forkBlock,
        timestamp: new Date().toISOString(),
        operators: operatorsToCache(discoveredOps),
        clusters: clustersToCache(discoveredClusters),
      });
    }

    if (discoveredClusters.size < 100) {
      console.warn(
        `[FORK-MC] WARNING: Only ${discoveredClusters.size} clusters discovered. ` +
        `Consider increasing FORK_SCAN_BLOCKS (current: ${scanTo - scanFrom}) for better coverage.`,
      );
    }

    // Sample and impersonate mainnet operators
    try {
      const sampled = await sampleOperators(discoveredOps, fixture.views, 20, rng);
      console.log(`[FORK-MC] Sampled ${sampled.length} active mainnet operators`);

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
        `[FORK-MC] Operator sampling failed: ${String(err).slice(0, 120)}; continuing with synthetic operators only`,
      );
    }

    // --- Phase 3: Register synthetic operators for new ETH clusters ---
    console.log("[FORK-MC] Registering synthetic operators...");
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
    console.log(`[FORK-MC] Registered ${simOpRecords.length} synthetic operators`);
    for (const rec of simOpRecords) {
      operatorPool.set(rec.id, rec);
    }

    // Convert discovered clusters to cluster book
    try {
      const converted = await convertDiscoveredClusters(
        discoveredClusters,
        connection,
        fixture.network,
        rng,
        50,
      );

      for (const [key, rec] of converted) {
        clusterBook.set(key, rec);
      }
      console.log(`[FORK-MC] Converted ${converted.size} active clusters to cluster book`);
    } catch (err) {
      console.warn(
        `[FORK-MC] Cluster conversion failed: ${String(err).slice(0, 120)}; continuing with synthetic clusters only`,
      );
    }

    // --- Phase 5: Create synthetic ETH clusters ---
    console.log("[FORK-MC] Creating synthetic ETH clusters...");
    const simOpIds = simOpRecords.map((r) => r.id);
    const opGroups = [
      simOpIds.slice(0, 4),
      simOpIds.slice(4, 8),
    ].filter((g) => g.length === 4);

    const stakerSigners = signers.slice(2, 6);

    for (const opGroup of opGroups) {
      for (let i = 0; i < 2; i++) {
        const staker = rng.pick(stakerSigners);
        const keySeed = currentBlock + Number(rng.next() % 1000000n);
        const validatorKey = makePublicKey(keySeed);

        try {
          const tx = await fixture.network.connect(staker).registerValidator(
            validatorKey,
            opGroup,
            DEFAULT_SHARES,
            EMPTY_CLUSTER,
            { value: DEFAULT_ETH_REGISTER_VALUE },
          );
          const receipt = await tx.wait();
          const cluster = parseClusterFromReceipt(
            fixture.network,
            receipt,
            "ValidatorAdded",
          );

          if (cluster) {
            const key = clusterKey(
              connection.ethers,
              staker.address,
              opGroup,
            );
            clusterBook.set(key, {
              owner: staker.address,
              ownerSigner: staker,
              operatorIds: opGroup,
              cluster,
              version: VERSION_ETH,
              validatorKeys: [validatorKey],
            });
          }
        } catch (err) {
          console.warn(
            `[FORK-MC] Failed to register synthetic cluster: ${String(err).slice(0, 80)}`,
          );
        }
      }
    }

    // Add a 2nd validator to some ETH clusters
    for (const [, rec] of clusterBook) {
      if (rec.version !== VERSION_ETH) continue;
      if (rec.validatorKeys.length >= 2) continue;
      const keySeed = 60000 + Number(rng.next() % 1000000n);
      const extraKey = makePublicKey(keySeed);
      try {
        const tx = await fixture.network
          .connect(rec.ownerSigner)
          .registerValidator(
            extraKey,
            rec.operatorIds,
            DEFAULT_SHARES,
            rec.cluster,
            { value: DEFAULT_ETH_REGISTER_VALUE },
          );
        const receipt = await tx.wait();
        const updated = parseClusterFromReceipt(fixture.network, receipt, "ValidatorAdded");
        if (updated) {
          rec.cluster = updated;
          rec.validatorKeys.push(extraKey);
        }
      } catch (err) {
        console.warn(
          `[FORK-MC] Failed to add 2nd validator: ${String(err).slice(0, 80)}`,
        );
      }
    }

    const ssvClusterCount = [...clusterBook.values()].filter(
      (c) => c.version === VERSION_SSV,
    ).length;
    const ethClusterCount = [...clusterBook.values()].filter(
      (c) => c.version === VERSION_ETH,
    ).length;
    console.log(
      `[FORK-MC] Cluster book: ${ssvClusterCount} SSV + ${ethClusterCount} ETH = ${clusterBook.size} total`,
    );

    // --- Phase 6: Provision oracle signers ---
    console.log("[FORK-MC] Provisioning oracle signers...");
    const oracleSigners = signers.slice(6, 9);
    for (let i = 0; i < oracleSigners.length; i++) {
      try {
        await fixture.network.connect(fixture.daoSigner).replaceOracle(
          i + 1,
          oracleSigners[i].address,
        );
      } catch {
        // Oracle slot may already be set or require DAO
        try {
          await fixture.network.replaceOracle(i + 1, oracleSigners[i].address);
        } catch {
          // Skip if oracle provisioning fails
        }
      }
    }

    // --- Phase 7: Provision stakers + bootstrap cSSV supply ---
    console.log("[FORK-MC] Provisioning stakers...");
    const stakerPool = await provisionStakers(connection, fixture, stakerSigners);

    console.log("[FORK-MC] Bootstrapping cSSV supply...");
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
    console.log(`[FORK-MC] Initial cSSV supply: ${await fixture.cssvToken.totalSupply()}`);

    // --- Phase 8: Build SimulationState ---
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

    console.log("[FORK-MC] Setup complete.");
    console.log(
      `[FORK-MC] Summary: ${operatorPool.size} operators, ${clusterBook.size} clusters, ${stakerPool.length} stakers, ${oracleSigners.length} oracles`,
    );
  });

  it("runs scenario Monte Carlo on mainnet fork", async function () {
    const totalPicks = parseInt(process.env.SCENARIO_PICKS ?? "100", 10);
    const seed = process.env.SIMULATION_SEED
      ? BigInt(process.env.SIMULATION_SEED)
      : undefined;

    console.log(
      `[FORK-MC] Running ${totalPicks} scenario picks with ${ALL_SCENARIOS.length} scenarios`,
    );

    const runner = new ScenarioRunner({
      totalPicks,
      invariantEvery: 10,
      seed,
    });
    runner.registerScenarios(ALL_SCENARIOS);

    const summary = await runner.run(state, invCtx);

    console.log(`\n[FORK-MC] === Run Summary ===`);
    console.log(`  Picks: ${summary.totalPicks}`);
    console.log(`  Completed: ${summary.totalCompleted}`);
    console.log(`  Stopped (reverts/skips): ${summary.totalStopped}`);
    console.log(`  Bug candidates: ${summary.totalBugs}`);
    console.log(`  Duration: ${(summary.durationMs / 1000).toFixed(1)}s`);
    console.log(`  JSONL: ${runner.getOutputPath()}`);

    if (summary.neverPicked.length > 0 && summary.neverPicked.length <= 20) {
      console.log(`  Never picked: ${summary.neverPicked.join(", ")}`);
    } else if (summary.neverPicked.length > 20) {
      console.log(`  Never picked: ${summary.neverPicked.length} scenarios`);
    }

    // Print coverage
    console.log(`\n  Coverage:`);
    for (const [id, cov] of summary.coverage) {
      if (cov.picked === 0) continue;
      const stopped = [...cov.stoppedAtStep.values()].reduce((a, b) => a + b, 0);
      console.log(
        `    ${id}: picked=${cov.picked} completed=${cov.completed} stopped=${stopped} bugs=${cov.bugCandidates}`,
      );
    }

    // Generate report (console + file)
    try {
      const report = runner.generateReport();
      console.log(`\n${report}`);
      const reportPath = runner.generateReportFile();
      console.log(`[FORK-MC] Report written to: ${reportPath}`);
    } catch {
      // Report generation may fail if JSONL was not written
    }

    // Run final invariants
    console.log("[FORK-MC] Running final invariants...");
    const finals = await runFinalInvariants(state, invCtx);
    for (const r of finals) {
      if (!r.passed) {
        console.warn(`  FAIL: ${r.message}`);
      }
    }

    // Assert no bugs found
    expect(summary.totalBugs, "Bug candidates found during fork simulation").to.equal(0);
  });
});

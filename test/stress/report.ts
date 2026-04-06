// Stress test run report: tracks all simulation metrics and generates an HTML report.

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { GAS_PRICE_FOR_REPORT } from './constants.ts';

// Error dump files (always overwritten — no file build-up)
const ERROR_FILE_PATH     = path.join(process.cwd(), 'test', 'stress', 'reports', 'stress-error-specific.txt');
const ERROR_ALL_FILE_PATH = path.join(process.cwd(), 'test', 'stress', 'reports', 'stress-error-all.txt');
const SUCCESS_ALL_FILE_PATH = path.join(process.cwd(), 'test', 'stress', 'reports', 'stress-all-tx.txt');

// ─── Types ────────────────────────────────────────────────────────────────

export interface ActionEntry {
  name: string;
  gasUsed: bigint;
  block: bigint;
}

export interface TxHistoryEntry {
  block: string;
  action: string;
  params: Record<string, string>;
  event: string;
}

interface ClusterHistoryRecord {
  owner: string;
  operatorIds: string[];   // bigint stringified
  entries: TxHistoryEntry[];
  version?: string;        // 'ETH' | 'SSV' — set on first recordClusterTx
}

interface OperatorHistoryRecord {
  opIds: number[];
  entries: TxHistoryEntry[];
}

interface ActionStats {
  calls: number;
  successes: number;
  gasTotal: bigint;
  gasMin: bigint;
  gasMax: bigint;
}

interface ConservationPoint {
  block: string;    // stored as string for JSON serialisation
  excessWei: string;
  clusterBalanceWei: string;   // sum of active cluster balances (wei)
  validatorCount: string;
}

interface EBUpdatePoint {
  block: string;
  clustersUpdated: number;
  ebMin: number;
  ebMax: number;
  root: string;
}

interface LiquidationRecord {
  ageBlocks: string;
}

interface FailureRecord {
  block: string;
  check: string;
  expected: string;
  actual: string;
  action: string;
}

interface StakerSummary {
  address: string;
  cssvBalance: string;
  totalClaimed: string;
  totalStaked: string;
}

// ─── RunReport class ──────────────────────────────────────────────────────

export class RunReport {
  // Basic tx log (backward-compat)
  entries: ActionEntry[] = [];
  blocksMined: bigint = 0n;
  miningRounds: number = 0;
  checkStateCallCount: number = 0;
  startTimeMs: number = Date.now();

  // Per-action stats
  actionStats: Map<string, ActionStats> = new Map();

  // Economic totals
  totalEthDepositedWei: bigint = 0n;
  totalEthWithdrawnByOwnersWei: bigint = 0n;
  totalOperatorEthWithdrawnWei: bigint = 0n;

  // Time-series (sampled on recordConservation calls)
  conservationHistory: ConservationPoint[] = [];

  // Oracle activity
  ebUpdateHistory: EBUpdatePoint[] = [];

  // Cluster lifecycle
  totalClustersLiquidated: number = 0;
  clusterLiquidationAges: string[] = [];  // ageBlocks stored as strings
  // Typed liquidation tracking (classified at liquidation time)
  runwayLiquidations: Array<{ blocksLeft: string }> = [];      // balance < minimumBlocksBeforeLiquidation * burnPerBlock
  collateralLiquidations: Array<{ amountLeft: string }> = [];  // balance < minimumLiquidationCollateral
  totalReactivations: number = 0;

  // Cluster creation counts (setup = seeded externally, dynamic = incremented in actions)
  ethClustersSetup: number = 0;          // ETH clusters from setup (STRESS_ETH_CLUSTERS)
  ethClustersDynamic: number = 0;        // ETH clusters created during run
  ssvClustersSetup: number = 0;          // SSV clusters from setup (STRESS_SSV_CLUSTERS)
  migrationsSetup: number = 0;           // SSV→ETH migrations during setup
  migrationsDynamic: number = 0;         // SSV→ETH migrations during run
  ssvClustersLiquidatedBeforeMigration: number = 0; // SSV clusters liquidated instead of migrated
  txTarget: number = 0;                  // STRESS_TARGET_WRITE_TXS (set by caller)
  // Operator registration split (pre-migration = SSV era, post-migration = ETH era)
  operatorsPreMigration: number = 0;     // STRESS_OPERATORS_PRE_UPGRADE (setup)
  operatorsPostMigrationSetup: number = 0; // STRESS_OPERATORS_POST_UPGRADE (setup)
  operatorsPostMigrationDynamic: number = 0; // operators registered during run
  // Operator fee / privacy snapshot (set by recordOperatorStats before teardown)
  operatorPrivateCount: number = 0;      // includes removed operators
  operatorPublicCount: number = 0;       // includes removed operators
  operatorRemovedCount: number = 0;
  operatorZeroFeeCount: number = 0;      // active (non-removed) operators only
  operatorAvgYearlyFeeEth: number = 0;   // average yearly ETH fee, active non-zero-fee operators only

  // Network-level action history (fee changes, liq param changes) — for timeline + cluster explorer
  networkHistory: Array<{ block: string; action: string; params: Record<string, string> }> = [];

  // Network fee rates and accumulated earnings (captured from simState before teardown)
  networkFeeEthWei: bigint = 0n;         // ETH fee per block per DEFAULT_EB unit
  networkFeeSSVWei: bigint = 0n;         // SSV fee per block per validator
  networkEarningsEthWei: bigint = 0n;    // total ETH network fees accumulated (simState)
  networkEarningsSSVWei: bigint = 0n;    // total SSV network fees accumulated (simState)

  // Staker info (set at end by teardown)
  stakerSummaries: StakerSummary[] = [];

  // Failures
  failures: FailureRecord[] = [];

  // Network parameter changes (for display in cluster section)
  networkFeeChanges: Array<{ block: string; oldFee: string; newFee: string }> = [];

  // EB oracle stats
  ebRaised:    number = 0;  // updateClusterBalance calls that raised EB
  ebLowered:   number = 0;  // updateClusterBalance calls that lowered EB
  ebSkipped:   number = 0;  // entries committed but never applied (abandoned or intentional)
  ebLiquidated: number = 0; // updateClusterBalance calls that auto-liquidated the cluster
  ebRounds:    number = 0;  // total commitEBRoot calls

  // Per-account history
  stakerHistory: Map<string, TxHistoryEntry[]> = new Map();
  clusterHistory: Map<string, ClusterHistoryRecord> = new Map();
  operatorHistory: Map<string, OperatorHistoryRecord> = new Map();

  // Misc
  ethPriceUSD: number = 3000;
  finalContractETH: bigint = 0n;         // contract ETH after teardown
  expectedFinalETH: bigint = 0n;         // SEED_ETH + accumulated network fees (set by teardown)
  finalDustSSV: bigint = 0n;             // contract SSV after teardown (must equal expectedFinalSSV = SEED_SSV)
  expectedFinalSSV: bigint = 0n;         // expected final SSV balance (= SEED_SSV, set by teardown)
  expectedEthNetworkFees: bigint = 0n;   // accumulated ETH network fees (staking pool for SSV stakers)
  lastAccEthPerShare: bigint = 0n;
  totalStakingDust: bigint = 0n;         // cumulative ETH precision loss from staker reward distribution

  // cSSV transfer breakdown
  cssvTransferTotal: number = 0;              // total transferCSSV actions
  cssvTransferAllBalance: number = 0;         // times sender transferred their entire cSSV balance
  cssvTransferToContract: number = 0;         // times recipient was a contract-staker slot
  cssvTransferToFreshWallet: number = 0;      // times recipient was a brand-new non-SSV wallet
  cssvTransferFromContract: number = 0;       // times the sender was a contract staker

  // ── Core record method (backward-compat) ────────────────────────────────

  record(name: string, gasUsed: bigint, block: bigint): void {
    this.entries.push({ name, gasUsed, block });

    // Update per-action stats
    let stats = this.actionStats.get(name);
    if (!stats) {
      stats = { calls: 0, successes: 0, gasTotal: 0n, gasMin: gasUsed, gasMax: 0n };
      this.actionStats.set(name, stats);
    }
    stats.calls++;
    stats.successes++;
    stats.gasTotal += gasUsed;
    if (gasUsed < stats.gasMin) stats.gasMin = gasUsed;
    if (gasUsed > stats.gasMax) stats.gasMax = gasUsed;
  }

  // ── Helper record methods ────────────────────────────────────────────────

  recordLiquidation(ageBlocks: bigint): void {
    this.totalClustersLiquidated++;
    this.clusterLiquidationAges.push(ageBlocks.toString());
  }

  /** Record whether liquidation was runway-based or collateral-based and the measure at the time. */
  recordLiquidationTyped(isCollateral: boolean, measureValue: bigint): void {
    if (isCollateral) {
      this.collateralLiquidations.push({ amountLeft: measureValue.toString() });
    } else {
      this.runwayLiquidations.push({ blocksLeft: measureValue.toString() });
    }
  }

  recordReactivation(): void {
    this.totalReactivations++;
  }

  /** Snapshot network fee rates and accumulated earnings from simState before teardown. */
  recordNetworkStats(network: { feeWei: bigint; feeSSVWei: bigint; ethNetworkEarnings: bigint; ssvNetworkEarnings: bigint }): void {
    this.networkFeeEthWei      = network.feeWei;
    this.networkFeeSSVWei      = network.feeSSVWei;
    this.networkEarningsEthWei = network.ethNetworkEarnings;
    this.networkEarningsSSVWei = network.ssvNetworkEarnings;
  }

  /** Record cumulative staking reward precision loss (dust from PackedETH flooring). */
  recordStakingDust(dust: bigint): void {
    this.totalStakingDust = dust;
  }

  /**
   * Record a cSSV transfer breakdown.
   * @param transferredAll   true if the sender moved their entire cSSV balance
   * @param recipientType    'existing' | 'contract' | 'fresh'
   * @param senderIsContract true if the sender was a contract-staker slot
   */
  recordCSSVTransfer(transferredAll: boolean, recipientType: 'existing' | 'contract' | 'fresh', senderIsContract: boolean): void {
    this.cssvTransferTotal++;
    if (transferredAll)            this.cssvTransferAllBalance++;
    if (recipientType === 'contract') this.cssvTransferToContract++;
    if (recipientType === 'fresh')    this.cssvTransferToFreshWallet++;
    if (senderIsContract)          this.cssvTransferFromContract++;
  }

  /** Snapshot operator privacy / fee stats from final simState before teardown. */
  recordOperatorStats(operators: Map<bigint, { isPrivate: boolean; isRemoved: boolean; feeWei: bigint }>): void {
    const BLOCKS_PER_YEAR = 7160n * 365n; // 2,613,400 blocks/year
    let privateCount = 0, publicCount = 0, removedCount = 0, zeroFeeCount = 0;
    let feeSumWei = 0n, feeCount = 0;
    for (const op of operators.values()) {
      // Private/public counts include removed operators (per spec)
      if (op.isPrivate) privateCount++; else publicCount++;
      if (op.isRemoved) { removedCount++; continue; }
      // Fee stats are for active operators only
      if (op.feeWei === 0n) {
        zeroFeeCount++;
      } else {
        feeSumWei += op.feeWei * BLOCKS_PER_YEAR;
        feeCount++;
      }
    }
    this.operatorPrivateCount = privateCount;
    this.operatorPublicCount  = publicCount;
    this.operatorRemovedCount = removedCount;
    this.operatorZeroFeeCount = zeroFeeCount;
    this.operatorAvgYearlyFeeEth = feeCount > 0
      ? Number(feeSumWei / BigInt(feeCount)) / 1e18
      : 0;
  }

  recordEBUpdate(block: bigint, count: number, minEB: number, maxEB: number, root: string): void {
    this.ebUpdateHistory.push({
      block: block.toString(),
      clustersUpdated: count,
      ebMin: minEB,
      ebMax: maxEB,
      root,
    });
  }

  recordEBRound(block: bigint, count: number): void {
    this.ebRounds++;
    this.ebUpdateHistory.push({
      block: block.toString(),
      clustersUpdated: count,
      ebMin: 0,
      ebMax: 0,
      root: '',
    });
  }

  recordEBRaised(): void    { this.ebRaised++; }
  recordEBLowered(): void   { this.ebLowered++; }
  recordEBSkipped(): void   { this.ebSkipped++; }
  recordEBLiquidated(): void { this.ebLiquidated++; }

  recordConservation(block: bigint, excessWei: bigint, clusterBalanceWei: bigint, validatorCount: bigint): void {
    this.conservationHistory.push({
      block: block.toString(),
      excessWei: excessWei.toString(),
      clusterBalanceWei: clusterBalanceWei.toString(),
      validatorCount: validatorCount.toString(),
    });
  }

  recordFailure(block: bigint, check: string, expected: string, actual: string, action: string): void {
    this.failures.push({
      block: block.toString(),
      check,
      expected,
      actual,
      action,
    });
  }

  recordNetworkAction(block: bigint, action: string, params: Record<string, string>): void {
    this.networkHistory.push({ block: block.toString(), action, params });
  }

  recordNetworkFeeChange(block: bigint, oldFee: bigint, newFee: bigint): void {
    this.networkFeeChanges.push({ block: block.toString(), oldFee: oldFee.toString(), newFee: newFee.toString() });
  }

  recordStakerTx(address: string, block: bigint, action: string, params: Record<string, string>, event: string): void {
    const key = address.toLowerCase();
    if (!this.stakerHistory.has(key)) this.stakerHistory.set(key, []);
    this.stakerHistory.get(key)!.push({ block: block.toString(), action, params, event });
  }

  recordClusterTx(clusterId: string, owner: string, operatorIds: bigint[], block: bigint, action: string, params: Record<string, string>, event: string): void {
    if (!this.clusterHistory.has(clusterId)) {
      const version = params['version'] as string | undefined;
      this.clusterHistory.set(clusterId, { owner, operatorIds: operatorIds.map(id => id.toString()), entries: [], version });
    }
    this.clusterHistory.get(clusterId)!.entries.push({ block: block.toString(), action, params, event });
  }

  recordOperatorTx(ownerAddress: string, opId: bigint, block: bigint, action: string, params: Record<string, string>, event: string): void {
    const key = ownerAddress.toLowerCase();
    if (!this.operatorHistory.has(key)) this.operatorHistory.set(key, { opIds: [], entries: [] });
    const rec = this.operatorHistory.get(key)!;
    const idNum = Number(opId);
    if (!rec.opIds.includes(idNum)) rec.opIds.push(idNum);
    rec.entries.push({ block: block.toString(), action, params, event });
  }

  // ── History lookup helpers ────────────────────────────────────────────────

  /**
   * Print a unified timeline of all TX history related to the given clusters and operators.
   * All entries are collected, deduplicated, sorted by block ascending (newest at bottom).
   * Format: block=N  [cluster=0x.. | op=N]  action  [Event]  params...
   */
  printTimeline(clusterIds: string[], opIds: bigint[]): void {
    type Line = { block: bigint; text: string };
    const seen = new Set<string>();
    const lines: Line[] = [];

    const addCluster = (clusterId: string) => {
      const rec = this.clusterHistory.get(clusterId);
      if (!rec) {
        console.error(`  (no history for cluster ${clusterId.slice(0, 14)})`);
        return;
      }
      for (const e of rec.entries) {
        const key = `${clusterId}:${e.block}:${e.action}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const paramStr = Object.entries(e.params).map(([k, v]) => `${k}=${v}`).join(' ');
        const label = `cluster=${clusterId.slice(0, 14)} ops=[${rec.operatorIds.join(',')}] owner=${rec.owner.slice(0, 10)}`;
        lines.push({ block: BigInt(e.block), text: `  block=${e.block.padStart(10)}  ${label}  ${e.action}  [${e.event}]  ${paramStr}` });
      }
    };

    // Direct clusters
    for (const id of clusterIds) addCluster(id);

    // Clusters touching any of the operators
    for (const opId of opIds) {
      const idStr = String(opId);
      // Operator's own actions
      for (const [, rec] of this.operatorHistory) {
        if (!rec.opIds.includes(Number(opId))) continue;
        for (const e of rec.entries) {
          const key = `op:${opId}:${e.block}:${e.action}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const paramStr = Object.entries(e.params).map(([k, v]) => `${k}=${v}`).join(' ');
          lines.push({ block: BigInt(e.block), text: `  block=${e.block.padStart(10)}  op=${opId}  ${e.action}  [${e.event}]  ${paramStr}` });
        }
      }
      // Cluster actions for clusters that use this operator
      for (const [clusterId, rec] of this.clusterHistory) {
        if (!rec.operatorIds.includes(idStr)) continue;
        addCluster(clusterId);
      }
    }

    if (lines.length === 0) {
      console.error('  (no history found)');
      return;
    }

    lines.sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0));

    // Write full history to file (always overwrites — no file build-up)
    const subject = clusterIds.length > 0
      ? `cluster ${clusterIds[0].slice(0, 14)}…`
      : `operator ${opIds[0]}`;
    const fileLines = [
      `── Stress Test Error Dump ──────────────────────────────────────────────────`,
      `Subject  : ${subject}`,
      `Entries  : ${lines.length}`,
      `Generated: ${new Date().toISOString()}`,
      `────────────────────────────────────────────────────────────────────────────`,
      '',
      ...lines.map(l => l.text),
    ];
    try {
      fsSync.writeFileSync(ERROR_FILE_PATH, fileLines.join('\n') + '\n', 'utf8');
    } catch { /* non-fatal */ }

    // Terminal: only the last 5 lines + path
    const tail = lines.slice(-5);
    console.error(`\n  Last ${tail.length} of ${lines.length} history entries (specific → ${ERROR_FILE_PATH}):`);
    for (const l of tail) console.error(l.text);

    // Also write the full cross-entity TX history
    this.writeFullHistory(subject);
  }

  /** Print all tx entries for a staker. */
  getStakerTrace(address: string): void {
    const entries = this.stakerHistory.get(address.toLowerCase());
    if (!entries || entries.length === 0) { console.error(`  (no history for staker ${address.slice(0, 10)})`); return; }

    // Write full history to file
    const fileLines = [
      `── Stress Test Error Dump ──────────────────────────────────────────────────`,
      `Subject  : staker ${address}`,
      `Entries  : ${entries.length}`,
      `Generated: ${new Date().toISOString()}`,
      `────────────────────────────────────────────────────────────────────────────`,
      '',
      ...entries.map(e => {
        const paramStr = Object.entries(e.params).map(([k, v]) => `${k}=${v}`).join(' ');
        return `  block=${e.block.padStart(10)}  ${e.action}  [${e.event}]  ${paramStr}`;
      }),
    ];
    try {
      fsSync.writeFileSync(ERROR_FILE_PATH, fileLines.join('\n') + '\n', 'utf8');
    } catch { /* non-fatal */ }

    // Terminal: last 5 + path
    const tail = entries.slice(-5);
    console.error(`\n  Last ${tail.length} of ${entries.length} staker history entries (full history → ${ERROR_FILE_PATH}):`);
    for (const e of tail) {
      const paramStr = Object.entries(e.params).map(([k, v]) => `${k}=${v}`).join(' ');
      console.error(`    block=${e.block}  ${e.action}  [${e.event}]  ${paramStr}`);
    }
  }

  /** @deprecated Use printTimeline instead. Kept for backward compat. */
  getClusterTrace(clusterId: string): void { this.printTimeline([clusterId], []); }
  /** @deprecated Use printTimeline instead. Kept for backward compat. */
  getOperatorTrace(opId: bigint): void { this.printTimeline([], [opId]); }

  /**
   * Write every recorded TX across all histories (cluster, operator, network, staker)
   * to stress-error-all.txt, sorted by block ascending.
   * Called on any failure — always overwrites, no file build-up.
   */
  writeFullHistory(subject: string): void {
    type Line = { block: bigint; text: string };
    const lines: Line[] = [];
    const seen = new Set<string>();

    for (const [clusterId, rec] of this.clusterHistory) {
      for (const e of rec.entries) {
        const key = `c:${clusterId}:${e.block}:${e.action}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const p = Object.entries(e.params).map(([k, v]) => `${k}=${v}`).join(' ');
        lines.push({ block: BigInt(e.block), text: `  cluster=${clusterId.slice(0, 14)}  block=${e.block.padStart(10)}  ${e.action}  [${e.event}]  ${p}` });
      }
    }

    for (const [, rec] of this.operatorHistory) {
      for (const e of rec.entries) {
        const key = `o:${rec.opIds.join(',')}:${e.block}:${e.action}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const p = Object.entries(e.params).map(([k, v]) => `${k}=${v}`).join(' ');
        lines.push({ block: BigInt(e.block), text: `  op=[${rec.opIds.join(',')}]  block=${e.block.padStart(10)}  ${e.action}  [${e.event}]  ${p}` });
      }
    }

    for (const e of this.networkHistory) {
      const key = `n:${e.block}:${e.action}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const p = Object.entries(e.params).map(([k, v]) => `${k}=${v}`).join(' ');
      lines.push({ block: BigInt(e.block), text: `  network  block=${e.block.padStart(10)}  ${e.action}  ${p}` });
    }

    for (const [addr, entries] of this.stakerHistory) {
      for (const e of entries) {
        const key = `s:${addr}:${e.block}:${e.action}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const p = Object.entries(e.params).map(([k, v]) => `${k}=${v}`).join(' ');
        lines.push({ block: BigInt(e.block), text: `  staker=${addr.slice(0, 10)}  block=${e.block.padStart(10)}  ${e.action}  [${e.event}]  ${p}` });
      }
    }

    lines.sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0));

    const fileLines = [
      `── Stress Test Full TX History ──────────────────────────────────────────────`,
      `Subject  : ${subject}`,
      `Entries  : ${lines.length}`,
      `Generated: ${new Date().toISOString()}`,
      `────────────────────────────────────────────────────────────────────────────`,
      '',
      ...lines.map(l => l.text),
    ];
    try {
      fsSync.writeFileSync(ERROR_ALL_FILE_PATH, fileLines.join('\n') + '\n', 'utf8');
      console.error(`  full TX history (${lines.length} entries) → ${ERROR_ALL_FILE_PATH}`);
    } catch { /* non-fatal */ }
  }

  /**
   * Write every recorded TX across all histories (cluster, operator, network, staker)
   * to stress-all-tx.txt, sorted by block ascending.
   * Called at the end of a successful run — same format as writeFullHistory.
   */
  writeSuccessHistory(): void {
    type Line = { block: bigint; text: string };
    const lines: Line[] = [];
    const seen = new Set<string>();

    for (const [clusterId, rec] of this.clusterHistory) {
      for (const e of rec.entries) {
        const key = `c:${clusterId}:${e.block}:${e.action}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const p = Object.entries(e.params).map(([k, v]) => `${k}=${v}`).join(' ');
        lines.push({ block: BigInt(e.block), text: `  cluster=${clusterId.slice(0, 14)}  block=${e.block.padStart(10)}  ${e.action}  [${e.event}]  ${p}` });
      }
    }

    for (const [, rec] of this.operatorHistory) {
      for (const e of rec.entries) {
        const key = `o:${rec.opIds.join(',')}:${e.block}:${e.action}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const p = Object.entries(e.params).map(([k, v]) => `${k}=${v}`).join(' ');
        lines.push({ block: BigInt(e.block), text: `  op=[${rec.opIds.join(',')}]  block=${e.block.padStart(10)}  ${e.action}  [${e.event}]  ${p}` });
      }
    }

    for (const e of this.networkHistory) {
      const key = `n:${e.block}:${e.action}`;
      if (seen.has(key)) continue;
      seen.add(key);
      const p = Object.entries(e.params).map(([k, v]) => `${k}=${v}`).join(' ');
      lines.push({ block: BigInt(e.block), text: `  network  block=${e.block.padStart(10)}  ${e.action}  ${p}` });
    }

    for (const [addr, entries] of this.stakerHistory) {
      for (const e of entries) {
        const key = `s:${addr}:${e.block}:${e.action}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const p = Object.entries(e.params).map(([k, v]) => `${k}=${v}`).join(' ');
        lines.push({ block: BigInt(e.block), text: `  staker=${addr.slice(0, 10)}  block=${e.block.padStart(10)}  ${e.action}  [${e.event}]  ${p}` });
      }
    }

    lines.sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0));

    const fileLines = [
      `── Stress Test Full TX History ──────────────────────────────────────────────`,
      `Subject  : successful run`,
      `Entries  : ${lines.length}`,
      `Generated: ${new Date().toISOString()}`,
      `────────────────────────────────────────────────────────────────────────────`,
      '',
      ...lines.map(l => l.text),
    ];
    try {
      fsSync.writeFileSync(SUCCESS_ALL_FILE_PATH, fileLines.join('\n') + '\n', 'utf8');
      console.log(`  full TX history (${lines.length} entries) → ${SUCCESS_ALL_FILE_PATH}`);
    } catch { /* non-fatal */ }
  }

  // Primary action counter — incremented once per successful action dispatch in the main loop.
  // Separate from txCount (entries.length) which also counts sub-TXs like updateClusterBalance
  // calls inside actCommitEBRoot. The loop exit condition uses this so that the TX target
  // controls actual "action rounds", not the number of on-chain records.
  primaryActionCount: number = 0;

  // ── Computed getters ─────────────────────────────────────────────────────

  get txCount(): number { return this.entries.length; }

  get totalGasUsed(): bigint {
    return this.entries.reduce((s, e) => s + e.gasUsed, 0n);
  }

  actionCounts(): Record<string, number> {
    const counts: Record<string, number> = {};
    for (const e of this.entries) {
      counts[e.name] = (counts[e.name] ?? 0) + 1;
    }
    return counts;
  }

  // ── Console print (backward-compat) ──────────────────────────────────────

  print(): void {
    const elapsed = ((Date.now() - this.startTimeMs) / 1000).toFixed(1);
    console.log('\n════════════════ Stress Test Report ════════════════');
    console.log(`Duration:         ${elapsed}s`);
    console.log(`Primary actions:  ${this.primaryActionCount}`);
    console.log(`On-chain records: ${this.txCount}`);
    console.log(`Blocks mined:     ${this.blocksMined}`);
    console.log(`Total gas:        ${this.totalGasUsed.toLocaleString()}`);
    console.log(`Mining rounds:    ${this.miningRounds}`);
    console.log(`checkState calls: ${this.checkStateCallCount}`);
    console.log(`Liquidations:     ${this.totalClustersLiquidated}`);
    console.log(`EB rounds:        ${this.ebRounds}`);
    console.log(`EB raised:        ${this.ebRaised}`);
    console.log(`EB lowered:       ${this.ebLowered}`);
    console.log(`EB skipped:       ${this.ebSkipped}`);
    console.log(`EB auto-liq:      ${this.ebLiquidated}`);
    if (this.failures.length > 0) {
      console.log(`FAILURES:         ${this.failures.length}`);
    }

    const counts = this.actionCounts();
    const sorted = Object.entries(counts).sort(([a], [b]) => a.localeCompare(b));
    if (sorted.length > 0) {
      console.log('\nAction breakdown:');
      for (const [name, count] of sorted) {
        console.log(`  ${name.padEnd(30)} ${count}`);
      }
    }
    console.log('════════════════════════════════════════════════════\n');
  }

  // ── HTML generation ──────────────────────────────────────────────────────

  generateHTML(simSummary?: object): string {
    const elapsedTotalSecs = Math.floor((Date.now() - this.startTimeMs) / 1000);
    const elapsedMins = Math.floor(elapsedTotalSecs / 60);
    const elapsedSecs = elapsedTotalSecs % 60;
    const elapsed = elapsedMins > 0 ? `${elapsedMins}m ${elapsedSecs}s` : `${elapsedSecs}s`;
    const counts = this.actionCounts();
    const sortedActions = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    // Helper: convert gas units → USD string using report gas price + real ETH price
    const ethPrice = this.ethPriceUSD;
    const gasCostUsd = (gas: bigint): string => {
      const costEth = Number(gas) * Number(GAS_PRICE_FOR_REPORT) / 1e18;
      const costUsd = costEth * ethPrice;
      return costUsd < 0.0001 ? '<$0.0001' : `$${costUsd.toFixed(4)}`;
    };

    // Compute average gas per action for the table
    const actionTableRows = sortedActions.map(([name, count]) => {
      const stats = this.actionStats.get(name);
      const avgGas = stats ? stats.gasTotal / BigInt(stats.calls) : 0n;
      const minGas = stats?.gasMin ?? 0n;
      const maxGas = stats?.gasMax ?? 0n;
      return { name, count, avgGas, minGas, maxGas };
    });

    // Build gas-by-action bar chart data
    const gasChartData = actionTableRows.map(r => ({
      name: r.name,
      avgGas: r.avgGas.toString(),
    }));

    // Downsample helper: reduce to at most maxPts evenly-spaced points
    function downsample<T>(arr: T[], maxPts: number): T[] {
      if (arr.length <= maxPts) return arr;
      const step = (arr.length - 1) / (maxPts - 1);
      return Array.from({ length: maxPts }, (_, i) => arr[Math.round(i * step)]);
    }

    const sampledHistory = downsample(this.conservationHistory, 1000);

    // Conservation history for line chart (accumulated fees = opEarnings + networkFees)
    const conservationData = sampledHistory.map(p => ({
      block: p.block,
      excessEth: (Number(BigInt(p.excessWei)) / 1e18).toFixed(4),
    }));

    // Total ETH in active clusters over time
    const clusterBalanceData = sampledHistory.map(p => ({
      block: p.block,
      ethValue: (Number(BigInt(p.clusterBalanceWei)) / 1e18).toFixed(4),
    }));


    // EB update summary (last 120 rounds, displayed in 4 columns of 30)
    const ebSummaryRows = this.ebUpdateHistory.slice(-120);

    // Staker summaries
    const stakerRows = this.stakerSummaries;

    // Failures table
    const failureRows = this.failures.slice(0, 100);

    // Account history data (serialized for embedding)
    const clusterHistObj: Record<string, ClusterHistoryRecord> = {};
    for (const [k, v] of this.clusterHistory) clusterHistObj[k] = v;

    const operatorHistObj: Record<string, OperatorHistoryRecord> = {};
    for (const [k, v] of this.operatorHistory) operatorHistObj[k] = v;

    const allTxBlocksArr = this.entries.map(e => ({ b: Number(e.block), a: e.name }));
    const networkFeeChangesArr = this.networkFeeChanges;
    const networkHistoryArr = this.networkHistory;

    // Convert bigints to strings for JSON embedding
    const jsonSafe = (v: any): any => {
      if (typeof v === 'bigint') return v.toString();
      if (Array.isArray(v)) return v.map(jsonSafe);
      if (v && typeof v === 'object') {
        const out: any = {};
        for (const k of Object.keys(v)) out[k] = jsonSafe(v[k]);
        return out;
      }
      return v;
    };

    const totalGasStr = this.totalGasUsed.toString();
    const gasCostEth = Number(this.totalGasUsed * 30_000_000_000n) / 1e18;
    const gasCostUSD = gasCostEth * this.ethPriceUSD;
    const finalContractETHStr = this.finalContractETH.toString();
    const expectedFinalETHStr = this.expectedFinalETH.toString();
    const finalDustSSVStr = this.finalDustSSV.toString();
    const expectedEthNetworkFeesStr = this.expectedEthNetworkFees.toString();
    const accEthStr = this.lastAccEthPerShare.toString();
    const stakingDustEth = Number(this.totalStakingDust) / 1e18;

    // Simulation wall-clock duration from blocks mined
    const simSeconds = Number(this.blocksMined) * 12;
    const simYears = Math.floor(simSeconds / (365.25 * 86400));
    const simDays = Math.floor((simSeconds % (365.25 * 86400)) / 86400);
    const simDuration = simYears > 0 ? `${simYears}y ${simDays}d` : `${simDays}d`;

    const summaryCards = [
      { label: 'Total Transactions', value: this.primaryActionCount.toLocaleString() },
      { label: 'Blocks Simulated', value: Number(this.blocksMined).toLocaleString() },
      { label: 'Sim Duration', value: simDuration },
      { label: 'Mining Rounds', value: this.miningRounds.toLocaleString() },
      { label: 'State Checks', value: this.checkStateCallCount.toLocaleString() },
      { label: 'Gas Cost (ETH)', value: gasCostEth.toFixed(4) },
      { label: 'Gas Cost (USD)', value: `$${gasCostUSD.toFixed(2)}` },
      { label: 'Liquidations', value: this.totalClustersLiquidated.toLocaleString() },
      { label: 'EB Oracle Rounds', value: this.ebRounds.toLocaleString() },
      { label: 'EB Raised', value: this.ebRaised.toLocaleString() },
      { label: 'EB Lowered', value: this.ebLowered.toLocaleString() },
      { label: 'EB Skipped', value: this.ebSkipped.toLocaleString() },
      { label: 'EB Auto-Liquidated', value: this.ebLiquidated.toLocaleString() },
      { label: 'Invariant Failures', value: this.failures.length.toLocaleString(), highlight: this.failures.length > 0 },
      { label: 'Duration', value: elapsed },
      { label: 'ETH Price', value: `$${this.ethPriceUSD}` },
      { label: 'Total Staking Pool Accumulation', value: `${(Number(expectedEthNetworkFeesStr) / 1e18).toFixed(6)} ETH` },
      { label: 'Staking Reward Dust (PackedETH rounding)', value: `${stakingDustEth.toFixed(5)} ETH (${this.totalStakingDust} wei)` },
    ];

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>SSV Network Stress Test Report</title>
<style>
  :root {
    --bg: #0d1117;
    --bg2: #161b22;
    --bg3: #1c2128;
    --border: #30363d;
    --text: #c9d1d9;
    --text-muted: #8b949e;
    --accent: #58a6ff;
    --accent2: #3fb950;
    --warn: #d29922;
    --danger: #f85149;
    --purple: #bc8cff;
    --teal: #39d353;
    --font: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, monospace;
  }
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body { background: var(--bg); color: var(--text); font-family: var(--font); font-size: 14px; line-height: 1.6; }
  a { color: var(--accent); text-decoration: none; }
  h1 { font-size: 24px; font-weight: 700; color: #fff; }
  h2 { font-size: 18px; font-weight: 600; color: var(--accent); margin-bottom: 12px; border-bottom: 1px solid var(--border); padding-bottom: 8px; }
  h3 { font-size: 14px; font-weight: 600; color: var(--text-muted); margin-bottom: 8px; }
  .header { background: var(--bg2); border-bottom: 1px solid var(--border); padding: 20px 32px; display: flex; align-items: center; gap: 16px; }
  .header .logo { font-size: 28px; }
  .header .meta { color: var(--text-muted); font-size: 12px; }
  .container { max-width: 1400px; margin: 0 auto; padding: 24px 32px; }
  .section { background: var(--bg2); border: 1px solid var(--border); border-radius: 8px; padding: 20px; margin-bottom: 24px; }
  .cards { display: grid; grid-template-columns: repeat(auto-fill, minmax(160px, 1fr)); gap: 12px; margin-bottom: 24px; }
  .card { background: var(--bg3); border: 1px solid var(--border); border-radius: 6px; padding: 14px; }
  .card .val { font-size: 22px; font-weight: 700; color: #fff; margin-top: 4px; }
  .card .val.danger { color: var(--danger); }
  .card .val.ok { color: var(--accent2); }
  .card .lbl { font-size: 11px; color: var(--text-muted); text-transform: uppercase; letter-spacing: 0.05em; }
  table { width: 100%; border-collapse: collapse; font-size: 13px; }
  th { background: var(--bg3); color: var(--text-muted); font-weight: 600; text-align: left; padding: 8px 12px; border-bottom: 1px solid var(--border); font-size: 11px; text-transform: uppercase; }
  td { padding: 7px 12px; border-bottom: 1px solid #21262d; }
  tr:last-child td { border-bottom: none; }
  tr:hover td { background: var(--bg3); }
  .mono { font-family: monospace; font-size: 12px; }
  .badge { display: inline-block; padding: 2px 8px; border-radius: 10px; font-size: 11px; font-weight: 600; }
  .badge-ok { background: #1a4025; color: var(--teal); }
  .badge-warn { background: #2d2011; color: var(--warn); }
  .badge-danger { background: #2d1117; color: var(--danger); }
  .chart-container { position: relative; height: 200px; margin: 12px 0; }
  .toc { display: flex; flex-wrap: wrap; gap: 8px; margin-bottom: 24px; }
  .toc a { background: var(--bg3); border: 1px solid var(--border); border-radius: 4px; padding: 4px 10px; font-size: 12px; color: var(--text-muted); }
  .toc a:hover { color: var(--accent); border-color: var(--accent); }
  .two-col { display: grid; grid-template-columns: 1fr 1fr; gap: 16px; }
  @media (max-width: 900px) { .two-col { grid-template-columns: 1fr; } }
  .scroll-x { overflow-x: auto; }
  .small { font-size: 12px; color: var(--text-muted); }
  .tag { background: #1f2937; border: 1px solid #374151; border-radius: 4px; padding: 1px 6px; font-size: 11px; color: #9ca3af; font-family: monospace; }
  .hist-bar { cursor: pointer; }
  .hist-bar:hover { opacity: 1 !important; }
  /* 2-panel explorer */
  .explorer { display: grid; grid-template-columns: 260px 1fr; border: 1px solid var(--border); border-radius: 6px; overflow: hidden; }
  .exp-list { background: var(--bg3); border-right: 1px solid var(--border); overflow-y: auto; max-height: 540px; }
  .exp-item { padding: 10px 14px; cursor: pointer; border-bottom: 1px solid #21262d; font-size: 12px; transition: background .1s; }
  .exp-item:hover { background: #1c2128; }
  .exp-item.active { background: #1c3045; border-left: 3px solid var(--accent); }
  .exp-item .ei-id { color: var(--accent); font-family: monospace; font-size: 11px; }
  .exp-item .ei-sub { color: var(--text-muted); font-size: 11px; margin-top: 2px; }
  .exp-detail { padding: 16px; overflow-y: auto; max-height: 540px; }
  .exp-empty { color: var(--text-muted); text-align: center; padding: 80px 20px; font-size: 13px; }
  /* Vertical timeline */
  .tl-wrap { position: relative; padding-left: 64px; }
  .tl-wrap::before { content: ''; position: absolute; left: 22px; top: 0; bottom: 0; width: 2px; background: var(--border); }
  .tl-node { position: relative; margin-bottom: 20px; }
  .tl-circle { position: absolute; left: -52px; top: 0; width: 44px; height: 44px; border-radius: 50%; background: var(--bg3); border: 2px solid var(--border); display: flex; align-items: center; justify-content: center; font-size: 9px; font-family: monospace; color: var(--text-muted); text-align: center; line-height: 1.2; cursor: default; transition: border-color .15s; z-index: 1; }
  .tl-node:hover .tl-circle { border-color: var(--accent); color: var(--accent); }
  .tl-txs { background: var(--bg3); border: 1px solid var(--border); border-radius: 6px; padding: 8px 12px; }
  .tl-tx { padding: 5px 0; border-bottom: 1px solid #21262d; cursor: pointer; display: flex; align-items: flex-start; gap: 8px; font-size: 12px; }
  .tl-tx:last-child { border-bottom: none; }
  .tl-tx:hover { background: #1c2128; margin: 0 -12px; padding-left: 12px; padding-right: 12px; }
  .tl-tx-detail { display: none; background: var(--bg2); border: 1px solid var(--border); border-radius: 4px; padding: 10px 14px; margin-top: 6px; font-size: 12px; }
  .tl-tx-detail.open { display: block; }
  .tl-tx-detail table td:first-child { color: var(--text-muted); padding-right: 16px; white-space: nowrap; font-size: 11px; }
  .tl-filter { display: flex; gap: 8px; flex-wrap: wrap; margin-bottom: 16px; }
  .tl-filter-btn { background: var(--bg3); border: 1px solid var(--border); border-radius: 4px; padding: 3px 10px; font-size: 11px; color: var(--text-muted); cursor: pointer; }
  .tl-filter-btn.active { background: #1c3045; border-color: var(--accent); color: var(--accent); }
  .tl-search { background: var(--bg3); border: 1px solid var(--border); border-radius: 4px; padding: 4px 10px; font-size: 12px; color: var(--text); width: 240px; }
  /* Detail tabs */
  .tab-bar { display: flex; gap: 2px; margin-bottom: 12px; border-bottom: 1px solid var(--border); flex-wrap: wrap; }
  .tab-btn { background: none; border: none; border-bottom: 2px solid transparent; margin-bottom: -1px; padding: 7px 14px; color: var(--text-muted); cursor: pointer; font-size: 12px; font-family: var(--font); transition: color .1s; }
  .tab-btn:hover { color: var(--text); }
  .tab-btn.active { color: var(--accent); border-bottom-color: var(--accent); }
</style>
</head>
<body>

<div class="header">
  <div class="logo">⬡</div>
  <div>
    <h1>SSV Network Stress Test Report</h1>
    <div class="meta">Stress test (${simDuration}) &bull; Generated ${new Date().toISOString()}</div>
  </div>
</div>

<div class="container">

<!-- TOC -->
<nav class="toc">
  <a href="#s1">1. Summary</a>
  <a href="#s2">2. Action Breakdown</a>
  <a href="#s3">3. Gas Usage</a>
  <a href="#s4">4. Conservation History</a>
  <a href="#s5">5. ETH in Active Clusters</a>
  <a href="#s7">7. Liquidations</a>
  <a href="#s9">9. Oracle EB Rounds</a>
  <a href="#s10">10. Staker Summaries</a>
  <a href="#s11">11. Protocol Parameters</a>
  <a href="#s12">12. Economic Totals</a>
  <a href="#s13">13. Dust &amp; Precision</a>
  <a href="#s15">15. Simulation Config</a>
  <a href="#s16">16. Assertions Performed</a>
  <a href="#s17">17. Account History</a>
  <a href="#s18">18. Cluster Explorer</a>
  <a href="#s19">19. Operator Explorer</a>
  <a href="#s20">20. Assertions Catalog</a>
  <a href="#s21">21. Revert Checks</a>
</nav>

<!-- ─── Section 1: Summary Cards ──────────────────────────────────────── -->
<div id="s1" class="section">
  <h2>1. Run Summary</h2>
  <div class="cards">
${summaryCards.map(c => `    <div class="card">
      <div class="lbl">${escapeHtml(c.label)}</div>
      <div class="val${c.highlight ? ' danger' : c.label === 'Invariant Failures' ? ' ok' : ''}">${escapeHtml(c.value)}</div>
    </div>`).join('\n')}
  </div>
</div>

<!-- ─── Section 1b: Cluster & Operator Counts ─────────────────────────── -->
<div class="section" style="margin-top:-12px">
  <h2>Cluster &amp; Operator Counts</h2>
  <div class="two-col">
    <div>
      <h3>Clusters</h3>
      <table>
        <tr><td>SSV clusters created (pre-migration, setup)</td><td class="mono">${this.ssvClustersSetup}</td></tr>
        <tr><td>ETH clusters created (setup)</td><td class="mono">${this.ethClustersSetup}</td></tr>
        <tr><td>ETH clusters created (dynamic, during run)</td><td class="mono">${this.ethClustersDynamic}</td></tr>
        <tr><td><strong>Total ETH clusters ever active</strong></td><td class="mono"><strong>${this.ethClustersSetup + this.ethClustersDynamic}</strong></td></tr>
        <tr><td>Clusters migrated SSV→ETH (setup)</td><td class="mono">${this.migrationsSetup}</td></tr>
        <tr><td>Clusters migrated SSV→ETH (during run)</td><td class="mono">${this.migrationsDynamic}</td></tr>
        <tr><td><strong>Total migrations</strong></td><td class="mono"><strong>${this.migrationsSetup + this.migrationsDynamic}</strong></td></tr>
        <tr><td>SSV clusters liquidated before migration</td><td class="mono">${this.ssvClustersLiquidatedBeforeMigration}</td></tr>
        <tr><td>Unique cluster owner accounts</td><td class="mono">${new Set([...this.clusterHistory.values()].map(r => r.owner.toLowerCase())).size}</td></tr>
      </table>
    </div>
    <div>
      <h3>Operators</h3>
      <table>
        <tr><td>Pre-migration operators (SSV era, setup)</td><td class="mono">${this.operatorsPreMigration}</td></tr>
        <tr><td>Post-migration operators (ETH era, setup)</td><td class="mono">${this.operatorsPostMigrationSetup}</td></tr>
        <tr><td>Post-migration operators (dynamic, during run)</td><td class="mono">${this.operatorsPostMigrationDynamic}</td></tr>
        <tr><td><strong>Total post-migration operators</strong></td><td class="mono"><strong>${this.operatorsPostMigrationSetup + this.operatorsPostMigrationDynamic}</strong></td></tr>
        <tr><td><strong>Total operators ever registered</strong></td><td class="mono"><strong>${this.operatorsPreMigration + this.operatorsPostMigrationSetup + this.operatorsPostMigrationDynamic}</strong></td></tr>
        <tr><td>Unique operator owner accounts</td><td class="mono">${this.operatorHistory.size}</td></tr>
        <tr><td style="padding-top:10px;color:var(--text-muted)" colspan="2">— Fee &amp; Privacy Snapshot (at end of run) —</td></tr>
        <tr><td>Private operators (incl. removed)</td><td class="mono">${this.operatorPrivateCount}</td></tr>
        <tr><td>Public operators (incl. removed)</td><td class="mono">${this.operatorPublicCount}</td></tr>
        <tr><td>Removed operators</td><td class="mono">${this.operatorRemovedCount}</td></tr>
        <tr><td>Operators with zero ETH fee (active only)</td><td class="mono">${this.operatorZeroFeeCount}</td></tr>
        <tr><td>Avg yearly ETH fee (active, non-zero, 7160 blocks/day)</td><td class="mono">${this.operatorAvgYearlyFeeEth.toFixed(6)} ETH</td></tr>
        <tr><td>Avg yearly ETH fee (USD @ $${this.ethPriceUSD})</td><td class="mono">$${(this.operatorAvgYearlyFeeEth * this.ethPriceUSD).toFixed(2)}</td></tr>
      </table>
    </div>
  </div>
</div>

<!-- ─── Section 1c: Network Fees ──────────────────────────────────────── -->
${(() => {
  const BLOCKS_PER_YEAR = 7160n * 365n;
  const ethRateYearly = Number(this.networkFeeEthWei * BLOCKS_PER_YEAR) / 1e18;
  const ssvRateYearly = Number(this.networkFeeSSVWei * BLOCKS_PER_YEAR) / 1e18;
  return `<div class="section" style="margin-top:-12px">
  <h2>Network Fees</h2>
  <div class="two-col">
    <div>
      <h3>ETH Network Fee</h3>
      <table>
        <tr><td>Rate (per block per 32 ETH)</td><td class="mono">${this.networkFeeEthWei.toString()} wei</td></tr>
        <tr><td>Rate (yearly, 7160 blocks/day)</td><td class="mono">${ethRateYearly.toFixed(8)} ETH</td></tr>
        <tr><td><strong>Total ETH collected (simState)</strong></td><td class="mono"><strong>${(Number(this.networkEarningsEthWei) / 1e18).toFixed(8)} ETH</strong></td></tr>
      </table>
    </div>
    <div>
      <h3>SSV Network Fee</h3>
      <table>
        <tr><td>Rate (per block per validator)</td><td class="mono">${this.networkFeeSSVWei.toString()} wei</td></tr>
        <tr><td>Rate (yearly, 7160 blocks/day)</td><td class="mono">${ssvRateYearly.toFixed(4)} SSV</td></tr>
        <tr><td><strong>Total SSV collected (simState)</strong></td><td class="mono"><strong>${(Number(this.networkEarningsSSVWei) / 1e18).toFixed(4)} SSV</strong></td></tr>
      </table>
    </div>
  </div>
</div>`;
})()}

<!-- ─── Section 2: Action Breakdown ───────────────────────────────────── -->
<div id="s2" class="section">
  <h2>2. Action Breakdown</h2>
  <p class="small" style="margin-bottom:12px">Cost columns assume <strong>${Number(GAS_PRICE_FOR_REPORT) / 1e9} gwei</strong> gas price and <strong>$${this.ethPriceUSD.toLocaleString()} / ETH</strong>.</p>
  <div class="scroll-x">
  <table>
    <thead>
      <tr><th>Action</th><th>Count</th><th>Avg Gas</th><th>Avg Cost</th><th>Min Gas</th><th>Min Cost</th><th>Max Gas</th><th>Max Cost</th><th>% of TXs</th></tr>
    </thead>
    <tbody>
${actionTableRows.map(r => `      <tr>
        <td><span class="tag">${escapeHtml(r.name)}</span></td>
        <td>${r.count.toLocaleString()}</td>
        <td class="mono">${Number(r.avgGas).toLocaleString()}</td>
        <td class="mono">${gasCostUsd(r.avgGas)}</td>
        <td class="mono">${Number(r.minGas).toLocaleString()}</td>
        <td class="mono">${gasCostUsd(r.minGas)}</td>
        <td class="mono">${Number(r.maxGas).toLocaleString()}</td>
        <td class="mono">${gasCostUsd(r.maxGas)}</td>
        <td>${this.txCount > 0 ? ((r.count / this.txCount) * 100).toFixed(1) : '0.0'}%</td>
      </tr>`).join('\n')}
    </tbody>
  </table>
  </div>
</div>

<!-- ─── Section 3: Gas Usage Chart ────────────────────────────────────── -->
<div id="s3" class="section">
  <h2>3. Gas Usage by Action</h2>
  <div id="gasChart" style="overflow:hidden">
    <svg id="gasChartSvg" width="100%"></svg>
  </div>
  <div class="small" style="margin-top:8px">Average gas per action type (horizontal bars). Gas cost estimate: <strong>${gasCostEth.toFixed(4)} ETH</strong> ($${gasCostUSD.toFixed(2)}) at 30 gwei.</div>
</div>

<!-- ─── Section 4: Conservation History ──────────────────────────────── -->
<div id="s4" class="section">
  <h2>4. Accumulated Protocol Fees</h2>
  <p class="small" style="margin-bottom:12px">Accumulated protocol fees = operator ETH earnings + ETH network fees = contractETH − SEED − clusterBalances. Starts at 0 and grows as fees accrue. Sampled every 50 TXs. Should always be &ge; 0.</p>
  <div class="chart-container" id="conservationChart">
    <svg id="conservationChartSvg" width="100%" height="200" viewBox="0 0 900 200" preserveAspectRatio="none"></svg>
  </div>
</div>

<!-- ─── Section 5: ETH in Active Clusters ─────────────────────────────── -->
<div id="s5" class="section">
  <h2>5. Total ETH in Active Clusters</h2>
  <p class="small" style="margin-bottom:12px">Sum of all active cluster balances. Shows deposited ETH declining as fees accrue, dropping to 0 at teardown when all clusters self-liquidate. Values in ETH.</p>
  <div class="chart-container" id="clusterBalanceChart">
    <svg id="clusterBalanceChartSvg" width="100%" height="200" viewBox="0 0 900 200" preserveAspectRatio="none"></svg>
  </div>
</div>

<!-- ─── Section 7: Liquidation Summary ────────────────────────────────── -->
<div id="s7" class="section">
  <h2>7. Liquidation &amp; Reactivation Summary</h2>
  <p class="small" style="margin-bottom:12px">
    <strong>Runway liquidations</strong>: cluster ran out of blocks of runway (balance &lt; minimumBlocksBeforeLiquidation &times; burnPerBlock). Metric = blocks of runway remaining at liquidation.<br>
    <strong>Collateral liquidations</strong>: cluster fell below the minimum ETH/SSV collateral floor. Metric = wei remaining at liquidation.
  </p>

  <!-- Top-level totals -->
  <div class="cards" style="margin-bottom:20px">
    <div class="card">
      <div class="lbl">Total Liquidated</div>
      <div class="val">${this.totalClustersLiquidated}</div>
    </div>
    <div class="card">
      <div class="lbl">Runway Liquidations</div>
      <div class="val">${this.runwayLiquidations.length}</div>
    </div>
    <div class="card">
      <div class="lbl">Collateral Liquidations</div>
      <div class="val">${this.collateralLiquidations.length}</div>
    </div>
    <div class="card">
      <div class="lbl">Reactivations</div>
      <div class="val">${this.totalReactivations}</div>
    </div>
    <div class="card">
      <div class="lbl">Avg Cluster Age</div>
      <div class="val">${this.clusterLiquidationAges.length > 0
        ? (this.clusterLiquidationAges.reduce((s, a) => s + Number(BigInt(a)), 0) / this.clusterLiquidationAges.length * 12 / 86400).toFixed(1) + ' d'
        : 'N/A'}</div>
    </div>
  </div>

  <div class="two-col">
    <!-- Runway liquidations detail -->
    <div>
      <h3>Runway Liquidations (${this.runwayLiquidations.length})</h3>
      <p class="small" style="margin-bottom:8px">Blocks of runway remaining when liquidated (lower = closer to zero).</p>
      <table>
        <tbody>
          ${(() => {
            const vals = this.runwayLiquidations.map(r => Number(BigInt(r.blocksLeft)));
            if (vals.length === 0) return '<tr><td colspan="2" style="color:var(--text-muted)">None recorded</td></tr>';
            const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
            const min = Math.min(...vals);
            const max = Math.max(...vals);
            return `<tr><td>Avg blocks remaining</td><td class="mono">${avg.toFixed(0)} blocks (${(avg * 12 / 3600).toFixed(1)} h)</td></tr>
                    <tr><td>Lowest (closest to zero)</td><td class="mono">${min.toLocaleString()} blocks (${(min * 12 / 3600).toFixed(1)} h)</td></tr>
                    <tr><td>Highest (most runway left)</td><td class="mono">${max.toLocaleString()} blocks (${(max * 12 / 86400).toFixed(1)} d)</td></tr>`;
          })()}
        </tbody>
      </table>
    </div>

    <!-- Collateral liquidations detail -->
    <div>
      <h3>Collateral Liquidations (${this.collateralLiquidations.length})</h3>
      <p class="small" style="margin-bottom:8px">ETH/SSV wei remaining at time of liquidation.</p>
      <table>
        <tbody>
          ${(() => {
            const vals = this.collateralLiquidations.map(r => Number(BigInt(r.amountLeft)));
            if (vals.length === 0) return '<tr><td colspan="2" style="color:var(--text-muted)">None recorded</td></tr>';
            const avg = vals.reduce((s, v) => s + v, 0) / vals.length;
            const min = Math.min(...vals);
            const max = Math.max(...vals);
            return `<tr><td>Avg amount remaining</td><td class="mono">${(avg / 1e18).toFixed(8)} ETH</td></tr>
                    <tr><td>Lowest (most drained)</td><td class="mono">${(min / 1e18).toFixed(8)} ETH</td></tr>
                    <tr><td>Highest (most remaining)</td><td class="mono">${(max / 1e18).toFixed(8)} ETH</td></tr>`;
          })()}
        </tbody>
      </table>
    </div>
  </div>
</div>

<!-- ─── Section 9: Oracle EB Rounds ───────────────────────────────────── -->
<div id="s9" class="section">
  <h2>9. Oracle / Effective Balance Activity</h2>
  <div class="two-col" style="margin-bottom:18px">
    <div class="card"><div class="card-label">EB Rounds (commitRoot)</div><div class="card-value">${this.ebRounds}</div></div>
    <div class="card"><div class="card-label">EB Raised</div><div class="card-value" style="color:var(--danger)">${this.ebRaised}</div></div>
    <div class="card"><div class="card-label">EB Lowered</div><div class="card-value" style="color:var(--accent)">${this.ebLowered}</div></div>
    <div class="card"><div class="card-label">EB Skipped (never applied)</div><div class="card-value" style="color:var(--warn)">${this.ebSkipped}</div></div>
    <div class="card"><div class="card-label">EB Auto-Liquidated</div><div class="card-value" style="color:var(--danger)">${this.ebLiquidated}</div></div>
  </div>
  <p class="small" style="margin-bottom:12px">Last ${ebSummaryRows.length} commitEBRoot calls (up to 120), displayed in 4 columns of 30. "Clusters" = # of clusters included in that round's Merkle tree.</p>
  <div style="display:grid;grid-template-columns:repeat(4,1fr);gap:8px">
${[0,1,2,3].map(col => {
  const slice = ebSummaryRows.slice(col * 30, col * 30 + 30);
  if (slice.length === 0) return `    <div></div>`;
  return `    <div><table style="width:100%">
      <thead><tr><th>Block</th><th>Clusters</th></tr></thead>
      <tbody>
${slice.map(r => `        <tr><td class="mono">${Number(r.block).toLocaleString()}</td><td>${r.clustersUpdated}</td></tr>`).join('\n')}
      </tbody>
    </table></div>`;
}).join('\n')}
  </div>
</div>

<!-- ─── Section 10: Staker Summaries ──────────────────────────────────── -->
<div id="s10" class="section">
  <h2>10. Staker Summaries</h2>

  <h3 style="margin-bottom:8px">cSSV Transfer Breakdown</h3>
  <table style="margin-bottom:20px">
    <thead>
      <tr><th>Metric</th><th>Count</th><th>Notes</th></tr>
    </thead>
    <tbody>
      <tr><td>Total transferCSSV actions</td><td class="mono">${this.cssvTransferTotal}</td><td>All successful cSSV transfers</td></tr>
      <tr><td>Transferred entire cSSV balance</td><td class="mono">${this.cssvTransferAllBalance}</td><td>15% probability per call — sender moved 100% of their cSSV</td></tr>
      <tr><td>Transferred to contract-staker slot</td><td class="mono">${this.cssvTransferToContract}</td><td>20% probability — recipient is a designated contract-staker address</td></tr>
      <tr><td>Transferred to fresh wallet</td><td class="mono">${this.cssvTransferToFreshWallet}</td><td>20% probability — recipient had zero prior SSV/cSSV association</td></tr>
      <tr><td>Contract staker sent transfer</td><td class="mono">${this.cssvTransferFromContract}</td><td>Contract-staker slot acted as sender (not just receiver)</td></tr>
    </tbody>
  </table>

  <h3 style="margin-bottom:8px">Staker Balances</h3>
  <div class="scroll-x">
  <table>
    <thead>
      <tr><th>Address</th><th>cSSV Balance</th><th>Total SSV Staked</th><th>Total ETH Claimed</th></tr>
    </thead>
    <tbody>
${stakerRows.length > 0
  ? stakerRows.map(r => `      <tr>
        <td class="mono">${escapeHtml(r.address.slice(0, 10))}…</td>
        <td>${(Number(BigInt(r.cssvBalance)) / 1e18).toFixed(4)} SSV</td>
        <td>${(Number(BigInt(r.totalStaked)) / 1e18).toFixed(4)} SSV</td>
        <td>${(Number(BigInt(r.totalClaimed)) / 1e18).toFixed(6)} ETH</td>
      </tr>`).join('\n')
  : '      <tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No staker data recorded</td></tr>'}
    </tbody>
  </table>
  </div>
</div>

<!-- ─── Section 11: Protocol Parameters ───────────────────────────────── -->
<div id="s11" class="section">
  <h2>11. Protocol Parameters (at start)</h2>
  <div class="two-col">
    <div>
      <h3>Fee Parameters</h3>
      <table>
        <tr><td>Initial Network Fee</td><td class="mono">3,000,000,000 wei/block</td></tr>
        <tr><td>Min Liquidation Collateral</td><td class="mono">0.001 ETH</td></tr>
        <tr><td>Min Blocks Before Liquidation</td><td class="mono">214,800 (~30 days)</td></tr>
        <tr><td>Operator Max Fee Increase</td><td class="mono">10,000 BPS (100%)</td></tr>
      </table>
    </div>
    <div>
      <h3>Timing Parameters</h3>
      <table>
        <tr><td>Declare Fee Period</td><td class="mono">500 seconds (stress)</td></tr>
        <tr><td>Execute Fee Period</td><td class="mono">500 seconds (stress)</td></tr>
        <tr><td>Unstake Cooldown</td><td class="mono">500 seconds (stress)</td></tr>
        <tr><td>Oracle Slot Count</td><td class="mono">3</td></tr>
      </table>
    </div>
  </div>
</div>

<!-- ─── Section 12: Economic Totals ───────────────────────────────────── -->
<div id="s12" class="section">
  <h2>12. Economic Totals</h2>
  <div class="cards">
    <div class="card">
      <div class="lbl">ETH Deposited</div>
      <div class="val">${(Number(this.totalEthDepositedWei) / 1e18).toFixed(4)} ETH</div>
    </div>
    <div class="card">
      <div class="lbl">ETH Withdrawn (clusters)</div>
      <div class="val">${(Number(this.totalEthWithdrawnByOwnersWei) / 1e18).toFixed(4)} ETH</div>
    </div>
    <div class="card">
      <div class="lbl">ETH Withdrawn (operators)</div>
      <div class="val">${(Number(this.totalOperatorEthWithdrawnWei) / 1e18).toFixed(4)} ETH</div>
    </div>
    <div class="card">
      <div class="lbl">Total Staking Pool Accumulation</div>
      <div class="val">${(Number(expectedEthNetworkFeesStr) / 1e18).toFixed(8)} ETH</div>
    </div>
  </div>
  <p class="small">Note: Economic totals track events during the simulation loop. Teardown withdrawals are not counted.</p>
</div>

<!-- ─── Section 13: Post-Teardown Balances ─────────────────────────────────── -->
<div id="s13" class="section">
  <h2>13. Post-Teardown Balances</h2>
  <p class="small" style="margin-bottom:12px">All clusters self-liquidated, all operator earnings withdrawn, all network SSV withdrawn. Contract ETH must equal the accumulated ETH network fees (staking pool). Contract SSV must equal the original SEED_SSV (seed funds are never consumed by the protocol).</p>
  <table>
    <thead>
      <tr><th>Metric</th><th>Actual</th><th>Expected</th><th>Status</th></tr>
    </thead>
    <tbody>
      <tr>
        <td>Contract ETH</td>
        <td class="mono">${(Number(BigInt(finalContractETHStr)) / 1e18).toFixed(10)} ETH</td>
        <td class="mono">${(Number(BigInt(expectedFinalETHStr)) / 1e18).toFixed(10)} ETH (SEED + netFees)</td>
        <td><span class="badge ${finalContractETHStr === expectedFinalETHStr ? 'badge-ok' : 'badge-danger'}">${finalContractETHStr === expectedFinalETHStr ? 'EXACT MATCH' : 'MISMATCH ' + (BigInt(finalContractETHStr) - BigInt(expectedFinalETHStr)).toString() + ' wei'}</span></td>
      </tr>
      <tr>
        <td>Contract SSV</td>
        <td class="mono">${(Number(BigInt(finalDustSSVStr)) / 1e18).toFixed(10)} SSV</td>
        <td class="mono">${(Number(this.expectedFinalSSV) / 1e18).toFixed(10)} SSV (SEED_SSV)</td>
        <td><span class="badge ${this.finalDustSSV === this.expectedFinalSSV ? 'badge-ok' : 'badge-danger'}">${this.finalDustSSV === this.expectedFinalSSV ? 'EXACT MATCH' : 'MISMATCH ' + (this.finalDustSSV - this.expectedFinalSSV).toString() + ' wei'}</span></td>
      </tr>
      <tr>
        <td>State checks</td>
        <td class="mono">${this.checkStateCallCount.toLocaleString()}</td>
        <td></td>
        <td><span class="badge badge-ok">OK</span></td>
      </tr>
    </tbody>
  </table>
</div>

<!-- ─── Section 15: Simulation Configuration ──────────────────────────── -->
<div id="s15" class="section">
  <h2>15. Simulation Configuration</h2>
  <div class="two-col">
    <div>
      <h3>Scale (Setup)</h3>
      <table>
        <tr><td>Pre-upgrade SSV operators (setup)</td><td>${this.operatorsPreMigration}</td></tr>
        <tr><td>Post-upgrade ETH operators (setup)</td><td>${this.operatorsPostMigrationSetup}</td></tr>
        <tr><td>Post-upgrade ETH operators (dynamic)</td><td>${this.operatorsPostMigrationDynamic}</td></tr>
        <tr><td>Initial SSV clusters</td><td>${this.ssvClustersSetup}</td></tr>
        <tr><td>Initial ETH clusters (setup)</td><td>${this.ethClustersSetup}</td></tr>
        <tr><td>ETH clusters (dynamic)</td><td>${this.ethClustersDynamic}</td></tr>
      </table>
    </div>
    <div>
      <h3>Run Parameters</h3>
      <table>
        <tr><td>Write TXs (target)</td><td>${this.txTarget > 0 ? this.txTarget.toLocaleString() : 'N/A'}</td></tr>
        <tr><td>Write TXs (actual)</td><td>${this.primaryActionCount.toLocaleString()}</td></tr>
        <tr><td>On-chain records (total)</td><td>${this.txCount.toLocaleString()}</td></tr>
        <tr><td>Blocks simulated</td><td>${Number(this.blocksMined).toLocaleString()}</td></tr>
        <tr><td>Sim duration (12s/block)</td><td>${simDuration}</td></tr>
        <tr><td>RNG Seed</td><td class="mono">0xdeadbeef</td></tr>
        <tr><td>Block Step Range</td><td>1 – 8,760</td></tr>
      </table>
    </div>
  </div>
</div>

<!-- ─── Section 16: Assertions Performed ──────────────────────────────── -->
<div id="s16" class="section">
  <h2>16. Assertions Performed</h2>
  <div class="cards" style="margin-bottom:20px">
    <div class="card">
      <div class="lbl">State Checks</div>
      <div class="val ok">${this.checkStateCallCount.toLocaleString()}</div>
    </div>
    <div class="card">
      <div class="lbl">Transactions Executed</div>
      <div class="val">${this.primaryActionCount.toLocaleString()}</div>
    </div>
    <div class="card">
      <div class="lbl">Invariant Failures</div>
      <div class="val${this.failures.length > 0 ? ' danger' : ' ok'}">${this.failures.length.toLocaleString()}</div>
    </div>
    <div class="card">
      <div class="lbl">Pass Rate</div>
      <div class="val ok">${this.checkStateCallCount > 0 ? (((this.checkStateCallCount - this.failures.length) / this.checkStateCallCount) * 100).toFixed(2) : '100.00'}%</div>
    </div>
  </div>
  ${this.failures.length === 0
    ? '<p><span class="badge badge-ok">PASS</span> All ' + this.checkStateCallCount.toLocaleString() + ' state checks passed with no invariant violations.</p>'
    : `<p class="badge badge-danger">FAIL — ${this.failures.length} violation(s) detected</p>
  <div class="scroll-x" style="margin-top:12px">
  <table>
    <thead><tr><th>Block</th><th>Check</th><th>Expected</th><th>Actual</th><th>Action</th></tr></thead>
    <tbody>
${failureRows.map(r => `      <tr>
        <td class="mono">${escapeHtml(r.block)}</td>
        <td>${escapeHtml(r.check)}</td>
        <td class="mono">${escapeHtml(r.expected.slice(0, 30))}</td>
        <td class="mono">${escapeHtml(r.actual.slice(0, 30))}</td>
        <td><span class="tag">${escapeHtml(r.action)}</span></td>
      </tr>`).join('\n')}
    </tbody>
  </table>
  </div>`}
</div>

<!-- ─── Section 17: Transaction Timeline ──────────────────────────────── -->
<div id="s17" class="section">
  <h2>17. Transaction Timeline</h2>
  <p class="small" style="margin-bottom:12px">All transactions in block order, oldest first. Includes cluster actions, operator actions, and network parameter changes. Click any entry to expand details.</p>

  <!-- Filter bar -->
  <div class="tl-filter" id="tlFilterBar">
    <input type="text" class="tl-search" id="tlSearch" placeholder="Search action or account…" oninput="renderTimeline()">
    <button class="tl-filter-btn active" id="tlAll" onclick="setTlFilter('')">All</button>
    <button class="tl-filter-btn" id="tlFilterCluster" onclick="setTlFilter('cluster')">Clusters</button>
    <button class="tl-filter-btn" id="tlFilterOperator" onclick="setTlFilter('operator')">Operators</button>
    <button class="tl-filter-btn" id="tlFilterNetwork" onclick="setTlFilter('network')">Network</button>
  </div>

  <div id="tlContainer" style="max-height:700px;overflow-y:auto;padding-right:8px"></div>
</div>

<!-- ─── Section 18: Cluster Explorer ──────────────────────────────────── -->
<div id="s18" class="section">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <h2 style="margin-bottom:0;border:none;padding:0">18. Cluster Explorer</h2>
    <div style="display:flex;gap:4px">
      <button id="clusterViewExplorer" class="tl-filter-btn active" onclick="setClusterView('explorer')">Explorer</button>
      <button id="clusterViewTimeline" class="tl-filter-btn" onclick="setClusterView('timeline')">Timeline</button>
    </div>
  </div>
  <p class="small" id="clusterViewHint" style="margin-bottom:8px">Click a cluster to see all transactions related to it.</p>
  <div class="tl-filter" id="clusterFnFilterBar" style="margin-bottom:12px"></div>
  <div class="explorer">
    <div class="exp-list" id="clusterList"></div>
    <div class="exp-detail" id="clusterDetail"><div class="exp-empty">← Select a cluster</div></div>
  </div>
</div>

<!-- ─── Section 19: Operator Explorer ────────────────────────────────── -->
<div id="s19" class="section">
  <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
    <h2 style="margin-bottom:0;border:none;padding:0">19. Operator Explorer</h2>
    <div style="display:flex;gap:4px">
      <button id="operatorViewExplorer" class="tl-filter-btn active" onclick="setOperatorView('explorer')">Explorer</button>
      <button id="operatorViewTimeline" class="tl-filter-btn" onclick="setOperatorView('timeline')">Timeline</button>
    </div>
  </div>
  <p class="small" id="operatorViewHint" style="margin-bottom:8px">Click an operator to see its own actions plus all cluster actions on clusters it serves.</p>
  <div class="tl-filter" id="operatorFnFilterBar" style="margin-bottom:12px"></div>
  <div class="explorer">
    <div class="exp-list" id="operatorList"></div>
    <div class="exp-detail" id="operatorDetail"><div class="exp-empty">← Select an operator</div></div>
  </div>
</div>

<!-- ─── Section 20: Assertions Catalog ────────────────────────────────── -->
<div id="s20" class="section">
  <h2>20. Assertions Catalog</h2>
  <p class="small" style="margin-bottom:20px">Every invariant asserted in <code>checkState</code> after each write transaction. Grouped by category. Checks marked <span style="color:#bc8cff">derived</span> are not a single getter call — they build an expected value from TS simulation state and compare to a contract read.</p>

  <h3 style="margin-bottom:10px">Operator Assertions <span class="small">(per non-removed operator)</span></h3>
  <table style="margin-bottom:24px">
    <thead><tr><th>Contract Call</th><th>Compared To</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td class="mono">views.getOperatorEarnings(opId)</td><td class="mono">op.balance</td><td>Accumulated ETH earnings for the operator at current block</td></tr>
      <tr><td class="mono">views.getOperatorEarningsSSV(opId)</td><td class="mono">op.ssvBalance</td><td>SSV earnings — pre-migration operators only (ssvFeeWei &gt; 0)</td></tr>
      <tr><td class="mono">views.getOperatorFee(opId)</td><td class="mono">op.feeWei</td><td>ETH fee rate (wei/block/32 ETH of effective balance)</td></tr>
      <tr><td class="mono">views.getOperatorFeeSSV(opId)</td><td class="mono">op.ssvFeeWei</td><td>SSV fee rate — pre-migration operators only</td></tr>
      <tr><td class="mono">views.getOperatorById(opId).validatorCount</td><td class="mono">Σ cluster.validatorCount for active ETH clusters containing this op</td><td>ETH validator count. Note: this is raw validatorCount, NOT effectiveBalance/32 — oracle EB updates change effectiveBalance but not validatorCount</td></tr>
      <tr><td class="mono">views.getOperatorByIdSSV(opId).validatorCount</td><td class="mono">op.ssvValidatorCount</td><td>SSV validator count — pre-migration operators only</td></tr>
    </tbody>
  </table>

  <h3 style="margin-bottom:10px">Cluster Assertions <span class="small">(all clusters)</span></h3>
  <table style="margin-bottom:24px">
    <thead><tr><th>Contract Call</th><th>Compared To</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td class="mono">views.getClusterAssetType(owner, opIds)</td><td class="mono">cluster.version</td><td>0 = VERSION_SSV (legacy), 1 = VERSION_ETH (post-migration)</td></tr>
      <tr><td class="mono">views.isLiquidated(owner, opIds, struct)</td><td class="mono">true</td><td>Inactive clusters only — verifies they are marked liquidated on-chain</td></tr>
      <tr><td class="mono">views.getBalance(owner, opIds, struct)</td><td class="mono">cluster.balance</td><td>Active ETH clusters — ETH balance at current block including accrued fees</td></tr>
      <tr><td class="mono">views.getBurnRate(owner, opIds, struct)</td><td class="mono">burnPerBlock(cluster)</td><td>Active ETH clusters — wei/block total burn (= cluster.burnRate × effectiveBalance / 32)</td></tr>
      <tr><td class="mono">views.getEffectiveBalance(owner, opIds, struct)</td><td class="mono">cluster.effectiveBalance</td><td>Active ETH clusters — total ETH staked across all validators in the cluster (oracle-set, whole ETH)</td></tr>
      <tr><td class="mono">views.isLiquidatable(owner, opIds, struct)</td><td class="mono">isLiquidatable(cluster, simState)</td><td>Active ETH clusters — true if balance &lt; max(minBlocks × burnPerBlock, minCollateral)</td></tr>
      <tr><td class="mono">views.getBalanceSSV(owner, opIds, struct)</td><td class="mono">cluster.ssvBalance</td><td>Active SSV clusters — SSV wei balance at current block</td></tr>
      <tr><td class="mono">views.getBurnRateSSV(owner, opIds, struct)</td><td class="mono">burnPerBlock(cluster)</td><td>Active SSV clusters — SSV wei/block (= ssvBurnRate × validatorCount)</td></tr>
      <tr><td class="mono">views.isLiquidatableSSV(owner, opIds, struct)</td><td class="mono">isLiquidatable(cluster, simState)</td><td>Active SSV clusters — liquidation check using SSV balance and SSV collateral floor</td></tr>
    </tbody>
  </table>

  <h3 style="margin-bottom:10px">Network Assertions <span class="small">(global)</span></h3>
  <table style="margin-bottom:24px">
    <thead><tr><th>Contract Call</th><th>Compared To</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td class="mono">views.getNetworkEarnings()</td><td class="mono">simState.network.ethNetworkEarnings</td><td>Accumulated ETH network fees — flows into the SSV staking pool for cSSV holders</td></tr>
      <tr><td class="mono">views.getNetworkEarningsSSV()</td><td class="mono">simState.network.ssvNetworkEarnings</td><td>Accumulated SSV DAO treasury fees — separate from ETH staking pool</td></tr>
    </tbody>
  </table>

  <h3 style="margin-bottom:10px">Conservation Assertions <span class="small" style="color:#bc8cff">(derived — built from simulation state)</span></h3>
  <table style="margin-bottom:24px">
    <thead><tr><th>Contract Read</th><th>Expected Value (TS-derived)</th><th>Description</th></tr></thead>
    <tbody>
      <tr>
        <td class="mono">provider.getBalance(networkAddr)</td>
        <td class="mono">SEED_ETH + Σ(active ETH cluster balances) + Σ(op ETH earnings) + ethNetworkFees − totalClampingExcess</td>
        <td>ETH conservation. SEED_ETH is 100 ETH seeded directly to the contract. totalClampingExcess accounts for clusters whose fees exceeded their balance — contract clamps to 0 but operators/network still accrue the full index-based amount, backed by SEED_ETH.</td>
      </tr>
      <tr>
        <td class="mono">ssvToken.balanceOf(networkAddr)</td>
        <td class="mono">SEED_SSV + totalStaked() + pendingUnstakeSSV + ssvNetworkEarnings + Σ(op SSV earnings) + Σ(active SSV cluster balances)</td>
        <td>SSV conservation. SEED_SSV is 100 SSV seeded directly. totalStaked() = cSSV total supply (SSV locked while cSSV is outstanding). pendingUnstakeSSV = Σ staker.pendingUnstake[].amount — requestUnstake() burns cSSV immediately (drops out of totalStaked) but the SSV stays in the contract until withdrawUnlocked() is called.</td>
      </tr>
    </tbody>
  </table>

  <h3 style="margin-bottom:10px">Staking Assertions <span class="small">(per staker + global)</span></h3>
  <table>
    <thead><tr><th>Contract Call</th><th>Compared To</th><th>Notes</th></tr></thead>
    <tbody>
      <tr><td class="mono">views.stakedBalanceOf(staker)</td><td class="mono">staker.cssvBalance</td><td>cSSV balance — increases on stake(), decreases on requestUnstake(). Checked for every staker in simState.stakers.</td></tr>
      <tr><td class="mono">views.pendingUnstake(staker)</td><td class="mono">staker.pendingUnstake[]</td><td>Array of {amount, unlockTime} matching the on-chain withdrawalRequests[]. Both arrays are sorted by (unlockTime, amount) before comparison since withdrawUnlocked uses swap-and-pop which may reorder entries.</td></tr>
      <tr><td class="mono">views.totalStaked()</td><td class="mono">Σ staker.cssvBalance across all stakers</td><td>Global cSSV supply — equals the sum of every individual staker's cssvBalance in the TS simulation.</td></tr>
      <tr><td class="mono">views.getOracleWeight(1)</td><td class="mono">totalCSSV / 4 (integer division)</td><td>Each oracle slot gets totalCSSV / 4 (equal-weighted across 4 slots). Only checked when totalCSSV &gt; 0 to avoid division by zero.</td></tr>
    </tbody>
  </table>
</div>

<!-- ─── Section 21: Revert Checks ─────────────────────────────────────── -->
<div id="s21" class="section">
  <h2>21. Revert Checks</h2>
  <p class="small" style="margin-bottom:20px">Scenarios where the stress test intentionally triggers a contract revert and asserts it happens correctly. Pass = revert occurred as expected. Fail = no revert (unexpected success) or wrong error.</p>
  <table>
    <thead><tr><th>Check</th><th>Action</th><th>Expected Revert</th><th>Description</th></tr></thead>
    <tbody>
      <tr>
        <td style="font-weight:600;white-space:nowrap">Pre-upgrade fee blocked post-upgrade</td>
        <td class="mono" style="font-size:11px">executeOperatorFee</td>
        <td class="mono" style="font-size:11px">LegacyOperatorFeeDeclarationInvalid</td>
        <td>An SSV operator declares a fee change on V1.2.0, then the network is upgraded. Post-upgrade, executing that stale declaration must revert immediately (the timestamp guard fires before the timing check).</td>
      </tr>
      <tr>
        <td style="font-weight:600;white-space:nowrap">SSV cluster rejects ETH ops (×5)</td>
        <td class="mono" style="font-size:11px">withdraw / registerValidator / bulkRegisterValidator / reactivate / deposit</td>
        <td class="mono" style="font-size:11px">IncorrectClusterVersion</td>
        <td>Five ETH-only cluster operations are called on legacy SSV clusters. Each must revert with IncorrectClusterVersion — SSV clusters use separate storage (s.clusters) and cannot be accessed via ETH paths.</td>
      </tr>
      <tr>
        <td style="font-weight:600;white-space:nowrap">Over-unstake (request after burning all cSSV)</td>
        <td class="mono" style="font-size:11px">requestUnstake(1)</td>
        <td class="mono" style="font-size:11px">UnstakeAmountExceedsBalance</td>
        <td>A staker stakes 5 SSV, then calls requestUnstake(5 SSV) burning all their cSSV. A second requestUnstake(1) with zero cSSV balance must revert. Verifies the contract rejects any attempt to over-burn cSSV.</td>
      </tr>
      <tr>
        <td style="font-weight:600;white-space:nowrap">Withdraw too early (only locked requests remain)</td>
        <td class="mono" style="font-size:11px">withdrawUnlocked()</td>
        <td class="mono" style="font-size:11px">NothingToWithdraw</td>
        <td>A staker makes two unstake requests at different times (4 SSV then 6 SSV, separated by the full cooldown period). Once the first entry unlocks, withdrawUnlocked() is called and succeeds — draining the 4 SSV while leaving the 6 SSV request still locked. A second immediate withdrawUnlocked() call must revert with NothingToWithdraw because the remaining entry's unlockTime has not yet passed. The locked entry stays in the pool and is claimed by teardown.</td>
      </tr>
    </tbody>
  </table>
</div>

</div><!-- /container -->

<script>
// ── Chart rendering ────────────────────────────────────────────────────────

const gasData = ${JSON.stringify(gasChartData)};
const conservationData = ${JSON.stringify(conservationData)};
const clusterBalanceData = ${JSON.stringify(clusterBalanceData)};

function renderHorizontalBarChart(svgId, data, labelKey, valueKey, color) {
  const svg = document.getElementById(svgId);
  if (!svg || !data.length) return;
  const barH = 26, gap = 6, labelW = 180, valW = 80;
  const padTop = 8, padBot = 8, padLeft = labelW + 12, padRight = valW + 8;
  const W = 900;
  const H = data.length * (barH + gap) + padTop + padBot;
  svg.setAttribute('height', String(H));
  svg.setAttribute('viewBox', \`0 0 \${W} \${H}\`);

  const vals = data.map(d => Number(d[valueKey]));
  const maxVal = Math.max(...vals, 1);
  const chartW = W - padLeft - padRight;

  let inner = '';
  // Axis line
  inner += \`<line x1="\${padLeft}" y1="\${padTop}" x2="\${padLeft}" y2="\${H - padBot}" stroke="#30363d" stroke-width="1"/>\`;

  data.forEach((d, i) => {
    const val = Number(d[valueKey]);
    const barLen = (val / maxVal) * chartW;
    const y = padTop + i * (barH + gap);
    const midY = (y + barH / 2 + 4).toFixed(1);
    const lbl = String(d[labelKey]).replace(/([A-Z])/g, ' $1').trim();
    // Label
    inner += \`<text x="\${labelW}" y="\${midY}" fill="#8b949e" font-size="11" text-anchor="end" dominant-baseline="middle">\${escHtml(lbl)}</text>\`;
    // Bar
    if (barLen > 0) {
      inner += \`<rect x="\${padLeft}" y="\${y}" width="\${barLen.toFixed(1)}" height="\${barH}" fill="\${color}" opacity="0.8" rx="3"/>\`;
    }
    // Value label
    inner += \`<text x="\${(padLeft + barLen + 6).toFixed(1)}" y="\${midY}" fill="#c9d1d9" font-size="11" dominant-baseline="middle">\${fmtNum(val)}</text>\`;
  });
  svg.innerHTML = inner;
}

function renderLineChart(svgId, data, xKey, yKey, color) {
  const svg = document.getElementById(svgId);
  if (!svg || !data.length) { if(svg) svg.innerHTML='<text x="450" y="100" fill="#8b949e" text-anchor="middle" font-size="14">No data</text>'; return; }
  const W = 900, H = 200, pad = { top: 10, bottom: 30, left: 70, right: 10 };
  const xVals = data.map(d => Number(d[xKey]));
  const yVals = data.map(d => Number(d[yKey]));
  const xMin = Math.min(...xVals), xMax = Math.max(...xVals);
  const yMin = Math.min(0, ...yVals), yMax = Math.max(...yVals, 1);
  const toX = v => pad.left + (xMax > xMin ? (v - xMin) / (xMax - xMin) : 0) * (W - pad.left - pad.right);
  const toY = v => H - pad.bottom - (yMax > yMin ? (v - yMin) / (yMax - yMin) : 0) * (H - pad.top - pad.bottom);

  const pts = data.map(d => \`\${toX(Number(d[xKey])).toFixed(1)},\${toY(Number(d[yKey])).toFixed(1)}\`).join(' ');
  let inner = \`<polyline points="\${pts}" fill="none" stroke="\${color}" stroke-width="1.5"/>\`;
  // Zero line
  if (yMin < 0) {
    const zy = toY(0).toFixed(1);
    inner += \`<line x1="\${pad.left}" y1="\${zy}" x2="\${W - pad.right}" y2="\${zy}" stroke="#f85149" stroke-dasharray="4,2" opacity="0.5"/>\`;
  }
  // Axes
  inner += \`<line x1="\${pad.left}" y1="\${pad.top}" x2="\${pad.left}" y2="\${H - pad.bottom}" stroke="#30363d"/>\`;
  inner += \`<line x1="\${pad.left}" y1="\${H - pad.bottom}" x2="\${W - pad.right}" y2="\${H - pad.bottom}" stroke="#30363d"/>\`;
  // Y labels
  inner += \`<text x="\${pad.left - 4}" y="\${pad.top + 8}" fill="#8b949e" font-size="10" text-anchor="end">\${fmtNum(yMax)}</text>\`;
  inner += \`<text x="\${pad.left - 4}" y="\${H - pad.bottom}" fill="#8b949e" font-size="10" text-anchor="end">\${fmtNum(yMin)}</text>\`;
  // X labels
  inner += \`<text x="\${pad.left}" y="\${H - 4}" fill="#8b949e" font-size="10">\${fmtNum(xMin)}</text>\`;
  inner += \`<text x="\${W - pad.right}" y="\${H - 4}" fill="#8b949e" font-size="10" text-anchor="end">\${fmtNum(xMax)}</text>\`;
  svg.innerHTML = inner;
}

function fmtNum(n) {
  if (Math.abs(n) >= 1e9) return (n / 1e9).toFixed(1) + 'B';
  if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(1) + 'M';
  if (Math.abs(n) >= 1e3) return (n / 1e3).toFixed(1) + 'K';
  return String(Math.round(n));
}

function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;');
}

// ── Account history data ────────────────────────────────────────────────────

const clusterHistoryData = ${JSON.stringify(clusterHistObj)};
const operatorHistoryData = ${JSON.stringify(operatorHistObj)};
const networkHistory = ${JSON.stringify(networkHistoryArr)};
const allTxBlocks = ${JSON.stringify(allTxBlocksArr)};
const networkFeeChanges = ${JSON.stringify(networkFeeChangesArr)};

// ── Build unified timeline: block → [{type, label, account, action, params, event}] ──

const timelineMap = {};
for (const [clusterId, rec] of Object.entries(clusterHistoryData)) {
  for (const e of rec.entries) {
    if (e.action.startsWith('teardown')) continue;
    if (!timelineMap[e.block]) timelineMap[e.block] = [];
    timelineMap[e.block].push({
      type: 'cluster',
      label: clusterId.slice(0,8)+'…',
      account: rec.owner,
      action: e.action,
      params: e.params,
      event: e.event,
    });
  }
}
for (const [addr, rec] of Object.entries(operatorHistoryData)) {
  for (const e of rec.entries) {
    if (e.action.startsWith('teardown')) continue;
    if (!timelineMap[e.block]) timelineMap[e.block] = [];
    timelineMap[e.block].push({
      type: 'operator',
      label: 'op ' + rec.opIds.slice(0,2).join(','),
      account: addr,
      action: e.action,
      params: e.params,
      event: e.event,
    });
  }
}
for (const e of networkHistory) {
  if (!timelineMap[e.block]) timelineMap[e.block] = [];
  timelineMap[e.block].push({
    type: 'network',
    label: 'network',
    account: 'protocol',
    action: e.action,
    params: e.params,
    event: '',
  });
}
const timelineBlocks = Object.keys(timelineMap).map(Number).sort((a,b) => a-b);

// ── Cluster explorer view mode ──────────────────────────────────────────────

let _clusterViewMode = 'explorer';
let _selectedClusterId = null;

function setClusterView(mode) {
  _clusterViewMode = mode;
  document.getElementById('clusterViewExplorer').className = 'tl-filter-btn' + (mode === 'explorer' ? ' active' : '');
  document.getElementById('clusterViewTimeline').className = 'tl-filter-btn' + (mode === 'timeline' ? ' active' : '');
  const hint = document.getElementById('clusterViewHint');
  if (hint) hint.textContent = mode === 'timeline'
    ? 'Click a cluster to see a chronological timeline of all events for that cluster.'
    : 'Click a cluster to see all transactions related to it.';
  // Re-render the detail pane for the currently selected cluster (if any)
  if (_selectedClusterId) selectCluster(_selectedClusterId);
}

// ── Operator explorer view mode ─────────────────────────────────────────────

let _operatorViewMode = 'explorer';
let _selectedOperatorId = null;

function setOperatorView(mode) {
  _operatorViewMode = mode;
  document.getElementById('operatorViewExplorer').className = 'tl-filter-btn' + (mode === 'explorer' ? ' active' : '');
  document.getElementById('operatorViewTimeline').className = 'tl-filter-btn' + (mode === 'timeline' ? ' active' : '');
  const hint = document.getElementById('operatorViewHint');
  if (hint) hint.textContent = mode === 'timeline'
    ? 'Click an operator to see a chronological timeline of all events for that operator.'
    : 'Click an operator to see its own actions plus all cluster actions on clusters it serves.';
  // Re-render the detail pane for the currently selected operator (if any)
  if (_selectedOperatorId !== null) selectOperator(_selectedOperatorId);
}

// ── Vertical timeline rendering ─────────────────────────────────────────────

let tlFilter = '';

function setTlFilter(f) {
  tlFilter = f;
  ['tlAll','tlFilterCluster','tlFilterOperator','tlFilterNetwork'].forEach(id => {
    const el = document.getElementById(id);
    if (el) el.className = 'tl-filter-btn';
  });
  const active = f === '' ? 'tlAll' : f === 'cluster' ? 'tlFilterCluster' : f === 'operator' ? 'tlFilterOperator' : 'tlFilterNetwork';
  const activeEl = document.getElementById(active);
  if (activeEl) activeEl.className = 'tl-filter-btn active';
  renderTimeline();
}

function renderTimeline() {
  const container = document.getElementById('tlContainer');
  if (!container) return;

  const search = (document.getElementById('tlSearch')?.value || '').toLowerCase();

  // Build filtered list of blocks — oldest first (no reverse)
  const filtered = timelineBlocks.filter(b => {
    const txs = (timelineMap[String(b)] || []).filter(tx => {
      if (tlFilter && tx.type !== tlFilter) return false;
      if (search && !tx.action.toLowerCase().includes(search) && !tx.account.toLowerCase().includes(search) && !tx.label.toLowerCase().includes(search)) return false;
      return true;
    });
    return txs.length > 0;
  }); // oldest first — no reverse

  if (filtered.length === 0) {
    container.innerHTML = '<p style="color:var(--text-muted);text-align:center;padding:40px">No transactions match the current filter.</p>';
    return;
  }

  const typeColor = {cluster:'#58a6ff', operator:'#bc8cff', network:'#39d353', teardown:'#d29922'};

  const nodes = filtered.map((b, nodeIdx) => {
    const txs = (timelineMap[String(b)] || []).filter(tx => {
      if (tlFilter && tx.type !== tlFilter) return false;
      if (search && !tx.action.toLowerCase().includes(search) && !tx.account.toLowerCase().includes(search) && !tx.label.toLowerCase().includes(search)) return false;
      return true;
    });

    const blockLabel = Number(b) >= 1_000_000
      ? (Number(b)/1_000_000).toFixed(2)+'M'
      : Number(b).toLocaleString();

    const txItems = txs.map((tx, txIdx) => {
      const detailId = \`td_\${nodeIdx}_\${txIdx}\`;
      const paramsHtml = Object.entries(tx.params).map(([k,v]) =>
        \`<tr><td>\${escHtml(k)}</td><td class="mono">\${escHtml(v)}</td></tr>\`
      ).join('');
      const color = typeColor[tx.type] || '#8b949e';
      return \`<div class="tl-tx" onclick="toggleDetail('\${detailId}')">
          <span class="tag" style="color:\${color};flex-shrink:0">\${escHtml(tx.action)}</span>
          <span style="color:var(--text-muted);font-size:11px;flex-shrink:0">\${escHtml(tx.label)}</span>
          <span style="color:var(--text-muted);font-size:10px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">\${escHtml(tx.account.slice(0,10))}…</span>
        </div>
        <div class="tl-tx-detail" id="\${detailId}">
          <table style="width:100%">
            <tr><td>Account</td><td class="mono">\${escHtml(tx.account)}</td></tr>
            <tr><td>Action</td><td><span class="tag" style="color:\${color}">\${escHtml(tx.action)}</span></td></tr>
            <tr><td>Type</td><td><span class="tag">\${escHtml(tx.type)}</span></td></tr>
            \${paramsHtml}
            <tr><td>Event</td><td style="color:var(--text-muted);font-size:11px">\${escHtml(tx.event)}</td></tr>
          </table>
        </div>\`;
    }).join('');

    return \`<div class="tl-node">
      <div class="tl-circle" title="Block \${Number(b).toLocaleString()}">\${escHtml(blockLabel)}</div>
      <div class="tl-txs">\${txItems}</div>
    </div>\`;
  }).join('');

  container.innerHTML = \`<div class="tl-wrap">\${nodes}</div>\`;
}

function toggleDetail(id) {
  const el = document.getElementById(id);
  if (el) el.classList.toggle('open');
}

// ── Cluster Explorer ────────────────────────────────────────────────────────

let _clusterFnFilter = '';

function buildClusterFnButtons() {
  const bar = document.getElementById('clusterFnFilterBar');
  if (!bar) return;
  // Collect unique action names and count how many clusters have each
  const fnCounts = {};
  const totalClusters = Object.keys(clusterHistoryData).length;
  for (const rec of Object.values(clusterHistoryData)) {
    const seen = new Set();
    for (const e of rec.entries) {
      if (!seen.has(e.action)) { seen.add(e.action); fnCounts[e.action] = (fnCounts[e.action] || 0) + 1; }
    }
  }
  const sorted = Object.keys(fnCounts).sort();
  bar.innerHTML =
    \`<button class="tl-filter-btn active" id="clusterFnAll" onclick="setClusterFnFilter('')">All (\${totalClusters})</button>\` +
    sorted.map(fn =>
      \`<button class="tl-filter-btn" id="clusterFn_\${escHtml(fn)}" onclick="setClusterFnFilter('\${escHtml(fn)}')">\${escHtml(fn)} (\${fnCounts[fn]})</button>\`
    ).join('');
}

function setClusterFnFilter(fn) {
  _clusterFnFilter = fn;
  _selectedClusterId = null;
  // Update button active states
  document.querySelectorAll('#clusterFnFilterBar .tl-filter-btn').forEach(btn => btn.classList.remove('active'));
  // Button IDs include the count suffix, so match by data or just query all and match text
  document.querySelectorAll('#clusterFnFilterBar .tl-filter-btn').forEach(btn => {
    if (fn === '' && btn.id === 'clusterFnAll') btn.classList.add('active');
    else if (fn && btn.id === 'clusterFn_' + fn) btn.classList.add('active');
  });
  buildClusterList();
  const detail = document.getElementById('clusterDetail');
  if (detail) detail.innerHTML = '<div class="exp-empty">← Select a cluster</div>';
}

function buildClusterList() {
  const list = document.getElementById('clusterList');
  if (!list) return;
  let entries = Object.entries(clusterHistoryData);
  if (_clusterFnFilter) {
    entries = entries.filter(([, rec]) => rec.entries.some(e => e.action === _clusterFnFilter));
    // Sort by number of matching-action entries descending so most-active clusters float to top
    entries.sort((a, b) => {
      const ca = a[1].entries.filter(e => e.action === _clusterFnFilter).length;
      const cb = b[1].entries.filter(e => e.action === _clusterFnFilter).length;
      return cb - ca;
    });
  } else {
    entries.sort((a, b) => b[1].entries.length - a[1].entries.length);
  }
  if (entries.length === 0) {
    list.innerHTML = _clusterFnFilter
      ? \`<div class="exp-empty">No clusters with \${escHtml(_clusterFnFilter)}</div>\`
      : '<div class="exp-empty">No clusters</div>';
    return;
  }
  list.innerHTML = entries.map(([id, rec]) => {
    const matchCount = _clusterFnFilter ? rec.entries.filter(e => e.action === _clusterFnFilter).length : rec.entries.length;
    const subLabel = _clusterFnFilter ? \`\${matchCount}× \${escHtml(_clusterFnFilter)}\` : \`\${rec.entries.length} txs\`;
    const versionColor = rec.version === 'ETH' ? '#39d353' : rec.version === 'SSV' ? '#bc8cff' : '#8b949e';
    const versionBadge = rec.version ? \` <span style="color:\${versionColor};font-size:10px;font-weight:600">\${escHtml(rec.version)}</span>\` : '';
    return \`<div class="exp-item" id="ci_\${escHtml(id)}" onclick="selectCluster('\${escHtml(id)}')" >
      <div class="ei-id">\${escHtml(id.slice(0,14))}…\${versionBadge}</div>
      <div class="ei-sub">ops [\${escHtml(rec.operatorIds.slice(0,4).join(', '))}\${rec.operatorIds.length > 4 ? '…' : ''}]  •  \${subLabel}</div>
      <div class="ei-sub">\${escHtml(rec.owner.slice(0,10))}…</div>
    </div>\`;
  }).join('');
}

function showClusterTab(safeId, tab) {
  ['cluster','operator','network','oracle'].forEach(t => {
    const content = document.getElementById('ctab-' + t + '-' + safeId);
    const btn = document.getElementById('ctabBtn-' + t + '-' + safeId);
    if (content) content.style.display = t === tab ? '' : 'none';
    if (btn) btn.className = 'tab-btn' + (t === tab ? ' active' : '');
  });
}

function selectCluster(id) {
  _selectedClusterId = id;
  document.querySelectorAll('#clusterList .exp-item').forEach(el => el.classList.remove('active'));
  const item = document.getElementById('ci_' + id);
  if (item) item.classList.add('active');

  const rec = clusterHistoryData[id];
  const detail = document.getElementById('clusterDetail');
  if (!rec || !detail) return;

  // ── Timeline mode: flat chronological table for this cluster only ──────────
  if (_clusterViewMode === 'timeline') {
    // Collect all event types for this cluster, sorted by block
    const all = [];
    // Cluster own txs
    for (const e of rec.entries) {
      all.push({ block: Number(e.block), source: 'cluster', action: e.action, params: e.params, event: e.event, sub: '' });
    }
    // Operator fee actions for this cluster's operators
    const OP_FEE_ACTIONS = new Set(['declareOperatorFee', 'cancelOperatorFee', 'executeOperatorFee']);
    for (const [, orec] of Object.entries(operatorHistoryData)) {
      const relevantOps = orec.opIds.filter(oid => rec.operatorIds.includes(String(oid)));
      if (relevantOps.length === 0) continue;
      for (const e of orec.entries) {
        if (!OP_FEE_ACTIONS.has(e.action)) continue;
        all.push({ block: Number(e.block), source: 'operator', action: e.action, params: e.params, event: e.event, sub: 'Op #' + relevantOps[0] });
      }
    }
    // Network param changes
    for (const e of networkHistory) {
      all.push({ block: Number(e.block), source: 'network', action: e.action, params: e.params, event: '', sub: 'protocol' });
    }
    all.sort((a, b) => a.block - b.block || a.source.localeCompare(b.source));

    const sourceColor = { cluster: '#58a6ff', operator: '#d29922', network: '#bc8cff' };
    const rows = all.map(e => {
      const params = Object.entries(e.params).map(([k,v]) => \`<span class="tag">\${escHtml(k)}=\${escHtml(v)}</span>\`).join(' ');
      const color = sourceColor[e.source] || '#8b949e';
      const sourceTag = \`<span class="tag" style="color:\${color};font-size:10px">\${escHtml(e.source)}\${e.sub ? ': ' + escHtml(e.sub) : ''}</span>\`;
      const eventStyle = e.event === 'ClusterLiquidated' ? 'color:#f85149' : 'color:var(--text-muted)';
      return \`<tr><td class="mono" style="white-space:nowrap">\${e.block}</td><td>\${sourceTag}</td><td><span class="tag" style="color:\${color}">\${escHtml(e.action)}</span></td><td>\${params}</td><td style="font-size:11px;\${eventStyle}">\${escHtml(e.event)}</td></tr>\`;
    }).join('');

    detail.innerHTML = \`
      <h3 style="margin-bottom:4px">Cluster \${escHtml(id.slice(0,14))}…\${rec.version ? \` <span style="color:\${rec.version==='ETH'?'#39d353':'#bc8cff'};font-size:12px">\${escHtml(rec.version)}</span>\` : ''} — Timeline</h3>
      <p class="small" style="margin-bottom:2px">Owner: <span class="mono">\${escHtml(rec.owner)}</span></p>
      <p class="small" style="margin-bottom:12px">Operators: [\${escHtml(rec.operatorIds.join(', '))}]</p>
      <div class="scroll-x" style="max-height:520px;overflow-y:auto"><table>
        <thead><tr><th>Block</th><th>Source</th><th>Action</th><th>Params</th><th>Event</th></tr></thead>
        <tbody>\${rows || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No events</td></tr>'}</tbody>
      </table></div>\`;
    return;
  }

  // Sanitise id for use in element IDs (strip non-alphanumeric)
  const safeId = id.replace(/[^a-zA-Z0-9]/g, '');

  // ── Tab 1: Cluster Txs (own entries, excluding oracle updateClusterBalance) ──
  const clusterEntries = rec.entries.filter(e => !e.action.startsWith('updateClusterBalance'));
  const clusterRows = clusterEntries.map(e => {
    const params = Object.entries(e.params).map(([k,v]) => \`<span class="tag">\${escHtml(k)}=\${escHtml(v)}</span>\`).join(' ');
    return \`<tr><td class="mono">\${escHtml(e.block)}</td><td><span class="tag">\${escHtml(e.action)}</span></td><td>\${params}</td><td style="color:var(--text-muted);font-size:11px">\${escHtml(e.event)}</td></tr>\`;
  }).join('');

  // ── Tab 2: Operator Actions (declare, cancel, execute) for this cluster's operators ──
  const OP_FEE_ACTIONS = new Set(['declareOperatorFee', 'cancelOperatorFee', 'executeOperatorFee']);
  const opFeeEvents = [];
  for (const [, orec] of Object.entries(operatorHistoryData)) {
    const relevantOps = orec.opIds.filter(oid => rec.operatorIds.includes(String(oid)));
    if (relevantOps.length === 0) continue;
    for (const e of orec.entries) {
      if (!OP_FEE_ACTIONS.has(e.action)) continue;
      opFeeEvents.push({ block: Number(e.block), opId: relevantOps[0], e });
    }
  }
  opFeeEvents.sort((a, b) => a.block - b.block);
  const opFeeActionColors = { declareOperatorFee: '#d29922', cancelOperatorFee: '#f85149', executeOperatorFee: '#3fb950' };
  const opFeeRows = opFeeEvents.map(({ block, opId, e }) => {
    const params = Object.entries(e.params).map(([k,v]) => \`<span class="tag">\${escHtml(k)}=\${escHtml(v)}</span>\`).join(' ');
    const color = opFeeActionColors[e.action] || '#8b949e';
    return \`<tr><td class="mono">\${block}</td><td style="font-size:11px;color:var(--text-muted)">Op #\${opId}</td><td><span class="tag" style="color:\${color}">\${escHtml(e.action)}</span></td><td>\${params}</td></tr>\`;
  }).join('');

  // ── Tab 3: Network Calls (fee + liq params) ──
  const netEntries = networkHistory.slice().sort((a, b) => Number(a.block) - Number(b.block));
  const netColors = { updateNetworkFee: '#58a6ff', updateLiquidationThresholdPeriod: '#bc8cff', updateMinimumLiquidationCollateral: '#39d353' };
  const netRows = netEntries.map(e => {
    const params = Object.entries(e.params).map(([k,v]) => \`<span class="tag">\${escHtml(k)}=\${escHtml(v)}</span>\`).join(' ');
    const color = netColors[e.action] || '#8b949e';
    return \`<tr><td class="mono">\${escHtml(e.block)}</td><td><span class="tag" style="color:\${color}">\${escHtml(e.action)}</span></td><td>\${params}</td></tr>\`;
  }).join('');

  // ── Tab 4: Oracle (updateClusterBalance for this cluster only) ──
  const oracleEntries = rec.entries.filter(e => e.action.startsWith('updateClusterBalance'));
  const oracleActionColors = { 'updateClusterBalance': '#3fb950', 'updateClusterBalance-skipped': '#d29922' };
  const oracleRows = oracleEntries.map(e => {
    const params = Object.entries(e.params).map(([k,v]) => \`<span class="tag">\${escHtml(k)}=\${escHtml(v)}</span>\`).join(' ');
    const color = oracleActionColors[e.action] || '#8b949e';
    const eventStyle = e.event === 'ClusterLiquidated' ? 'color:#f85149' : 'color:var(--text-muted)';
    return \`<tr><td class="mono">\${escHtml(e.block)}</td><td><span class="tag" style="color:\${color}">\${escHtml(e.action)}</span></td><td>\${params}</td><td style="font-size:11px;\${eventStyle}">\${escHtml(e.event)}</td></tr>\`;
  }).join('');

  detail.innerHTML = \`
    <h3 style="margin-bottom:4px">Cluster \${escHtml(id.slice(0,14))}…\${rec.version ? \` <span style="color:\${rec.version==='ETH'?'#39d353':'#bc8cff'};font-size:12px">\${escHtml(rec.version)}</span>\` : ''}</h3>
    <p class="small" style="margin-bottom:2px">Owner: <span class="mono">\${escHtml(rec.owner)}</span></p>
    <p class="small" style="margin-bottom:12px">Operators: [\${escHtml(rec.operatorIds.join(', '))}]</p>

    <div class="tab-bar">
      <button id="ctabBtn-cluster-\${safeId}" class="tab-btn active" onclick="showClusterTab('\${safeId}','cluster')">Cluster Txs (\${clusterEntries.length})</button>
      <button id="ctabBtn-operator-\${safeId}" class="tab-btn" onclick="showClusterTab('\${safeId}','operator')">Operator Actions (\${opFeeEvents.length})</button>
      <button id="ctabBtn-network-\${safeId}" class="tab-btn" onclick="showClusterTab('\${safeId}','network')">Network (\${netEntries.length})</button>
      <button id="ctabBtn-oracle-\${safeId}" class="tab-btn" onclick="showClusterTab('\${safeId}','oracle')">Oracle (\${oracleEntries.length})</button>
    </div>

    <div id="ctab-cluster-\${safeId}">
      <p class="small" style="margin-bottom:8px;color:var(--text-muted)">Direct cluster transactions: deposits, withdrawals, register/remove validators, liquidation, reactivation, migration.</p>
      <div class="scroll-x"><table>
        <thead><tr><th>Block</th><th>Action</th><th>Params</th><th>Event</th></tr></thead>
        <tbody>\${clusterRows || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No transactions</td></tr>'}</tbody>
      </table></div>
    </div>

    <div id="ctab-operator-\${safeId}" style="display:none">
      <p class="small" style="margin-bottom:8px;color:var(--text-muted)">Fee declarations, cancellations, and executions from operators in this cluster's set. Executions change the cluster's burn rate.</p>
      <div class="scroll-x"><table>
        <thead><tr><th>Block</th><th>Operator</th><th>Action</th><th>Params</th></tr></thead>
        <tbody>\${opFeeRows || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No operator fee actions</td></tr>'}</tbody>
      </table></div>
    </div>

    <div id="ctab-network-\${safeId}" style="display:none">
      <p class="small" style="margin-bottom:8px;color:var(--text-muted)">Protocol-level parameter changes that affect all clusters: ETH network fee, liquidation threshold, and liquidation collateral floor.</p>
      <div class="scroll-x"><table>
        <thead><tr><th>Block</th><th>Action</th><th>Params</th></tr></thead>
        <tbody>\${netRows || '<tr><td colspan="3" style="text-align:center;color:var(--text-muted)">No network param changes</td></tr>'}</tbody>
      </table></div>
    </div>

    <div id="ctab-oracle-\${safeId}" style="display:none">
      <p class="small" style="margin-bottom:8px;color:var(--text-muted)">Oracle effective balance updates for this cluster. Only rounds that included this cluster appear here. Auto-liquidated entries are shown in red.</p>
      <div class="scroll-x"><table>
        <thead><tr><th>Block</th><th>Action</th><th>Params</th><th>Event</th></tr></thead>
        <tbody>\${oracleRows || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No oracle EB updates for this cluster</td></tr>'}</tbody>
      </table></div>
    </div>
  \`;
}

// ── Operator Explorer ────────────────────────────────────────────────────────

// Build opId → ownerAddr index (each operator ID gets its own list item)
const opIdToOwner = {};
for (const [addr, rec] of Object.entries(operatorHistoryData)) {
  for (const id of rec.opIds) opIdToOwner[id] = addr;
}
const allOpIds = Object.keys(opIdToOwner).map(Number).sort((a, b) => a - b);

let _opFnFilter = '';

function buildOperatorFnButtons() {
  const bar = document.getElementById('operatorFnFilterBar');
  if (!bar) return;
  // Collect all unique action names from operator own entries AND their cluster entries
  const fns = new Set();
  for (const rec of Object.values(operatorHistoryData)) {
    for (const e of rec.entries) fns.add(e.action);
  }
  // Also include cluster actions (removeOperator shows in cluster history)
  for (const rec of Object.values(clusterHistoryData)) {
    for (const e of rec.entries) fns.add(e.action);
  }
  const sorted = Array.from(fns).sort();
  bar.innerHTML =
    \`<button class="tl-filter-btn active" id="opFnAll" onclick="setOpFnFilter('')">All</button>\` +
    sorted.map(fn =>
      \`<button class="tl-filter-btn" id="opFn_\${escHtml(fn)}" onclick="setOpFnFilter('\${escHtml(fn)}')">\${escHtml(fn)}</button>\`
    ).join('');
}

function setOpFnFilter(fn) {
  _opFnFilter = fn;
  document.querySelectorAll('#operatorFnFilterBar .tl-filter-btn').forEach(btn => btn.classList.remove('active'));
  const activeBtn = fn ? document.getElementById('opFn_' + fn) : document.getElementById('opFnAll');
  if (activeBtn) activeBtn.classList.add('active');
  buildOperatorList();
}

function buildOperatorList() {
  const list = document.getElementById('operatorList');
  if (!list) return;
  if (allOpIds.length === 0) { list.innerHTML = '<div class="exp-empty">No operators</div>'; return; }

  let ids = allOpIds;
  if (_opFnFilter) {
    ids = ids.filter(opId => {
      const owner = opIdToOwner[opId];
      const rec = owner ? operatorHistoryData[owner] : null;
      // Match own operator actions
      if (rec && rec.entries.some(e => e.action === _opFnFilter)) return true;
      // Match cluster actions on clusters this operator serves
      return Object.values(clusterHistoryData).some(crec =>
        crec.operatorIds.includes(String(opId)) && crec.entries.some(e => e.action === _opFnFilter)
      );
    });
  }

  if (ids.length === 0) {
    list.innerHTML = _opFnFilter
      ? \`<div class="exp-empty">No operators with \${escHtml(_opFnFilter)}</div>\`
      : '<div class="exp-empty">No operators</div>';
    return;
  }

  list.innerHTML = ids.map(opId => {
    const owner = opIdToOwner[opId];
    const rec = operatorHistoryData[owner];
    const clusterCount = Object.values(clusterHistoryData)
      .filter(crec => crec.operatorIds.includes(String(opId))).length;
    return \`<div class="exp-item" id="oi_\${opId}" onclick="selectOperator(\${opId})">
      <div class="ei-id">Operator #\${opId}</div>
      <div class="ei-sub">\${rec ? rec.entries.length + ' own txs' : '0 own txs'} • \${clusterCount} cluster(s)</div>
      <div class="ei-sub">\${escHtml(owner ? owner.slice(0,10) : '?')}…</div>
    </div>\`;
  }).join('');
}

function selectOperator(opId) {
  _selectedOperatorId = opId;
  document.querySelectorAll('#operatorList .exp-item').forEach(el => el.classList.remove('active'));
  const item = document.getElementById('oi_' + opId);
  if (item) item.classList.add('active');

  const detail = document.getElementById('operatorDetail');
  if (!detail) return;

  const owner = opIdToOwner[opId];
  const rec = owner ? operatorHistoryData[owner] : null;

  // ── Timeline mode: flat chronological table for this operator only ─────────
  if (_operatorViewMode === 'timeline') {
    const all = [];
    // Own operator actions
    if (rec) {
      for (const e of rec.entries) {
        all.push({ block: Number(e.block), source: 'operator', action: e.action, params: e.params, event: e.event, sub: '' });
      }
    }
    // All cluster actions on clusters this operator serves
    for (const [cid, crec] of Object.entries(clusterHistoryData)) {
      if (!crec.operatorIds.includes(String(opId))) continue;
      for (const e of crec.entries) {
        all.push({ block: Number(e.block), source: 'cluster', action: e.action, params: e.params, event: e.event, sub: cid.slice(0,8)+'…' });
      }
    }
    // Network param changes
    for (const e of networkHistory) {
      all.push({ block: Number(e.block), source: 'network', action: e.action, params: e.params, event: '', sub: 'protocol' });
    }
    all.sort((a, b) => a.block - b.block || a.source.localeCompare(b.source));

    const sourceColor = { operator: '#bc8cff', cluster: '#58a6ff', network: '#39d353' };
    const rows = all.map(e => {
      const params = Object.entries(e.params).map(([k,v]) => \`<span class="tag">\${escHtml(k)}=\${escHtml(v)}</span>\`).join(' ');
      const color = sourceColor[e.source] || '#8b949e';
      const sourceTag = \`<span class="tag" style="color:\${color};font-size:10px">\${escHtml(e.source)}\${e.sub ? ': ' + escHtml(e.sub) : ''}</span>\`;
      const eventStyle = e.event === 'ClusterLiquidated' ? 'color:#f85149' : 'color:var(--text-muted)';
      return \`<tr><td class="mono" style="white-space:nowrap">\${e.block}</td><td>\${sourceTag}</td><td><span class="tag" style="color:\${color}">\${escHtml(e.action)}</span></td><td>\${params}</td><td style="font-size:11px;\${eventStyle}">\${escHtml(e.event)}</td></tr>\`;
    }).join('');

    detail.innerHTML = \`
      <h3 style="margin-bottom:6px">Operator #\${opId} — Timeline</h3>
      <p class="small" style="margin-bottom:12px">Owner: <span class="mono">\${owner ? escHtml(owner) : 'unknown'}</span></p>
      <div class="scroll-x" style="max-height:520px;overflow-y:auto"><table>
        <thead><tr><th>Block</th><th>Source</th><th>Action</th><th>Params</th><th>Event</th></tr></thead>
        <tbody>\${rows || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No events</td></tr>'}</tbody>
      </table></div>\`;
    return;
  }

  // Own operator actions — fee-related actions (declare/execute/cancel) are highlighted in amber
  const FEE_OP_ACTIONS = new Set(['declareOperatorFee', 'executeOperatorFee', 'cancelOperatorFee']);
  const ownRows = rec ? rec.entries
    .filter(e => {
      // Only show actions belonging to this specific opId (each owner may have multiple ops)
      // Actions recorded via recordOperatorTx include the opId in the record's opIds array,
      // but entries are owner-level. We can't filter by opId here without extra metadata,
      // so we show all owner actions (consistent with prior behaviour).
      return true;
    })
    .map(e => {
      const params = Object.entries(e.params).map(([k,v]) => \`<span class="tag">\${escHtml(k)}=\${escHtml(v)}</span>\`).join(' ');
      const isFee = FEE_OP_ACTIONS.has(e.action);
      const tagStyle = isFee ? 'style="background:#2d2011;color:#d29922;border-color:#6b4e1a"' : '';
      return \`<tr\${isFee ? ' style="background:rgba(210,153,34,0.05)"' : ''}>
        <td class="mono">\${escHtml(e.block)}</td>
        <td><span class="tag" \${tagStyle}>\${escHtml(e.action)}</span></td>
        <td>\${params}</td>
        <td style="color:var(--text-muted);font-size:11px">\${escHtml(e.event)}</td>
      </tr>\`;
    }).join('') : '';

  // Cluster actions that affect operator's effective balance (EB tracking)
  const EB_ACTIONS = new Set(['registerValidator','bulkRegisterValidator','removeValidator','bulkRemoveValidator','migrateCluster','reactivate','liquidate','updateClusterBalance']);

  const relatedClusters = Object.entries(clusterHistoryData)
    .filter(([, crec]) => crec.operatorIds.includes(String(opId)));

  const clusterRows = relatedClusters
    .flatMap(([cid, crec]) => crec.entries
      .filter(e => EB_ACTIONS.has(e.action))
      .map(e => ({ block: Number(e.block), cid, e }))
    )
    .sort((a, b) => a.block - b.block)
    .map(({ block, cid, e }) => {
      const eb = e.params.eb || '';
      const isPositive = eb.startsWith('+');
      const isNegative = eb.startsWith('-');
      const ebColor = isPositive ? '#3fb950' : isNegative ? '#f85149' : '#8b949e';
      const ebDisplay = eb ? \`<span style="font-weight:700;color:\${ebColor};font-family:monospace">\${escHtml(eb)}</span>\` : '';
      return \`<tr><td class="mono">\${block}</td><td class="mono" style="font-size:10px">\${escHtml(cid.slice(0,10))}…</td><td><span class="tag" style="color:#58a6ff">\${escHtml(e.action)}</span></td><td>\${ebDisplay}</td><td style="color:var(--text-muted);font-size:11px">\${escHtml(e.event)}</td></tr>\`;
    }).join('');

  detail.innerHTML = \`
    <h3 style="margin-bottom:6px">Operator #\${opId}</h3>
    <p class="small" style="margin-bottom:12px">Owner: <span class="mono">\${owner ? escHtml(owner) : 'unknown'}</span></p>
    <h3 style="margin-bottom:8px">Operator Actions (\${rec ? rec.entries.length : 0})</h3>
    <div class="scroll-x">
    <table>
      <thead><tr><th>Block</th><th>Action</th><th>Params</th><th>Event</th></tr></thead>
      <tbody>\${ownRows || '<tr><td colspan="4" style="text-align:center;color:var(--text-muted)">No direct operator actions recorded</td></tr>'}</tbody>
    </table>
    </div>
    \${relatedClusters.length > 0 ? \`
    <h3 style="margin-top:20px;margin-bottom:8px">Effective Balance Changes on \${relatedClusters.length} cluster(s)</h3>
    <p class="small" style="margin-bottom:8px;color:var(--text-muted)">Actions that change this operator's tracked ETH effective balance: register/remove validators, migrate (SSV→ETH), reactivate, liquidate, oracle EB update.</p>
    <div class="scroll-x">
    <table>
      <thead><tr><th>Block</th><th>Cluster</th><th>Action</th><th>EB Change</th><th>Event</th></tr></thead>
      <tbody>\${clusterRows || '<tr><td colspan="5" style="text-align:center;color:var(--text-muted)">No EB-affecting actions</td></tr>'}</tbody>
    </table>
    </div>\` : '<p class="small" style="margin-top:12px;color:var(--text-muted)">No clusters recorded for this operator.</p>'}
  \`;
}

// ── Global event timeline (histogram above charts) ──────────────────────────

function renderEventTimeline() {
  const svg = document.getElementById('eventTimelineSvg');
  if (!svg || !allTxBlocks.length) return;
  const BUCKETS = 50;
  const blocks = allTxBlocks.map(e => e.b);
  const bMin = Math.min(...blocks), bMax = Math.max(...blocks);
  const range = bMax - bMin || 1;
  const buckets = new Array(BUCKETS).fill(0);
  blocks.forEach(b => {
    const idx = Math.min(BUCKETS - 1, Math.floor(((b - bMin) / range) * BUCKETS));
    buckets[idx]++;
  });
  const maxV = Math.max(...buckets, 1);
  const W = 900, H = 140, padL = 40, padB = 20;
  const bw = (W - padL) / BUCKETS;
  let inner = '';
  buckets.forEach((v, i) => {
    const bh = (v / maxV) * (H - padB - 10);
    const x = padL + i * bw + 0.5;
    const y = H - padB - bh;
    inner += \`<rect x="\${x.toFixed(1)}" y="\${y.toFixed(1)}" width="\${(bw - 1).toFixed(1)}" height="\${bh.toFixed(1)}" fill="#58a6ff" opacity="0.75" class="hist-bar" title="bucket \${i}: \${v} txs"/>\`;
  });
  inner += \`<line x1="\${padL}" y1="0" x2="\${padL}" y2="\${H - padB}" stroke="#30363d"/>\`;
  inner += \`<line x1="\${padL}" y1="\${H - padB}" x2="\${W}" y2="\${H - padB}" stroke="#30363d"/>\`;
  inner += \`<text x="\${padL - 2}" y="12" fill="#8b949e" font-size="10" text-anchor="end">\${maxV}</text>\`;
  inner += \`<text x="\${padL}" y="\${H - 4}" fill="#8b949e" font-size="9">block \${fmtNum(bMin)}</text>\`;
  inner += \`<text x="\${W}" y="\${H - 4}" fill="#8b949e" font-size="9" text-anchor="end">block \${fmtNum(bMax)}</text>\`;
  svg.innerHTML = inner;
}

// Render all charts on load
window.addEventListener('DOMContentLoaded', () => {
  renderHorizontalBarChart('gasChartSvg', gasData, 'name', 'avgGas', '#58a6ff');
  renderLineChart('conservationChartSvg', conservationData, 'block', 'excessEth', '#3fb950');
  renderLineChart('clusterBalanceChartSvg', clusterBalanceData, 'block', 'ethValue', '#f78166');
  renderEventTimeline();
  renderTimeline();
  buildClusterFnButtons();
  buildClusterList();
  buildOperatorFnButtons();
  buildOperatorList();
});
</script>
</body>
</html>`;
    return html;
  }

  async writeHTML(filePath: string, simSummary?: object): Promise<void> {
    const html = this.generateHTML(simSummary);
    await fs.writeFile(filePath, html, 'utf-8');
    console.log(`HTML report written to: ${filePath}`);
  }
}

// ── Module-level escapeHtml (used in template) ────────────────────────────
function escapeHtml(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

import * as fs from 'fs/promises';
import * as fsSync from 'fs';
import * as path from 'path';
import { GAS_PRICE_FOR_REPORT } from './constants.ts';

const TEMPLATE_PATH = path.join(process.cwd(), 'test', 'stress', 'reports', 'template.html');

const ERROR_FILE_PATH     = path.join(process.cwd(), 'test', 'stress', 'reports', 'stress-error-specific.txt');
const ERROR_ALL_FILE_PATH = path.join(process.cwd(), 'test', 'stress', 'reports', 'stress-error-all.txt');
const SUCCESS_ALL_FILE_PATH = path.join(process.cwd(), 'test', 'stress', 'reports', 'stress-all-tx.txt');

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
}

interface OperatorHistoryRecord {
  owner: string;
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

export class RunReport {
  entries: ActionEntry[] = [];
  blocksMined: bigint = 0n;
  miningRounds: number = 0;
  checkStateCallCount: number = 0;
  startTimeMs: number = Date.now();

  actionStats: Map<string, ActionStats> = new Map();

  totalEthDepositedWei: bigint = 0n;
  totalEthWithdrawnByOwnersWei: bigint = 0n;
  totalOperatorEthWithdrawnWei: bigint = 0n;

  conservationHistory: ConservationPoint[] = [];

  ebUpdateHistory: EBUpdatePoint[] = [];

  totalClustersLiquidated: number = 0;
  clusterLiquidationAges: string[] = [];  // ageBlocks stored as strings
  runwayLiquidations: Array<{ blocksLeft: string }> = [];      // balance < minimumBlocksBeforeLiquidation * burnPerBlock
  collateralLiquidations: Array<{ amountLeft: string }> = [];  // balance < minimumLiquidationCollateral
  totalReactivations: number = 0;

  ethClustersSetup: number = 0;          // ETH clusters from setup (STRESS_ETH_CLUSTERS)
  ethClustersDynamic: number = 0;        // ETH clusters created during run
  ssvClustersSetup: number = 0;          // SSV clusters from setup (STRESS_SSV_CLUSTERS)
  migrationsSetup: number = 0;           // SSV→ETH migrations during setup
  migrationsDynamic: number = 0;         // SSV→ETH migrations during run
  ssvClustersLiquidatedBeforeMigration: number = 0; // SSV clusters liquidated instead of migrated
  txTarget: number = 0;                  // STRESS_TARGET_WRITE_TXS (set by caller)
  operatorsPreMigration: number = 0;     // STRESS_OPERATORS_PRE_UPGRADE (setup)
  operatorsPostMigrationSetup: number = 0; // STRESS_OPERATORS_POST_UPGRADE (setup)
  operatorsPostMigrationDynamic: number = 0; // operators registered during run
  operatorPrivateCount: number = 0;      // includes removed operators
  operatorPublicCount: number = 0;       // includes removed operators
  operatorRemovedCount: number = 0;
  operatorZeroFeeCount: number = 0;      // active (non-removed) operators only
  operatorAvgYearlyFeeEth: number = 0;   // average yearly ETH fee, active non-zero-fee operators only

  networkHistory: Array<{ block: string; action: string; params: Record<string, string> }> = [];

  networkFeeEthWei: bigint = 0n;         // ETH fee per block per DEFAULT_EB unit
  networkFeeSSVWei: bigint = 0n;         // SSV fee per block per validator
  networkEarningsEthWei: bigint = 0n;    // total ETH network fees accumulated (simState)
  networkEarningsSSVWei: bigint = 0n;    // total SSV network fees accumulated (simState)

  stakerSummaries: StakerSummary[] = [];

  failures: FailureRecord[] = [];

  networkFeeChanges: Array<{ block: string; oldFee: string; newFee: string }> = [];

  ebRaised:    number = 0;  // updateClusterBalance calls that raised EB
  ebLowered:   number = 0;  // updateClusterBalance calls that lowered EB
  ebSkipped:   number = 0;  // entries committed but never applied (abandoned or intentional)
  ebLiquidated: number = 0; // updateClusterBalance calls that auto-liquidated the cluster
  ebRounds:    number = 0;  // total commitEBRoot calls

  stakerHistory: Map<string, TxHistoryEntry[]> = new Map();
  clusterHistory: Map<string, ClusterHistoryRecord> = new Map();
  operatorHistory: Map<string, OperatorHistoryRecord> = new Map();

  ethPriceUSD: number = 3000;
  finalContractETH: bigint = 0n;         // contract ETH after teardown
  expectedFinalETH: bigint = 0n;         // SEED_ETH + accumulated network fees (set by teardown)
  finalDustSSV: bigint = 0n;             // contract SSV after teardown (must equal expectedFinalSSV = SEED_SSV)
  expectedFinalSSV: bigint = 0n;         // expected final SSV balance (= SEED_SSV, set by teardown)
  expectedEthNetworkFees: bigint = 0n;   // accumulated ETH network fees (staking pool for SSV stakers)
  lastAccEthPerShare: bigint = 0n;
  totalStakingDust: bigint = 0n;         // cumulative ETH precision loss from staker reward distribution

  cssvTransferTotal: number = 0;              // total transferCSSV actions
  cssvTransferAllBalance: number = 0;         // times sender transferred their entire cSSV balance
  cssvTransferToContract: number = 0;         // times recipient was a contract-staker slot
  cssvTransferToFreshWallet: number = 0;      // times recipient was a brand-new non-SSV wallet
  cssvTransferFromContract: number = 0;       // times the sender was a contract staker

  record(name: string, gasUsed: bigint, block: bigint): void {
    this.entries.push({ name, gasUsed, block });

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

  recordLiquidation(ageBlocks: bigint): void {
    this.totalClustersLiquidated++;
    this.clusterLiquidationAges.push(ageBlocks.toString());
  }

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

  recordNetworkStats(network: { feeWei: bigint; feeSSVWei: bigint; ethNetworkEarnings: bigint; ssvNetworkEarnings: bigint }): void {
    this.networkFeeEthWei      = network.feeWei;
    this.networkFeeSSVWei      = network.feeSSVWei;
    this.networkEarningsEthWei = network.ethNetworkEarnings;
    this.networkEarningsSSVWei = network.ssvNetworkEarnings;
  }

  recordStakingDust(dust: bigint): void {
    this.totalStakingDust = dust;
  }

  recordCSSVTransfer(transferredAll: boolean, recipientType: 'existing' | 'contract' | 'fresh', senderIsContract: boolean): void {
    this.cssvTransferTotal++;
    if (transferredAll)            this.cssvTransferAllBalance++;
    if (recipientType === 'contract') this.cssvTransferToContract++;
    if (recipientType === 'fresh')    this.cssvTransferToFreshWallet++;
    if (senderIsContract)          this.cssvTransferFromContract++;
  }

  recordOperatorStats(operators: Map<bigint, { isPrivate: boolean; isRemoved: boolean; feeWei: bigint }>): void {
    const BLOCKS_PER_YEAR = 7160n * 365n; // 2,613,400 blocks/year
    let privateCount = 0, publicCount = 0, removedCount = 0, zeroFeeCount = 0;
    let feeSumWei = 0n, feeCount = 0;
    for (const op of operators.values()) {
      if (op.isPrivate) privateCount++; else publicCount++;
      if (op.isRemoved) { removedCount++; continue; }
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

  recordStakerSummaries(stakers: Map<string, { address: string; cssvBalance: bigint; pendingUnstake: { amount: bigint }[]; ethClaimed: bigint }>): void {
    this.stakerSummaries = [];
    for (const s of stakers.values()) {
      let totalStaked = s.cssvBalance;
      for (const r of s.pendingUnstake) totalStaked += r.amount;
      this.stakerSummaries.push({
        address: s.address,
        cssvBalance: s.cssvBalance.toString(),
        totalStaked: totalStaked.toString(),
        totalClaimed: s.ethClaimed.toString(),
      });
    }
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

  recordStakerTx(address: string, block: bigint, action: string, params: Record<string, string>, event: string): void {
    const key = address.toLowerCase();
    if (!this.stakerHistory.has(key)) this.stakerHistory.set(key, []);
    this.stakerHistory.get(key)!.push({ block: block.toString(), action, params, event });
  }

  recordNetworkAction(block: bigint, action: string, params: Record<string, string>): void {
    this.networkHistory.push({ block: block.toString(), action, params });
  }

  recordNetworkFeeChange(block: bigint, oldFee: bigint, newFee: bigint): void {
    this.networkFeeChanges.push({ block: block.toString(), oldFee: oldFee.toString(), newFee: newFee.toString() });
  }

  recordClusterTx(clusterId: string, owner: string, operatorIds: bigint[], block: bigint, action: string, params: Record<string, string>, event: string): void {
    if (!this.clusterHistory.has(clusterId)) {
      this.clusterHistory.set(clusterId, { owner, operatorIds: operatorIds.map(id => id.toString()), entries: [] });
    }
    this.clusterHistory.get(clusterId)!.entries.push({ block: block.toString(), action, params, event });
  }

  recordOperatorTx(ownerAddress: string, opId: bigint, block: bigint, action: string, params: Record<string, string>, event: string): void {
    const key = opId.toString();
    if (!this.operatorHistory.has(key)) this.operatorHistory.set(key, { owner: ownerAddress.toLowerCase(), entries: [] });
    this.operatorHistory.get(key)!.entries.push({ block: block.toString(), action, params, event });
  }

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

    for (const id of clusterIds) addCluster(id);

    for (const opId of opIds) {
      const rec = this.operatorHistory.get(opId.toString());
      if (rec) {
        for (const e of rec.entries) {
          const key = `op:${opId}:${e.block}:${e.action}`;
          if (seen.has(key)) continue;
          seen.add(key);
          const paramStr = Object.entries(e.params).map(([k, v]) => `${k}=${v}`).join(' ');
          lines.push({ block: BigInt(e.block), text: `  block=${e.block.padStart(10)}  op=${opId}  ${e.action}  [${e.event}]  ${paramStr}` });
        }
      }
      const idStr = String(opId);
      for (const [clusterId, crec] of this.clusterHistory) {
        if (!crec.operatorIds.includes(idStr)) continue;
        addCluster(clusterId);
      }
    }

    if (lines.length === 0) {
      console.error('  (no history found)');
      return;
    }

    lines.sort((a, b) => (a.block < b.block ? -1 : a.block > b.block ? 1 : 0));

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

    const tail = lines.slice(-5);
    console.error(`\n  Last ${tail.length} of ${lines.length} history entries (specific → ${ERROR_FILE_PATH}):`);
    for (const l of tail) console.error(l.text);

    this.writeFullHistory(subject);
  }

  getClusterTrace(clusterId: string): void { this.printTimeline([clusterId], []); }
  getOperatorTrace(opId: bigint): void { this.printTimeline([], [opId]); }

  writeHistory(filePath: string, subject: string): void {
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

    for (const [opId, rec] of this.operatorHistory) {
      for (const e of rec.entries) {
        const key = `o:${opId}:${e.block}:${e.action}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const p = Object.entries(e.params).map(([k, v]) => `${k}=${v}`).join(' ');
        lines.push({ block: BigInt(e.block), text: `  op=${opId}  block=${e.block.padStart(10)}  ${e.action}  [${e.event}]  ${p}` });
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
      fsSync.writeFileSync(filePath, fileLines.join('\n') + '\n', 'utf8');
      console.log(`  full TX history (${lines.length} entries) → ${filePath}`);
    } catch { /* non-fatal */ }
  }

  writeFullHistory(subject: string): void {
    this.writeHistory(ERROR_ALL_FILE_PATH, subject);
  }

  writeSuccessHistory(): void {
    this.writeHistory(SUCCESS_ALL_FILE_PATH, 'successful run');
  }

  primaryActionCount: number = 0;

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

  buildReportData(): Record<string, any> {
    const elapsedTotalSecs = Math.floor((Date.now() - this.startTimeMs) / 1000);
    const elapsedMins = Math.floor(elapsedTotalSecs / 60);
    const elapsedSecs = elapsedTotalSecs % 60;
    const elapsed = elapsedMins > 0 ? `${elapsedMins}m ${elapsedSecs}s` : `${elapsedSecs}s`;
    const counts = this.actionCounts();
    const sortedActions = Object.entries(counts).sort((a, b) => b[1] - a[1]);

    const actionTableRows = sortedActions.map(([name, count]) => {
      const stats = this.actionStats.get(name);
      const avgGas = stats ? (stats.gasTotal / BigInt(stats.calls)).toString() : '0';
      const minGas = (stats?.gasMin ?? 0n).toString();
      const maxGas = (stats?.gasMax ?? 0n).toString();
      return { name, count, avgGas, minGas, maxGas };
    });

    function downsample<T>(arr: T[], maxPts: number): T[] {
      if (arr.length <= maxPts) return arr;
      const step = (arr.length - 1) / (maxPts - 1);
      return Array.from({ length: maxPts }, (_, i) => arr[Math.round(i * step)]);
    }

    const sampledHistory = downsample(this.conservationHistory, 1000);

    const gasCostEth = Number(this.totalGasUsed * GAS_PRICE_FOR_REPORT) / 1e18;
    const gasCostUSD = gasCostEth * this.ethPriceUSD;

    const simSeconds = Number(this.blocksMined) * 12;
    const simYears = Math.floor(simSeconds / (365.25 * 86400));
    const simDays = Math.floor((simSeconds % (365.25 * 86400)) / 86400);
    const simDuration = simYears > 0 ? `${simYears}y ${simDays}d` : `${simDays}d`;

    const BLOCKS_PER_YEAR = 7160 * 365;

    const clusterHistObj: Record<string, ClusterHistoryRecord> = {};
    for (const [k, v] of this.clusterHistory) clusterHistObj[k] = v;
    const operatorHistObj: Record<string, OperatorHistoryRecord> = {};
    for (const [k, v] of this.operatorHistory) operatorHistObj[k] = v;

    const expectedEthNetworkFeesStr = this.expectedEthNetworkFees.toString();

    return {
      elapsed,
      simDuration,
      generatedAt: new Date().toISOString(),

      summaryCards: [
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
        { label: 'Staking Reward Dust (PackedETH rounding)', value: `${(Number(this.totalStakingDust) / 1e18).toFixed(5)} ETH (${this.totalStakingDust} wei)` },
      ],

      ssvClustersSetup: this.ssvClustersSetup,
      ethClustersSetup: this.ethClustersSetup,
      ethClustersDynamic: this.ethClustersDynamic,
      migrationsSetup: this.migrationsSetup,
      migrationsDynamic: this.migrationsDynamic,
      ssvClustersLiquidatedBeforeMigration: this.ssvClustersLiquidatedBeforeMigration,
      uniqueClusterOwners: new Set([...this.clusterHistory.values()].map(r => r.owner.toLowerCase())).size,
      operatorsPreMigration: this.operatorsPreMigration,
      operatorsPostMigrationSetup: this.operatorsPostMigrationSetup,
      operatorsPostMigrationDynamic: this.operatorsPostMigrationDynamic,
      uniqueOperatorOwners: new Set([...this.operatorHistory.values()].map(r => r.owner)).size,
      operatorPrivateCount: this.operatorPrivateCount,
      operatorPublicCount: this.operatorPublicCount,
      operatorRemovedCount: this.operatorRemovedCount,
      operatorZeroFeeCount: this.operatorZeroFeeCount,
      operatorAvgYearlyFeeEth: this.operatorAvgYearlyFeeEth,
      ethPriceUSD: this.ethPriceUSD,

      networkFeeEthWei: this.networkFeeEthWei.toString(),
      networkFeeSSVWei: this.networkFeeSSVWei.toString(),
      ethRateYearly: Number(this.networkFeeEthWei) * BLOCKS_PER_YEAR / 1e18,
      ssvRateYearly: Number(this.networkFeeSSVWei) * BLOCKS_PER_YEAR / 1e18,
      networkEarningsEthStr: (Number(this.networkEarningsEthWei) / 1e18).toFixed(8),
      networkEarningsSSVStr: (Number(this.networkEarningsSSVWei) / 1e18).toFixed(4),

      gasPriceGwei: Number(GAS_PRICE_FOR_REPORT) / 1e9,
      actionTableRows,
      txCount: this.txCount,
      gasCostEth,
      gasCostUSD,

      gasChartData: actionTableRows.map(r => ({ name: r.name, avgGas: r.avgGas })),
      conservationData: sampledHistory.map(p => ({
        block: p.block,
        excessEth: (Number(BigInt(p.excessWei)) / 1e18).toFixed(4),
      })),
      clusterBalanceData: sampledHistory.map(p => ({
        block: p.block,
        ethValue: (Number(BigInt(p.clusterBalanceWei)) / 1e18).toFixed(4),
      })),

      totalClustersLiquidated: this.totalClustersLiquidated,
      runwayLiquidations: this.runwayLiquidations,
      collateralLiquidations: this.collateralLiquidations,
      totalReactivations: this.totalReactivations,
      avgClusterAgeDays: this.clusterLiquidationAges.length > 0
        ? (this.clusterLiquidationAges.reduce((s, a) => s + Number(BigInt(a)), 0) / this.clusterLiquidationAges.length * 12 / 86400).toFixed(1)
        : 'N/A',

      ebRounds: this.ebRounds,
      ebRaised: this.ebRaised,
      ebLowered: this.ebLowered,
      ebSkipped: this.ebSkipped,
      ebLiquidated: this.ebLiquidated,
      ebSummaryRows: this.ebUpdateHistory.slice(-120).map(r => ({ block: r.block, clustersUpdated: r.clustersUpdated })),

      cssvTransferTotal: this.cssvTransferTotal,
      cssvTransferAllBalance: this.cssvTransferAllBalance,
      cssvTransferToContract: this.cssvTransferToContract,
      cssvTransferToFreshWallet: this.cssvTransferToFreshWallet,
      cssvTransferFromContract: this.cssvTransferFromContract,
      stakerRows: this.stakerSummaries,

      totalEthDepositedEth: (Number(this.totalEthDepositedWei) / 1e18).toFixed(4),
      totalEthWithdrawnByOwnersEth: (Number(this.totalEthWithdrawnByOwnersWei) / 1e18).toFixed(4),
      totalOperatorEthWithdrawnEth: (Number(this.totalOperatorEthWithdrawnWei) / 1e18).toFixed(4),
      stakingPoolAccumulationEth: (Number(expectedEthNetworkFeesStr) / 1e18).toFixed(8),

      finalContractETH: this.finalContractETH.toString(),
      expectedFinalETH: this.expectedFinalETH.toString(),
      ethMatch: this.finalContractETH === this.expectedFinalETH,
      ethDiffWei: (this.finalContractETH - this.expectedFinalETH).toString(),
      finalDustSSV: this.finalDustSSV.toString(),
      expectedFinalSSV: this.expectedFinalSSV.toString(),
      ssvMatch: this.finalDustSSV === this.expectedFinalSSV,
      ssvDiffWei: (this.finalDustSSV - this.expectedFinalSSV).toString(),
      checkStateCallCount: this.checkStateCallCount,

      primaryActionCount: this.primaryActionCount,
      blocksMined: this.blocksMined.toString(),
      miningRounds: this.miningRounds,
      txTarget: this.txTarget,

      failures: this.failures.slice(0, 100),

      stakingDustEth: (Number(this.totalStakingDust) / 1e18).toFixed(5),
      stakingDustWei: this.totalStakingDust.toString(),

      clusterHistory: clusterHistObj,
      operatorHistory: operatorHistObj,
      networkHistory: this.networkHistory,
      allTxBlocks: this.entries.map(e => ({ b: Number(e.block), a: e.name })),
      networkFeeChanges: this.networkFeeChanges,
    };
  }

  generateHTML(): string {
    const data = this.buildReportData();

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

    let template: string;
    try {
      template = fsSync.readFileSync(TEMPLATE_PATH, 'utf8');
    } catch {
      return `<html><body><h1>Template not found</h1><p>Expected at: ${TEMPLATE_PATH}</p><pre>${JSON.stringify(jsonSafe(data), null, 2)}</pre></body></html>`;
    }

    return template.replace('/*__REPORT_DATA__*/null', JSON.stringify(jsonSafe(data)));
  }

  async writeHTML(filePath: string): Promise<void> {
    const html = this.generateHTML();
    await fs.writeFile(filePath, html, 'utf-8');
    console.log(`HTML report written to: ${filePath}`);
  }
}

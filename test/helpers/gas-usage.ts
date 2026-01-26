import { expect } from 'chai';
import { Interface } from 'ethers';
import { createRequire } from 'node:module';
import * as fs from 'node:fs';
import * as path from 'node:path';

const require = createRequire(import.meta.url);
const ssvNetworkAbi = require('../../abis/SSVNetwork.json');

const GAS_REPORT_OUTPUT_DIR = process.env.GAS_REPORT_DIR || '.';
const GAS_REPORT_JSON_FILE = 'gas-report.json';

export enum GasGroup {
  REGISTER_OPERATOR,
  REMOVE_OPERATOR,
  REMOVE_OPERATOR_WITH_WITHDRAW,
  SET_OPERATOR_WHITELISTING_CONTRACT,
  UPDATE_OPERATOR_WHITELISTING_CONTRACT,
  SET_OPERATOR_WHITELISTING_CONTRACT_10,
  REMOVE_OPERATOR_WHITELISTING_CONTRACT,
  REMOVE_OPERATOR_WHITELISTING_CONTRACT_10,
  SET_MULTIPLE_OPERATOR_WHITELIST_10_10,
  REMOVE_MULTIPLE_OPERATOR_WHITELIST_10_10,
  SET_OPERATORS_PRIVATE_10,
  SET_OPERATORS_PUBLIC_10,


  DECLARE_OPERATOR_FEE,
  CANCEL_OPERATOR_FEE,
  EXECUTE_OPERATOR_FEE,
  REDUCE_OPERATOR_FEE,

  REGISTER_VALIDATOR_EXISTING_ETH_CLUSTER,
  REGISTER_VALIDATOR_NEW_STATE,
  REGISTER_VALIDATOR_WITHOUT_DEPOSIT,

  REGISTER_VALIDATOR_NEW_STATE_1_WHITELISTED_4,
  REGISTER_VALIDATOR_NEW_STATE_4_WHITELISTED_4,
  REGISTER_VALIDATOR_EXISTING_CLUSTER_4_WHITELISTED_4,

  REGISTER_VALIDATOR_NEW_STATE_1_WHITELISTING_CONTRACT_4,
  REGISTER_VALIDATOR_NEW_STATE_4_WHITELISTING_CONTRACT_4,

  BULK_REGISTER_10_VALIDATOR_NEW_STATE_4,
  BULK_REGISTER_10_VALIDATOR_EXISTING_CLUSTER_4,
  BULK_REGISTER_10_VALIDATOR_1_WHITELISTING_CONTRACT_EXISTING_CLUSTER_4,


  REGISTER_VALIDATOR_EXISTING_CLUSTER_7,
  REGISTER_VALIDATOR_NEW_STATE_7,
  REGISTER_VALIDATOR_WITHOUT_DEPOSIT_7,

  BULK_REGISTER_10_VALIDATOR_NEW_STATE_7,
  BULK_REGISTER_10_VALIDATOR_EXISTING_CLUSTER_7,

  REGISTER_VALIDATOR_EXISTING_CLUSTER_10,
  REGISTER_VALIDATOR_NEW_STATE_10,
  REGISTER_VALIDATOR_WITHOUT_DEPOSIT_10,

  BULK_REGISTER_10_VALIDATOR_NEW_STATE_10,
  BULK_REGISTER_10_VALIDATOR_EXISTING_CLUSTER_10,

  REGISTER_VALIDATOR_EXISTING_CLUSTER_13,
  REGISTER_VALIDATOR_NEW_STATE_13,
  REGISTER_VALIDATOR_WITHOUT_DEPOSIT_13,

  BULK_REGISTER_10_VALIDATOR_NEW_STATE_13,
  BULK_REGISTER_10_VALIDATOR_EXISTING_CLUSTER_13,

  REMOVE_VALIDATOR,
  BULK_REMOVE_10_VALIDATOR_4,
  REMOVE_VALIDATOR_7,
  BULK_REMOVE_10_VALIDATOR_7,
  REMOVE_VALIDATOR_10,
  BULK_REMOVE_10_VALIDATOR_10,
  REMOVE_VALIDATOR_13,
  BULK_REMOVE_10_VALIDATOR_13,
  DEPOSIT,
  WITHDRAW_CLUSTER_BALANCE,
  WITHDRAW_OPERATOR_BALANCE,
  WITHDRAW_OPERATOR_BALANCE_ALL_VERSIONS,
  VALIDATOR_EXIT,
  BULK_EXIT_10_VALIDATOR_4,
  BULK_EXIT_10_VALIDATOR_7,
  BULK_EXIT_10_VALIDATOR_10,
  BULK_EXIT_10_VALIDATOR_13,

  LIQUIDATE_CLUSTER_4,
  LIQUIDATE_CLUSTER_7,
  LIQUIDATE_CLUSTER_10,
  LIQUIDATE_CLUSTER_13,
  LIQUIDATE_CLUSTER_SSV_4,
  LIQUIDATE_CLUSTER_SSV_7,
  LIQUIDATE_CLUSTER_SSV_10,
  LIQUIDATE_CLUSTER_SSV_13,
  REACTIVATE_CLUSTER,

  NETWORK_FEE_CHANGE,
  WITHDRAW_NETWORK_EARNINGS,
  DAO_UPDATE_OPERATOR_FEE_INCREASE_LIMIT,
  DAO_UPDATE_DECLARE_OPERATOR_FEE_PERIOD,
  DAO_UPDATE_EXECUTE_OPERATOR_FEE_PERIOD,
  DAO_UPDATE_OPERATOR_MAX_FEE,

  CHANGE_LIQUIDATION_THRESHOLD_PERIOD,
  CHANGE_MINIMUM_COLLATERAL,

  MIGRATE_CLUSTER_TO_ETH,
  UPDATE_CLUSTER_BALANCE,

  SET_UNSTAKE_COOLDOWN,
  SET_QUORUM,
  REPLACE_ORACLE,
  COMMIT_ROOT,
  NETWORK_FEE_CHANGE_SSV,
  WITHDRAW_NETWORK_SSV_EARNINGS,

  STAKE_SSV,
  INITIAL_STAKE_SSV,
  POST_INITIAL_STAKE_SSV,
  REQUEST_UNSTAKE,
  WITHDRAW_UNSTAKE,
  CLAIM_ETH_REWARDS,
  SYNC_FEES,
  RESCUE_ERC20,
}

const MAX_GAS_PER_GROUP: any = {
  [GasGroup.REGISTER_OPERATOR]: 210000,
  [GasGroup.REMOVE_OPERATOR]: 100000,
  [GasGroup.REMOVE_OPERATOR_WITH_WITHDRAW]: 100000,
  [GasGroup.SET_OPERATOR_WHITELISTING_CONTRACT]: 150000,
  [GasGroup.UPDATE_OPERATOR_WHITELISTING_CONTRACT]: 105000,
  [GasGroup.SET_OPERATOR_WHITELISTING_CONTRACT_10]: 400000,
  [GasGroup.REMOVE_OPERATOR_WHITELISTING_CONTRACT]: 100000,
  [GasGroup.REMOVE_OPERATOR_WHITELISTING_CONTRACT_10]: 170000,
  [GasGroup.SET_MULTIPLE_OPERATOR_WHITELIST_10_10]: 420000,
  [GasGroup.REMOVE_MULTIPLE_OPERATOR_WHITELIST_10_10]: 200000,
  [GasGroup.SET_OPERATORS_PRIVATE_10]: 350000,
  [GasGroup.SET_OPERATORS_PUBLIC_10]: 150000,

  [GasGroup.DECLARE_OPERATOR_FEE]: 100000,
  [GasGroup.CANCEL_OPERATOR_FEE]: 80000,
  [GasGroup.EXECUTE_OPERATOR_FEE]: 80000,
  [GasGroup.REDUCE_OPERATOR_FEE]: 80000,

  [GasGroup.REGISTER_VALIDATOR_EXISTING_ETH_CLUSTER]: 250000,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE]: 450000,
  [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT]: 250000,

  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_1_WHITELISTED_4]: 350000,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_4_WHITELISTED_4]: 350000,
  [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_4_WHITELISTED_4]: 250000,

  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_1_WHITELISTING_CONTRACT_4]: 350000,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_4_WHITELISTING_CONTRACT_4]: 400000,

  [GasGroup.BULK_REGISTER_10_VALIDATOR_NEW_STATE_4]: 835500,
  [GasGroup.BULK_REGISTER_10_VALIDATOR_EXISTING_CLUSTER_4]: 818700,
  [GasGroup.BULK_REGISTER_10_VALIDATOR_1_WHITELISTING_CONTRACT_EXISTING_CLUSTER_4]: 830000,

  [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_7]: 293500,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_7]: 601000,
  [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT_7]: 293500,

  [GasGroup.BULK_REGISTER_10_VALIDATOR_NEW_STATE_7]: 1143000,
  [GasGroup.BULK_REGISTER_10_VALIDATOR_EXISTING_CLUSTER_7]: 1126500,

  [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_10]: 381000,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_10]: 791000,
  [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT_10]: 381000,

  [GasGroup.BULK_REGISTER_10_VALIDATOR_NEW_STATE_10]: 1447000,
  [GasGroup.BULK_REGISTER_10_VALIDATOR_EXISTING_CLUSTER_10]: 1430500,

  [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_13]: 468500,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_13]: 981000,
  [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT_13]: 468500,

  [GasGroup.BULK_REGISTER_10_VALIDATOR_NEW_STATE_13]: 1757000,
  [GasGroup.BULK_REGISTER_10_VALIDATOR_EXISTING_CLUSTER_13]: 1740000,

  [GasGroup.REMOVE_VALIDATOR]: 140000,
  [GasGroup.BULK_REMOVE_10_VALIDATOR_4]: 203000,

  [GasGroup.REMOVE_VALIDATOR_7]: 155500,
  [GasGroup.BULK_REMOVE_10_VALIDATOR_7]: 254500,

  [GasGroup.REMOVE_VALIDATOR_10]: 197000,
  [GasGroup.BULK_REMOVE_10_VALIDATOR_10]: 306000,

  [GasGroup.REMOVE_VALIDATOR_13]: 241000,
  [GasGroup.BULK_REMOVE_10_VALIDATOR_13]: 357500,

  [GasGroup.DEPOSIT]: 400000,
  [GasGroup.WITHDRAW_CLUSTER_BALANCE]: 120000,
  [GasGroup.WITHDRAW_OPERATOR_BALANCE]: 120000,
  [GasGroup.WITHDRAW_OPERATOR_BALANCE_ALL_VERSIONS]: 140000,
  [GasGroup.VALIDATOR_EXIT]: 80000,
  [GasGroup.BULK_EXIT_10_VALIDATOR_4]: 126200,
  [GasGroup.BULK_EXIT_10_VALIDATOR_7]: 139500,
  [GasGroup.BULK_EXIT_10_VALIDATOR_10]: 152500,
  [GasGroup.BULK_EXIT_10_VALIDATOR_13]: 165500,

  [GasGroup.LIQUIDATE_CLUSTER_4]: 155000,
  [GasGroup.LIQUIDATE_CLUSTER_7]: 173000,
  [GasGroup.LIQUIDATE_CLUSTER_10]: 218000,
  [GasGroup.LIQUIDATE_CLUSTER_13]: 265000,
  [GasGroup.LIQUIDATE_CLUSTER_SSV_4]: 175000,
  [GasGroup.LIQUIDATE_CLUSTER_SSV_7]: 220000,
  [GasGroup.LIQUIDATE_CLUSTER_SSV_10]: 270000,
  [GasGroup.LIQUIDATE_CLUSTER_SSV_13]: 320000,
  [GasGroup.REACTIVATE_CLUSTER]: 310000,

  [GasGroup.NETWORK_FEE_CHANGE]: 72000,
  [GasGroup.WITHDRAW_NETWORK_EARNINGS]: 62500,
  [GasGroup.DAO_UPDATE_OPERATOR_FEE_INCREASE_LIMIT]: 50000,
  [GasGroup.DAO_UPDATE_DECLARE_OPERATOR_FEE_PERIOD]: 50000,
  [GasGroup.DAO_UPDATE_EXECUTE_OPERATOR_FEE_PERIOD]: 50000,
  [GasGroup.DAO_UPDATE_OPERATOR_MAX_FEE]: 50000,

  [GasGroup.CHANGE_LIQUIDATION_THRESHOLD_PERIOD]: 50000,
  [GasGroup.CHANGE_MINIMUM_COLLATERAL]: 50000,

  [GasGroup.MIGRATE_CLUSTER_TO_ETH]: 600000,
  [GasGroup.UPDATE_CLUSTER_BALANCE]: 300000,

  [GasGroup.SET_UNSTAKE_COOLDOWN]: 80000,
  [GasGroup.SET_QUORUM]: 80000,
  [GasGroup.REPLACE_ORACLE]: 120000,
  [GasGroup.COMMIT_ROOT]: 150000,
  [GasGroup.NETWORK_FEE_CHANGE_SSV]: 52000,
  [GasGroup.WITHDRAW_NETWORK_SSV_EARNINGS]: 95000,

  [GasGroup.STAKE_SSV]: 400000,
  [GasGroup.INITIAL_STAKE_SSV]: 400000,
  [GasGroup.POST_INITIAL_STAKE_SSV]: 140000,
  [GasGroup.REQUEST_UNSTAKE]: 300000,
  [GasGroup.WITHDRAW_UNSTAKE]: 250000,
  [GasGroup.CLAIM_ETH_REWARDS]: 200000,
  [GasGroup.SYNC_FEES]: 180000,
  [GasGroup.RESCUE_ERC20]: 120000,
};

class GasStats {
  max: number | null = null;
  min: number | null = null;
  totalGas = 0;
  txCount = 0;

  addStat(gas: number) {
    this.totalGas += gas;
    ++this.txCount;
    this.max = Math.max(gas, this.max === null ? -Infinity : this.max);
    this.min = Math.min(gas, this.min === null ? Infinity : this.min);
  }

  get average(): number {
    return this.totalGas / this.txCount;
  }
}

const gasUsageStats = new Map();

for (const group in MAX_GAS_PER_GROUP) {
  gasUsageStats.set(group, new GasStats());
}

export const trackGas = async function (tx: Promise<any>, groups?: Array<GasGroup>): Promise<any> {
  const response = await tx;
  const receipt = await response.wait();
  return await trackGasFromReceipt(receipt, groups);
};

export const trackGasFromReceipt = async function (receipt: any, groups?: Array<GasGroup>): Promise<any> {
  const iface = new Interface(ssvNetworkAbi);
  const logs = (receipt.logs ?? [])
    .map((log: any) => {
      try {
        return iface.parseLog(log);
      } catch {
        return null;
      }
    })
    .filter(Boolean);

  groups &&
    [...new Set(groups)].forEach(group => {
      const gasUsed = Number(receipt.gasUsed);

      if (!process.env.NO_GAS_ENFORCE) {
        const maxGas = MAX_GAS_PER_GROUP[group];
        expect(gasUsed).to.be.lessThanOrEqual(maxGas, 'gasUsed higher than max allowed gas');
      }

      gasUsageStats.get(group.toString()).addStat(gasUsed);
    });

  return {
    ...receipt,
    gasUsed: receipt.gasUsed,
    eventsByName: logs.reduce((aggr: any, item: any) => {
      const eventName = item.name;
      aggr[eventName] = aggr[eventName] || [];
      aggr[eventName].push(item);
      return aggr;
    }, {}),
  };
};

export const getGasStats = (group: string) => {
  return gasUsageStats.get(group) || new GasStats();
};

export const getGasGroupName = (group: GasGroup | string): string => {
  const groupNum = typeof group === 'string' ? parseInt(group, 10) : group;
  return GasGroup[groupNum] || `UNKNOWN_${group}`;
};

export const getAllMaxGasLimits = (): Record<string, number> => {
  const result: Record<string, number> = {};
  for (const group in MAX_GAS_PER_GROUP) {
    const name = getGasGroupName(group);
    result[name] = MAX_GAS_PER_GROUP[group];
  }
  return result;
};

export interface GasReportEntry {
  name: string;
  maxLimit: number;
  min: number | null;
  max: number | null;
  average: number | null;
  txCount: number;
  withinLimit: boolean;
}

export interface GasReport {
  timestamp: string;
  commit?: string;
  branch?: string;
  entries: GasReportEntry[];
  summary: {
    totalOperations: number;
    operationsWithData: number;
    allWithinLimits: boolean;
  };
}

export const generateGasReport = (): GasReport => {
  const entries: GasReportEntry[] = [];
  let operationsWithData = 0;
  let allWithinLimits = true;

  for (const group in MAX_GAS_PER_GROUP) {
    const groupNum = parseInt(group, 10);
    const name = getGasGroupName(groupNum);
    const maxLimit = MAX_GAS_PER_GROUP[groupNum] || 0;
    const gasStats = getGasStats(group);

    const withinLimit = gasStats.max === null || gasStats.max <= maxLimit;
    if (!withinLimit) allWithinLimits = false;
    if (gasStats.txCount > 0) operationsWithData++;

    entries.push({
      name,
      maxLimit,
      min: gasStats.min,
      max: gasStats.max,
      average: gasStats.txCount > 0 ? Math.round(gasStats.average) : null,
      txCount: gasStats.txCount,
      withinLimit,
    });
  }

  entries.sort((a, b) => a.name.localeCompare(b.name));

  return {
    timestamp: new Date().toISOString(),
    entries,
    summary: {
      totalOperations: entries.length,
      operationsWithData,
      allWithinLimits,
    },
  };
};

export const printGasReport = (report?: GasReport): void => {
  const gasReport = report || generateGasReport();

  console.log('\n');
  console.log('='.repeat(100));
  console.log('                              GAS USAGE REPORT');
  console.log('='.repeat(100));
  console.log(`Generated: ${gasReport.timestamp}`);
  console.log('-'.repeat(100));

  console.log(
    padRight('Operation', 55) +
    padLeft('Max Limit', 12) +
    padLeft('Avg Gas', 12) +
    padLeft('Min', 10) +
    padLeft('Max', 10)
  );
  console.log('-'.repeat(100));

  const entriesWithData = gasReport.entries.filter(e => e.txCount > 0);

  for (const entry of entriesWithData) {
    console.log(
      padRight(entry.name, 55) +
      padLeft(entry.maxLimit.toLocaleString(), 12) +
      padLeft(entry.average?.toLocaleString() || '-', 12) +
      padLeft(entry.min?.toLocaleString() || '-', 10) +
      padLeft(entry.max?.toLocaleString() || '-', 10)
    );
  }

  console.log('-'.repeat(100));
  console.log(`Total operations tracked: ${gasReport.summary.operationsWithData}`);
  console.log(`All within limits: ${gasReport.summary.allWithinLimits ? 'YES' : 'NO'}`);
  console.log('='.repeat(100));
  console.log('\n');
};

export const saveGasReport = (outputPath?: string): GasReport => {
  const report = generateGasReport();

  try {
    const { execSync } = require('child_process');
    report.commit = execSync('git rev-parse --short HEAD', { encoding: 'utf8' }).trim();
    report.branch = execSync('git rev-parse --abbrev-ref HEAD', { encoding: 'utf8' }).trim();
  } catch {
  }

  const filePath = outputPath || path.join(GAS_REPORT_OUTPUT_DIR, GAS_REPORT_JSON_FILE);

  const dir = path.dirname(filePath);
  if (!fs.existsSync(dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }

  fs.writeFileSync(filePath, JSON.stringify(report, null, 2));
  console.log(`Gas report saved to: ${filePath}`);

  return report;
};

export const resetGasStats = (): void => {
  for (const group in MAX_GAS_PER_GROUP) {
    gasUsageStats.set(group, new GasStats());
  }
};

function padRight(str: string, len: number): string {
  return str.length >= len ? str.substring(0, len) : str + ' '.repeat(len - str.length);
}

function padLeft(str: string, len: number): string {
  return str.length >= len ? str : ' '.repeat(len - str.length) + str;
}

let reportRegistered = false;

export const registerGasReportOnExit = (): void => {
  if (reportRegistered) return;
  if (process.env.REPORT_GAS !== 'true') return;

  reportRegistered = true;

  process.on('beforeExit', () => {
    const report = generateGasReport();

    if (report.summary.operationsWithData > 0) {
      printGasReport(report);
      saveGasReport();
    }
  });
};

registerGasReportOnExit();

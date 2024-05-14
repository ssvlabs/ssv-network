import { parseEventLogs } from 'viem';
import { expect } from 'chai';
import { ssvNetwork, getTransactionReceipt } from '../helpers/contract-helpers';

export enum GasGroup {
  REGISTER_OPERATOR,
  REMOVE_OPERATOR,
  REMOVE_OPERATOR_WITH_WITHDRAW,
  SET_OPERATOR_WHITELIST,
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

  REGISTER_VALIDATOR_EXISTING_CLUSTER,
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
  VALIDATOR_EXIT,
  BULK_EXIT_10_VALIDATOR_4,
  BULK_EXIT_10_VALIDATOR_7,
  BULK_EXIT_10_VALIDATOR_10,
  BULK_EXIT_10_VALIDATOR_13,

  LIQUIDATE_CLUSTER_4,
  LIQUIDATE_CLUSTER_7,
  LIQUIDATE_CLUSTER_10,
  LIQUIDATE_CLUSTER_13,
  REACTIVATE_CLUSTER,

  NETWORK_FEE_CHANGE,
  WITHDRAW_NETWORK_EARNINGS,
  DAO_UPDATE_OPERATOR_FEE_INCREASE_LIMIT,
  DAO_UPDATE_DECLARE_OPERATOR_FEE_PERIOD,
  DAO_UPDATE_EXECUTE_OPERATOR_FEE_PERIOD,
  DAO_UPDATE_OPERATOR_MAX_FEE,

  CHANGE_LIQUIDATION_THRESHOLD_PERIOD,
  CHANGE_MINIMUM_COLLATERAL,
}

const MAX_GAS_PER_GROUP: any = {
  /* REAL GAS LIMITS */
  [GasGroup.REGISTER_OPERATOR]: 134500,
  [GasGroup.REMOVE_OPERATOR]: 70500,
  [GasGroup.REMOVE_OPERATOR_WITH_WITHDRAW]: 70500,
  [GasGroup.SET_OPERATOR_WHITELIST]: 64000,
  [GasGroup.SET_OPERATOR_WHITELISTING_CONTRACT]: 95500,
  [GasGroup.UPDATE_OPERATOR_WHITELISTING_CONTRACT]: 70000,
  [GasGroup.SET_OPERATOR_WHITELISTING_CONTRACT_10]: 375000,
  [GasGroup.REMOVE_OPERATOR_WHITELISTING_CONTRACT]: 43000,
  [GasGroup.REMOVE_OPERATOR_WHITELISTING_CONTRACT_10]: 130000,
  [GasGroup.SET_MULTIPLE_OPERATOR_WHITELIST_10_10]: 382000,
  [GasGroup.REMOVE_MULTIPLE_OPERATOR_WHITELIST_10_10]: 169000,
  [GasGroup.SET_OPERATORS_PRIVATE_10]: 313000,
  [GasGroup.SET_OPERATORS_PUBLIC_10]: 114000,

  [GasGroup.DECLARE_OPERATOR_FEE]: 70000,
  [GasGroup.CANCEL_OPERATOR_FEE]: 41900,
  [GasGroup.EXECUTE_OPERATOR_FEE]: 52000,
  [GasGroup.REDUCE_OPERATOR_FEE]: 51900,

  [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER]: 202000,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE]: 236000,
  [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT]: 180600,

  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_1_WHITELISTED_4]: 221000,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_4_WHITELISTED_4]: 221500,
  [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_4_WHITELISTED_4]: 204500,

  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_1_WHITELISTING_CONTRACT_4]: 231000,

  [GasGroup.BULK_REGISTER_10_VALIDATOR_NEW_STATE_4]: 835500,
  [GasGroup.BULK_REGISTER_10_VALIDATOR_EXISTING_CLUSTER_4]: 818700,
  [GasGroup.BULK_REGISTER_10_VALIDATOR_1_WHITELISTING_CONTRACT_EXISTING_CLUSTER_4]: 830000,

  [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_7]: 272500,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_7]: 289000,
  [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT_7]: 251600,

  [GasGroup.BULK_REGISTER_10_VALIDATOR_NEW_STATE_7]: 1143000,
  [GasGroup.BULK_REGISTER_10_VALIDATOR_EXISTING_CLUSTER_7]: 1126500,

  [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_10]: 342700,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_10]: 359500,
  [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT_10]: 322200,

  [GasGroup.BULK_REGISTER_10_VALIDATOR_NEW_STATE_10]: 1447000,
  [GasGroup.BULK_REGISTER_10_VALIDATOR_EXISTING_CLUSTER_10]: 1430500,

  [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_13]: 413700,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_13]: 430500,
  [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT_13]: 393300,

  [GasGroup.BULK_REGISTER_10_VALIDATOR_NEW_STATE_13]: 1757000,
  [GasGroup.BULK_REGISTER_10_VALIDATOR_EXISTING_CLUSTER_13]: 1740000,

  [GasGroup.REMOVE_VALIDATOR]: 114000,
  [GasGroup.BULK_REMOVE_10_VALIDATOR_4]: 191500,

  [GasGroup.REMOVE_VALIDATOR_7]: 155500,
  [GasGroup.BULK_REMOVE_10_VALIDATOR_7]: 241700,

  [GasGroup.REMOVE_VALIDATOR_10]: 197000,
  [GasGroup.BULK_REMOVE_10_VALIDATOR_10]: 292500,

  [GasGroup.REMOVE_VALIDATOR_13]: 238500,
  [GasGroup.BULK_REMOVE_10_VALIDATOR_13]: 343000,

  [GasGroup.DEPOSIT]: 77500,
  [GasGroup.WITHDRAW_CLUSTER_BALANCE]: 95000,
  [GasGroup.WITHDRAW_OPERATOR_BALANCE]: 64900,
  [GasGroup.VALIDATOR_EXIT]: 43000,
  [GasGroup.BULK_EXIT_10_VALIDATOR_4]: 126200,
  [GasGroup.BULK_EXIT_10_VALIDATOR_7]: 139500,
  [GasGroup.BULK_EXIT_10_VALIDATOR_10]: 152500,
  [GasGroup.BULK_EXIT_10_VALIDATOR_13]: 165500,

  [GasGroup.LIQUIDATE_CLUSTER_4]: 130500,
  [GasGroup.LIQUIDATE_CLUSTER_7]: 171000,
  [GasGroup.LIQUIDATE_CLUSTER_10]: 212000,
  [GasGroup.LIQUIDATE_CLUSTER_13]: 253000,
  [GasGroup.REACTIVATE_CLUSTER]: 121500,

  [GasGroup.NETWORK_FEE_CHANGE]: 45800,
  [GasGroup.WITHDRAW_NETWORK_EARNINGS]: 62500,
  [GasGroup.DAO_UPDATE_OPERATOR_FEE_INCREASE_LIMIT]: 38200,
  [GasGroup.DAO_UPDATE_DECLARE_OPERATOR_FEE_PERIOD]: 40900,
  [GasGroup.DAO_UPDATE_EXECUTE_OPERATOR_FEE_PERIOD]: 41000,
  [GasGroup.DAO_UPDATE_OPERATOR_MAX_FEE]: 40300,

  [GasGroup.CHANGE_LIQUIDATION_THRESHOLD_PERIOD]: 41000,
  [GasGroup.CHANGE_MINIMUM_COLLATERAL]: 41200,
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
  const receipt = await getTransactionReceipt(tx);
  return await trackGasFromReceipt(receipt, groups);
};

export const trackGasFromReceipt = async function (receipt: any, groups?: Array<GasGroup>): Promise<any> {
  const logs = parseEventLogs({
    abi: ssvNetwork.abi,
    logs: receipt.logs,
  });

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
      aggr[item.eventName] = aggr[item.eventName] || [];
      aggr[item.eventName].push(item);
      return aggr;
    }, {}),
  };
};

export const getGasStats = (group: string) => {
  return gasUsageStats.get(group) || new GasStats();
};

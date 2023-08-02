import { expect } from 'chai';

export enum GasGroup {
  REGISTER_OPERATOR,
  REMOVE_OPERATOR,
  REMOVE_OPERATOR_WITH_WITHDRAW,
  SET_OPERATOR_WHITELIST,

  DECLARE_OPERATOR_FEE,
  CANCEL_OPERATOR_FEE,
  EXECUTE_OPERATOR_FEE,
  REDUCE_OPERATOR_FEE,

  REGISTER_VALIDATOR_EXISTING_CLUSTER,
  REGISTER_VALIDATOR_NEW_STATE,
  REGISTER_VALIDATOR_WITHOUT_DEPOSIT,

  REGISTER_VALIDATOR_EXISTING_CLUSTER_7,
  REGISTER_VALIDATOR_NEW_STATE_7,
  REGISTER_VALIDATOR_WITHOUT_DEPOSIT_7,

  REGISTER_VALIDATOR_EXISTING_CLUSTER_10,
  REGISTER_VALIDATOR_NEW_STATE_10,
  REGISTER_VALIDATOR_WITHOUT_DEPOSIT_10,

  REGISTER_VALIDATOR_EXISTING_CLUSTER_13,
  REGISTER_VALIDATOR_NEW_STATE_13,
  REGISTER_VALIDATOR_WITHOUT_DEPOSIT_13,

  REMOVE_VALIDATOR,
  DEPOSIT,
  WITHDRAW_CLUSTER_BALANCE,
  WITHDRAW_OPERATOR_BALANCE,
  
  LIQUIDATE_CLUSTER_4,
  LIQUIDATE_CLUSTER_7,
  LIQUIDATE_CLUSTER_10,
  LIQUIDATE_CLUSTER_13,
  REACTIVATE_CLUSTER,

  NETWORK_FEE_CHANGE,
  WITHDRAW_NETWORK_EARNINGS,
  OPERATOR_FEE_INCREASE_LIMIT,
  OPERATOR_DECLARE_FEE_LIMIT,
  OPERATOR_EXECUTE_FEE_LIMIT,

  CHANGE_LIQUIDATION_THRESHOLD_PERIOD,
  CHANGE_MINIMUM_COLLATERAL
}

const MAX_GAS_PER_GROUP: any = {
  /* REAL GAS LIMITS */
  [GasGroup.REGISTER_OPERATOR]: 131890,
  [GasGroup.REMOVE_OPERATOR]: 70200,
  [GasGroup.REMOVE_OPERATOR_WITH_WITHDRAW]: 70200,
  [GasGroup.SET_OPERATOR_WHITELIST]: 84300,
  
  [GasGroup.DECLARE_OPERATOR_FEE]: 70000,
  [GasGroup.CANCEL_OPERATOR_FEE]: 41900,
  [GasGroup.EXECUTE_OPERATOR_FEE]: 49900,
  [GasGroup.REDUCE_OPERATOR_FEE]: 51900,

  [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER]: 202000,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE]: 221400,
  [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT]: 181600,

  [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_7]: 272900,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_7]: 289634,
  [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT_7]: 252500,

  [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_10]: 343600,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_10]: 360300,
  [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT_10]: 323000,

  [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_13]: 414500,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_13]: 431300,
  [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT_13]: 394000,

  [GasGroup.REMOVE_VALIDATOR]: 113500,
  [GasGroup.DEPOSIT]: 77500,
  [GasGroup.WITHDRAW_CLUSTER_BALANCE]: 94500,
  [GasGroup.WITHDRAW_OPERATOR_BALANCE]: 64900,
  [GasGroup.LIQUIDATE_CLUSTER_4]: 129200, 
  [GasGroup.LIQUIDATE_CLUSTER_7]: 170400, 
  [GasGroup.LIQUIDATE_CLUSTER_10]: 211600, 
  [GasGroup.LIQUIDATE_CLUSTER_13]: 252800, 
  [GasGroup.REACTIVATE_CLUSTER]: 120600,

  [GasGroup.NETWORK_FEE_CHANGE]: 45800,
  [GasGroup.WITHDRAW_NETWORK_EARNINGS]: 62200,
  [GasGroup.OPERATOR_FEE_INCREASE_LIMIT]: 38200,
  [GasGroup.OPERATOR_DECLARE_FEE_LIMIT]: 40900,
  [GasGroup.OPERATOR_EXECUTE_FEE_LIMIT]: 41000,

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
    this.max = Math.max(gas, (this.max === null) ? -Infinity : this.max);
    this.min = Math.min(gas, (this.min === null) ? Infinity : this.min);
  }

  get average(): number {
    return this.totalGas / this.txCount;
  }
}

const gasUsageStats = new Map();

for (const group in MAX_GAS_PER_GROUP) {
  gasUsageStats.set(group, new GasStats());
}

export const trackGas = async (tx: Promise<any>, groups?: Array<GasGroup>): Promise<any> => {
  const receipt = await (await tx).wait();

  groups && [...new Set(groups)].forEach(group => {
    const gasUsed = parseInt(receipt.gasUsed);

    if (!process.env.NO_GAS_ENFORCE) {
      const maxGas = MAX_GAS_PER_GROUP[group];
      expect(gasUsed).to.be.lessThanOrEqual(maxGas, 'gasUsed higher than max allowed gas');
    }

    gasUsageStats.get(group.toString()).addStat(gasUsed);
  });
  return {
    ...receipt,
    gasUsed: +receipt.gasUsed,
    eventsByName: receipt.events.reduce((aggr: any, item: any) => {
      aggr[item.event] = aggr[item.event] || [];
      aggr[item.event].push(item);
      return aggr;
    }, {})
  };
};

export const getGasStats = (group: string) => {
  return gasUsageStats.get(group) || new GasStats();
};


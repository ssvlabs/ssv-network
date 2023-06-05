import { expect } from 'chai';

export enum GasGroup {
  REGISTER_OPERATOR,
  REMOVE_OPERATOR,
  REMOVE_OPERATOR_WITH_WITHDRAW,
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
  REGISTER_CLUSTER,
  LIQUIDATE_CLUSTER_4,
  LIQUIDATE_CLUSTER_7,
  LIQUIDATE_CLUSTER_10,
  LIQUIDATE_CLUSTER_13,
  REACTIVATE_CLUSTER,
}

const MAX_GAS_PER_GROUP: any = {
  /* REAL GAS LIMITS */
  [GasGroup.REGISTER_OPERATOR]: 152500,
  [GasGroup.REMOVE_OPERATOR]: 70400,
  [GasGroup.REMOVE_OPERATOR_WITH_WITHDRAW]: 70400,

  [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER]: 234500,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE]: 249000,
  [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT]: 213700,

  [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_7]: 309200,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_7]: 326000,
  [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT_7]: 288700,

  [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_10]: 383900,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_10]: 400600,
  [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT_10]: 363500,

  [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_13]: 459000,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_13]: 476000,
  [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT_13]: 438500,

  [GasGroup.REMOVE_VALIDATOR]: 124500,
  [GasGroup.DEPOSIT]: 77500,
  [GasGroup.WITHDRAW_CLUSTER_BALANCE]: 97000,
  [GasGroup.WITHDRAW_OPERATOR_BALANCE]: 64900,
  [GasGroup.REGISTER_CLUSTER]: 137000,
  [GasGroup.LIQUIDATE_CLUSTER_4]: 141800, 
  [GasGroup.LIQUIDATE_CLUSTER_7]: 189600, 
  [GasGroup.LIQUIDATE_CLUSTER_10]: 237400, 
  [GasGroup.LIQUIDATE_CLUSTER_13]: 285300, 
  [GasGroup.REACTIVATE_CLUSTER]: 131400,
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


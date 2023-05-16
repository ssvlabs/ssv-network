import { expect } from 'chai';

export enum GasGroup {
  REGISTER_OPERATOR,
  REMOVE_OPERATOR,
  REMOVE_OPERATOR_WITH_WITHDRAW,
  REGISTER_VALIDATOR_EXISTING_POD,
  REGISTER_VALIDATOR_NEW_STATE,
  REGISTER_VALIDATOR_WITHOUT_DEPOSIT,

  REGISTER_VALIDATOR_EXISTING_POD_7,
  REGISTER_VALIDATOR_NEW_STATE_7,
  REGISTER_VALIDATOR_WITHOUT_DEPOSIT_7,

  REGISTER_VALIDATOR_EXISTING_POD_10,
  REGISTER_VALIDATOR_NEW_STATE_10,
  REGISTER_VALIDATOR_WITHOUT_DEPOSIT_10,

  REGISTER_VALIDATOR_EXISTING_POD_13,
  REGISTER_VALIDATOR_NEW_STATE_13,
  REGISTER_VALIDATOR_WITHOUT_DEPOSIT_13,

  REMOVE_VALIDATOR,
  DEPOSIT,
  WITHDRAW_POD_BALANCE,
  WITHDRAW_OPERATOR_BALANCE,
  REGISTER_POD,
  LIQUIDATE_POD,
  REACTIVATE_POD,
}

const MAX_GAS_PER_GROUP: any = {
  /* REAL GAS LIMITS */
  [GasGroup.REGISTER_OPERATOR]: 134000,
  [GasGroup.REMOVE_OPERATOR]: 62600,
  [GasGroup.REMOVE_OPERATOR_WITH_WITHDRAW]: 62000,

  [GasGroup.REGISTER_VALIDATOR_EXISTING_POD]: 206000,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE]: 224900,
  [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT]: 185500,

  [GasGroup.REGISTER_VALIDATOR_EXISTING_POD_7]: 277000,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_7]: 293500,
  [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT_7]: 256500,

  [GasGroup.REGISTER_VALIDATOR_EXISTING_POD_10]: 348500,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_10]: 365000,
  [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT_10]: 328000,

  [GasGroup.REGISTER_VALIDATOR_EXISTING_POD_13]: 419000,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_13]: 436000,
  [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT_13]: 398500,

  [GasGroup.REMOVE_VALIDATOR]: 106850,
  [GasGroup.DEPOSIT]: 77500,
  [GasGroup.WITHDRAW_POD_BALANCE]: 90700,
  [GasGroup.WITHDRAW_OPERATOR_BALANCE]: 56600,
  [GasGroup.REGISTER_POD]: 137000,
  [GasGroup.LIQUIDATE_POD]: 125700,
  [GasGroup.REACTIVATE_POD]: 126600,
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


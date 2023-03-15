import { expect } from 'chai';

export enum GasGroup {
  REGISTER_OPERATOR,
  REMOVE_OPERATOR,
  REMOVE_OPERATOR_WITH_WITHDRAW,
  REGISTER_VALIDATOR_EXISTING_POD,
  REGISTER_VALIDATOR_NEW_STATE,
  REGISTER_VALIDATOR_NEW_STATE_WITHOUT_DEPOSIT,

  REGISTER_VALIDATOR_EXISTING_POD_7,
  REGISTER_VALIDATOR_NEW_STATE_7,
  REGISTER_VALIDATOR_NEW_STATE_WITHOUT_DEPOSIT_7,

  REGISTER_VALIDATOR_EXISTING_POD_13,
  REGISTER_VALIDATOR_NEW_STATE_13,
  REGISTER_VALIDATOR_NEW_STATE_WITHOUT_DEPOSIT_13,

  REMOVE_VALIDATOR,
  TRANSFER_VALIDATOR_NEW_CLUSTER,
  TRANSFER_VALIDATOR,
  TRANSFER_VALIDATOR_NON_EXISTING_POD,
  BULK_TRANSFER_VALIDATOR,
  BULK_TRANSFER_VALIDATOR_NON_EXISTING_POD,
  DEPOSIT,
  WITHDRAW_POD_BALANCE,
  WITHDRAW_OPERATOR_BALANCE,
  REGISTER_POD,
  LIQUIDATE_POD,
  REACTIVATE_POD,
}

const MAX_GAS_PER_GROUP: any = {
  /* REAL GAS LIMITS */
  [GasGroup.REGISTER_OPERATOR]: 105000,
  [GasGroup.REMOVE_OPERATOR]: 62000,
  [GasGroup.REMOVE_OPERATOR_WITH_WITHDRAW]: 62000,

  [GasGroup.REGISTER_VALIDATOR_EXISTING_POD]: 185400,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE]: 202000,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_WITHOUT_DEPOSIT]: 164900,

  [GasGroup.REGISTER_VALIDATOR_EXISTING_POD_7]: 248500,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_7]: 265150,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_WITHOUT_DEPOSIT_7]: 228000,

  [GasGroup.REGISTER_VALIDATOR_EXISTING_POD_13]: 375350,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_13]: 391950,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE_WITHOUT_DEPOSIT_13]: 354850,

  [GasGroup.REMOVE_VALIDATOR]: 106300,
  [GasGroup.TRANSFER_VALIDATOR_NEW_CLUSTER]: 400000,
  [GasGroup.TRANSFER_VALIDATOR]: 260000,
  [GasGroup.TRANSFER_VALIDATOR_NON_EXISTING_POD]: 290000,
  [GasGroup.BULK_TRANSFER_VALIDATOR]: 366000,
  [GasGroup.BULK_TRANSFER_VALIDATOR_NON_EXISTING_POD]: 383000,
  [GasGroup.DEPOSIT]: 77500,
  [GasGroup.WITHDRAW_POD_BALANCE]: 95500,
  [GasGroup.WITHDRAW_OPERATOR_BALANCE]: 59000,
  [GasGroup.REGISTER_POD]: 137000,
  [GasGroup.LIQUIDATE_POD]: 137000,
  [GasGroup.REACTIVATE_POD]: 137000,
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
    }, {}) };
};

export const getGasStats = (group: string) => {
  return gasUsageStats.get(group) || new GasStats();
};


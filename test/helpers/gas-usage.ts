import { expect } from 'chai';

export enum GasGroup {
  REGISTER_OPERATOR,
  REGISTER_VALIDATOR_EXISTED_POD,
  REGISTER_VALIDATOR_EXISTED_CLUSTER,
  REGISTER_VALIDATOR_NEW_STATE,
  REMOVE_VALIDATOR,
  TRANSFER_VALIDATOR_NEW_POD,
  TRANSFER_VALIDATOR_EXISTED_POD,
  TRANSFER_VALIDATOR_EXISTED_CLUSTER,
}

const MAX_GAS_PER_GROUP: any = {
  [GasGroup.REGISTER_OPERATOR]: 100000,
  [GasGroup.REGISTER_VALIDATOR_EXISTED_POD]: 190000,
  [GasGroup.REGISTER_VALIDATOR_EXISTED_CLUSTER]: 230000,
  [GasGroup.REGISTER_VALIDATOR_NEW_STATE]: 400000,
  [GasGroup.REMOVE_VALIDATOR]: 120000,
  [GasGroup.TRANSFER_VALIDATOR_NEW_POD]: 400000,
  [GasGroup.TRANSFER_VALIDATOR_EXISTED_POD]: 260000,
  [GasGroup.TRANSFER_VALIDATOR_EXISTED_CLUSTER]: 290000,
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
    const maxGas = MAX_GAS_PER_GROUP[group];

    expect(gasUsed).to.be.lessThanOrEqual(maxGas);

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


export enum GasGroup {
  registerValidator,
  registerValidatorExistingGroup
}

// const MAX_GAS_PER_GROUP = {
//   registerValidator: 400000,
//   registerValidatorExistingGroup: 250000
// }

const MAX_GAS_PER_GROUP = {
  [GasGroup.registerValidator]: 400000,
  [GasGroup.registerValidatorExistingGroup]: 250000
}

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

  groups && groups.forEach(group => {
    const gasUsed = parseInt(receipt.gasUsed);
    const maxGas = MAX_GAS_PER_GROUP[group as keyof typeof MAX_GAS_PER_GROUP];

    if (gasUsed > maxGas) {
      throw new Error(`Gas usage too high. Max: ${maxGas}, Actual: ${gasUsed}`);
    }

    gasUsageStats.get(group.toString()).addStat(gasUsed);
  });
  return {
    ...receipt,
    eventsByName: receipt.events.reduce((aggr: any, item: any) => {
      aggr[item.event] = aggr[item.event] || [];
      aggr[item.event].push(item);
      return aggr;
    }, {}) };
};

export const getGasStats = (group: string) => {
  return gasUsageStats.get(group) || new GasStats();
};


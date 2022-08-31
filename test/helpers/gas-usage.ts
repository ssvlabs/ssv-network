export class GasStats {
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

const getOrCreate = (group: string) => {
  let groupStats = gasUsageStats.get(group);

  if (!groupStats) {
    groupStats = new GasStats();
    gasUsageStats.set(group, groupStats);
  }

  return groupStats;
};

export const trackGas = async (tx: Promise<any>, groups?: Array<string>): Promise<any> => {
  const receipt = await (await tx).wait();

  groups && groups.forEach(group => {
    const groupStats = getOrCreate(group);
    groupStats.addStat(parseInt(receipt.gasUsed));
  });
  return {
    receipt,
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


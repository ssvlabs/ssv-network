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

export const trackGas = async (tx: Promise<any>, group: string, maxGas: number) => {
  const receipt = await (await tx).wait();

  if (receipt.gasUsed > maxGas) {
    throw new Error(`Gas usage too high. Max: ${maxGas}, Actual: ${receipt.gasUsed}`);
  }
  console.log('\t', +receipt.gasUsed);

  const groupStats = getOrCreate(group);

  groupStats.addStat(parseInt(receipt.gasUsed));

  return receipt;
};

export const getGasStats = (group: string) => {
  return gasUsageStats.get(group) || new GasStats();
};

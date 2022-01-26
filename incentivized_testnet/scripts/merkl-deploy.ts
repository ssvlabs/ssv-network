import { ethers } from 'hardhat';
const fs = require('fs');
import { parse } from 'csv-parse';
import { parseBalanceMap } from './merkl-tree/parse-balance-map';

async function fetchRewards() {
  const rewardsFile = `${__dirname}/rewards.csv`;

  const rewards = [] as any;
  const rewardsParser = fs.createReadStream(rewardsFile).pipe(parse({ columns: true }));

  for await (const record of rewardsParser) {
    const amount = +`${record.amount}000000000000000000`;
    rewards.push({
      address: record.address,
      earnings: `0x${(amount).toString(16)}`,
      reasons: record.reasons || ''
    });
  }
  return rewards;
}

async function main() {
  const rewards = await fetchRewards();
  const result = parseBalanceMap(rewards);
  await fs.promises.writeFile('result.json', JSON.stringify(result, null, 4));
  const MerkleDistributorFactory = await ethers.getContractFactory('MerkleDistributor');
  const contract = await MerkleDistributorFactory.deploy(process.env.SSV_TOKEN_ADDRESS, result.merkleRoot, process.env.TREASURE_ADDRESS);
  console.log('MerkleDistributor deployed to:', contract.address);
}

// We recommend this pattern to be able to use async/await everywhere
// and properly handle errors.
main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
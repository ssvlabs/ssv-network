// Declare imports
import {
  owners,
  initializeContract,
  registerOperators,
  bulkRegisterValidators,
  DataGenerator,
  CONFIG,
  DEFAULT_OPERATOR_IDS,
} from '../helpers/contract-helpers';

import { mine } from '@nomicfoundation/hardhat-network-helpers';

import { expect } from 'chai';

let ssvNetwork: any, ssvViews: any, firstCluster: any;

// Declare globals
describe('DAO operational Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = await initializeContract();
    ssvNetwork = metadata.ssvNetwork;
    ssvViews = metadata.ssvNetworkViews;
  });

  it('Starting the transfer process does not change owner', async () => {
    await ssvNetwork.write.transferOwnership([owners[4].account.address]);

    expect(await ssvNetwork.read.owner()).to.deep.equal(owners[0].account.address);
  });

  it('Ownership is transferred in a 2-step process', async () => {
    await ssvNetwork.write.transferOwnership([owners[4].account.address]);
    await ssvNetwork.write.acceptOwnership([], { account: owners[4].account });

    expect(await ssvNetwork.read.owner()).to.deep.equal(owners[4].account.address);
  });

  it('Get the network validators count (add/remove validaotor)', async () => {
    await registerOperators(0, 4, CONFIG.minimalOperatorFee);

    const deposit = (BigInt(CONFIG.minimalBlocksBeforeLiquidation) + 2n) * CONFIG.minimalOperatorFee * 13n;

    firstCluster = (
      await bulkRegisterValidators(4, 1, DEFAULT_OPERATOR_IDS[4], deposit, {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0n,
        active: true,
      })
    ).args;

    expect(await ssvViews.read.getNetworkValidatorsCount()).to.equal(1);

    await ssvNetwork.write.removeValidator(
      [DataGenerator.publicKey(1), firstCluster.operatorIds, firstCluster.cluster],
      { account: owners[4].account },
    );

    expect(await ssvViews.read.getNetworkValidatorsCount()).to.equal(0);
  });

  it('Get the network validators count (add/remove validaotor)', async () => {
    await registerOperators(0, 4, CONFIG.minimalOperatorFee);

    const deposit = (BigInt(CONFIG.minimalBlocksBeforeLiquidation) + 2n) * (CONFIG.minimalOperatorFee * 13n);

    firstCluster = (
      await bulkRegisterValidators(4, 1, DEFAULT_OPERATOR_IDS[4], deposit, {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0n,
        active: true,
      })
    ).args;

    expect(await ssvViews.read.getNetworkValidatorsCount()).to.equal(1);

    await mine(CONFIG.minimalBlocksBeforeLiquidation);

    await ssvNetwork.write.liquidate([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster], {
      account: owners[4].account,
    });

    expect(await ssvViews.read.getNetworkValidatorsCount()).to.equal(0);
  });
});

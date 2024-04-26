// Declare imports
import { owners, initializeContract, registerOperators, DataGenerator, CONFIG } from '../helpers/contract-helpers';
import { assertEvent } from '../helpers/utils/test';
import { trackGas, GasGroup } from '../helpers/gas-usage';

import { ethers } from 'hardhat';
import { expect } from 'chai';

// Declare globals
let ssvNetwork: any, ssvViews: any;

describe('Others Operator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = await initializeContract();
    ssvNetwork = metadata.ssvNetwork;
    ssvViews = metadata.ssvNetworkViews;
  });

  it('Add fee recipient address emits "FeeRecipientAddressUpdated"', async () => {
    await assertEvent(
      ssvNetwork.write.setFeeRecipientAddress([owners[2].account.address], {
        account: owners[1].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'FeeRecipientAddressUpdated',
          argNames: ['owner', 'recipientAddress'],
          argValuesList: [[owners[1].account.address, owners[2].account.address]],
        },
      ],
    );
  });

  it('Get the maximum number of validators per operator', async () => {
    expect(await ssvViews.read.getValidatorsPerOperatorLimit()).to.equal(CONFIG.validatorsPerOperatorLimit);
  });
});

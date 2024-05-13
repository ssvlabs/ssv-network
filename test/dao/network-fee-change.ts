// Declare imports
import { owners, initializeContract, CONFIG } from '../helpers/contract-helpers';
import { assertEvent } from '../helpers/utils/test';

import { trackGas, GasGroup } from '../helpers/gas-usage';

import { expect } from 'chai';

// Declare globals
let ssvNetwork: any, ssvViews: any, networkFee: any;

describe('Network Fee Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = await initializeContract();
    ssvNetwork = metadata.ssvNetwork;
    ssvViews = metadata.ssvNetworkViews;

    // Define minumum allowed network fee to pass shrinkable validation
    networkFee = CONFIG.minimalOperatorFee / 10n;
  });

  it('Change network fee emits "NetworkFeeUpdated"', async () => {
    await assertEvent(ssvNetwork.write.updateNetworkFee([networkFee]), [
      {
        contract: ssvNetwork,
        eventName: 'NetworkFeeUpdated',
        argNames: ['oldFee', 'newFee'],
        argValuesList: [[0, networkFee]],
      },
    ]);
  });

  it('Change network fee providing UINT64 max value reverts "Max value exceeded"', async () => {
    const amount = 2n ** 64n * 100000000n;
    await expect(ssvNetwork.write.updateNetworkFee([amount])).to.be.rejectedWith('Max value exceeded');
  });

  it('Change network fee when it was set emits "NetworkFeeUpdated"', async () => {
    const initialNetworkFee = CONFIG.minimalOperatorFee;
    await ssvNetwork.write.updateNetworkFee([initialNetworkFee]);

    it('Change network fee emits "NetworkFeeUpdated"', async () => {
      await assertEvent(ssvNetwork.write.updateNetworkFee([networkFee]), [
        {
          contract: ssvNetwork,
          eventName: 'NetworkFeeUpdated',
          argNames: ['oldFee', 'newFee'],
          argValuesList: [[initialNetworkFee, networkFee]],
        },
      ]);
    });
  });

  it('Change network fee gas limit', async () => {
    await trackGas(ssvNetwork.write.updateNetworkFee([networkFee]), [GasGroup.NETWORK_FEE_CHANGE]);
  });

  it('Get network fee', async () => {
    expect(await ssvViews.read.getNetworkFee()).to.equal(0);
  });

  it('Change the network fee to a number below the minimum fee reverts "Max precision exceeded"', async () => {
    await expect(ssvNetwork.write.updateNetworkFee([networkFee - 1n])).to.be.rejectedWith('Max precision exceeded');
  });

  it('Change the network fee to a number that exceeds allowed type limit reverts "Max value exceeded"', async () => {
    const amount = 2n ** 64n * 100000000n;

    await expect(ssvNetwork.write.updateNetworkFee([amount + 1n])).to.be.rejectedWith('Max value exceeded');
  });

  it('Change network fee from an address thats not the DAO reverts "caller is not the owner"', async () => {
    await expect(
      ssvNetwork.write.updateNetworkFee([networkFee], {
        account: owners[3].account,
      }),
    ).to.be.rejectedWith('Ownable: caller is not the owner');
  });
});

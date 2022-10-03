import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';

import { expect } from 'chai';

let ssvNetworkContract: any, networkFee: any;

describe('Network Fee Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    // Register operators
    await helpers.registerOperators(0, 12, helpers.CONFIG.minimalOperatorFee);

    // Define minumum allowed network fee to pass shrinkable validation
    networkFee = helpers.CONFIG.minimalOperatorFee / 10;
  });

  it('Get network fee', async () => {
    expect(await ssvNetworkContract.getNetworkFee()).to.equal(0);
  });

  it('Change network fee', async () => {
    await ssvNetworkContract.updateNetworkFee(networkFee);
    expect(await ssvNetworkContract.getNetworkFee()).to.equal(networkFee);
  });

  it('Change network fee with a small number error', async () => {
    await expect(ssvNetworkContract.updateNetworkFee(networkFee - 1)).to.be.revertedWith('Precision is over the maximum defined');
  });

  it('Change network fee with an invalid owner', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[3]).updateNetworkFee(networkFee)).to.be.revertedWith('caller is not the owner');
  });
});

// Declare imports
import * as helpers from '../helpers/contract-helpers';
import { expect } from 'chai';

// Declare globals
let ssvNetworkContract: any;

describe('Others Operator Tests', () => {
  beforeEach(async () => {
    ssvNetworkContract = (await helpers.initializeContract()).contract;
  });

  it('Add fee recipient address emits "FeeRecipientAddressAdded"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).feeRecipientAddress(
      helpers.DB.owners[2].address
    ))
      .to.emit(ssvNetworkContract, 'FeeRecipientAddressAdded')
      .withArgs(helpers.DB.owners[1].address, helpers.DB.owners[2].address);
  });
});

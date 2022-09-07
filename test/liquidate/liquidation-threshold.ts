import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';

const numberOfOperators = 4;
const operatorFee = 4;

let ssvNetworkContract: any, operatorIDs: any, shares: any, owner: any;


describe('Liquidation Threshold Tests', () => {
  beforeEach(async () => {
    const contractData = await helpers.initializeContract();
    ssvNetworkContract = contractData.contract;
  });

  it('Get liquidation threshold', async () => {

  });

  it('Change liquidation threshold', async () => {

  });

  it('Change liquidation threshold errors', async () => {

  });

  it('Liquidation threshold gas limits', async () => {

  });

});

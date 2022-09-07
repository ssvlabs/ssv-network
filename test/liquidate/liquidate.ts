import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';

const numberOfOperators = 4;
const operatorFee = 4;

let ssvNetworkContract: any, operatorIDs: any, shares: any, owner: any;

describe('Liquidate Tests', () => {
  beforeEach(async () => {
    const contractData = await helpers.initializeContract();
    ssvNetworkContract = contractData.contract;
  });

  it('Liquidatable', async () => {

  });

  it('Liquidate', async () => {

  });

  it('Liquidate errors', async () => {

  });

  it('Liquidate gas limits', async () => {

  });

});

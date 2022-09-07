import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';

const numberOfOperators = 4;
const operatorFee = 4;

let ssvNetworkContract: any, operatorIDs: any, shares: any, owner: any;

describe('Withdraw Tests', () => {
  beforeEach(async () => {
    const contractData = await helpers.initializeContract();
    ssvNetworkContract = contractData.contract;
  });

  it('Withdraw', async () => {

  });

  it('Withdraw errors', async () => {

  });

  it('Withdraw gas limits', async () => {

  });

});

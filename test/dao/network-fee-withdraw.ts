import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';

const numberOfOperators = 4;
const operatorFee = 4;

let ssvNetworkContract: any, operatorIDs: any, shares: any, owner: any;

describe('DAO Network Fee Withdraw Tests', () => {
  beforeEach(async () => {
    const contractData = await helpers.initializeContract();
    ssvNetworkContract = contractData.contract;
  });

  it('Get withdrawable network fee amount', async () => {

  });

  it('Withdraw network fee', async () => {

  });

  it('Withdraw network fee errors', async () => {

  });

});

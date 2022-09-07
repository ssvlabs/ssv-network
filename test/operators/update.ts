import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';

const numberOfOperators = 4;
const operatorFee = 4;

let ssvNetworkContract: any, operatorIDs: any, shares: any, owner: any;

describe('Update Operator Tests', () => {
  beforeEach(async () => {
    const contractData = await helpers.initializeContract();
    ssvNetworkContract = contractData.contract;
  });

  it('Update operator', async () => {

  });

  it('Update operator errors', async () => {

  });

  it('Update operator gas limits', async () => {

  });

});

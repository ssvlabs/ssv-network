import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';

const numberOfOperators = 4;
const operatorFee = 4;

let registryContract: any, operatorIDs: any, shares: any, owner: any;

describe('Liquidate Tests', () => {
  beforeEach(async () => {
    const contractData = await helpers.initializeContract(numberOfOperators, operatorFee);
    registryContract = contractData.contract;
    operatorIDs = contractData.operatorIDs;
    shares = contractData.shares;
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

import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';

const numberOfOperators = 4;
const operatorFee = 4;

let registryContract: any, operatorIDs: any, shares: any, owner: any;

describe('Remove Operator Tests', () => {
  beforeEach(async () => {
    const contractData = await helpers.initializeContract(numberOfOperators, operatorFee);
    registryContract = contractData.contract;
    operatorIDs = contractData.operatorIDs;
    shares = contractData.shares;
  });

  it('Remove operator', async () => {

  });

  it('Remove operator errors', async () => {

  });

  it('Remove operator gas limits', async () => {

  });

});

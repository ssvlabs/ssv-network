declare const ethers: any;

import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';

const numberOfOperators = 1000;
const operatorFee = 1;

let registryContract: any, operatorIDs: any, shares: any;
let validatorData: any = [];

describe('Stress Tests', () => {
  beforeEach(async () => {
    const contractData = await helpers.initializeContract(numberOfOperators, operatorFee);
    registryContract = contractData.contract;
    operatorIDs = contractData.operatorIDs;
    shares = contractData.shares;

    // Register 1000 validators
    validatorData = await helpers.registerValidators(1000, '10000', numberOfOperators, registryContract);
  });

  it('Update 1000 operators', async () => {
    for (let i = 0; i < operatorIDs.length; i++) {
      await registryContract.updateOperatorFee(operatorIDs[i], 10);
    }
  });

  it('Update 1000 validators', async () => {
    for (let i = 1000; i < (validatorData.length + 1000); i++) {
      const randomOperator = Math.floor(Math.random() * (numberOfOperators - 4));
      await registryContract.updateValidator(
        validatorData[i-1000].publicKey,
        [randomOperator, randomOperator + 1, randomOperator + 2, randomOperator + 3],
        shares[1],
        '10001'
      );
    }
  });

  it('Remove 1000 operators', async () => {
    for (let i = 0; i < operatorIDs.length; i++) {
      await registryContract.removeOperator(operatorIDs[i]);
    }
  });

  it('Remove 1000 validators', async () => {
    for (let i = 0; i < validatorData.length; i++) {
      await registryContract.removeValidator(validatorData[i].publicKey);
    }
  });

});

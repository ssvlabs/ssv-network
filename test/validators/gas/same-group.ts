import * as helpers from '../../helpers/contract-helpers';

import { expect } from 'chai';

const numberOfOperators = 4;
const operatorFee = 4;

let registryContract: any, operatorIDs: any, shares: any, owner: any;

describe('Register Validator Gas Tests Same Group', () => {
  beforeEach(async () => {
    const contractData = await helpers.initializeContract(numberOfOperators, operatorFee);
    registryContract = contractData.contract;
    operatorIDs = contractData.operatorIDs;
    shares = contractData.shares;
  });

  it('Same group', async () => {
    const validatorPK = '0x98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098100';

    await registryContract.registerValidator(
      `${validatorPK}0`,
      [1, 2, 3, 4],
      shares[0],
      '10000'
    );

    await registryContract.registerValidator(
      `${validatorPK}1`,
      [1, 2, 3, 4],
      shares[1],
      '10000'
    );
  });

});

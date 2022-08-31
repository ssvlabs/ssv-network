import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { trackGas } from '../helpers/gas-usage';

const numberOfOperators = 4;
const operatorFee = 4;

let registryContract: any, operatorIDs: any, shares: any, owner: any;

describe('Register Operator Tests', () => {
  beforeEach(async () => {
    const contractData = await helpers.initializeContract(numberOfOperators, operatorFee);
    registryContract = contractData.contract;
    operatorIDs = contractData.operatorIDs;
    shares = contractData.shares;
  });

  it('Register operator', async () => {

  });

  it('Register operator errors', async () => {

  });

  it('Register operator gas limits', async () => {
    const validatorPK = '0x98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098100';

    // Cost: 364101
    await trackGas(registryContract.registerValidator(
      `${validatorPK}0`,
      [1, 2, 3, 4],
      shares[0],
      '10000'
    ), ['registerValidator']);

    // // Cost: 185380
    // await deployedRegistryContract.registerValidator(
    //     [1, 2, 3, 4],
    //     `${validatorPK}1`,
    //     sharePKs.slice(0, 4),
    //     encryptedShares.slice(0, 4),
    //     "10000"
    // )

    // Cost: 295713
    await registryContract.registerValidator(
      `${validatorPK}1`,
      [1, 2, 5, 6],
      shares[1],
      '10000'
    );

    // // Cost: 312813
    // await deployedRegistryContract.registerValidator(
    //     [1, 5, 6, 7],
    //     `${validatorPK}2`,
    //     sharePKs.slice(0, 4),
    //     encryptedShares.slice(0, 4),
    //     "10000"
    // )

    // // Cost: 329901
    // await deployedRegistryContract.registerValidator(
    //     [5, 6, 7, 8],
    //     `${validatorPK}0`,
    //     sharePKs.slice(0, 4),
    //     encryptedShares.slice(0, 4),
    //     "10000"
    // )
  });

});

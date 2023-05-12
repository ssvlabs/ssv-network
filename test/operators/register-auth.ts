// Declare imports
import * as helpers from '../helpers/contract-helpers';
import { expect } from 'chai';

// Declare globals
let ssvNetworkContract: any, registerAuth: any;

describe('Register Auth Operator Tests', () => {
  before(async () => {
    const metadata = (await helpers.initializeContract());
    ssvNetworkContract = metadata.contract;
    registerAuth = metadata.registerAuth;
  });

  it('Register operator with unauthorized address reverts "NotAuthorized"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerOperator(
      helpers.DataGenerator.publicKey(12),
      helpers.CONFIG.minimalOperatorFee
    )).to.be.revertedWithCustomError(ssvNetworkContract, 'NotAuthorized');

  });

  it('Register operator with unauthorized address reverts "NotAuthorized" (2)', async () => {
    await registerAuth.setAuth(helpers.DB.owners[1].address, { registerOperator: false, registerValidator: true });

    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerOperator(
      helpers.DataGenerator.publicKey(12),
      helpers.CONFIG.minimalOperatorFee
    )).to.be.revertedWithCustomError(ssvNetworkContract, 'NotAuthorized');
  });

  it('Register validator with unauthorized address reverts "NotAuthorized"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[3]).registerValidator(
      helpers.DataGenerator.publicKey(12),
      [1, 2, 3, 4],
      helpers.DataGenerator.shares(4),
      10000000,
      {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        active: true
      }
    )).to.be.revertedWithCustomError(ssvNetworkContract, 'NotAuthorized');

  });

  it('Register validator with unauthorized address reverts "NotAuthorized" (2)', async () => {
    await registerAuth.setAuth(helpers.DB.owners[3].address, { registerOperator: true, registerValidator: false });

    await expect(ssvNetworkContract.connect(helpers.DB.owners[3]).registerValidator(
      helpers.DataGenerator.publicKey(12),
      [1, 2, 3, 4],
      helpers.DataGenerator.shares(4),
      10000000,
      {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        active: true
      }
    )).to.be.revertedWithCustomError(ssvNetworkContract, 'NotAuthorized');
  });

});
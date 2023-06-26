// Declare imports
import * as helpers from '../helpers/contract-helpers';
import { expect } from 'chai';

// Declare globals
let ssvNetworkContract: any;

describe('Register Auth Operator Tests', () => {
  before(async () => {
    const metadata = (await helpers.initializeContract());
    ssvNetworkContract = metadata.contract;
  });

  it('Register auth and get auth data', async () => {
    await ssvNetworkContract.setRegisterAuth(helpers.DB.owners[10].address, true, false);
    expect(await ssvNetworkContract.getRegisterAuth(helpers.DB.owners[10].address)).to.deep.equal(
      [true, false]
    );

    await ssvNetworkContract.setRegisterAuth(helpers.DB.owners[11].address, false, true);
    expect(await ssvNetworkContract.getRegisterAuth(helpers.DB.owners[11].address)).to.deep.equal(
      [false, true]
    )

    await ssvNetworkContract.setRegisterAuth(helpers.DB.owners[12].address, true, true);
    expect(await ssvNetworkContract.getRegisterAuth(helpers.DB.owners[12].address)).to.deep.equal(
      [true, true]
    )

    expect(await ssvNetworkContract.getRegisterAuth(helpers.DB.owners[5].address)).to.deep.equal(
      [false, false]
    )
  });

  it('Register operator with unauthorized address reverts "NotAuthorized"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerOperator(
      helpers.DataGenerator.publicKey(12),
      helpers.CONFIG.minimalOperatorFee
    )).to.be.revertedWithCustomError(ssvNetworkContract, 'NotAuthorized');

  });

  it('Register operator with unauthorized address reverts "NotAuthorized" (2)', async () => {
    await ssvNetworkContract.setRegisterAuth(helpers.DB.owners[1].address, false, true);

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
    await ssvNetworkContract.setRegisterAuth(helpers.DB.owners[3].address, true, false);

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
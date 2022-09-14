import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any;

describe('Register Operator Tests', () => {
  beforeEach(async () => {
    // Initialize the contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;
  });

  it('Register operator with expected emit', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerOperator(
      helpers.DataGenerator.publicKey(0),
      '10'
    )).to.emit(ssvNetworkContract, 'OperatorAdded').withArgs(1, helpers.DB.owners[1].address, helpers.DataGenerator.publicKey(0));
  });

  it('Register operator', async () => {
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerOperator(
      helpers.DataGenerator.publicKey(0),
      '10'
    ), [GasGroup.REGISTER_OPERATOR]);
  });

  it('Register operator same public key', async () => {
    // Register operator
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerOperator(
      helpers.DataGenerator.publicKey(0),
      '10'
    ), [GasGroup.REGISTER_OPERATOR]);

    // Register operator with same public key / owner
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerOperator(
      helpers.DataGenerator.publicKey(0),
      '10'
    ), [GasGroup.REGISTER_OPERATOR]);
  });

  it('Fails to register with low fee', async () => {
    await expect(ssvNetworkContract.registerOperator(
      helpers.DataGenerator.publicKey(0),
      '0'
    )).to.be.revertedWith('FeeTooLow');
  });

  // SHOULD HAVE SOME VALIDITY HERE FOR PUBLIC KEY
  it('Fails to register with an invalid public key', async () => {
    await expect(ssvNetworkContract.registerOperator(
      helpers.DataGenerator.shares(0),
      '10'
    )).to.be.revertedWith('InvalidPublicKey');
  });

  // // To add some sort of validity here maybe?
  // it('Register operator invalid fee', async () => {
  //   await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerOperator(
  //     helpers.DataGenerator.publicKey(0),
  //     'abc'
  //     )).to.be.revertedWith('InvalidFee');
  // });

});

// Declare imports
import * as helpers from '../helpers/contract-helpers';
import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

// Declare globals
let ssvNetworkContract: any;

describe('Register Operator Tests', () => {
  beforeEach(async () => {
    ssvNetworkContract = (await helpers.initializeContract()).contract;
  });

  it('Register operator emits "OperatorAdded"', async () => {
    const publicKey = helpers.DataGenerator.publicKey(0);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerOperator(
      publicKey,
      helpers.CONFIG.minimalOperatorFee,
    )).to.emit(ssvNetworkContract, 'OperatorAdded').withArgs(1, helpers.DB.owners[1].address, publicKey, helpers.CONFIG.minimalOperatorFee);
  });

  it('Register operator gas limits', async () => {
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerOperator(
      helpers.DataGenerator.publicKey(0),
      helpers.CONFIG.minimalOperatorFee,
    ), [GasGroup.REGISTER_OPERATOR]);
  });

  it('Register an operator with a fee thats too low reverts "FeeTooLow"', async () => {
    await expect(ssvNetworkContract.registerOperator(
      helpers.DataGenerator.publicKey(0),
      '10'
    )).to.be.revertedWithCustomError(ssvNetworkContract,'FeeTooLow');
  });

  it('Get operator by id', async () => {
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerOperator(
      helpers.DataGenerator.publicKey(0),
      helpers.CONFIG.minimalOperatorFee,
    ), [GasGroup.REGISTER_OPERATOR]);

    expect((await ssvNetworkContract.getOperatorById(1)).owner).to.equal(helpers.DB.owners[1].address);
    expect((await ssvNetworkContract.getOperatorById(1)).fee).to.equal(helpers.CONFIG.minimalOperatorFee);
    expect((await ssvNetworkContract.getOperatorById(1)).validatorCount).to.equal(0);
  });

  it('Get operator by id reverts "OperatorNotFound"', async () => {
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerOperator(
      helpers.DataGenerator.publicKey(0),
      helpers.CONFIG.minimalOperatorFee,
    ), [GasGroup.REGISTER_OPERATOR]);

    await expect(ssvNetworkContract.getOperatorById(3)).to.be.revertedWithCustomError(ssvNetworkContract,'OperatorNotFound');
  });
});

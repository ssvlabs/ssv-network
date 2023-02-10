// Declare imports
import * as helpers from '../helpers/contract-helpers';
import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

// Declare globals
let ssvNetworkContract: any, ssvViews: any;

describe('Register Operator Tests', () => {
  beforeEach(async () => {
    const metadata = (await helpers.initializeContract());
    ssvNetworkContract = metadata.contract;
    ssvViews = metadata.ssvViews;
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

  it('Get operator by id', async () => {
    await ssvNetworkContract.connect(helpers.DB.owners[1]).registerOperator(
      helpers.DataGenerator.publicKey(0),
      helpers.CONFIG.minimalOperatorFee);

    expect((await ssvViews.getOperatorById(1))[0]).to.equal(helpers.DB.owners[1].address); // owner
    expect((await ssvViews.getOperatorById(1))[1]).to.equal(helpers.CONFIG.minimalOperatorFee); // fee
    expect((await ssvViews.getOperatorById(1))[2]).to.equal(0); // validatorCount
    expect((await ssvViews.getOperatorById(1))[3]).to.equal(true); // active
  });

  it('Get operator by id reverts "OperatorDoesNotExist"', async () => {
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerOperator(
      helpers.DataGenerator.publicKey(0),
      helpers.CONFIG.minimalOperatorFee,
    ), [GasGroup.REGISTER_OPERATOR]);

    await expect(ssvViews.getOperatorById(3)).to.be.revertedWithCustomError(ssvNetworkContract, 'OperatorDoesNotExist');
  });

  it('Get operator removed by id', async () => {
    await ssvNetworkContract.connect(helpers.DB.owners[1]).registerOperator(
      helpers.DataGenerator.publicKey(0),
      helpers.CONFIG.minimalOperatorFee,
    );
    await ssvNetworkContract.connect(helpers.DB.owners[1]).removeOperator(1);

    expect((await ssvViews.getOperatorById(1))[0]).to.equal(helpers.DB.owners[1].address);
    expect((await ssvViews.getOperatorById(1))[1]).to.equal(0);
    expect((await ssvViews.getOperatorById(1))[2]).to.equal(0);
    expect((await ssvViews.getOperatorById(1))[3]).to.equal(false);
  });

  it('Register an operator with a fee thats too low reverts "FeeTooLow"', async () => {
    await expect(ssvNetworkContract.registerOperator(
      helpers.DataGenerator.publicKey(0),
      '10'
    )).to.be.revertedWithCustomError(ssvNetworkContract, 'FeeTooLow');
  });
});
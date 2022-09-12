import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any;

describe('Register Operator Tests', () => {
  beforeEach(async () => {
    ssvNetworkContract = (await helpers.initializeContract()).contract;
  });

  it('Register operator', async () => {
    const publicKey = helpers.DataGenerator.publicKey(0);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerOperator(
      publicKey,
      '10'
    )).to.emit(ssvNetworkContract, 'OperatorAdded').withArgs(1, helpers.DB.owners[1].address, publicKey);
  });

  it('Fails to register with low fee', async () => {
    await expect(ssvNetworkContract.registerOperator(
      helpers.DataGenerator.publicKey(0),
      '0'
    )).to.be.revertedWith('FeeTooLow');
  });

  it('Register operator gas limits', async () => {
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerOperator(
      helpers.DataGenerator.publicKey(0),
      '10'
    ), [GasGroup.REGISTER_OPERATOR]);
  });

});

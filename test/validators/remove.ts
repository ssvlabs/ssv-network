declare const ethers: any;

import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';


let registryContract: any;

describe('Remove Validator Tests', () => {
  beforeEach(async () => {
    const contractData = await helpers.initializeContract();
    registryContract = contractData.contract;
    await helpers.registerOperators(0, 1, '10');
    await helpers.registerOperators(1, 1, '10');
    await helpers.registerOperators(2, 1, '10');
    await helpers.registerOperators(3, 1, '10');

    await helpers.deposit([4], ['100000']);
  });

  it('Remove validator', async () => {
    const { validators } = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new());
    await trackGas(registryContract.connect(helpers.DB.owners[4]).removeValidator(validators[0].publicKey), [GasGroup.REMOVE_VALIDATOR]);
  });

  it('Fails to remove validator with no owner', async () => {
    const { validators } = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.pod.new());
    await expect(trackGas(registryContract.connect(helpers.DB.owners[3]).removeValidator(validators[0].publicKey))).to.be.revertedWith('ValidatorNotOwned');
  });
});

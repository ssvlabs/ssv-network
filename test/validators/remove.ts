declare const ethers: any;

import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';


let ssvNetworkContract: any;
let minDepositAmount: any;

describe('Remove Validator Tests', () => {
  beforeEach(async () => {
    ssvNetworkContract = (await helpers.initializeContract()).contract;
    await helpers.registerOperators(0, 1, helpers.CONFIG.minimalOperatorFee);
    await helpers.registerOperators(1, 1, helpers.CONFIG.minimalOperatorFee);
    await helpers.registerOperators(2, 1, helpers.CONFIG.minimalOperatorFee);
    await helpers.registerOperators(3, 1, helpers.CONFIG.minimalOperatorFee);

    minDepositAmount = helpers.CONFIG.minimalBlocksBeforeLiquidation * helpers.CONFIG.minimalOperatorFee * 4;

    await helpers.deposit([4], [minDepositAmount]);
  });

  it('Remove validator emits ValidatorRemoved event', async () => {
    const { validators } = await helpers.registerValidators(4, 1, minDepositAmount, helpers.DataGenerator.pod.new());

    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).removeValidator(
      validators[0].publicKey,
    )).to.emit(ssvNetworkContract, 'ValidatorRemoved');
  });

  it('Remove validator track gas', async () => {
    const { validators } = await helpers.registerValidators(4, 1, minDepositAmount, helpers.DataGenerator.pod.new());
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).removeValidator(validators[0].publicKey), [GasGroup.REMOVE_VALIDATOR]);
  });

  it('Fails to remove validator with no owner', async () => {
    const { validators } = await helpers.registerValidators(4, 1, minDepositAmount, helpers.DataGenerator.pod.new());
    await expect(ssvNetworkContract.connect(helpers.DB.owners[3]).removeValidator(validators[0].publicKey)).to.be.revertedWith('ValidatorNotOwned');
  });
});

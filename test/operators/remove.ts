import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, minDepositAmount: any;

describe('Remove Operator Tests', () => {
  beforeEach(async () => {
    // Initialize the contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    //Register an operator
    await helpers.registerOperators(0, 1, helpers.CONFIG.minimalOperatorFee);

    // Define a minimum deposit amount
    minDepositAmount = helpers.CONFIG.minimalBlocksBeforeLiquidation * helpers.CONFIG.minimalOperatorFee * 4;
  });

  it('Remove operator emits OperatorRemoved event', async () => {
    await expect(ssvNetworkContract.removeOperator(1)).to.emit(ssvNetworkContract, 'OperatorRemoved').withArgs(1);
  });

  it('Remove operator without validators', async () => {
    await trackGas(ssvNetworkContract.removeOperator(1), [GasGroup.REMOVE_OPERATOR]);
  });

  it('Remove operators with validators', async () => {
    // Register 3 operators
    await helpers.registerOperators(0, 3, helpers.CONFIG.minimalOperatorFee);

    // Deposit into account
    await helpers.deposit([2], [`${minDepositAmount * 2}`]);

    // Register 5 validators
    await helpers.registerValidators(2, 5, minDepositAmount, [1, 2, 3, 4], [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);

    // Remove all the operators
    for (let i = 1; i < 5; i++) await trackGas(ssvNetworkContract.removeOperator(i), [GasGroup.REMOVE_OPERATOR]);
  });

  it('Remove operator invalid owner', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).removeOperator(1)).to.be.revertedWith('CallerNotOwner');
  });

  it('Add and delete already removed operator', async () => {
    // Remove operator
    await trackGas(ssvNetworkContract.removeOperator(1), [GasGroup.REMOVE_OPERATOR]);

    // Add same operator
    await trackGas(ssvNetworkContract.registerOperator(helpers.DataGenerator.publicKey(0), helpers.CONFIG.minimalOperatorFee), [GasGroup.REGISTER_OPERATOR]);

    // Remove operator again
    await trackGas(ssvNetworkContract.removeOperator(2), [GasGroup.REMOVE_OPERATOR]);
  });

  // THIS SHOULD HAVE A MORE CLEAR ERROR MESSAGE
  it('Remove non existent operator', async () => {
    await expect(ssvNetworkContract.removeOperator(20)).to.be.revertedWith('CallerNotOwner');
  });

  // THIS SHOULD BE PASSING
  it('Remove already removed operator', async () => {
    // Remove operator
    await trackGas(ssvNetworkContract.removeOperator(1), [GasGroup.REMOVE_OPERATOR]);

    // Remove same operator again
    await expect(ssvNetworkContract.removeOperator(1)).to.be.revertedWith('CallerNotOwner');
  });

});

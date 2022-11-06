import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';

import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, clusterResult1: any, minDepositAmount: any;

describe('Withdraw Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    // Register operators
    await helpers.registerOperators(0, 12, helpers.CONFIG.minimalOperatorFee);

    minDepositAmount = (helpers.CONFIG.minimalBlocksBeforeLiquidation + 10) * helpers.CONFIG.minimalOperatorFee * 4;

    // Register validators
    clusterResult1 = await helpers.registerValidators(4, 1, minDepositAmount, helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
  });

  it('Withdraw emits ValidatorFundsWithdrawal event', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4])['withdraw(bytes,uint256)'](clusterResult1.validators[0].publicKey, helpers.CONFIG.minimalOperatorFee)).to.emit(ssvNetworkContract, 'ValidatorFundsWithdrawal');
  });

  it('Withdraw all emits OperatorFundsWithdrawal event', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[0]).withdrawAll(1)).to.emit(ssvNetworkContract, 'OperatorFundsWithdrawal');
  });

  it('Withdraw all gas limits', async () => {
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[0]).withdrawAll(1), [GasGroup.WITHDRAW]);
  });

  it('Withdraw returns error - NotEnoughBalance', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4])['withdraw(bytes,uint256)'](clusterResult1.validators[0].publicKey, minDepositAmount)).to.be.revertedWith('NotEnoughBalance');
  });

  it('Withdraw gas limits', async () => {
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4])['withdraw(bytes,uint256)'](clusterResult1.validators[0].publicKey, helpers.CONFIG.minimalOperatorFee), [GasGroup.WITHDRAW]);
  });
});

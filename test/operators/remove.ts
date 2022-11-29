// Declare imports
import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';
import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

// Declare globals
let ssvNetworkContract: any;

describe('Remove Operator Tests', () => {
  beforeEach(async () => {
    ssvNetworkContract = (await helpers.initializeContract()).contract;
  });

  it('Remove operator emits "OperatorRemoved"', async () => {
    await helpers.registerOperators(0, 1, helpers.CONFIG.minimalOperatorFee);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[0]).removeOperator(1
    )).to.emit(ssvNetworkContract, 'OperatorRemoved').withArgs(1);
  });

  it('Remove operator gas limits', async () => {
    await helpers.registerOperators(0, 1, helpers.CONFIG.minimalOperatorFee);
    await trackGas(ssvNetworkContract.removeOperator(1), [GasGroup.REMOVE_OPERATOR]);
  });

  it('Remove operator with a balance emits "OperatorFundsWithdrawal"', async () => {
    await helpers.registerOperators(0, 4, helpers.CONFIG.minimalOperatorFee);
    await helpers.registerValidators(4, 1, `${helpers.CONFIG.minimalBlocksBeforeLiquidation * helpers.CONFIG.minimalOperatorFee * 4}`, [1, 2, 3, 4], [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    await expect(ssvNetworkContract.removeOperator(1
    )).to.emit(ssvNetworkContract, 'OperatorFundsWithdrawal');
  });

  it('Remove operator with a balance gas limits', async () => {
    await helpers.registerOperators(0, 4, helpers.CONFIG.minimalOperatorFee);
    await helpers.registerValidators(4, 1, `${helpers.CONFIG.minimalBlocksBeforeLiquidation * helpers.CONFIG.minimalOperatorFee * 4}`, [1, 2, 3, 4], [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    await trackGas(ssvNetworkContract.removeOperator(1), [GasGroup.REMOVE_OPERATOR_WITH_WITHDRAW]);
  });

  it('Remove operator I do not own reverts "CallerNotOwner"', async () => {
    await helpers.registerOperators(0, 1, helpers.CONFIG.minimalOperatorFee);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).removeOperator(1
    )).to.be.revertedWith('CallerNotOwner');
  });
});
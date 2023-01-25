// Declare imports
import * as helpers from '../helpers/contract-helpers';
import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

// Declare globals
let ssvNetworkContract: any;

describe('Remove Operator Tests', () => {
  beforeEach(async () => {
    ssvNetworkContract = (await helpers.initializeContract()).contract;
    // Register operators
    await helpers.registerOperators(0, 5, helpers.CONFIG.minimalOperatorFee);

    // Register a validator
    // cold register
    await helpers.DB.ssvToken.connect(helpers.DB.owners[6]).approve(helpers.DB.ssvNetwork.contract.address, '1000000000000000');
    await ssvNetworkContract.connect(helpers.DB.owners[6]).registerValidator(
      '0x221111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111119',
      [1,2,3,4],
      helpers.DataGenerator.shares(4),
      '1000000000000000',
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    );
  });

  it('Remove operator emits "OperatorRemoved"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[0]).removeOperator(1))
      .to.emit(ssvNetworkContract, 'OperatorRemoved').withArgs(1);
  });

  it('Remove operator gas limits', async () => {
    await trackGas(ssvNetworkContract.removeOperator(1), [GasGroup.REMOVE_OPERATOR]);
  });

  it('Remove operator with 0 balance emits "OperatorWithdrawn"', async () => {
    await expect(ssvNetworkContract.removeOperator(5)).not.to.emit(ssvNetworkContract, 'OperatorWithdrawn');
  });

  it('Remove operator with a balance emits "OperatorWithdrawn"', async () => {
    await helpers.registerValidators(4, 1, `${helpers.CONFIG.minimalBlocksBeforeLiquidation * helpers.CONFIG.minimalOperatorFee * 4}`, [1,2,3,4], [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    await expect(ssvNetworkContract.removeOperator(1)).to.emit(ssvNetworkContract, 'OperatorWithdrawn');
  });

  it('Remove operator with a balance gas limits', async () => {
    await helpers.registerValidators(4, 1, `${helpers.CONFIG.minimalBlocksBeforeLiquidation * helpers.CONFIG.minimalOperatorFee * 4}`, [1,2,3,4], [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    await trackGas(ssvNetworkContract.removeOperator(1), [GasGroup.REMOVE_OPERATOR_WITH_WITHDRAW]);
  });

  it('Remove operator I do not own reverts "CallerNotOwner"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).removeOperator(1))
      .to.be.revertedWithCustomError(ssvNetworkContract,'CallerNotOwner');
  });
});
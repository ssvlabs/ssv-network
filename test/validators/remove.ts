// Decalre imports
import * as helpers from '../helpers/contract-helpers';
import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

// Decalre globals 
let ssvNetworkContract: any, clusterResult: any, minDepositAmount: any;

describe('Remove Validator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    minDepositAmount = helpers.CONFIG.minimalBlocksBeforeLiquidation * helpers.CONFIG.minimalOperatorFee * 4;

    // Register operators
    await helpers.registerOperators(0, 4, helpers.CONFIG.minimalOperatorFee);

    // Register a validator
    clusterResult = await helpers.registerValidators(4, 1, minDepositAmount, helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
  });

  it('Remove validator emits "ValidatorRemoved"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).removeValidator(
      clusterResult.validators[0].publicKey,
    )).to.emit(ssvNetworkContract, 'ValidatorRemoved');
  });

  it('Remove validator gas limits', async () => {
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).removeValidator(clusterResult.validators[0].publicKey), [GasGroup.REMOVE_VALIDATOR]);
  });

  it('Remove validator with a removed operator in a cluster', async () => {
    await trackGas(ssvNetworkContract.removeOperator(1), [GasGroup.REMOVE_OPERATOR_WITH_WITHDRAW]);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).removeValidator(clusterResult.validators[0].publicKey), [GasGroup.REMOVE_VALIDATOR]);
  });

  it('Remove validator I do not own reverts "ValidatorNotOwned"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[3]).removeValidator(clusterResult.validators[0].publicKey
    )).to.be.revertedWith('ValidatorNotOwned');
  });

  it('Remove same validator twice reverts "ValidatorNotOwned"', async () => {
    // Remove validator
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).removeValidator(clusterResult.validators[0].publicKey), [GasGroup.REMOVE_VALIDATOR]);

    // Remove validator again
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).removeValidator(clusterResult.validators[0].publicKey)).to.be.revertedWith('ValidatorNotOwned');
  });

  it('Register a removed validator and remove again', async () => {
    // Remove validator
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).removeValidator(clusterResult.validators[0].publicKey), [GasGroup.REMOVE_VALIDATOR]);

    // Re-register validator
    await ssvNetworkContract.connect(helpers.DB.owners[4]).registerValidator(
      helpers.DataGenerator.publicKey(0),
      (await helpers.registerPodAndDeposit(4, [1, 2, 3, 4], minDepositAmount)).clusterId,
      helpers.DataGenerator.shares(0),
    );

    // Remove the validator again
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).removeValidator(helpers.DataGenerator.publicKey(0)), [GasGroup.REMOVE_VALIDATOR]);
  });

  // TODO: Once liquidation is updated
  it('Remove validator from a liquidated cluster', async () => {
    // // Register validator
    // const { validators } = await helpers.registerValidators(4, 1, '10000', helpers.DataGenerator.cluster.new());
    // // Liquidate cluster
    // // Progress blocks to liquidatable state
    // // Liquidate cluster
    // // Remove validator
    // await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).removeValidator(
    //     validators[0].publicKey,
    // )).to.emit(ssvNetworkContract, 'ValidatorRemoved');
  });
});

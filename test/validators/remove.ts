// Decalre imports
import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';
import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

// Declare globals
let ssvNetworkContract: any, registerAuth: any, minDepositAmount: any, firstCluster: any;

describe('Remove Validator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = (await helpers.initializeContract());
    ssvNetworkContract = metadata.contract;
    registerAuth = metadata.registerAuth;

    minDepositAmount = (helpers.CONFIG.minimalBlocksBeforeLiquidation + 10) * helpers.CONFIG.minimalOperatorFee * 4;

    // Register operators
    await helpers.registerOperators(0, 14, helpers.CONFIG.minimalOperatorFee);

    // Register a validator
    // cold register
    await helpers.coldRegisterValidator();

    await registerAuth.setAuth(helpers.DB.owners[1].address, [false, true]);
    // first validator
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    const register = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1, 2, 3, 4],
      helpers.DataGenerator.shares(4),
      minDepositAmount,
      {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        active: true
      }
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    firstCluster = register.eventsByName.ValidatorAdded[0].args;
  });

  it('Remove validator emits "ValidatorRemoved"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).removeValidator(
      helpers.DataGenerator.publicKey(1),
      firstCluster.operatorIds,
      firstCluster.cluster
    )).to.emit(ssvNetworkContract, 'ValidatorRemoved');
  });

  it('Remove validator after cluster liquidation period emits "ValidatorRemoved"', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation + 10);

    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).removeValidator(
      helpers.DataGenerator.publicKey(1),
      firstCluster.operatorIds,
      firstCluster.cluster
    )).to.emit(ssvNetworkContract, 'ValidatorRemoved');
  });

  it('Remove validator gas limit', async () => {
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).removeValidator(
      helpers.DataGenerator.publicKey(1),
      firstCluster.operatorIds,
      firstCluster.cluster
    ), [GasGroup.REMOVE_VALIDATOR]);
  });

  it('Remove validator with a removed operator in the cluster', async () => {
    await trackGas(ssvNetworkContract.removeOperator(1), [GasGroup.REMOVE_OPERATOR_WITH_WITHDRAW]);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).removeValidator(
      helpers.DataGenerator.publicKey(1),
      firstCluster.operatorIds,
      firstCluster.cluster
    ), [GasGroup.REMOVE_VALIDATOR]);
  });

  it('Register a removed validator and remove the same validator again', async () => {
    // Remove validator
    const remove = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).removeValidator(
      helpers.DataGenerator.publicKey(1),
      firstCluster.operatorIds,
      firstCluster.cluster
    ), [GasGroup.REMOVE_VALIDATOR]);
    const updatedCluster = remove.eventsByName.ValidatorRemoved[0].args;

    // Re-register validator
    const newRegister = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      updatedCluster.operatorIds,
      helpers.DataGenerator.shares(4),
      0,
      updatedCluster.cluster
    ), [GasGroup.REGISTER_VALIDATOR_EXISTING_POD]);
    const afterRegisterCluster = newRegister.eventsByName.ValidatorAdded[0].args;

    // Remove the validator again
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).removeValidator(
      helpers.DataGenerator.publicKey(1),
      afterRegisterCluster.operatorIds,
      afterRegisterCluster.cluster
    ), [GasGroup.REMOVE_VALIDATOR]);
  });

  it('Remove validator from a liquidated cluster', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(ssvNetworkContract.liquidate(
      firstCluster.owner,
      firstCluster.operatorIds,
      firstCluster.cluster
    ), [GasGroup.LIQUIDATE_POD]);
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;

    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).removeValidator(
      helpers.DataGenerator.publicKey(1),
      updatedCluster.operatorIds,
      updatedCluster.cluster
    ), [GasGroup.REMOVE_VALIDATOR]);
  });

  it('Remove validator with an invalid owner reverts "ValidatorOwnedByOtherAddress"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[3]).removeValidator(
      helpers.DataGenerator.publicKey(1),
      firstCluster.operatorIds,
      firstCluster.cluster
    )).to.be.revertedWithCustomError(ssvNetworkContract, 'ValidatorOwnedByOtherAddress');
  });

  it('Remove the same validator twice reverts "ValidatorDoesNotExist"', async () => {
    // Remove validator
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).removeValidator(
      helpers.DataGenerator.publicKey(1),
      firstCluster.operatorIds,
      firstCluster.cluster
    ), [GasGroup.REMOVE_VALIDATOR]);

    // Remove validator again
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).removeValidator(
      helpers.DataGenerator.publicKey(1),
      firstCluster.operatorIds,
      firstCluster.cluster
    )).to.be.revertedWithCustomError(ssvNetworkContract, 'ValidatorDoesNotExist');
  });
});
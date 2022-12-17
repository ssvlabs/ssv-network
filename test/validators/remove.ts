import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';

import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, minDepositAmount: any, firstPod: any;

describe('Remove Validator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    minDepositAmount = (helpers.CONFIG.minimalBlocksBeforeLiquidation + 10) * helpers.CONFIG.minimalOperatorFee * 4;

    // Register operators
    await helpers.registerOperators(0, 14, helpers.CONFIG.minimalOperatorFee);

    // Register a validator
    // cold register
    await helpers.DB.ssvToken.connect(helpers.DB.owners[6]).approve(helpers.DB.ssvNetwork.contract.address, '1000000000000000');
    await ssvNetworkContract.connect(helpers.DB.owners[6]).registerValidator(
      '0x221111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111119',
      [1, 2, 3, 4],
      Array(4).fill(helpers.DataGenerator.publicKey(0)),
      Array(4).fill(helpers.DataGenerator.shares(0)),
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

    // first validator
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    const register = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1, 2, 3, 4],
      Array(4).fill(helpers.DataGenerator.publicKey(0)),
      Array(4).fill(helpers.DataGenerator.shares(0)),
      minDepositAmount,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    firstPod = register.eventsByName.ValidatorAdded[0].args;
  });

  it('Remove validator emits ValidatorRemoved event', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).removeValidator(
      helpers.DataGenerator.publicKey(1),
      firstPod.operatorIds,
      firstPod.pod
    )).to.emit(ssvNetworkContract, 'ValidatorRemoved');
  });

  it('Remove validator track gas', async () => {
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).removeValidator(
      helpers.DataGenerator.publicKey(1),
      firstPod.operatorIds,
      firstPod.pod
    ), [GasGroup.REMOVE_VALIDATOR]);
  });

  it('Remove validator with removed operator in a pod', async () => {
    await trackGas(ssvNetworkContract.removeOperator(1), [GasGroup.REMOVE_OPERATOR_WITH_WITHDRAW]);
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).removeValidator(
      helpers.DataGenerator.publicKey(1),
      firstPod.operatorIds,
      firstPod.pod
    ), [GasGroup.REMOVE_VALIDATOR]);
  });

  it('Remove validator with an invalid owner', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[3]).removeValidator(
      helpers.DataGenerator.publicKey(1),
      firstPod.operatorIds,
      firstPod.pod
    )).to.be.revertedWith('ValidatorNotOwned');
  });

  it('Remove validator twice', async () => {
    // Remove validator
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).removeValidator(
      helpers.DataGenerator.publicKey(1),
      firstPod.operatorIds,
      firstPod.pod
    ), [GasGroup.REMOVE_VALIDATOR]);

    // Remove validator again
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).removeValidator(
      helpers.DataGenerator.publicKey(1),
      firstPod.operatorIds,
      firstPod.pod
    )).to.be.revertedWith('ValidatorNotOwned');
  });

  it('Register / remove validator twice', async () => {
    // Remove validator
    const remove = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).removeValidator(
      helpers.DataGenerator.publicKey(1),
      firstPod.operatorIds,
      firstPod.pod
    ), [GasGroup.REMOVE_VALIDATOR]);
    const updatedPod = remove.eventsByName.ValidatorRemoved[0].args;

    // Re-register validator
    const newRegister = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      updatedPod.operatorIds,
      Array(4).fill(helpers.DataGenerator.publicKey(0)),
      Array(4).fill(helpers.DataGenerator.shares(0)),
      0,
      updatedPod.pod
    ), [GasGroup.REGISTER_VALIDATOR_EXISTING_POD]);
    const afterRegisterPod = newRegister.eventsByName.ValidatorAdded[0].args;

    // Remove the validator again
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).removeValidator(
      helpers.DataGenerator.publicKey(1),
      afterRegisterPod.operatorIds,
      afterRegisterPod.pod
    ), [GasGroup.REMOVE_VALIDATOR]);
  });

  it('Remove validator from a liquidated pod', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedPod = await trackGas(ssvNetworkContract.liquidatePod(
      firstPod.ownerAddress,
      firstPod.operatorIds,
      firstPod.pod
    ), [GasGroup.LIQUIDATE_POD]);
    const updatedPod = liquidatedPod.eventsByName.PodLiquidated[0].args;

    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).removeValidator(
      helpers.DataGenerator.publicKey(1),
      updatedPod.operatorIds,
      updatedPod.pod
    ), [GasGroup.REMOVE_VALIDATOR]);
  });
});

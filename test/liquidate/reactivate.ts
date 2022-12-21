// Declare imports
import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';
import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, minDepositAmount: any, firstPod: any;

describe('Reactivate Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    // Register operators
    await helpers.registerOperators(0, 12, helpers.CONFIG.minimalOperatorFee);

    minDepositAmount = (helpers.CONFIG.minimalBlocksBeforeLiquidation + 10) * helpers.CONFIG.minimalOperatorFee * 4;

    // Register validators
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

  it('Reactivate a disabled pod emits "PodEnabled"', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedPod = await trackGas(ssvNetworkContract.liquidatePod(firstPod.ownerAddress, firstPod.operatorIds, firstPod.pod), [GasGroup.LIQUIDATE_POD]);
    const updatedPod = liquidatedPod.eventsByName.PodLiquidated[0].args;
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);

    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).reactivatePod(updatedPod.operatorIds, minDepositAmount, updatedPod.pod)).to.emit(ssvNetworkContract, 'PodEnabled');
  });

  it('Reactivate with 0 deposit and no validators emits PodEnabled', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedPod = await trackGas(ssvNetworkContract.liquidatePod(firstPod.ownerAddress, firstPod.operatorIds, firstPod.pod), [GasGroup.LIQUIDATE_POD]);
    const updatedPod = liquidatedPod.eventsByName.PodLiquidated[0].args;

    const remove = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).removeValidator(
      helpers.DataGenerator.publicKey(1),
      firstPod.operatorIds,
      updatedPod.pod
    ), [GasGroup.REMOVE_VALIDATOR]);
    const updatedPodAfrerRemove = remove.eventsByName.ValidatorRemoved[0].args;

    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).reactivatePod(updatedPodAfrerRemove.operatorIds, 0, updatedPodAfrerRemove.pod)).to.emit(ssvNetworkContract, 'PodEnabled');
  });

  it('Reactivate an enabled pod reverts "PodAlreadyEnabled"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).reactivatePod(firstPod.operatorIds, minDepositAmount, firstPod.pod)).to.be.revertedWith('PodAlreadyEnabled');
  });

  it('Reactivate a pod when the amount is not enough reverts "NegativeBalance"', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedPod = await trackGas(ssvNetworkContract.liquidatePod(firstPod.ownerAddress, firstPod.operatorIds, firstPod.pod), [GasGroup.LIQUIDATE_POD]);
    const updatedPod = liquidatedPod.eventsByName.PodLiquidated[0].args;
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, helpers.CONFIG.minimalOperatorFee);

    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).reactivatePod(updatedPod.operatorIds, helpers.CONFIG.minimalOperatorFee, updatedPod.pod)).to.be.revertedWith('NotEnoughBalance');
  });

  it('Reactivate a pod with a removed operator in the cluster', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedPod = await trackGas(ssvNetworkContract.liquidatePod(firstPod.ownerAddress, firstPod.operatorIds, firstPod.pod), [GasGroup.LIQUIDATE_POD]);
    const updatedPod = liquidatedPod.eventsByName.PodLiquidated[0].args;
    await ssvNetworkContract.removeOperator(1);

    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).reactivatePod(updatedPod.operatorIds, minDepositAmount, updatedPod.pod), [GasGroup.REACTIVATE_POD]);
  });
});

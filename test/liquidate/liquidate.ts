import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';

import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, minDepositAmount: any, firstPod: any;

describe('Liquidate Validator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    // Register operators
    await helpers.registerOperators(0, 12, helpers.CONFIG.minimalOperatorFee);

    minDepositAmount = (helpers.CONFIG.minimalBlocksBeforeLiquidation + 10) * helpers.CONFIG.minimalOperatorFee * 4;

    // cold register
    await helpers.DB.ssvToken.connect(helpers.DB.owners[6]).approve(helpers.DB.ssvNetwork.contract.address, '1000000000000000');
    await ssvNetworkContract.connect(helpers.DB.owners[6]).registerValidator(
      '0x221111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111119',
      [1,2,3,4],
      helpers.DataGenerator.shares(0),
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
      [1,2,3,4],
      helpers.DataGenerator.shares(0),
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
    firstPod = register.eventsByName.PodMetadataUpdated[0].args;
  });

  it('Liquidatable', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    expect(await ssvNetworkContract.isLiquidatable(firstPod.ownerAddress, firstPod.operatorIds, firstPod.pod)).to.equal(true);
  });

  it('Liquidate emits PodLiquidated event', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);

    await expect(ssvNetworkContract.liquidatePod(
      firstPod.ownerAddress,
      firstPod.operatorIds,
      firstPod.pod
    )).to.emit(ssvNetworkContract, 'PodLiquidated');
  });

  it('Liquidate validator with removed operator in a pod', async () => {
    await ssvNetworkContract.removeOperator(1);
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation); // TMP IT FAILS WITH PROGRESS BLOCK, CRITICAL ERROR IN INDEX MATH LOGIC
    await trackGas(ssvNetworkContract.liquidatePod(
      firstPod.ownerAddress,
      firstPod.operatorIds,
      firstPod.pod
    ), [GasGroup.LIQUIDATE_POD]);
  });

  it('Liquidate and register validator in disabled pod', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedPod = await trackGas(ssvNetworkContract.liquidatePod(
      firstPod.ownerAddress,
      firstPod.operatorIds,
      firstPod.pod
    ), [GasGroup.LIQUIDATE_POD]);
    const updatedPod = liquidatedPod.eventsByName.PodMetadataUpdated[0].args;
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, `${minDepositAmount*2}`);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(2),
      updatedPod.operatorIds,
      helpers.DataGenerator.shares(0),
      `${minDepositAmount*2}`,
      updatedPod.pod
    ), [GasGroup.REGISTER_VALIDATOR_EXISTING_POD]);
  });

  it('Liquidate returns error - PodNotLiquidatable', async () => {
    await expect(ssvNetworkContract.liquidatePod(
      firstPod.ownerAddress,
      firstPod.operatorIds,
      firstPod.pod
    )).to.be.revertedWith('PodNotLiquidatable');
  });

  it('Is liquidated', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedPod = await trackGas(ssvNetworkContract.liquidatePod(
      firstPod.ownerAddress,
      firstPod.operatorIds,
      firstPod.pod
    ), [GasGroup.LIQUIDATE_POD]);
    const updatedPod = liquidatedPod.eventsByName.PodMetadataUpdated[0].args;

    expect(await ssvNetworkContract.isLiquidated(firstPod.ownerAddress, firstPod.operatorIds, updatedPod.pod)).to.equal(true);
  });

  it('Is liquidated returns error - PodNotExists', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedPod = await trackGas(ssvNetworkContract.liquidatePod(
      firstPod.ownerAddress,
      firstPod.operatorIds,
      firstPod.pod
    ), [GasGroup.LIQUIDATE_POD]);
    const updatedPod = liquidatedPod.eventsByName.PodMetadataUpdated[0].args;

    await expect(ssvNetworkContract.isLiquidated(helpers.DB.owners[0].address, firstPod.operatorIds, updatedPod.pod)).to.be.revertedWith('PodNotExists');
  });

});

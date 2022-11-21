import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';

import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, clusterResult1: any, minDepositAmount: any;

describe('Liquidate Validator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    // Register operators
    await helpers.registerOperators(0, 12, helpers.CONFIG.minimalOperatorFee);

    minDepositAmount = (helpers.CONFIG.minimalBlocksBeforeLiquidation + 10) * helpers.CONFIG.minimalOperatorFee * 4;

    // cold register
    await helpers.DB.ssvToken.connect(helpers.DB.owners[4]).approve(ssvNetworkContract.address, minDepositAmount);
    await ssvNetworkContract.connect(helpers.DB.owners[4]).registerValidator(
      helpers.DataGenerator.publicKey(9),
      [1,2,3,4],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      0,
      0,
      0,
      0,
      0,
      false
    );
  });

  it('Liquidatable', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    const register = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1,2,3,4],
      helpers.DataGenerator.shares(0),
      minDepositAmount,
      0,
      0,
      0,
      0,
      0,
      false
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    const registerArgs = register.eventsByName.PodMetadataUpdated[0].args;

    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);

    const liquidate = await trackGas(ssvNetworkContract.liquidate(
      registerArgs.ownerAddress,
      registerArgs.operatorIds,
      registerArgs.validatorCount,
      registerArgs.networkFee,
      registerArgs.networkFeeIndex,
      registerArgs.index,
      registerArgs.balance,
      registerArgs.disabled
    ), [GasGroup.LIQUIDATE_POD]);
    //await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    //expect(await ssvNetworkContract.isLiquidatable(helpers.DB.owners[4].address, clusterResult1.clusterId)).to.equal(true);
  });

  /*
  it('Liquidate emits PodLiquidated event', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    await expect(ssvNetworkContract.liquidate(helpers.DB.owners[4].address, clusterResult1.clusterId)).to.emit(ssvNetworkContract, 'PodLiquidated');
  });

  it('Liquidate validator with removed operator in a cluster', async () => {
    await ssvNetworkContract.removeOperator(1);
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation); // TMP IT FAILS WITH PROGRESS BLOCK, CRITICAL ERROR IN INDEX MATH LOGIC
    await trackGas(ssvNetworkContract.liquidate(helpers.DB.owners[4].address, clusterResult1.clusterId), [GasGroup.LIQUIDATE_POD]);
  });

  it('Liquidate and register in disabled pod', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    await trackGas(ssvNetworkContract.liquidate(helpers.DB.owners[4].address, clusterResult1.clusterId), [GasGroup.LIQUIDATE_POD]);
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    await helpers.DB.ssvToken.connect(helpers.DB.owners[4]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4])['deposit(bytes32,uint256)'](clusterResult1.clusterId, minDepositAmount), [GasGroup.DEPOSIT]);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).registerValidator(helpers.DataGenerator.publicKey(9), clusterResult1.clusterId, helpers.DataGenerator.shares(0)), [GasGroup.REGISTER_VALIDATOR_EXISTING_POD]);
  });

  it('Liquidate and register validator in disabled pod', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    await trackGas(ssvNetworkContract.liquidate(helpers.DB.owners[4].address, clusterResult1.clusterId), [GasGroup.LIQUIDATE_POD]);
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    await helpers.DB.ssvToken.connect(helpers.DB.owners[4]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4])['deposit(bytes32,uint256)'](clusterResult1.clusterId, minDepositAmount), [GasGroup.DEPOSIT]);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).registerValidator(helpers.DataGenerator.publicKey(9), clusterResult1.clusterId, helpers.DataGenerator.shares(0)), [GasGroup.REGISTER_VALIDATOR_EXISTING_POD]);
  });

  it('Liquidate errors', async () => {
    await expect(ssvNetworkContract.liquidate(helpers.DB.owners[4].address, clusterResult1.clusterId)).to.be.revertedWith('PodNotLiquidatable');
  });

  it('Is liquidated', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    await ssvNetworkContract.liquidate(helpers.DB.owners[4].address, clusterResult1.clusterId);
    expect(await ssvNetworkContract.isLiquidated(helpers.DB.owners[4].address, clusterResult1.clusterId)).to.equal(true);
  });

  it('Liquidate gas limits', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);

    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).liquidate(helpers.DB.owners[4].address, clusterResult1.clusterId), [GasGroup.LIQUIDATE_POD]);
  });
  */
});

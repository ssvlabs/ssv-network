import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';

import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, clusterResult1: any, minDepositAmount: any;

describe('Transfer Validator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    // Register operators
    await helpers.registerOperators(0, 12, helpers.CONFIG.minimalOperatorFee);

    minDepositAmount = (helpers.CONFIG.minimalBlocksBeforeLiquidation + 10) * helpers.CONFIG.minimalOperatorFee * 4;

    // Register validators
    clusterResult1 = await helpers.registerValidators(4, 1, minDepositAmount, helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
  });

  it('Liquidatable', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    expect(await ssvNetworkContract.isLiquidatable(helpers.DB.owners[4].address, clusterResult1.clusterId)).to.equal(true);
  });

  it('Liquidate emits PodLiquidated event', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    await expect(ssvNetworkContract.liquidate(helpers.DB.owners[4].address, clusterResult1.clusterId)).to.emit(ssvNetworkContract, 'PodLiquidated');
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

    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).liquidate(helpers.DB.owners[4].address, clusterResult1.clusterId), [GasGroup.LIQUIDATE_VALIDATOR]);
  });
});

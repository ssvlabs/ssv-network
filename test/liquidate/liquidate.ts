// Decalre imports
import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';
import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

// declare globals
let ssvNetworkContract: any, clusterResult1: any, minDepositAmount: any;

describe('Liquidate Validator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    // Register operators
    await helpers.registerOperators(0, 12, helpers.CONFIG.minimalOperatorFee);

    minDepositAmount = (helpers.CONFIG.minimalBlocksBeforeLiquidation + 10) * helpers.CONFIG.minimalOperatorFee * 4;

    // Register validators
    clusterResult1 = await helpers.registerValidators(4, 1, minDepositAmount, helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
  });

  it('Get liquidatable', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    expect(await ssvNetworkContract.isLiquidatable(helpers.DB.owners[4].address, clusterResult1.clusterId)).to.equal(true);
  });

  it('Liquidate emits "PodLiquidated"', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    await expect(ssvNetworkContract.liquidate(helpers.DB.owners[4].address, clusterResult1.clusterId
    )).to.emit(ssvNetworkContract, 'PodLiquidated');
  });

  it('Liquidate gas limits', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).liquidate(helpers.DB.owners[4].address, clusterResult1.clusterId), [GasGroup.LIQUIDATE_POD]);
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

  // Test to be removed - duplicate
  it('Liquidate and register validator in disabled pod', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    await trackGas(ssvNetworkContract.liquidate(helpers.DB.owners[4].address, clusterResult1.clusterId), [GasGroup.LIQUIDATE_POD]);
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    await helpers.DB.ssvToken.connect(helpers.DB.owners[4]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4])['deposit(bytes32,uint256)'](clusterResult1.clusterId, minDepositAmount), [GasGroup.DEPOSIT]);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).registerValidator(helpers.DataGenerator.publicKey(9), clusterResult1.clusterId, helpers.DataGenerator.shares(0)), [GasGroup.REGISTER_VALIDATOR_EXISTING_POD]);
  });

  it('Liquidate not a liquidatable pod reverts"PodNotLiquidatable"', async () => {
    await expect(ssvNetworkContract.liquidate(helpers.DB.owners[4].address, clusterResult1.clusterId
    )).to.be.revertedWith('PodNotLiquidatable');
  });

  it('Get is liquidated', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    await ssvNetworkContract.liquidate(helpers.DB.owners[4].address, clusterResult1.clusterId);
    expect(await ssvNetworkContract.isLiquidated(helpers.DB.owners[4].address, clusterResult1.clusterId)).to.equal(true);
  });
});

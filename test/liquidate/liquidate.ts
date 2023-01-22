// Decalre imports
import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';
import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, minDepositAmount: any, firstCluster: any;

describe('Liquidate Tests', () => {
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

    // first validator
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    const register = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1,2,3,4],
      helpers.DataGenerator.shares(4),
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
    firstCluster = register.eventsByName.ValidatorAdded[0].args;
  });

  it('Liquidate a cluster emits "ClusterLiquidated"', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);

    await expect(ssvNetworkContract.liquidate(
      firstCluster.owner,
      firstCluster.operatorIds,
      firstCluster.cluster
    )).to.emit(ssvNetworkContract, 'ClusterLiquidated');
  });

  it('Liquidatable with removed operator', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    await ssvNetworkContract.removeOperator(1);
    expect(await ssvNetworkContract.isLiquidatable(firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster)).to.equal(true);
  });

  it('Liquidate validator with removed operator in a cluster', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    await ssvNetworkContract.removeOperator(1);
    await trackGas(ssvNetworkContract.liquidate(
      firstCluster.owner,
      firstCluster.operatorIds,
      firstCluster.cluster
    ), [GasGroup.LIQUIDATE_POD]);
  });

  it('Liquidate and register validator in a disabled cluster', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(ssvNetworkContract.liquidate(
      firstCluster.owner,
      firstCluster.operatorIds,
      firstCluster.cluster
    ), [GasGroup.LIQUIDATE_POD]);
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, `${minDepositAmount*2}`);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(2),
      updatedCluster.operatorIds,
      helpers.DataGenerator.shares(4),
      `${minDepositAmount*2}`,
      updatedCluster.cluster
    ), [GasGroup.REGISTER_VALIDATOR_EXISTING_POD]);
  });
  
  it('Is liquidated', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(ssvNetworkContract.liquidate(
      firstCluster.owner,
      firstCluster.operatorIds,
      firstCluster.cluster
    ), [GasGroup.LIQUIDATE_POD]);
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;

    expect(await ssvNetworkContract.isLiquidated(firstCluster.owner, firstCluster.operatorIds, updatedCluster.cluster)).to.equal(true);
  });

  it('Get if the cluster is liquidatable', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    expect(await ssvNetworkContract.isLiquidatable(firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster)).to.equal(true);
  });

  it('Liquidate a cluster that is not liquidatable reverts "ClusterNotLiquidatable"', async () => {
    await expect(ssvNetworkContract.liquidate(
      firstCluster.owner,
      firstCluster.operatorIds,
      firstCluster.cluster
    )).to.be.revertedWithCustomError(ssvNetworkContract,'ClusterNotLiquidatable');
  });

  it('Liquidate a cluster that is not liquidatable reverts "IncorrectClusterState"', async () => {
    await expect(ssvNetworkContract.liquidate(
      firstCluster.owner,
      firstCluster.operatorIds,
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        disabled: false
      }
    )).to.be.revertedWithCustomError(ssvNetworkContract,'IncorrectClusterState');
  });

  it('Liquidate second time a cluster that is liquidated already reverts "ClusterIsLiquidated"', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(ssvNetworkContract.liquidate(
      firstCluster.owner,
      firstCluster.operatorIds,
      firstCluster.cluster
    ), [GasGroup.LIQUIDATE_POD]);
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;

    await expect(ssvNetworkContract.liquidate(
      firstCluster.owner,
      updatedCluster.operatorIds,
      updatedCluster.cluster
    )).to.be.revertedWithCustomError(ssvNetworkContract,'ClusterIsLiquidated');
  });

  it('Is liquidated reverts "ClusterDoesNotExists"', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(ssvNetworkContract.liquidate(
      firstCluster.owner,
      firstCluster.operatorIds,
      firstCluster.cluster
    ), [GasGroup.LIQUIDATE_POD]);
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;

    await expect(ssvNetworkContract.isLiquidated(helpers.DB.owners[0].address, firstCluster.operatorIds, updatedCluster.cluster)).to.be.revertedWithCustomError(ssvNetworkContract,'ClusterDoesNotExists');
  });
});
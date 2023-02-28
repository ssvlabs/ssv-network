// Declare imports
import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';
import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, minDepositAmount: any, firstCluster: any;

// Declare globals
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
      [1,2,3,4],
      helpers.DataGenerator.shares(4),
      '1000000000000000',
      {
        validatorCount: 0,
        networkFee: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        active: true
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
        active: true
      }
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    firstCluster = register.eventsByName.ValidatorAdded[0].args;
  });

  it('Reactivate a disabled cluster emits "ClusterReactivated"', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(ssvNetworkContract.liquidate(firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster), [GasGroup.LIQUIDATE_POD]);
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);

    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).reactivate(updatedCluster.operatorIds, minDepositAmount, updatedCluster.cluster)).to.emit(ssvNetworkContract, 'ClusterReactivated');
  });

  it('Reactivate with 0 deposit and no validators emits ClusterReactivated', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(ssvNetworkContract.liquidate(firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster), [GasGroup.LIQUIDATE_POD]);
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;

    const remove = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).removeValidator(
      helpers.DataGenerator.publicKey(1),
      firstCluster.operatorIds,
      updatedCluster.cluster
    ), [GasGroup.REMOVE_VALIDATOR]);
    const updatedClusterAfrerRemove = remove.eventsByName.ValidatorRemoved[0].args;

    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).reactivate(updatedClusterAfrerRemove.operatorIds, 0, updatedClusterAfrerRemove.cluster)).to.emit(ssvNetworkContract, 'ClusterReactivated');
  });

  it('Reactivate a cluster with a removed operator in the cluster', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(ssvNetworkContract.liquidate(firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster), [GasGroup.LIQUIDATE_POD]);
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;
    await ssvNetworkContract.removeOperator(1);

    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).reactivate(updatedCluster.operatorIds, minDepositAmount, updatedCluster.cluster), [GasGroup.REACTIVATE_POD]);
  });

  it('Reactivate an enabled cluster reverts "ClusterAlreadyEnabled"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).reactivate(firstCluster.operatorIds, minDepositAmount, firstCluster.cluster)).to.be.revertedWithCustomError(ssvNetworkContract,'ClusterAlreadyEnabled');
  });

  it('Reactivate a cluster when the amount is not enough reverts "InsufficientFunds"', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(ssvNetworkContract.liquidate(firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster), [GasGroup.LIQUIDATE_POD]);
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, helpers.CONFIG.minimalOperatorFee);

    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).reactivate(updatedCluster.operatorIds, helpers.CONFIG.minimalOperatorFee, updatedCluster.cluster)).to.be.revertedWithCustomError(ssvNetworkContract,'InsufficientBalance');
  });
});
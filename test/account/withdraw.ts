// Declare imports
import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';
import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

// Declare globals
let ssvNetworkContract: any, cluster1: any, minDepositAmount: any;

describe('Withdraw Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    // Register operators
    await helpers.registerOperators(0, 12, helpers.CONFIG.minimalOperatorFee);

    minDepositAmount = (helpers.CONFIG.minimalBlocksBeforeLiquidation + 10) * helpers.CONFIG.minimalOperatorFee * 4;

    // Register validators
    // cold register
    await helpers.coldRegisterValidator();

    cluster1 = await helpers.registerValidators(4, 1, minDepositAmount, helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
  });

  it('Withdraw from cluster emits "ClusterWithdrawn"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).withdraw(cluster1.args.operatorIds, helpers.CONFIG.minimalOperatorFee, cluster1.args.cluster)).to.emit(ssvNetworkContract, 'ClusterWithdrawn');
  });

  it('Withdraw from cluster gas limits', async () => {
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).withdraw(cluster1.args.operatorIds, helpers.CONFIG.minimalOperatorFee, cluster1.args.cluster), [GasGroup.WITHDRAW_POD_BALANCE]);
  });

  it('Withdraw from operator balance emits "OperatorWithdrawn"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[0])['withdrawOperatorEarnings(uint64,uint256)'](1, helpers.CONFIG.minimalOperatorFee)).to.emit(ssvNetworkContract, 'OperatorWithdrawn');
  });

  it('Withdraw from operator balance gas limits', async () => {
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[0])['withdrawOperatorEarnings(uint64,uint256)'](1, helpers.CONFIG.minimalOperatorFee), [GasGroup.WITHDRAW_OPERATOR_BALANCE]);
  });

  it('Withdraw the total operator balance emits "OperatorWithdrawn"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[0])['withdrawOperatorEarnings(uint64)'](1)).to.emit(ssvNetworkContract, 'OperatorWithdrawn');
  });

  it('Withdraw the total operator balance gas limits', async () => {
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[0])['withdrawOperatorEarnings(uint64)'](1), [GasGroup.WITHDRAW_OPERATOR_BALANCE]);
  });

  it('Withdraw from a cluster that has a removed operator emits "ClusterWithdrawn"', async () => {
    await ssvNetworkContract.removeOperator(1);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).withdraw(cluster1.args.operatorIds, helpers.CONFIG.minimalOperatorFee, cluster1.args.cluster)).to.emit(ssvNetworkContract, 'ClusterWithdrawn');
  });

  it('Withdraw more than the cluster balance reverts "InsufficientBalance"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).withdraw(cluster1.args.operatorIds, minDepositAmount, cluster1.args.cluster)).to.be.revertedWithCustomError(ssvNetworkContract, 'InsufficientBalance');
  });

  it('Withdraw from a liquidatable cluster reverts "InsufficientBalance" (liquidation threshold)', async () => {
    await utils.progressBlocks(20);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).withdraw(cluster1.args.operatorIds, 4000000000, cluster1.args.cluster)).to.be.revertedWithCustomError(ssvNetworkContract, 'InsufficientBalance');
  });

  it('Withdraw from a liquidatable cluster reverts "InsufficientBalance" (liquidation collateral)', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation - 10);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).withdraw(cluster1.args.operatorIds, 7500000000, cluster1.args.cluster)).to.be.revertedWithCustomError(ssvNetworkContract, 'InsufficientBalance');
  });

  it('Withdraw from a liquidatable cluster after liquidation period reverts "InsufficientBalance"', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation + 10);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).withdraw(cluster1.args.operatorIds, helpers.CONFIG.minimalOperatorFee, cluster1.args.cluster)).to.be.revertedWithCustomError(ssvNetworkContract, 'InsufficientBalance');
  });

  it('Withdraw balance from an operator I do not own reverts "CallerNotOwner"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[2])['withdrawOperatorEarnings(uint64,uint256)'](1, minDepositAmount)).to.be.revertedWithCustomError(ssvNetworkContract, 'CallerNotOwner');
  });

  it('Withdraw more than the operator balance reverts "InsufficientBalance"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[0])['withdrawOperatorEarnings(uint64,uint256)'](1, minDepositAmount
    )).to.be.revertedWithCustomError(ssvNetworkContract, 'InsufficientBalance');
  });

  it('Withdraw the total balance from an operator I do not own reverts "CallerNotOwner"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[2])['withdrawOperatorEarnings(uint64)'](12)).to.be.revertedWithCustomError(ssvNetworkContract, 'CallerNotOwner');
  });

  it('Withdraw more than the operator total balance reverts "InsufficientBalance"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[0])['withdrawOperatorEarnings(uint64)'](12)).to.be.revertedWithCustomError(ssvNetworkContract, 'InsufficientBalance');
  });
});
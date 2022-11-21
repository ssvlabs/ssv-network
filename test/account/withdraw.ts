//Declare imports
import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';
import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

//Declare globals
let ssvNetworkContract: any, clusterResult1: any, minDepositAmount: any;

describe('Withdraw Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    // Register operators
    await helpers.registerOperators(0, 12, helpers.CONFIG.minimalOperatorFee);

    minDepositAmount = (helpers.CONFIG.minimalBlocksBeforeLiquidation + 10) * helpers.CONFIG.minimalOperatorFee * 4;

    // Register validators
    clusterResult1 = await helpers.registerValidators(4, 1, minDepositAmount, helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
  });

  it('Withdraw owner pod balance emits "PodFundsWithdrawal"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).withdrawPodBalance(clusterResult1.clusterId, helpers.CONFIG.minimalOperatorFee
    )).to.emit(ssvNetworkContract, 'PodFundsWithdrawal');
  });

  it('Withdraw owner pod balance gas limits', async () => {
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).withdrawPodBalance(clusterResult1.clusterId, helpers.CONFIG.minimalOperatorFee), [GasGroup.WITHDRAW]);
  });

  it('Withdraw owner pod balance reverts "NotEnoughBalance"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).withdrawPodBalance(clusterResult1.clusterId, minDepositAmount
    )).to.be.revertedWith('NotEnoughBalance');
  });

  it('Withdraw owner liquidatable pod balance reverts "NotEnoughBalance"', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).withdrawPodBalance(clusterResult1.clusterId, helpers.CONFIG.minimalOperatorFee
    )).to.be.revertedWith('NotEnoughBalance');
  });


  it('Withdraw operator balance emits "OperatorFundsWithdrawal"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[0])['withdrawOperatorBalance(uint64,uint256)'](1, helpers.CONFIG.minimalOperatorFee
    )).to.emit(ssvNetworkContract, 'OperatorFundsWithdrawal');
  });

  it('Withdraw operator balance gas limits', async () => {
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[0])['withdrawOperatorBalance(uint64,uint256)'](1, helpers.CONFIG.minimalOperatorFee), [GasGroup.WITHDRAW]);
  });

  it('Withdraw operator balance reverts "CallerNotOwner"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[2])['withdrawOperatorBalance(uint64,uint256)'](1, minDepositAmount
    )).to.be.revertedWith('CallerNotOwner');
  });

  it('Withdraw operator balance reverts "NotEnoughBalance"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[0])['withdrawOperatorBalance(uint64,uint256)'](1, minDepositAmount
    )).to.be.revertedWith('NotEnoughBalance');
  });

  //withdraw total operator balance
  it('Withdraw total operator balance emits "OperatorFundsWithdrawal"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[0])['withdrawOperatorBalance(uint64)'](1
    )).to.emit(ssvNetworkContract, 'OperatorFundsWithdrawal');
  });

  it('Withdraw total operator balance gas limits', async () => {
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[0])['withdrawOperatorBalance(uint64)'](1), [GasGroup.WITHDRAW]);
  });

  //Test to removed - Duplicate 
  it('Withdraw total operator balance gas limits', async () => {
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[0])['withdrawOperatorBalance(uint64)'](1), [GasGroup.WITHDRAW]);
  });

  it('Withdraw total operator balance reverts "CallerNotOwner"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[2])['withdrawOperatorBalance(uint64)'](12
    )).to.be.revertedWith('CallerNotOwner');
  });

  it('Withdraw total operator balance reverts "NotEnoughBalance"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[0])['withdrawOperatorBalance(uint64)'](12
    )).to.be.revertedWith('NotEnoughBalance');
  });
});

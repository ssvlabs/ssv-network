import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';

import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, pod1: any, minDepositAmount: any;

describe('Withdraw Tests', () => {
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

    pod1 = await helpers.registerValidators(4, 1, minDepositAmount, helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
  });

  it('Withdraw pod balance emits PodFundsWithdrawal event', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).withdrawPodBalance(pod1.args.operatorIds, helpers.CONFIG.minimalOperatorFee, pod1.args.pod)).to.emit(ssvNetworkContract, 'PodFundsWithdrawal');
  });

  it('Withdraw pod balance returns an error - NotEnoughBalance', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).withdrawPodBalance(pod1.args.operatorIds, minDepositAmount, pod1.args.pod)).to.be.revertedWith('NotEnoughBalance');
  });

  it('Withdraw balance of liquidatable pod returns an error - NotEnoughBalance', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4]).withdrawPodBalance(pod1.args.operatorIds, helpers.CONFIG.minimalOperatorFee, pod1.args.pod)).to.be.revertedWith('NotEnoughBalance');
  });

  it('Withdraw pod balance gas limits', async () => {
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).withdrawPodBalance(pod1.args.operatorIds, helpers.CONFIG.minimalOperatorFee, pod1.args.pod), [GasGroup.WITHDRAW_POD_BALANCE]);
  });

  it('Withdraw total operator balance emits OperatorFundsWithdrawal event', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[0])['withdrawOperatorBalance(uint64)'](1)).to.emit(ssvNetworkContract, 'OperatorFundsWithdrawal');
  });

  it('Withdraw operator balance emits OperatorFundsWithdrawal event', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[0])['withdrawOperatorBalance(uint64,uint256)'](1, helpers.CONFIG.minimalOperatorFee)).to.emit(ssvNetworkContract, 'OperatorFundsWithdrawal');
  });

  it('Withdraw operator balance returns an error - CallerNotOwner', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[2])['withdrawOperatorBalance(uint64,uint256)'](1, minDepositAmount)).to.be.revertedWith('CallerNotOwner');
  });

  it('Withdraw operator balance returns an error - NotEnoughBalance', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[0])['withdrawOperatorBalance(uint64,uint256)'](1, minDepositAmount)).to.be.revertedWith('NotEnoughBalance');
  });

  it('Withdraw total operator balance returns an error - CallerNotOwner', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[2])['withdrawOperatorBalance(uint64)'](12)).to.be.revertedWith('CallerNotOwner');
  });

  it('Withdraw total operator balance returns an error - NotEnoughBalance', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[0])['withdrawOperatorBalance(uint64)'](12)).to.be.revertedWith('NotEnoughBalance');
  });

  it('Withdraw operator balance gas limits', async () => {
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[0])['withdrawOperatorBalance(uint64,uint256)'](1, helpers.CONFIG.minimalOperatorFee), [GasGroup.WITHDRAW_OPERATOR_BALANCE]);
  });

  it('Withdraw total operator balance gas limits', async () => {
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[0])['withdrawOperatorBalance(uint64)'](1), [GasGroup.WITHDRAW_OPERATOR_BALANCE]);
  });
});

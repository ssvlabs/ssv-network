// Declare imports
import * as helpers from '../helpers/contract-helpers';
import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

// Declare globals
let ssvNetworkContract: any, pod1: any, minDepositAmount: any;

describe('Deposit Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;
    // Register operators
    await helpers.registerOperators(0, 12, helpers.CONFIG.minimalOperatorFee);

    // Define the operator fee
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

    // Register validators
    pod1 = await helpers.registerValidators(4, 1, minDepositAmount, helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
  });

  it('Deposit to a pod I own emits "PodDeposited', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[4]).approve(ssvNetworkContract.address, minDepositAmount);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4])['deposit(uint64[],uint256,(uint32,uint64,uint64,uint64,uint64,bool))'](pod1.args.operatorIds, minDepositAmount, pod1.args.pod)).to.emit(ssvNetworkContract, 'PodDeposited');
  });

  it('Deposit to a pod I own gas limits', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[4]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4])['deposit(uint64[],uint256,(uint32,uint64,uint64,uint64,uint64,bool))'](pod1.args.operatorIds, minDepositAmount, pod1.args.pod), [GasGroup.DEPOSIT]);
  });

  it('Deposit to a pod I do not own emits "PodDeposited"', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[0]).approve(ssvNetworkContract.address, minDepositAmount);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[0])['deposit(address,uint64[],uint256,(uint32,uint64,uint64,uint64,uint64,bool))'](helpers.DB.owners[4].address, pod1.args.operatorIds, minDepositAmount, pod1.args.pod)).to.emit(ssvNetworkContract, 'PodDeposited');
  });

  it('Deposit to a pod I do not own gas limits', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[0]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[0])['deposit(address,uint64[],uint256,(uint32,uint64,uint64,uint64,uint64,bool))'](helpers.DB.owners[4].address, pod1.args.operatorIds, minDepositAmount, pod1.args.pod), [GasGroup.DEPOSIT]);
  });

  it('Deposit to a pod I do own with a pod that does not exist reverts "PodNotExists"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1])['deposit(uint64[],uint256,(uint32,uint64,uint64,uint64,uint64,bool))'](pod1.args.operatorIds, minDepositAmount, pod1.args.pod)).to.be.revertedWith('PodNotExists');
  });

  it('Deposit to a pod I do not own with a pod that does not exist reverts "PodNotExists"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[4])['deposit(uint64[],uint256,(uint32,uint64,uint64,uint64,uint64,bool))']([1,2,4,5], minDepositAmount, pod1.args.pod)).to.be.revertedWith('PodNotExists');
  });
});

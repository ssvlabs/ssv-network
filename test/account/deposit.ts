import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, clusterResult1: any, minDepositAmount: any;

describe('Deposit Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    // Register operators
    await helpers.registerOperators(0, 12, helpers.CONFIG.minimalOperatorFee);

    minDepositAmount = (helpers.CONFIG.minimalBlocksBeforeLiquidation + 10) * helpers.CONFIG.minimalOperatorFee * 4;

    // Register validators
    clusterResult1 = await helpers.registerValidators(4, 1, minDepositAmount, helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
  });

  it('Deposit emits FundsDeposit event', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1])['deposit(bytes32,uint256)'](clusterResult1.clusterId, minDepositAmount)).to.emit(ssvNetworkContract, 'FundsDeposit');
  });

  it('Deposit returns error - ClusterNotExists', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1])['deposit(bytes32,uint256)']('0x392791df626408017a264f53fde61065d5a93a32b60171df9d8a46afdf82992c', minDepositAmount)).to.be.revertedWith('ClusterNotExists');
  });

  it('Deposit gas limits', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1])['deposit(bytes32,uint256)'](clusterResult1.clusterId, minDepositAmount), [GasGroup.DEPOSIT]);
  });
});

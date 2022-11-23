// Declare imports
import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';
import { expect } from 'chai';
import { GasGroup } from '../helpers/gas-usage';

// Declare globals
let ssvNetworkContract: any, minDepositAmount: any, burnPerBlock: any, networkFee: any;

describe('DAO Network Fee Withdraw Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    // Define minumum allowed network fee to pass shrinkable validation
    networkFee = helpers.CONFIG.minimalOperatorFee;

    // Register operators
    await helpers.registerOperators(0, 12, helpers.CONFIG.minimalOperatorFee);

    burnPerBlock = helpers.CONFIG.minimalOperatorFee * 4 + networkFee;
    minDepositAmount = helpers.CONFIG.minimalBlocksBeforeLiquidation * burnPerBlock;

    // Deposit into accounts
    // await helpers.deposit([4], [minDepositAmount]);

    // Set network fee
    await ssvNetworkContract.updateNetworkFee(networkFee);

    // Register validators
    await helpers.registerValidators(4, 1, minDepositAmount, helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    await utils.progressBlocks(10);

    // Temporary till deposit logic not available
    // Mint tokens
    await helpers.DB.ssvToken.mint(ssvNetworkContract.address, minDepositAmount);
  });

  it('Get withdrawable network earnings', async () => {
    expect(await ssvNetworkContract.getNetworkBalance()).to.above(0);
  });

    // test to be removed - everyone can see network earnings
  it('Get withdrawable network earnings reverts "caller is not the owner"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[3]).getNetworkBalance(
    )).to.be.revertedWith('caller is not the owner');
  });

  it('Withdraw network earnings emits "NetworkFeesWithdrawal"', async () => {
    const amount = await ssvNetworkContract.getNetworkBalance();
    await expect(ssvNetworkContract.withdrawDAOEarnings(amount
    )).to.emit(ssvNetworkContract, 'NetworkFeesWithdrawal').withArgs(amount, helpers.DB.owners[0].address);
  });

  it('Withdraw network earnings with not enough balance reverts "NotEnoughBalance"', async () => {
    const amount = await ssvNetworkContract.getNetworkBalance() * 2;
    await expect(ssvNetworkContract.withdrawDAOEarnings(amount
    )).to.be.revertedWith('NotEnoughBalance');
  });

  it('Not a Dao withdraw network earnings reverts "caller is not the owner"', async () => {
    const amount = await ssvNetworkContract.getNetworkBalance();
    await expect(ssvNetworkContract.connect(helpers.DB.owners[3]).withdrawDAOEarnings(amount
    )).to.be.revertedWith('caller is not the owner');
  });
});

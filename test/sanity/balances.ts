// Declare imports
import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';
import { expect } from 'chai';
import { GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, ssvViews: any, cluster1: any, minDepositAmount: any, burnPerBlock: any, networkFee: any, initNetworkFeeBalance: any;

// Declare globals
describe('Balance Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = (await helpers.initializeContract());
    ssvNetworkContract = metadata.contract;
    ssvViews = metadata.ssvViews;

    // Register operators
    await helpers.registerOperators(0, 12, helpers.CONFIG.minimalOperatorFee);

    networkFee = helpers.CONFIG.minimalOperatorFee;
    burnPerBlock = helpers.CONFIG.minimalOperatorFee * 4 + networkFee;
    minDepositAmount = helpers.CONFIG.minimalBlocksBeforeLiquidation * burnPerBlock;

    // Deposit into accounts
    // await helpers.deposit([4], [minDepositAmount]);

    // Set network fee
    await ssvNetworkContract.updateNetworkFee(networkFee);

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
        disabled: false
      }
    );

    cluster1 = await helpers.registerValidators(4, 1, minDepositAmount, helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    initNetworkFeeBalance = await ssvViews.getNetworkEarnings();
  });

  it('Check cluster balance in three blocks, one after the other', async () => {
    await utils.progressBlocks(1);
    expect(await ssvViews.getBalance(helpers.DB.owners[4].address, cluster1.args.operatorIds, cluster1.args.cluster)).to.equal(minDepositAmount - burnPerBlock);
    await utils.progressBlocks(1);
    expect(await ssvViews.getBalance(helpers.DB.owners[4].address, cluster1.args.operatorIds, cluster1.args.cluster)).to.equal(minDepositAmount - burnPerBlock * 2);
    await utils.progressBlocks(1);
    expect(await ssvViews.getBalance(helpers.DB.owners[4].address, cluster1.args.operatorIds, cluster1.args.cluster)).to.equal(minDepositAmount - burnPerBlock * 3);
  });

  it('Check cluster balance in two and twelve blocks, after network fee updates', async () => {
    await utils.progressBlocks(1);
    expect(await ssvViews.getBalance(helpers.DB.owners[4].address, cluster1.args.operatorIds, cluster1.args.cluster)).to.equal(minDepositAmount - burnPerBlock);
    const newBurnPerBlock = burnPerBlock + networkFee;
    await ssvNetworkContract.updateNetworkFee(networkFee * 2);
    await utils.progressBlocks(1);
    expect(await ssvViews.getBalance(helpers.DB.owners[4].address, cluster1.args.operatorIds, cluster1.args.cluster)).to.equal(minDepositAmount - burnPerBlock * 2 - newBurnPerBlock);
    await utils.progressBlocks(1);
    expect(await ssvViews.getBalance(helpers.DB.owners[4].address, cluster1.args.operatorIds, cluster1.args.cluster)).to.equal(minDepositAmount - burnPerBlock * 2 - newBurnPerBlock * 2);
    await utils.progressBlocks(10);
    expect(await ssvViews.getBalance(helpers.DB.owners[4].address, cluster1.args.operatorIds, cluster1.args.cluster)).to.equal(minDepositAmount - burnPerBlock * 2 - newBurnPerBlock * 12);
  });

  it('Check DAO earnings in three blocks, one after the other', async () => {
    await utils.progressBlocks(1);
    expect(await ssvViews.getNetworkEarnings() - initNetworkFeeBalance).to.equal(networkFee * 2);
    await utils.progressBlocks(1);
    expect(await ssvViews.getNetworkEarnings() - initNetworkFeeBalance).to.equal(networkFee * 4);
    await utils.progressBlocks(1);
    expect(await ssvViews.getNetworkEarnings() - initNetworkFeeBalance).to.equal(networkFee * 6);
  });

  it('Check DAO earnings in two and twelve blocks, after network fee updates', async () => {
    await utils.progressBlocks(1);
    expect(await ssvViews.getNetworkEarnings() - initNetworkFeeBalance).to.equal(networkFee * 2);
    const newNetworkFee = networkFee * 2;
    await ssvNetworkContract.updateNetworkFee(newNetworkFee);
    await utils.progressBlocks(1);
    expect(await ssvViews.getNetworkEarnings() - initNetworkFeeBalance).to.equal(networkFee * 4 + newNetworkFee * 2);
    await utils.progressBlocks(1);
    expect(await ssvViews.getNetworkEarnings() - initNetworkFeeBalance).to.equal(networkFee * 4 + newNetworkFee * 4);
    await utils.progressBlocks(10);
    expect(await ssvViews.getNetworkEarnings() - initNetworkFeeBalance).to.equal(networkFee * 4 + newNetworkFee * 24);
  });

  it('Check operators earnings in three blocks, one after the other', async () => {
    await utils.progressBlocks(1);
    expect(await ssvViews.getOperatorEarnings(1)).to.equal(helpers.CONFIG.minimalOperatorFee * 2 + helpers.CONFIG.minimalOperatorFee * 2);
    expect(await ssvViews.getOperatorEarnings(2)).to.equal(helpers.CONFIG.minimalOperatorFee * 2 + helpers.CONFIG.minimalOperatorFee * 2);
    expect(await ssvViews.getOperatorEarnings(3)).to.equal(helpers.CONFIG.minimalOperatorFee * 2 + helpers.CONFIG.minimalOperatorFee * 2);
    expect(await ssvViews.getOperatorEarnings(4)).to.equal(helpers.CONFIG.minimalOperatorFee * 2 + helpers.CONFIG.minimalOperatorFee * 2);
    await utils.progressBlocks(1);
    expect(await ssvViews.getOperatorEarnings(1)).to.equal(helpers.CONFIG.minimalOperatorFee * 4 + helpers.CONFIG.minimalOperatorFee * 2);
    expect(await ssvViews.getOperatorEarnings(2)).to.equal(helpers.CONFIG.minimalOperatorFee * 4 + helpers.CONFIG.minimalOperatorFee * 2);
    expect(await ssvViews.getOperatorEarnings(3)).to.equal(helpers.CONFIG.minimalOperatorFee * 4 + helpers.CONFIG.minimalOperatorFee * 2);
    expect(await ssvViews.getOperatorEarnings(4)).to.equal(helpers.CONFIG.minimalOperatorFee * 4 + helpers.CONFIG.minimalOperatorFee * 2);
    await utils.progressBlocks(1);
    expect(await ssvViews.getOperatorEarnings(1)).to.equal(helpers.CONFIG.minimalOperatorFee * 6 + helpers.CONFIG.minimalOperatorFee * 2);
    expect(await ssvViews.getOperatorEarnings(2)).to.equal(helpers.CONFIG.minimalOperatorFee * 6 + helpers.CONFIG.minimalOperatorFee * 2);
    expect(await ssvViews.getOperatorEarnings(3)).to.equal(helpers.CONFIG.minimalOperatorFee * 6 + helpers.CONFIG.minimalOperatorFee * 2);
    expect(await ssvViews.getOperatorEarnings(4)).to.equal(helpers.CONFIG.minimalOperatorFee * 6 + helpers.CONFIG.minimalOperatorFee * 2);
  });

  it('Check cluster balance with removed operator', async () => {
    await ssvNetworkContract.removeOperator(1);
    expect(await ssvViews.getBalance(helpers.DB.owners[4].address, cluster1.args.operatorIds, cluster1.args.cluster)).not.equals(0);
  });

  it('Check cluster balance with not enough balance reverts "InsufficientFunds"', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation + 10);
    await expect(ssvViews.getBalance(helpers.DB.owners[4].address, cluster1.args.operatorIds, cluster1.args.cluster)).to.be.revertedWithCustomError(ssvNetworkContract,'InsufficientFunds');
  });
});
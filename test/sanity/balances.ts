// Declare imports
import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';
import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

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

    // Set network fee
    await ssvNetworkContract.updateNetworkFee(networkFee);

    // Register validators
    // cold register
    await helpers.coldRegisterValidator();

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

    expect(await ssvViews.getOperatorEarnings(1)).to.equal(helpers.CONFIG.minimalOperatorFee * 2 + helpers.CONFIG.minimalOperatorFee * 3);
    expect(await ssvViews.getOperatorEarnings(2)).to.equal(helpers.CONFIG.minimalOperatorFee * 2 + helpers.CONFIG.minimalOperatorFee * 3);
    expect(await ssvViews.getOperatorEarnings(3)).to.equal(helpers.CONFIG.minimalOperatorFee * 2 + helpers.CONFIG.minimalOperatorFee * 3);
    expect(await ssvViews.getOperatorEarnings(4)).to.equal(helpers.CONFIG.minimalOperatorFee * 2 + helpers.CONFIG.minimalOperatorFee * 3);
    await utils.progressBlocks(1);
    expect(await ssvViews.getOperatorEarnings(1)).to.equal(helpers.CONFIG.minimalOperatorFee * 4 + helpers.CONFIG.minimalOperatorFee * 3);
    expect(await ssvViews.getOperatorEarnings(2)).to.equal(helpers.CONFIG.minimalOperatorFee * 4 + helpers.CONFIG.minimalOperatorFee * 3);
    expect(await ssvViews.getOperatorEarnings(3)).to.equal(helpers.CONFIG.minimalOperatorFee * 4 + helpers.CONFIG.minimalOperatorFee * 3);
    expect(await ssvViews.getOperatorEarnings(4)).to.equal(helpers.CONFIG.minimalOperatorFee * 4 + helpers.CONFIG.minimalOperatorFee * 3);
    await utils.progressBlocks(1);
    expect(await ssvViews.getOperatorEarnings(1)).to.equal(helpers.CONFIG.minimalOperatorFee * 6 + helpers.CONFIG.minimalOperatorFee * 3);
    expect(await ssvViews.getOperatorEarnings(2)).to.equal(helpers.CONFIG.minimalOperatorFee * 6 + helpers.CONFIG.minimalOperatorFee * 3);
    expect(await ssvViews.getOperatorEarnings(3)).to.equal(helpers.CONFIG.minimalOperatorFee * 6 + helpers.CONFIG.minimalOperatorFee * 3);
    expect(await ssvViews.getOperatorEarnings(4)).to.equal(helpers.CONFIG.minimalOperatorFee * 6 + helpers.CONFIG.minimalOperatorFee * 3);
  });

  it('Check cluster balance with removed operator', async () => {
    await ssvNetworkContract.removeOperator(1);
    expect(await ssvViews.getBalance(helpers.DB.owners[4].address, cluster1.args.operatorIds, cluster1.args.cluster)).not.equals(0);
  });

  it('Check cluster balance with not enough balance', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation + 10);
    expect(await ssvViews.getBalance(helpers.DB.owners[4].address, cluster1.args.operatorIds, cluster1.args.cluster)).to.be.equals(0);
  });

  it('Check cluster balance in a non liquidated cluster', async () => {
    await utils.progressBlocks(1);
    expect(await ssvViews.getBalance(helpers.DB.owners[4].address, cluster1.args.operatorIds, cluster1.args.cluster)).to.equal(minDepositAmount - burnPerBlock);
  });

  it('Check cluster balance in a liquidated cluster reverts "ClusterIsLiquidated"', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation - 1);
    const liquidatedCluster = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[6]).liquidate(
      cluster1.args.owner,
      cluster1.args.operatorIds,
      cluster1.args.cluster
    ));
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;

    expect(await ssvViews.isLiquidated(updatedCluster.owner, updatedCluster.operatorIds, updatedCluster.cluster)).to.equal(true);
    await expect(ssvViews.getBalance(helpers.DB.owners[4].address, updatedCluster.operatorIds, updatedCluster.cluster)).to.be.revertedWithCustomError(ssvViews, 'ClusterIsLiquidated');
  });

  it('Check operator earnings, cluster balances and network earnings"', async () => {
    // 2 exisiting clusters
    // update network fee
    // register a new validator with some shared operators
    // update network fee
    // progress blocks in the process
    await utils.progressBlocks(1);

    expect(await ssvViews.getOperatorEarnings(1)).to.equal(helpers.CONFIG.minimalOperatorFee * 4 + helpers.CONFIG.minimalOperatorFee);
    expect(await ssvViews.getBalance(helpers.DB.owners[4].address, cluster1.args.operatorIds, cluster1.args.cluster)).to.equal(minDepositAmount - burnPerBlock);
    expect(await ssvViews.getNetworkEarnings() - initNetworkFeeBalance).to.equal(networkFee * 2);

    const newNetworkFee = networkFee * 2;
    await ssvNetworkContract.updateNetworkFee(newNetworkFee);

    const newBurnPerBlock = helpers.CONFIG.minimalOperatorFee * 4 + newNetworkFee;
    await utils.progressBlocks(1);

    expect(await ssvViews.getBalance(helpers.DB.owners[4].address, cluster1.args.operatorIds, cluster1.args.cluster)).to.equal(minDepositAmount - burnPerBlock * 2 - newBurnPerBlock);
    expect(await ssvViews.getNetworkEarnings() - initNetworkFeeBalance).to.equal(networkFee * 4 + newNetworkFee * 2);

    const minDep2 = minDepositAmount * 2;
    const cluster2 = await helpers.registerValidators(4, 1, minDep2.toString(), [3, 4, 5, 6]);

    await utils.progressBlocks(2);
    expect(await ssvViews.getOperatorEarnings(1)).to.equal(helpers.CONFIG.minimalOperatorFee * 10 + helpers.CONFIG.minimalOperatorFee * 9);
    expect(await ssvViews.getOperatorEarnings(3)).to.equal(helpers.CONFIG.minimalOperatorFee * 10 + helpers.CONFIG.minimalOperatorFee * 9 + helpers.CONFIG.minimalOperatorFee * 2);

    expect(await ssvViews.getOperatorEarnings(5)).to.equal(helpers.CONFIG.minimalOperatorFee * 2);
    expect(await ssvViews.getBalance(helpers.DB.owners[4].address, cluster1.args.operatorIds, cluster1.args.cluster)).to.equal(minDepositAmount - burnPerBlock * 2 - newBurnPerBlock * 6);
    expect(await ssvViews.getBalance(helpers.DB.owners[4].address, cluster2.args.operatorIds, cluster2.args.cluster)).to.equal(minDep2 - newBurnPerBlock * 2);

    // cold cluster + cluster1 * networkFee (4) + (cold cluster + cluster1 * newNetworkFee (5 + 5)) + cluster2 * newNetworkFee (2)
    expect(await ssvViews.getNetworkEarnings() - initNetworkFeeBalance).to.equal(networkFee * 4 + newNetworkFee * 5 + newNetworkFee * 5 + newNetworkFee * 4);

    await ssvNetworkContract.updateNetworkFee(networkFee);
    await utils.progressBlocks(4);

    expect(await ssvViews.getBalance(helpers.DB.owners[4].address, cluster1.args.operatorIds, cluster1.args.cluster)).to.equal(minDepositAmount - burnPerBlock * 2 - newBurnPerBlock * 7 - burnPerBlock * 4);
    expect(await ssvViews.getBalance(helpers.DB.owners[4].address, cluster2.args.operatorIds, cluster2.args.cluster)).to.equal(minDep2 - newBurnPerBlock * 3 - burnPerBlock * 4);

    expect(await ssvViews.getOperatorEarnings(1)).to.equal(helpers.CONFIG.minimalOperatorFee * 15 + helpers.CONFIG.minimalOperatorFee * 14);
    expect(await ssvViews.getOperatorEarnings(3)).to.equal(helpers.CONFIG.minimalOperatorFee * 15 + helpers.CONFIG.minimalOperatorFee * 14 + helpers.CONFIG.minimalOperatorFee * 7);
    expect(await ssvViews.getOperatorEarnings(5)).to.equal(helpers.CONFIG.minimalOperatorFee * 7);

    // cold cluster + cluster1 * networkFee (4) + (cold cluster + cluster1 * newNetworkFee (6 + 6)) + cluster2 * newNetworkFee (3) + (cold cluster + cluster1 + cluster2 * networkFee (4 + 4 + 4))
    expect(await ssvViews.getNetworkEarnings() - initNetworkFeeBalance).to.equal(networkFee * 4 + newNetworkFee * 7 + newNetworkFee * 7 + newNetworkFee * 3 + networkFee * 12);
  });

  it('Check operator earnings and cluster balance when reducing operator fee"', async () => {
    const newFee = helpers.CONFIG.minimalOperatorFee / 2;
    await ssvNetworkContract.connect(helpers.DB.owners[0]).reduceOperatorFee(1, newFee);

    await utils.progressBlocks(2);

    expect(await ssvViews.getOperatorEarnings(1)).to.equal(helpers.CONFIG.minimalOperatorFee * 4 + helpers.CONFIG.minimalOperatorFee + newFee * 4);
    expect(await ssvViews.getBalance(helpers.DB.owners[4].address, cluster1.args.operatorIds, cluster1.args.cluster)).to.equal(minDepositAmount - burnPerBlock - ((helpers.CONFIG.minimalOperatorFee * 3 + networkFee) * 2) - newFee * 2);
  });

  it('Check cluster balance after withdraw and deposit"', async () => {
    await utils.progressBlocks(1);
    expect(await ssvViews.getBalance(helpers.DB.owners[4].address, cluster1.args.operatorIds, cluster1.args.cluster)).to.equal(minDepositAmount - burnPerBlock);

    await helpers.DB.ssvToken.connect(helpers.DB.owners[4]).approve(helpers.DB.ssvNetwork.contract.address, minDepositAmount * 2);
    let validator2 = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).registerValidator(
      helpers.DataGenerator.publicKey(3),
      [1, 2, 3, 4],
      helpers.DataGenerator.shares(4),
      minDepositAmount * 2,
      cluster1.args.cluster
    ));
    let cluster2 = validator2.eventsByName.ValidatorAdded[0];

    expect(await ssvViews.getBalance(helpers.DB.owners[4].address, cluster2.args.operatorIds, cluster2.args.cluster)).to.equal(minDepositAmount * 3 - burnPerBlock * 3);

    validator2 = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).withdraw(cluster2.args.operatorIds, helpers.CONFIG.minimalOperatorFee, cluster2.args.cluster));
    cluster2 = validator2.eventsByName.ClusterWithdrawn[0];

    expect(await ssvViews.getBalance(helpers.DB.owners[4].address, cluster2.args.operatorIds, cluster2.args.cluster)).to.equal(minDepositAmount * 3 - burnPerBlock * 4 - burnPerBlock - helpers.CONFIG.minimalOperatorFee);

    await helpers.DB.ssvToken.connect(helpers.DB.owners[4]).approve(helpers.DB.ssvNetwork.contract.address, minDepositAmount);
    validator2 = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[4]).deposit(helpers.DB.owners[4].address, cluster2.args.operatorIds, helpers.CONFIG.minimalOperatorFee, cluster2.args.cluster));
    cluster2 = validator2.eventsByName.ClusterDeposited[0];
    await utils.progressBlocks(2);

    expect(await ssvViews.getBalance(helpers.DB.owners[4].address, cluster2.args.operatorIds, cluster2.args.cluster)).to.equal(minDepositAmount * 3 - burnPerBlock * 8 - burnPerBlock * 5 - helpers.CONFIG.minimalOperatorFee + helpers.CONFIG.minimalOperatorFee);
  });
});
import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';

import { expect } from 'chai';
import { GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, clusterResult1: any, minDepositAmount: any, burnPerBlock: any, networkFee: any;

describe('Balance Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

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
    clusterResult1 = await helpers.registerValidators(4, 1, minDepositAmount, helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
  });

  it('Check pod balance in three blocks, one after the other', async () => {
    await utils.progressBlocks(1);
    expect(await ssvNetworkContract.podBalanceOf(helpers.DB.owners[4].address, clusterResult1.clusterId)).to.equal(minDepositAmount - burnPerBlock);
    await utils.progressBlocks(1);
    expect(await ssvNetworkContract.podBalanceOf(helpers.DB.owners[4].address, clusterResult1.clusterId)).to.equal(minDepositAmount - burnPerBlock * 2);
    await utils.progressBlocks(1);
    expect(await ssvNetworkContract.podBalanceOf(helpers.DB.owners[4].address, clusterResult1.clusterId)).to.equal(minDepositAmount - burnPerBlock * 3);
  });

  it('Check pod balance in two and twelve blocks, after network fee updates', async () => {
    await utils.progressBlocks(1);
    expect(await ssvNetworkContract.podBalanceOf(helpers.DB.owners[4].address, clusterResult1.clusterId)).to.equal(minDepositAmount - burnPerBlock);
    const newBurnPerBlock = burnPerBlock + networkFee;
    await ssvNetworkContract.updateNetworkFee(networkFee * 2);
    await utils.progressBlocks(1);
    expect(await ssvNetworkContract.podBalanceOf(helpers.DB.owners[4].address, clusterResult1.clusterId)).to.equal(minDepositAmount - burnPerBlock * 2 - newBurnPerBlock);
    await utils.progressBlocks(1);
    expect(await ssvNetworkContract.podBalanceOf(helpers.DB.owners[4].address, clusterResult1.clusterId)).to.equal(minDepositAmount - burnPerBlock * 2 - newBurnPerBlock * 2);
    await utils.progressBlocks(10);
    expect(await ssvNetworkContract.podBalanceOf(helpers.DB.owners[4].address, clusterResult1.clusterId)).to.equal(minDepositAmount - burnPerBlock * 2 - newBurnPerBlock * 12);
  });

  it('Check DAO earnings in three blocks, one after the other', async () => {
    await utils.progressBlocks(1);
    expect(await ssvNetworkContract.getNetworkBalance()).to.equal(networkFee);
    await utils.progressBlocks(1);
    expect(await ssvNetworkContract.getNetworkBalance()).to.equal(networkFee * 2);
    await utils.progressBlocks(1);
    expect(await ssvNetworkContract.getNetworkBalance()).to.equal(networkFee * 3);
  });

  it('Check DAO earnings in two and twelve blocks, after network fee updates', async () => {
    await utils.progressBlocks(1);
    expect(await ssvNetworkContract.getNetworkBalance()).to.equal(networkFee);
    const newNetworkFee = networkFee * 2;
    await ssvNetworkContract.updateNetworkFee(newNetworkFee);
    await utils.progressBlocks(1);
    expect(await ssvNetworkContract.getNetworkBalance()).to.equal(networkFee * 2 + newNetworkFee);
    await utils.progressBlocks(1);
    expect(await ssvNetworkContract.getNetworkBalance()).to.equal(networkFee * 2 + newNetworkFee * 2);
    await utils.progressBlocks(10);
    expect(await ssvNetworkContract.getNetworkBalance()).to.equal(networkFee * 2 + newNetworkFee * 12);
  });

  it('Check operators earnings in three blocks, one after the other', async () => {
    await utils.progressBlocks(1);
    expect((await ssvNetworkContract.operatorSnapshot(1)).balance).to.equal(helpers.CONFIG.minimalOperatorFee);
    expect((await ssvNetworkContract.operatorSnapshot(2)).balance).to.equal(helpers.CONFIG.minimalOperatorFee);
    expect((await ssvNetworkContract.operatorSnapshot(3)).balance).to.equal(helpers.CONFIG.minimalOperatorFee);
    expect((await ssvNetworkContract.operatorSnapshot(4)).balance).to.equal(helpers.CONFIG.minimalOperatorFee);
    await utils.progressBlocks(1);
    expect((await ssvNetworkContract.operatorSnapshot(1)).balance).to.equal(helpers.CONFIG.minimalOperatorFee * 2);
    expect((await ssvNetworkContract.operatorSnapshot(2)).balance).to.equal(helpers.CONFIG.minimalOperatorFee * 2);
    expect((await ssvNetworkContract.operatorSnapshot(3)).balance).to.equal(helpers.CONFIG.minimalOperatorFee * 2);
    expect((await ssvNetworkContract.operatorSnapshot(4)).balance).to.equal(helpers.CONFIG.minimalOperatorFee * 2);
    await utils.progressBlocks(1);
    expect((await ssvNetworkContract.operatorSnapshot(1)).balance).to.equal(helpers.CONFIG.minimalOperatorFee * 3);
    expect((await ssvNetworkContract.operatorSnapshot(2)).balance).to.equal(helpers.CONFIG.minimalOperatorFee * 3);
    expect((await ssvNetworkContract.operatorSnapshot(3)).balance).to.equal(helpers.CONFIG.minimalOperatorFee * 3);
    expect((await ssvNetworkContract.operatorSnapshot(4)).balance).to.equal(helpers.CONFIG.minimalOperatorFee * 3);
  });
});

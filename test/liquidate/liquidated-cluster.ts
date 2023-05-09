// Decalre imports
import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';
import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, ssvViews: any, registerAuth: any, minDepositAmount: any, firstCluster: any, burnPerBlock: any, networkFee: any;

// Declare globals
describe('Liquidate Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = (await helpers.initializeContract());
    ssvNetworkContract = metadata.contract;
    ssvViews = metadata.ssvViews;
    registerAuth = metadata.registerAuth;

    // Register operators
    await helpers.registerOperators(0, 12, helpers.CONFIG.minimalOperatorFee);

    networkFee = helpers.CONFIG.minimalOperatorFee;
    burnPerBlock = helpers.CONFIG.minimalOperatorFee * 4 + networkFee;
    minDepositAmount = helpers.CONFIG.minimalBlocksBeforeLiquidation * burnPerBlock;

    await ssvNetworkContract.updateNetworkFee(networkFee);

    await registerAuth.setAuth(helpers.DB.owners[1].address, [false, true]);
    // first validator
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount * 2);
    const register = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(1),
      [1, 2, 3, 4],
      helpers.DataGenerator.shares(4),
      minDepositAmount * 2,
      {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        active: true
      }
    ));
    firstCluster = register.eventsByName.ValidatorAdded[0].args;
  });

  it('Liquidate -> deposit -> reactivate', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);

    let clusterEventData = await helpers.liquidate(firstCluster.owner,
      firstCluster.operatorIds,
      firstCluster.cluster);

    expect(await ssvViews.isLiquidated(firstCluster.owner,
      firstCluster.operatorIds,
      clusterEventData.cluster)).to.equal(true);

    clusterEventData = await helpers.deposit(1,
      firstCluster.owner,
      firstCluster.operatorIds,
      minDepositAmount,
      clusterEventData.cluster);

    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).reactivate(clusterEventData.operatorIds, minDepositAmount, clusterEventData.cluster)).to.emit(ssvNetworkContract, 'ClusterReactivated');
  });

  it('RegisterValidator -> liquidate -> removeValidator -> deposit -> withdraw', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    const register = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(2),
      [1, 2, 3, 4],
      helpers.DataGenerator.shares(4),
      minDepositAmount,
      firstCluster.cluster
    ));
    let clusterEventData = register.eventsByName.ValidatorAdded[0].args;

    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);

    clusterEventData = await helpers.liquidate(clusterEventData.owner, clusterEventData.operatorIds, clusterEventData.cluster);
    await expect(clusterEventData.cluster.balance).to.be.equals(0);

    clusterEventData = await helpers.removeValidator(1, helpers.DataGenerator.publicKey(1), clusterEventData.operatorIds, clusterEventData.cluster);

    clusterEventData = await helpers.deposit(1, clusterEventData.owner, clusterEventData.operatorIds, minDepositAmount, clusterEventData.cluster);
    await expect(clusterEventData.cluster.balance).to.be.equals(minDepositAmount); // shrink

    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).withdraw(
      clusterEventData.operatorIds,
      minDepositAmount,
      clusterEventData.cluster)).to.be.revertedWithCustomError(ssvNetworkContract, 'ClusterIsLiquidated');
  });

  it('Withdraw -> liquidate -> deposit -> reactivate', async () => {
    await utils.progressBlocks(2);

    const withdrawAmount = 2e7;

    let clusterEventData = await helpers.withdraw(1,
      firstCluster.operatorIds,
      withdrawAmount.toString(),
      firstCluster.cluster)
    expect(await ssvViews.getBalance(helpers.DB.owners[1].address, clusterEventData.operatorIds, clusterEventData.cluster)).to.be.equals(minDepositAmount * 2 - withdrawAmount - (burnPerBlock * 3));

    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation - 2);

    clusterEventData = await helpers.liquidate(clusterEventData.owner,
      clusterEventData.operatorIds,
      clusterEventData.cluster);
    await expect(ssvViews.getBalance(helpers.DB.owners[1].address, clusterEventData.operatorIds, clusterEventData.cluster)).to.be.revertedWithCustomError(ssvNetworkContract, 'ClusterIsLiquidated');

    clusterEventData = await helpers.deposit(1,
      clusterEventData.owner,
      clusterEventData.operatorIds,
      minDepositAmount,
      clusterEventData.cluster)

    clusterEventData = await helpers.reactivate(1,
      clusterEventData.operatorIds,
      minDepositAmount,
      clusterEventData.cluster);
    expect(await ssvViews.getBalance(helpers.DB.owners[1].address, clusterEventData.operatorIds, clusterEventData.cluster)).to.be.equals(minDepositAmount * 2);

    await utils.progressBlocks(2);
    expect(await ssvViews.getBalance(helpers.DB.owners[1].address, clusterEventData.operatorIds, clusterEventData.cluster)).to.be.equals(minDepositAmount * 2 - burnPerBlock * 2);
  });
});
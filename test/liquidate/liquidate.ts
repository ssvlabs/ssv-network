// Decalre imports
import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';
import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, ssvViews: any, minDepositAmount: any, firstCluster: any, networkFee: any, burnPerBlock: any;

// Declare globals
describe('Liquidate Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = (await helpers.initializeContract());
    ssvNetworkContract = metadata.contract;
    ssvViews = metadata.ssvViews;

    // Register operators
    await helpers.registerOperators(0, 12, helpers.CONFIG.minimalOperatorFee);

    minDepositAmount = (helpers.CONFIG.minimalBlocksBeforeLiquidation + 10) * helpers.CONFIG.minimalOperatorFee * 4;

    // cold register
    await helpers.DB.ssvToken.connect(helpers.DB.owners[6]).approve(helpers.DB.ssvNetwork.contract.address, '1000000000000000');
    await ssvNetworkContract.connect(helpers.DB.owners[6]).registerValidator(
      '0x221111111111111111111111111111111111111111111111111111111111111111111111111111111111111111111119',
      [1, 2, 3, 4],
      helpers.DataGenerator.shares(4),
      '1000000000000000',
      {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        active: true
      }
    );

    // first validator
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    const register = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(100),
      [1, 2, 3, 4],
      helpers.DataGenerator.shares(4),
      minDepositAmount,
      {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        active: true
      }
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
    firstCluster = register.eventsByName.ValidatorAdded[0].args;
  });

  it('Liquidate a cluster via liquidation threshold emits "ClustersLiquidated"', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);

    await expect(ssvNetworkContract.liquidate([{
      owner: firstCluster.owner,
      operatorIds: firstCluster.operatorIds,
      cluster: firstCluster.cluster
    }])).to.emit(ssvNetworkContract, 'ClustersLiquidated')
      .to.emit(helpers.DB.ssvToken, 'Transfer').withArgs(
        ssvNetworkContract.address,
        helpers.DB.owners[0].address,
        minDepositAmount - (helpers.CONFIG.minimalOperatorFee * 4 * (helpers.CONFIG.minimalBlocksBeforeLiquidation + 1))
      );
  });

  it('Liquidate a cluster via minimum liquidation collateral emits "ClustersLiquidated"', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation - 2);

    await expect(ssvNetworkContract.liquidate([{
      owner: firstCluster.owner,
      operatorIds: firstCluster.operatorIds,
      cluster: firstCluster.cluster
    }])).to.emit(ssvNetworkContract, 'ClustersLiquidated')
      .to.emit(helpers.DB.ssvToken, 'Transfer').withArgs(
        ssvNetworkContract.address,
        helpers.DB.owners[0].address,
        minDepositAmount - (helpers.CONFIG.minimalOperatorFee * 4 * (helpers.CONFIG.minimalBlocksBeforeLiquidation + 1 - 2))
      );
  });

  it('Liquidate a cluster after liquidation period emits "ClustersLiquidated"', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation + 10);

    await expect(ssvNetworkContract.liquidate([{
      owner: firstCluster.owner,
      operatorIds: firstCluster.operatorIds,
      cluster: firstCluster.cluster
    }])).to.emit(ssvNetworkContract, 'ClustersLiquidated')
      .to.not.emit(helpers.DB.ssvToken, 'Transfer');
  });

  it('Liquidatable with removed operator', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    await ssvNetworkContract.removeOperator(1);
    expect(await ssvViews.isLiquidatable(firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster)).to.equal(true);
  });

  it('Liquidatable with removed operator after liquidation period', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation + 10);
    await ssvNetworkContract.removeOperator(1);
    expect(await ssvViews.isLiquidatable(firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster)).to.equal(true);
  });

  it('Liquidate validator with removed operator in a cluster', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    await ssvNetworkContract.removeOperator(1);
    const liquidatedCluster = await trackGas(ssvNetworkContract.liquidate([{
      owner: firstCluster.owner,
      operatorIds: firstCluster.operatorIds,
      cluster: firstCluster.cluster
    }]), [GasGroup.LIQUIDATE_POD]);

    const updatedCluster = liquidatedCluster.eventsByName.ClustersLiquidated[0].args.liquidations[0];

    expect(await ssvViews.isLiquidatable(updatedCluster.owner, updatedCluster.operatorIds, updatedCluster.cluster)).to.be.equals(false);
  });

  it('Liquidate and register validator in a disabled cluster reverts "ClusterIsLiquidated"', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(ssvNetworkContract.liquidate([{
      owner: firstCluster.owner,
      operatorIds: firstCluster.operatorIds,
      cluster: firstCluster.cluster
    }]), [GasGroup.LIQUIDATE_POD]);
    const updatedCluster = liquidatedCluster.eventsByName.ClustersLiquidated[0].args.liquidations[0];
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, `${minDepositAmount * 2}`);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerValidator(
      helpers.DataGenerator.publicKey(2),
      updatedCluster.operatorIds,
      helpers.DataGenerator.shares(4),
      `${minDepositAmount * 2}`,
      updatedCluster.cluster
    )).to.be.revertedWithCustomError(ssvNetworkContract, 'ClusterIsLiquidated');
  });

  it('Liquidate cluster and check isLiquidated true', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(ssvNetworkContract.liquidate([{
      owner: firstCluster.owner,
      operatorIds: firstCluster.operatorIds,
      cluster: firstCluster.cluster
    }]), [GasGroup.LIQUIDATE_POD]);
    const updatedCluster = liquidatedCluster.eventsByName.ClustersLiquidated[0].args.liquidations[0];

    expect(await ssvViews.isLiquidated(firstCluster.owner, updatedCluster.operatorIds, updatedCluster.cluster)).to.equal(true);
  });

  it('Liquidate a non liquidatable cluster that I own', async () => {
    const liquidatedCluster = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).liquidate([{
      owner: firstCluster.owner,
      operatorIds: firstCluster.operatorIds,
      cluster: firstCluster.cluster
    }]), [GasGroup.LIQUIDATE_POD]);
    const updatedCluster = liquidatedCluster.eventsByName.ClustersLiquidated[0].args.liquidations[0];

    expect(await ssvViews.isLiquidated(firstCluster.owner, updatedCluster.operatorIds, updatedCluster.cluster)).to.equal(true);
  });

  it('Liquidate cluster that I own', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).liquidate([{
      owner: firstCluster.owner,
      operatorIds: firstCluster.operatorIds,
      cluster: firstCluster.cluster
    }]), [GasGroup.LIQUIDATE_POD]);
    const updatedCluster = liquidatedCluster.eventsByName.ClustersLiquidated[0].args.liquidations[0];

    expect(await ssvViews.isLiquidated(firstCluster.owner, updatedCluster.operatorIds, updatedCluster.cluster)).to.equal(true);
  });

  it('Liquidate cluster that I own after liquidation period', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation + 10);
    const liquidatedCluster = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).liquidate([{
      owner: firstCluster.owner,
      operatorIds: firstCluster.operatorIds,
      cluster: firstCluster.cluster
    }]), [GasGroup.LIQUIDATE_POD]);
    const updatedCluster = liquidatedCluster.eventsByName.ClustersLiquidated[0].args.liquidations[0];

    expect(await ssvViews.isLiquidated(firstCluster.owner, updatedCluster.operatorIds, updatedCluster.cluster)).to.equal(true);
  });

  it('Get if the cluster is liquidatable', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    expect(await ssvViews.isLiquidatable(firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster)).to.equal(true);
  });

  it('Get if the cluster is liquidatable after liquidation period', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation + 10);
    expect(await ssvViews.isLiquidatable(firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster)).to.equal(true);
  });

  it('Get if the cluster is not liquidatable', async () => {
    expect(await ssvViews.isLiquidatable(firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster)).to.equal(false);
  });

  it('Liquidate a cluster that is not liquidatable reverts "ClusterNotLiquidatable"', async () => {
    await expect(ssvNetworkContract.liquidate([{
      owner: firstCluster.owner,
      operatorIds: firstCluster.operatorIds,
      cluster: firstCluster.cluster
    }])).to.be.revertedWithCustomError(ssvNetworkContract, 'ClusterNotLiquidatable');
    expect(await ssvViews.isLiquidatable(firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster)).to.equal(false);
  });

  it('Liquidate a cluster that is not liquidatable reverts "IncorrectClusterState"', async () => {
    await expect(ssvNetworkContract.liquidate([{
      owner: firstCluster.owner,
      operatorIds: firstCluster.operatorIds,
      cluster: {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        active: true
      }
    }])).to.be.revertedWithCustomError(ssvNetworkContract, 'IncorrectClusterState');
  });

  it('Liquidate already liquidated cluster reverts "ClusterIsLiquidated"', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(ssvNetworkContract.liquidate([{
      owner: firstCluster.owner,
      operatorIds: firstCluster.operatorIds,
      cluster: firstCluster.cluster
    }]), [GasGroup.LIQUIDATE_POD]);
    const updatedCluster = liquidatedCluster.eventsByName.ClustersLiquidated[0].args.liquidations[0];

    await expect(ssvNetworkContract.liquidate([{
      owner: updatedCluster.owner,
      operatorIds: updatedCluster.operatorIds,
      cluster: updatedCluster.cluster
    }])).to.be.revertedWithCustomError(ssvNetworkContract, 'ClusterIsLiquidated');
  });

  it('Is liquidated reverts "ClusterDoesNotExists"', async () => {
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(ssvNetworkContract.liquidate([{
      owner: firstCluster.owner,
      operatorIds: firstCluster.operatorIds,
      cluster: firstCluster.cluster
    }]), [GasGroup.LIQUIDATE_POD]);
    const updatedCluster = liquidatedCluster.eventsByName.ClustersLiquidated[0].args.liquidations[0];

    await expect(ssvViews.isLiquidated(helpers.DB.owners[0].address, updatedCluster.operatorIds, updatedCluster.cluster)).to.be.revertedWithCustomError(ssvNetworkContract, 'ClusterDoesNotExists');
  });
});

describe('Bulk Liquidation Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = (await helpers.initializeContract());
    ssvNetworkContract = metadata.contract;
    ssvViews = metadata.ssvViews;

    // Register operators
    await helpers.registerOperators(0, 30, helpers.CONFIG.minimalOperatorFee);

    networkFee = helpers.CONFIG.minimalOperatorFee;
    burnPerBlock = helpers.CONFIG.minimalOperatorFee * 4 + networkFee;
    minDepositAmount = (helpers.CONFIG.minimalBlocksBeforeLiquidation + 100) * burnPerBlock;

    await ssvNetworkContract.updateNetworkFee(networkFee);
  });

  it('Bulk Liquidate 2 clusters', async () => {

    let cluster1 = {
      validators: 10,
      owner: '',
      operatorIds: [1, 2, 3, 4],
      data: {},
      registerBlock: 0,
      initialBalance: 0
    };

    let cluster2 = {
      validators: 8,
      owner: '',
      operatorIds: [3, 4, 20, 22],
      data: {},
      registerBlock: 0,
      initialBalance: 0
    };

    // register cluster 1
    let newCluster = await helpers.registerValidatorsRaw(1, cluster1.validators, (minDepositAmount).toString(), cluster1.operatorIds);
    cluster1 = { ...cluster1, owner: newCluster.owner, operatorIds: newCluster.operatorIds, data: newCluster.cluster };
    cluster1.registerBlock = await ethers.provider.getBlockNumber();
    cluster1.initialBalance = await ssvViews.getBalance(cluster1.owner, cluster1.operatorIds, cluster1.data);

    // register cluster 2
    newCluster = await helpers.registerValidatorsRaw(2, cluster2.validators, (minDepositAmount).toString(), cluster2.operatorIds);
    cluster2 = { ...cluster2, owner: newCluster.owner, operatorIds: newCluster.operatorIds, data: newCluster.cluster };
    cluster2.registerBlock = await ethers.provider.getBlockNumber();
    cluster2.initialBalance = await ssvViews.getBalance(cluster2.owner, cluster2.operatorIds, cluster2.data);

    // register cluster 3
    await helpers.registerValidatorsRaw(3, 20, (minDepositAmount).toString(), [6, 8, 18, 20]);

    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);

    const liq1 = {
      owner: cluster1.owner,
      operatorIds: cluster1.operatorIds,
      cluster: cluster1.data
    }

    const liq2 = {
      owner: cluster2.owner,
      operatorIds: cluster2.operatorIds,
      cluster: cluster2.data
    }

    // liquidate clusters 1, 2
    const res = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[7]).liquidate([liq1, liq2]));
    const liquidateBlock = await ethers.provider.getBlockNumber();

    const oneTransfer = cluster1.initialBalance - (liquidateBlock - cluster1.registerBlock) * burnPerBlock * cluster1.validators;
    const twoTransfer = cluster2.initialBalance - (liquidateBlock - cluster2.registerBlock) * burnPerBlock * cluster2.validators;

    // check amount transferred to liquidator is correct
    expect(await helpers.DB.ssvToken.balanceOf(helpers.DB.owners[7].address)).to.be.equal(oneTransfer + twoTransfer);

    const liqRes1 = res.eventsByName.ClustersLiquidated[0].args.liquidations[0];
    const liqRes2 = res.eventsByName.ClustersLiquidated[0].args.liquidations[1];

    // check Liquidations state after liquidation
    expect(liqRes1).to.deep.equal([cluster1.owner, cluster1.operatorIds, [cluster1.validators, 0, 0, 0, false]]);
    expect(liqRes2).to.deep.equal([cluster2.owner, cluster2.operatorIds, [cluster2.validators, 0, 0, 0, false]]);

    // check DAO validatorCount
    expect((await ssvNetworkContract.dao()).validatorCount).to.be.equal(20);
    
    // check operators validatorCount
    expect((await ssvViews.getOperatorById(1))[2]
      | (await ssvViews.getOperatorById(2))[2]
      | (await ssvViews.getOperatorById(3))[2]
      | (await ssvViews.getOperatorById(4))[2]
      | (await ssvViews.getOperatorById(22))[2]
    ).to.equal(0);

    expect((await ssvViews.getOperatorById(6))[2]
      & (await ssvViews.getOperatorById(8))[2]
      & (await ssvViews.getOperatorById(18))[2]
      & (await ssvViews.getOperatorById(20))[2]
    ).to.equal(20);

  });
});
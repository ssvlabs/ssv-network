// Declare imports
import {
  owners,
  initializeContract,
  registerOperators,
  coldRegisterValidator,
  bulkRegisterValidators,
  DataGenerator,
  CONFIG,
  DEFAULT_OPERATOR_IDS,
} from '../helpers/contract-helpers';
import { assertEvent } from '../helpers/utils/test';
import { trackGas, GasGroup } from '../helpers/gas-usage';

import { mine } from '@nomicfoundation/hardhat-network-helpers';

import { expect } from 'chai';

let ssvNetwork: any, ssvViews: any, ssvToken: any, minDepositAmount: BigInt, firstCluster: Cluster;

// Declare globals
describe('Liquidate Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = await initializeContract();
    ssvNetwork = metadata.ssvNetwork;
    ssvViews = metadata.ssvNetworkViews;
    ssvToken = metadata.ssvToken;

    // Register operators
    await registerOperators(0, 14, CONFIG.minimalOperatorFee);

    minDepositAmount = BigInt(CONFIG.minimalBlocksBeforeLiquidation + 10) * CONFIG.minimalOperatorFee * 4n;

    // cold register
    await coldRegisterValidator();

    // first validator
    firstCluster = (
      await bulkRegisterValidators(
        4,
        1,
        DEFAULT_OPERATOR_IDS[4],
        minDepositAmount,
        { validatorCount: 0, networkFeeIndex: 0, index: 0, balance: 0n, active: true },
        [GasGroup.REGISTER_VALIDATOR_NEW_STATE],
      )
    ).args;
  });

  it('Liquidate a cluster via liquidation threshold emits "ClusterLiquidated"', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation);

    await assertEvent(
      ssvNetwork.write.liquidate([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
      [
        {
          contract: ssvNetwork,
          eventName: 'ClusterLiquidated',
        },
        {
          contract: ssvToken,
          eventName: 'Transfer',
          argNames: ['from', 'to', 'value'],
          argValuesList: [
            [
              ssvNetwork.address,
              owners[0].account.address,
              minDepositAmount - CONFIG.minimalOperatorFee * 4n * BigInt(CONFIG.minimalBlocksBeforeLiquidation + 1),
            ],
          ],
        },
      ],
    );
  });

  it('Liquidate a cluster via minimum liquidation collateral emits "ClusterLiquidated"', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation - 2);

    await assertEvent(
      ssvNetwork.write.liquidate([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
      [
        {
          contract: ssvNetwork,
          eventName: 'ClusterLiquidated',
        },
        {
          contract: ssvToken,
          eventName: 'Transfer',
          argNames: ['from', 'to', 'value'],
          argValuesList: [
            [
              ssvNetwork.address,
              owners[0].account.address,
              minDepositAmount - CONFIG.minimalOperatorFee * 4n * BigInt(CONFIG.minimalBlocksBeforeLiquidation + 1 - 2),
            ],
          ],
        },
      ],
    );
  });

  it('Liquidate a cluster after liquidation period emits "ClusterLiquidated"', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation + 10);

    await assertEvent(
      ssvNetwork.write.liquidate([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
      [
        {
          contract: ssvNetwork,
          eventName: 'ClusterLiquidated',
        },
      ],
      {
        contract: ssvToken,
        eventName: 'Transfer',
      },
    );
  });

  it('Liquidatable with removed operator', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation);
    await ssvNetwork.write.removeOperator([1]);
    expect(
      await ssvViews.read.isLiquidatable([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
    ).to.equal(true);
  });

  it('Liquidatable with removed operator after liquidation period', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation + 10);
    await ssvNetwork.write.removeOperator([1]);
    expect(
      await ssvViews.read.isLiquidatable([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
    ).to.equal(true);
  });

  it('Liquidate validator with removed operator in a cluster', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation);
    await ssvNetwork.write.removeOperator([1]);
    const liquidatedCluster = await trackGas(
      ssvNetwork.write.liquidate([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
      [GasGroup.LIQUIDATE_CLUSTER_4],
    );
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;
    expect(
      await ssvViews.read.isLiquidatable([updatedCluster.owner, updatedCluster.operatorIds, updatedCluster.cluster]),
    ).to.be.equals(false);
  });

  it('Liquidate and register validator in a disabled cluster reverts "ClusterIsLiquidated"', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(
      ssvNetwork.write.liquidate([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
      [GasGroup.LIQUIDATE_CLUSTER_4],
    );
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;
    await mine(CONFIG.minimalBlocksBeforeLiquidation);

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount * 2n], {
      account: owners[1].account,
    });

    await expect(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(2),
          updatedCluster.operatorIds,
          await DataGenerator.shares(1, 2, updatedCluster.operatorIds),
          minDepositAmount * 2n,
          updatedCluster.cluster,
        ],
        { account: owners[1].account },
      ),
    ).to.be.rejectedWith('IncorrectClusterState');
  });

  it('Liquidate cluster (4 operators) and check isLiquidated true', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(
      ssvNetwork.write.liquidate([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
      [GasGroup.LIQUIDATE_CLUSTER_4],
    );
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;

    expect(
      await ssvViews.read.isLiquidated([firstCluster.owner, firstCluster.operatorIds, updatedCluster.cluster]),
    ).to.equal(true);
  });

  it('Liquidate cluster (7 operators) and check isLiquidated true', async () => {
    const depositAmount = BigInt(CONFIG.minimalBlocksBeforeLiquidation + 10) * (CONFIG.minimalOperatorFee * 7n);

    const cluster = await bulkRegisterValidators(1, 1, DEFAULT_OPERATOR_IDS[7], depositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });
    firstCluster = cluster.args;

    await mine(CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(
      ssvNetwork.write.liquidate([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
      [GasGroup.LIQUIDATE_CLUSTER_7],
    );
    firstCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;

    expect(
      await ssvViews.read.isLiquidated([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
    ).to.equal(true);
  });

  it('Liquidate cluster (10 operators) and check isLiquidated true', async () => {
    const depositAmount = BigInt(CONFIG.minimalBlocksBeforeLiquidation + 10) * (CONFIG.minimalOperatorFee * 10n);

    const cluster = await bulkRegisterValidators(1, 1, DEFAULT_OPERATOR_IDS[10], depositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });
    firstCluster = cluster.args;

    await mine(CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(
      ssvNetwork.write.liquidate([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
      [GasGroup.LIQUIDATE_CLUSTER_10],
    );
    firstCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;

    expect(
      await ssvViews.read.isLiquidated([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
    ).to.equal(true);
  });

  it('Liquidate cluster (13 operators) and check isLiquidated true', async () => {
    const depositAmount = BigInt(CONFIG.minimalBlocksBeforeLiquidation + 10) * (CONFIG.minimalOperatorFee * 13n);

    const cluster = await bulkRegisterValidators(1, 1, DEFAULT_OPERATOR_IDS[13], depositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });
    firstCluster = cluster.args;

    await mine(CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(
      ssvNetwork.write.liquidate([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
      [GasGroup.LIQUIDATE_CLUSTER_13],
    );
    firstCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;

    expect(
      await ssvViews.read.isLiquidated([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
    ).to.equal(true);
  });

  it('Liquidate a non liquidatable cluster that I own', async () => {
    const liquidatedCluster = await trackGas(
      ssvNetwork.write.liquidate([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster], {
        account: owners[4].account,
      }),
      [GasGroup.LIQUIDATE_CLUSTER_4],
    );
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;

    expect(
      await ssvViews.read.isLiquidated([firstCluster.owner, firstCluster.operatorIds, updatedCluster.cluster]),
    ).to.equal(true);
  });

  it('Liquidate cluster that I own', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(
      ssvNetwork.write.liquidate([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster], {
        account: owners[4].account,
      }),
      [GasGroup.LIQUIDATE_CLUSTER_4],
    );
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;

    expect(
      await ssvViews.read.isLiquidated([firstCluster.owner, firstCluster.operatorIds, updatedCluster.cluster]),
    ).to.equal(true);
  });

  it('Liquidate cluster that I own after liquidation period', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation + 10);
    const liquidatedCluster = await trackGas(
      ssvNetwork.write.liquidate([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster], {
        account: owners[4].account,
      }),
      [GasGroup.LIQUIDATE_CLUSTER_4],
    );
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;

    expect(
      await ssvViews.read.isLiquidated([firstCluster.owner, firstCluster.operatorIds, updatedCluster.cluster]),
    ).to.equal(true);
  });

  it('Get if the cluster is liquidatable', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation);
    expect(
      await ssvViews.read.isLiquidatable([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
    ).to.equal(true);
  });

  it('Get if the cluster is liquidatable after liquidation period', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation + 10);
    expect(
      await ssvViews.read.isLiquidatable([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
    ).to.equal(true);
  });

  it('Get if the cluster is not liquidatable', async () => {
    expect(
      await ssvViews.read.isLiquidatable([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
    ).to.equal(false);
  });

  it('Liquidate a cluster that is not liquidatable reverts "ClusterNotLiquidatable"', async () => {
    await expect(
      ssvNetwork.write.liquidate([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
    ).to.be.rejectedWith('ClusterNotLiquidatable');
    expect(
      await ssvViews.read.isLiquidatable([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
    ).to.equal(false);
  });

  it('Liquidate a cluster that is not liquidatable reverts "IncorrectClusterState"', async () => {
    await expect(
      ssvNetwork.write.liquidate([
        firstCluster.owner,
        firstCluster.operatorIds,
        {
          validatorCount: 0,
          networkFeeIndex: 0,
          index: 0,
          balance: 0,
          active: true,
        },
      ]),
    ).to.be.rejectedWith('IncorrectClusterState');
  });

  it('Liquidate already liquidated cluster reverts "ClusterIsLiquidated"', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(
      ssvNetwork.write.liquidate([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
      [GasGroup.LIQUIDATE_CLUSTER_4],
    );
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;

    await expect(
      ssvNetwork.write.liquidate([firstCluster.owner, updatedCluster.operatorIds, updatedCluster.cluster]),
    ).to.be.rejectedWith('ClusterIsLiquidated');
  });

  it('Is liquidated reverts "ClusterDoesNotExists"', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(
      ssvNetwork.write.liquidate([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster], {
        account: owners[4].account,
      }),
      [GasGroup.LIQUIDATE_CLUSTER_4],
    );
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;

    await expect(
      ssvViews.read.isLiquidated([owners[1].account.address, firstCluster.operatorIds, updatedCluster.cluster]),
    ).to.be.rejectedWith('ClusterDoesNotExists');
  });
});

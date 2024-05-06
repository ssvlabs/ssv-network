// Declare imports
// Declare imports
import {
  owners,
  initializeContract,
  registerOperators,
  coldRegisterValidator,
  bulkRegisterValidators,
  deposit,
  CONFIG,
  DEFAULT_OPERATOR_IDS,
} from '../helpers/contract-helpers';
import { assertEvent } from '../helpers/utils/test';
import { trackGas, GasGroup } from '../helpers/gas-usage';

import { mine } from '@nomicfoundation/hardhat-network-helpers';

import { expect } from 'chai';

let ssvNetwork: any, ssvToken: any, minDepositAmount: BigInt, firstCluster: Cluster;

// Declare globals
describe('Reactivate Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = await initializeContract();
    ssvNetwork = metadata.ssvNetwork;
    ssvToken = metadata.ssvToken;

    // Register operators
    await registerOperators(0, 14, CONFIG.minimalOperatorFee);

    minDepositAmount = BigInt(CONFIG.minimalBlocksBeforeLiquidation + 10) * CONFIG.minimalOperatorFee * 4n;

    // Register validators
    // cold register
    await coldRegisterValidator();

    // first validator
    firstCluster = (
      await bulkRegisterValidators(1, 1, DEFAULT_OPERATOR_IDS[4], minDepositAmount, {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0n,
        active: true,
      })
    ).args;
  });

  it('Reactivate a disabled cluster emits "ClusterReactivated"', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(
      ssvNetwork.write.liquidate([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
      [GasGroup.LIQUIDATE_CLUSTER_4],
    );
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], {
      account: owners[1].account,
    });

    await assertEvent(
      ssvNetwork.write.reactivate([updatedCluster.operatorIds, minDepositAmount, updatedCluster.cluster], {
        account: owners[1].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'ClusterReactivated',
        },
      ],
    );
  });

  it('Reactivate a cluster with a removed operator in the cluster', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(
      ssvNetwork.write.liquidate([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
      [GasGroup.LIQUIDATE_CLUSTER_4],
    );
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;
    await ssvNetwork.write.removeOperator([1]);

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], {
      account: owners[1].account,
    });
    await trackGas(
      ssvNetwork.write.reactivate([updatedCluster.operatorIds, minDepositAmount, updatedCluster.cluster], {
        account: owners[1].account,
      }),
      [GasGroup.REACTIVATE_CLUSTER],
    );
  });

  it('Reactivate an enabled cluster reverts "ClusterAlreadyEnabled"', async () => {
    await expect(
      ssvNetwork.write.reactivate([firstCluster.operatorIds, minDepositAmount, firstCluster.cluster], {
        account: owners[1].account,
      }),
    ).to.be.rejectedWith('ClusterAlreadyEnabled');
  });

  it('Reactivate a cluster when the amount is not enough reverts "InsufficientBalance"', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(
      ssvNetwork.write.liquidate([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
      [GasGroup.LIQUIDATE_CLUSTER_4],
    );
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;

    await expect(
      ssvNetwork.write.reactivate([updatedCluster.operatorIds, CONFIG.minimalOperatorFee, updatedCluster.cluster], {
        account: owners[1].account,
      }),
    ).to.be.rejectedWith('InsufficientBalance');
  });

  it('Reactivate a liquidated cluster after making a deposit', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(
      ssvNetwork.write.liquidate([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
    );
    let clusterData = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], {
      account: owners[1].account,
    });

    clusterData = await deposit(1, firstCluster.owner, firstCluster.operatorIds, minDepositAmount, clusterData.cluster);

    await assertEvent(
      ssvNetwork.write.reactivate([firstCluster.operatorIds, 0, clusterData.cluster], {
        account: owners[1].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'ClusterReactivated',
        },
      ],
    );
  });

  it('Reactivate a cluster after liquidation period when the amount is not enough reverts "InsufficientBalance"', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(
      ssvNetwork.write.liquidate([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
      [GasGroup.LIQUIDATE_CLUSTER_4],
    );
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], {
      account: owners[1].account,
    });
    await expect(
      ssvNetwork.write.reactivate([updatedCluster.operatorIds, CONFIG.minimalOperatorFee, updatedCluster.cluster], {
        account: owners[1].account,
      }),
    ).to.be.rejectedWith('InsufficientBalance');
  });
});

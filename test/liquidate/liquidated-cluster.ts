// Declare imports
import {
  owners,
  initializeContract,
  registerOperators,
  bulkRegisterValidators,
  deposit,
  liquidate,
  withdraw,
  reactivate,
  removeValidator,
  DataGenerator,
  CONFIG,
  DEFAULT_OPERATOR_IDS,
} from '../helpers/contract-helpers';
import { assertEvent } from '../helpers/utils/test';
import { trackGas } from '../helpers/gas-usage';

import { mine } from '@nomicfoundation/hardhat-network-helpers';

import { expect } from 'chai';

let ssvNetwork: any,
  ssvViews: any,
  ssvToken: any,
  minDepositAmount: BigInt,
  firstCluster: Cluster,
  burnPerBlock: BigInt,
  networkFee: BigInt;

// Declare globals
describe('Liquidate Cluster Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = await initializeContract();
    ssvNetwork = metadata.ssvNetwork;
    ssvViews = metadata.ssvNetworkViews;
    ssvToken = metadata.ssvToken;

    // Register operators
    await registerOperators(0, 14, CONFIG.minimalOperatorFee);

    networkFee = CONFIG.minimalOperatorFee;
    burnPerBlock = CONFIG.minimalOperatorFee * 4n + networkFee;
    minDepositAmount = BigInt(CONFIG.minimalBlocksBeforeLiquidation) * burnPerBlock;

    await ssvNetwork.write.updateNetworkFee([networkFee]);

    // first validator
    firstCluster = (
      await bulkRegisterValidators(1, 1, DEFAULT_OPERATOR_IDS[4], minDepositAmount * 2n, {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0n,
        active: true,
      })
    ).args;
  });

  it('Liquidate -> deposit -> reactivate', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation);

    let clusterEventData = await liquidate(firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster);

    expect(
      await ssvViews.read.isLiquidated([firstCluster.owner, firstCluster.operatorIds, clusterEventData.cluster]),
    ).to.equal(true);

    clusterEventData = await deposit(
      1,
      firstCluster.owner,
      firstCluster.operatorIds,
      minDepositAmount,
      clusterEventData.cluster,
    );

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });

    await assertEvent(
      ssvNetwork.write.reactivate([clusterEventData.operatorIds, minDepositAmount, clusterEventData.cluster], {
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

  it('RegisterValidator -> liquidate -> removeValidator -> deposit -> withdraw', async () => {
    let clusterEventData = await bulkRegisterValidators(
      1,
      2,
      DEFAULT_OPERATOR_IDS[4],
      minDepositAmount,
      firstCluster.cluster,
    );

    await mine(CONFIG.minimalBlocksBeforeLiquidation);

    clusterEventData.args = await liquidate(
      clusterEventData.args.owner,
      clusterEventData.args.operatorIds,
      clusterEventData.args.cluster,
    );
    await expect(clusterEventData.args.cluster.balance).to.be.equals(0);

    clusterEventData.args = await removeValidator(
      1,
      DataGenerator.publicKey(1),
      clusterEventData.args.operatorIds,
      clusterEventData.args.cluster,
    );

    clusterEventData.args = await deposit(
      1,
      clusterEventData.args.owner,
      clusterEventData.args.operatorIds,
      minDepositAmount,
      clusterEventData.args.cluster,
    );
    await expect(clusterEventData.args.cluster.balance).to.be.equals(minDepositAmount); // shrink

    await expect(
      ssvNetwork.write.withdraw([clusterEventData.args.operatorIds, minDepositAmount, clusterEventData.args.cluster], {
        account: owners[1].account,
      }),
    ).to.be.rejectedWith('ClusterIsLiquidated');
  });

  it('Withdraw -> liquidate -> deposit -> reactivate', async () => {
    await mine(2);

    const withdrawAmount: BigInt = 20000000n;
    let clusterEventData = await withdraw(1, firstCluster.operatorIds, withdrawAmount, firstCluster.cluster);
    expect(
      await ssvViews.read.getBalance([
        owners[1].account.address,
        clusterEventData.operatorIds,
        clusterEventData.cluster,
      ]),
    ).to.be.equal(minDepositAmount * 2n - withdrawAmount - burnPerBlock * 3n);

    await mine(CONFIG.minimalBlocksBeforeLiquidation - 2);

    clusterEventData = await liquidate(clusterEventData.owner, clusterEventData.operatorIds, clusterEventData.cluster);
    await expect(
      ssvViews.read.getBalance([owners[1].account.address, clusterEventData.operatorIds, clusterEventData.cluster]),
    ).to.be.rejectedWith('ClusterIsLiquidated');

    clusterEventData = await deposit(
      1,
      clusterEventData.owner,
      clusterEventData.operatorIds,
      minDepositAmount,
      clusterEventData.cluster,
    );

    clusterEventData = await reactivate(1, clusterEventData.operatorIds, minDepositAmount, clusterEventData.cluster);
    expect(
      await ssvViews.read.getBalance([
        owners[1].account.address,
        clusterEventData.operatorIds,
        clusterEventData.cluster,
      ]),
    ).to.be.equal(minDepositAmount * 2n);

    await mine(2);
    expect(
      await ssvViews.read.getBalance([
        owners[1].account.address,
        clusterEventData.operatorIds,
        clusterEventData.cluster,
      ]),
    ).to.be.equal(minDepositAmount * 2n - burnPerBlock * 2n);
  });

  it('Remove validator -> withdraw -> try liquidate reverts "ClusterNotLiquidatable"', async () => {
    let clusterEventData = (
      await bulkRegisterValidators(2, 1, DEFAULT_OPERATOR_IDS[4], minDepositAmount, {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0n,
        active: true,
      })
    ).args;

    await mine(CONFIG.minimalBlocksBeforeLiquidation - 10);

    const remove = await trackGas(
      ssvNetwork.write.removeValidator(
        [DataGenerator.publicKey(2), clusterEventData.operatorIds, clusterEventData.cluster],
        { account: owners[2].account },
      ),
    );
    clusterEventData = remove.eventsByName.ValidatorRemoved[0].args;

    let balance = await ssvViews.read.getBalance([
      owners[2].account.address,
      clusterEventData.operatorIds,
      clusterEventData.cluster,
    ]);

    clusterEventData = await withdraw(
      2,
      clusterEventData.operatorIds,
      (balance - BigInt(CONFIG.minimumLiquidationCollateral)) * (101n / 100n),
      clusterEventData.cluster,
    );

    await expect(
      ssvNetwork.write.liquidate([clusterEventData.owner, clusterEventData.operatorIds, clusterEventData.cluster]),
    ).to.be.rejectedWith('ClusterNotLiquidatable');
  });
});

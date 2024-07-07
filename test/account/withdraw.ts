// Declare imports
import {
  owners,
  initializeContract,
  registerOperators,
  coldRegisterValidator,
  bulkRegisterValidators,
  deposit,
  withdraw,
  removeValidator,
  DataGenerator,
  CONFIG,
  DEFAULT_OPERATOR_IDS,
} from '../helpers/contract-helpers';
import { assertEvent } from '../helpers/utils/test';
import { trackGas, GasGroup } from '../helpers/gas-usage';

import { mine, loadFixture } from '@nomicfoundation/hardhat-toolbox-viem/network-helpers';
import { getAddress } from 'viem';
import { expect } from 'chai';

// Declare globals
let ssvNetwork: any, ssvViews: any, ssvToken: any, cluster1: any, minDepositAmount: BigInt;

describe('Withdraw Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = await initializeContract();
    ssvNetwork = metadata.ssvNetwork;
    ssvViews = metadata.ssvNetworkViews;
    ssvToken = metadata.ssvToken;

    // Register operators
    await registerOperators(0, 14, CONFIG.minimalOperatorFee);

    minDepositAmount = (BigInt(CONFIG.minimalBlocksBeforeLiquidation) + 10n) * CONFIG.minimalOperatorFee * 4n;

    // cold register
    await coldRegisterValidator();

    cluster1 = (
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

  it('Withdraw from cluster emits "ClusterWithdrawn"', async () => {
    await assertEvent(
      ssvNetwork.write.withdraw([cluster1.operatorIds, CONFIG.minimalOperatorFee, cluster1.cluster], {
        account: owners[4].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'ClusterWithdrawn',
          argNames: ['owner', 'value'],
          argValuesList: [[getAddress(owners[4].account.address), CONFIG.minimalOperatorFee]],
        },
      ],
    );
  });

  it('Withdraw from cluster gas limits', async () => {
    await trackGas(
      ssvNetwork.write.withdraw([cluster1.operatorIds, CONFIG.minimalOperatorFee, cluster1.cluster], {
        account: owners[4].account,
      }),
      [GasGroup.WITHDRAW_CLUSTER_BALANCE],
    );
  });

  it('Withdraw from operator balance emits "OperatorWithdrawn"', async () => {
    await assertEvent(ssvNetwork.write.withdrawOperatorEarnings([1, CONFIG.minimalOperatorFee]), [
      {
        contract: ssvNetwork,
        eventName: 'OperatorWithdrawn',
      },
    ]);
  });

  it('Withdraw from operator balance gas limits', async () => {
    await trackGas(ssvNetwork.write.withdrawOperatorEarnings([1, CONFIG.minimalOperatorFee]), [
      GasGroup.WITHDRAW_OPERATOR_BALANCE,
    ]);
  });

  it('Withdraw the total operator balance emits "OperatorWithdrawn"', async () => {
    await assertEvent(ssvNetwork.write.withdrawAllOperatorEarnings([1]), [
      {
        contract: ssvNetwork,
        eventName: 'OperatorWithdrawn',
      },
    ]);
  });

  it('Withdraw the total operator balance gas limits', async () => {
    await trackGas(ssvNetwork.write.withdrawAllOperatorEarnings([1]), [GasGroup.WITHDRAW_OPERATOR_BALANCE]);
  });

  it('Withdraw from a cluster that has a removed operator emits "ClusterWithdrawn"', async () => {
    await ssvNetwork.write.removeOperator([1]);
    await assertEvent(
      ssvNetwork.write.withdraw([cluster1.operatorIds, CONFIG.minimalOperatorFee, cluster1.cluster], {
        account: owners[4].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'ClusterWithdrawn',
        },
      ],
    );
  });

  it('Withdraw more than the cluster balance reverts "InsufficientBalance"', async () => {
    await expect(
      ssvNetwork.write.withdraw([cluster1.operatorIds, minDepositAmount, cluster1.cluster], {
        account: owners[4].account,
      }),
    ).to.be.rejectedWith('InsufficientBalance');
  });

  it('Sequentially withdraw more than the cluster balance reverts "InsufficientBalance"', async () => {
    const burnPerBlock = CONFIG.minimalOperatorFee * 4n;

    cluster1 = await deposit(1, cluster1.owner, cluster1.operatorIds, minDepositAmount * 2n, cluster1.cluster);
    expect(
      await ssvViews.read.getBalance([owners[4].account.address, cluster1.operatorIds, cluster1.cluster]),
    ).to.equal(minDepositAmount * 3n - burnPerBlock * 2n);

    cluster1 = await withdraw(4, cluster1.operatorIds, minDepositAmount, cluster1.cluster);
    expect(
      await ssvViews.read.getBalance([owners[4].account.address, cluster1.operatorIds, cluster1.cluster]),
    ).to.equal(minDepositAmount * 2n - burnPerBlock * 3n);

    cluster1 = await withdraw(4, cluster1.operatorIds, minDepositAmount, cluster1.cluster);
    expect(
      await ssvViews.read.getBalance([owners[4].account.address, cluster1.operatorIds, cluster1.cluster]),
    ).to.equal(minDepositAmount - burnPerBlock * 4n);

    await expect(
      ssvNetwork.write.withdraw([cluster1.operatorIds, minDepositAmount, cluster1.cluster], {
        account: owners[4].account,
      }),
    ).to.be.rejectedWith('InsufficientBalance');
  });

  it('Withdraw from a liquidatable cluster reverts "InsufficientBalance" (liquidation threshold)', async () => {
    await mine(20);
    await expect(
      ssvNetwork.write.withdraw([cluster1.operatorIds, 4000000000n, cluster1.cluster], {
        account: owners[4].account,
      }),
    ).to.be.rejectedWith('InsufficientBalance');
  });

  it('Withdraw from a liquidatable cluster reverts "InsufficientBalance" (liquidation collateral)', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation - 10);
    await expect(
      ssvNetwork.write.withdraw([cluster1.operatorIds, 7500000000n, cluster1.cluster], {
        account: owners[4].account,
      }),
    ).to.be.rejectedWith('InsufficientBalance');
  });

  it('Withdraw from a liquidatable cluster after liquidation period reverts "InsufficientBalance"', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation + 10);
    await expect(
      ssvNetwork.write.withdraw([cluster1.operatorIds, CONFIG.minimalOperatorFee, cluster1.cluster], {
        account: owners[4].account,
      }),
    ).to.be.rejectedWith('InsufficientBalance');
  });

  it('Withdraw balance from an operator I do not own reverts "CallerNotOwnerWithData"', async () => {
    await expect(
      ssvNetwork.write.withdrawOperatorEarnings([1, minDepositAmount], {
        account: owners[2].account,
      }),
    ).to.be.rejectedWith('CallerNotOwnerWithData');
  });

  it('Withdraw more than the operator balance reverts "InsufficientBalance"', async () => {
    await expect(ssvNetwork.write.withdrawOperatorEarnings([1, minDepositAmount])).to.be.rejectedWith(
      'InsufficientBalance',
    );
  });

  it('Sequentially withdraw more than the operator balance reverts "InsufficientBalance"', async () => {
    await ssvNetwork.write.withdrawOperatorEarnings([1, CONFIG.minimalOperatorFee * 3n]);

    expect(await ssvViews.read.getOperatorEarnings([1])).to.equal(
      CONFIG.minimalOperatorFee * 4n - CONFIG.minimalOperatorFee * 3n,
    );

    await ssvNetwork.write.withdrawOperatorEarnings([1, CONFIG.minimalOperatorFee * 3n]);
    expect(await ssvViews.read.getOperatorEarnings([1])).to.equal(
      CONFIG.minimalOperatorFee * 6n - CONFIG.minimalOperatorFee * 6n,
    );

    await expect(ssvNetwork.write.withdrawOperatorEarnings([1, CONFIG.minimalOperatorFee * 3n])).to.be.rejectedWith(
      'InsufficientBalance',
    );
  });

  it('Withdraw the total balance from an operator I do not own reverts "CallerNotOwnerWithData"', async () => {
    await expect(
      ssvNetwork.write.withdrawAllOperatorEarnings([12], {
        account: owners[2].account,
      }),
    ).to.be.rejectedWith('CallerNotOwnerWithData');
  });

  it('Withdraw more than the operator total balance reverts "InsufficientBalance"', async () => {
    await expect(ssvNetwork.write.withdrawOperatorEarnings([13, minDepositAmount])).to.be.rejectedWith(
      'InsufficientBalance',
    );
  });

  it('Withdraw from a cluster without validators', async () => {
    cluster1 = await removeValidator(4, DataGenerator.publicKey(1), cluster1.operatorIds, cluster1.cluster);
    const currentClusterBalance = minDepositAmount - CONFIG.minimalOperatorFee * 4n;

    await assertEvent(
      ssvNetwork.write.withdraw([cluster1.operatorIds, currentClusterBalance, cluster1.cluster], {
        account: owners[4].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'ClusterWithdrawn',
        },
      ],
    );
  });
});

// Declare imports
import {
  owners,
  initializeContract,
  registerOperators,
  coldRegisterValidator,
  bulkRegisterValidators,
  CONFIG,
  DEFAULT_OPERATOR_IDS,
} from '../helpers/contract-helpers';
import { assertEvent } from '../helpers/utils/test';

import { trackGas, GasGroup } from '../helpers/gas-usage';

import { mine } from '@nomicfoundation/hardhat-toolbox-viem/network-helpers';
import { expect } from 'chai';

// Declare globals
let ssvNetwork: any, ssvViews: any, ssvToken: any, cluster1: any, minDepositAmount: any;

describe('Deposit Tests', function () {
  beforeEach(async function () {
    // Initialize contract
    const metadata = await initializeContract();
    ssvNetwork = metadata.ssvNetwork;
    ssvViews = metadata.ssvNetworkViews;
    ssvToken = metadata.ssvToken;

    await registerOperators(0, 14, CONFIG.minimalOperatorFee);

    minDepositAmount = BigInt(CONFIG.minimalBlocksBeforeLiquidation + 10) * CONFIG.minimalOperatorFee * 4n;

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

  it('Deposit to a non liquidated cluster I own emits "ClusterDeposited"', async () => {
    expect(await ssvViews.read.isLiquidated([cluster1.owner, cluster1.operatorIds, cluster1.cluster])).to.equal(false);

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], {
      account: owners[4].account,
    });

    await assertEvent(
      ssvNetwork.write.deposit([owners[4].account.address, cluster1.operatorIds, minDepositAmount, cluster1.cluster], {
        account: owners[4].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'ClusterDeposited',
        },
      ],
    );
  });

  it('Deposit to a cluster I own gas limits', async () => {
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], {
      account: owners[4].account,
    });
    await trackGas(
      ssvNetwork.write.deposit([owners[4].account.address, cluster1.operatorIds, minDepositAmount, cluster1.cluster], {
        account: owners[4].account,
      }),
      [GasGroup.DEPOSIT],
    );
  });

  it('Deposit to a cluster I do not own emits "ClusterDeposited"', async () => {
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount]);

    await assertEvent(
      ssvNetwork.write.deposit([owners[4].account.address, cluster1.operatorIds, minDepositAmount, cluster1.cluster], {
        account: owners[0].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'ClusterDeposited',
        },
      ],
    );
  });

  it('Deposit to a cluster I do not own gas limits', async () => {
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount]);
    await trackGas(
      ssvNetwork.write.deposit([owners[4].account.address, cluster1.operatorIds, minDepositAmount, cluster1.cluster], {
        account: owners[0].account,
      }),
      [GasGroup.DEPOSIT],
    );
  });

  it('Deposit to a cluster I do not own with a cluster that does not exist reverts "ClusterDoesNotExists"', async () => {
    await expect(
      ssvNetwork.write.deposit([owners[1].account.address, [1, 2, 4, 5], minDepositAmount, cluster1.cluster], {
        account: owners[4].account,
      }),
    ).to.be.rejectedWith('ClusterDoesNotExists');
  });

  it('Deposit to a liquidated cluster emits "ClusterDeposited"', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation);

    const liquidatedCluster = await trackGas(
      ssvNetwork.write.liquidate([cluster1.owner, cluster1.operatorIds, cluster1.cluster]),
    );
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;

    expect(await ssvViews.read.isLiquidated([cluster1.owner, cluster1.operatorIds, updatedCluster.cluster])).to.equal(
      true,
    );

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], {
      account: owners[4].account,
    });

    await assertEvent(
      ssvNetwork.write.deposit(
        [owners[4].account.address, cluster1.operatorIds, minDepositAmount, updatedCluster.cluster],
        {
          account: owners[4].account,
        },
      ),
      [
        {
          contract: ssvNetwork,
          eventName: 'ClusterDeposited',
        },
      ],
    );
  });

  it('Deposit to a cluster I do own with a cluster that does not exist reverts "ClusterDoesNotExists"', async () => {
    await expect(
      ssvNetwork.write.deposit([owners[1].account.address, cluster1.operatorIds, minDepositAmount, cluster1.cluster], {
        account: owners[1].account,
      }),
    ).to.be.rejectedWith('ClusterDoesNotExists');
  });
});

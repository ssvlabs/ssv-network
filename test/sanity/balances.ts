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
import { trackGas } from '../helpers/gas-usage';

import { mine } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';

let ssvNetwork: any,
  ssvViews: any,
  ssvToken: any,
  cluster1: any,
  minDepositAmount: BigInt,
  burnPerBlock: BigInt,
  networkFee: BigInt,
  initNetworkFeeBalance: BigInt;

// Declare globals
describe('Balance Tests', () => {
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

    // Set network fee
    await ssvNetwork.write.updateNetworkFee([networkFee]);

    // Register validators
    // cold register
    await coldRegisterValidator();

    cluster1 = (
      await bulkRegisterValidators(4, 1, DEFAULT_OPERATOR_IDS[4], minDepositAmount, {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0n,
        active: true,
      })
    ).args;

    initNetworkFeeBalance = await ssvViews.read.getNetworkEarnings();
  });

  it('Check cluster balance with removing operator', async () => {
    const operatorIds = cluster1.operatorIds;
    const cluster = cluster1.cluster;
    let prevBalance: any;

    for (let i = 1; i <= 13; i++) {
      await ssvNetwork.write.removeOperator([i]);
      let balance = await ssvViews.read.getBalance([owners[4].account.address, operatorIds, cluster]);
      let networkFee = await ssvViews.read.getNetworkFee();
      if (i > 4) {
        expect(prevBalance - balance).to.equal(networkFee);
      }
      prevBalance = balance;
    }
  });

  it('Check cluster balance after removing operator, progress blocks and confirm', async () => {
    const operatorIds = cluster1.operatorIds;
    const cluster = cluster1.cluster;
    const owner = cluster1.owner;

    // get difference of account balance between blocks before removing operator
    let balance1 = await ssvViews.read.getBalance([owners[4].account.address, operatorIds, cluster]);
    await mine(1);
    let balance2 = await ssvViews.read.getBalance([owners[4].account.address, operatorIds, cluster]);

    await ssvNetwork.write.removeOperator([1]);

    // get difference of account balance between blocks after removing operator
    let balance3 = await ssvViews.read.getBalance([owners[4].account.address, operatorIds, cluster]);
    await mine(1);
    let balance4 = await ssvViews.read.getBalance([owners[4].account.address, operatorIds, cluster]);

    // check the reducing the balance after removing operator (only 3 operators)
    expect(balance1 - balance2).to.be.greaterThan(balance3 - balance4);

    // try to register a new validator in the new cluster with the same operator Ids, check revert
    const newOperatorIds = operatorIds.map((id: any) => id);
    await expect(
      bulkRegisterValidators(1, 1, newOperatorIds, minDepositAmount, {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0n,
        active: true,
      }),
    ).to.be.rejectedWith('OperatorDoesNotExist');

    // try to remove the validator again and check the operator removed is skipped
    const removed = await trackGas(
      ssvNetwork.write.removeValidator([DataGenerator.publicKey(1), operatorIds, cluster], {
        account: owners[4].account,
      }),
    );
    const cluster2 = removed.eventsByName.ValidatorRemoved[0];

    // try to liquidate
    const liquidated = await trackGas(
      ssvNetwork.write.liquidate([owner, operatorIds, cluster2.args.cluster], { account: owners[4].account }),
    );
    const cluster3 = liquidated.eventsByName.ClusterLiquidated[0];

    await expect(
      ssvViews.read.getBalance([owners[4].account.address, operatorIds, cluster3.args.cluster]),
    ).to.be.rejectedWith('ClusterIsLiquidated');
  });

  it('Check cluster balance in three blocks, one after the other', async () => {
    await mine(1);
    expect(
      await ssvViews.read.getBalance([owners[4].account.address, cluster1.operatorIds, cluster1.cluster]),
    ).to.equal(minDepositAmount - burnPerBlock);
    await mine(1);
    expect(
      await ssvViews.read.getBalance([owners[4].account.address, cluster1.operatorIds, cluster1.cluster]),
    ).to.equal(minDepositAmount - burnPerBlock * 2n);
    await mine(1);
    expect(
      await ssvViews.read.getBalance([owners[4].account.address, cluster1.operatorIds, cluster1.cluster]),
    ).to.equal(minDepositAmount - burnPerBlock * 3n);
  });

  it('Check cluster balance in two and twelve blocks, after network fee updates', async () => {
    await mine(1);
    expect(
      await ssvViews.read.getBalance([owners[4].account.address, cluster1.operatorIds, cluster1.cluster]),
    ).to.equal(minDepositAmount - burnPerBlock);
    const newBurnPerBlock = burnPerBlock + networkFee;
    await ssvNetwork.write.updateNetworkFee([networkFee * 2n]);

    await mine(1);
    expect(
      await ssvViews.read.getBalance([owners[4].account.address, cluster1.operatorIds, cluster1.cluster]),
    ).to.equal(minDepositAmount - burnPerBlock * 2n - newBurnPerBlock);
    await mine(1);
    expect(
      await ssvViews.read.getBalance([owners[4].account.address, cluster1.operatorIds, cluster1.cluster]),
    ).to.equal(minDepositAmount - burnPerBlock * 2n - newBurnPerBlock * 2n);
    await mine(10);
    expect(
      await ssvViews.read.getBalance([owners[4].account.address, cluster1.operatorIds, cluster1.cluster]),
    ).to.equal(minDepositAmount - burnPerBlock * 2n - newBurnPerBlock * 12n);
  });

  it('Check DAO earnings in three blocks, one after the other', async () => {
    await mine(1);
    expect((await ssvViews.read.getNetworkEarnings()) - initNetworkFeeBalance).to.equal(networkFee * 2n);
    await mine(1);
    expect((await ssvViews.read.getNetworkEarnings()) - initNetworkFeeBalance).to.equal(networkFee * 4n);
    await mine(1);
    expect((await ssvViews.read.getNetworkEarnings()) - initNetworkFeeBalance).to.equal(networkFee * 6n);
  });

  it('Check DAO earnings in two and twelve blocks, after network fee updates', async () => {
    await mine(1);
    expect((await ssvViews.read.getNetworkEarnings()) - initNetworkFeeBalance).to.equal(networkFee * 2n);
    const newNetworkFee = networkFee * 2n;
    await ssvNetwork.write.updateNetworkFee([newNetworkFee]);
    await mine(1);
    expect((await ssvViews.read.getNetworkEarnings()) - initNetworkFeeBalance).to.equal(
      networkFee * 4n + newNetworkFee * 2n,
    );
    await mine(1);
    expect((await ssvViews.read.getNetworkEarnings()) - initNetworkFeeBalance).to.equal(
      networkFee * 4n + newNetworkFee * 4n,
    );
    await mine(10);
    expect((await ssvViews.read.getNetworkEarnings()) - initNetworkFeeBalance).to.equal(
      networkFee * 4n + newNetworkFee * 24n,
    );
  });

  it('Check operators earnings in three blocks, one after the other', async () => {
    await mine(1);

    expect(await ssvViews.read.getOperatorEarnings([1])).to.equal(
      CONFIG.minimalOperatorFee * 2n + CONFIG.minimalOperatorFee * 2n,
    );
    expect(await ssvViews.read.getOperatorEarnings([2])).to.equal(
      CONFIG.minimalOperatorFee * 2n + CONFIG.minimalOperatorFee * 2n,
    );
    expect(await ssvViews.read.getOperatorEarnings([3])).to.equal(
      CONFIG.minimalOperatorFee * 2n + CONFIG.minimalOperatorFee * 2n,
    );
    expect(await ssvViews.read.getOperatorEarnings([4])).to.equal(
      CONFIG.minimalOperatorFee * 2n + CONFIG.minimalOperatorFee * 2n,
    );
    await mine(1);
    expect(await ssvViews.read.getOperatorEarnings([1])).to.equal(
      CONFIG.minimalOperatorFee * 4n + CONFIG.minimalOperatorFee * 2n,
    );
    expect(await ssvViews.read.getOperatorEarnings([2])).to.equal(
      CONFIG.minimalOperatorFee * 4n + CONFIG.minimalOperatorFee * 2n,
    );
    expect(await ssvViews.read.getOperatorEarnings([3])).to.equal(
      CONFIG.minimalOperatorFee * 4n + CONFIG.minimalOperatorFee * 2n,
    );
    expect(await ssvViews.read.getOperatorEarnings([4])).to.equal(
      CONFIG.minimalOperatorFee * 4n + CONFIG.minimalOperatorFee * 2n,
    );
    await mine(1);
    expect(await ssvViews.read.getOperatorEarnings([1])).to.equal(
      CONFIG.minimalOperatorFee * 6n + CONFIG.minimalOperatorFee * 2n,
    );
    expect(await ssvViews.read.getOperatorEarnings([2])).to.equal(
      CONFIG.minimalOperatorFee * 6n + CONFIG.minimalOperatorFee * 2n,
    );
    expect(await ssvViews.read.getOperatorEarnings([3])).to.equal(
      CONFIG.minimalOperatorFee * 6n + CONFIG.minimalOperatorFee * 2n,
    );
    expect(await ssvViews.read.getOperatorEarnings([4])).to.equal(
      CONFIG.minimalOperatorFee * 6n + CONFIG.minimalOperatorFee * 2n,
    );
  });

  it('Check cluster balance with removed operator', async () => {
    await ssvNetwork.write.removeOperator([1]);
    expect(
      await ssvViews.read.getBalance([owners[4].account.address, cluster1.operatorIds, cluster1.cluster]),
    ).not.equals(0);
  });

  it('Check cluster balance with not enough balance', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation + 10);
    expect(
      await ssvViews.read.getBalance([owners[4].account.address, cluster1.operatorIds, cluster1.cluster]),
    ).to.be.equals(0);
  });

  it('Check cluster balance in a non liquidated cluster', async () => {
    await mine(1);
    expect(
      await ssvViews.read.getBalance([owners[4].account.address, cluster1.operatorIds, cluster1.cluster]),
    ).to.equal(minDepositAmount - burnPerBlock);
  });

  it('Check cluster balance in a liquidated cluster reverts "ClusterIsLiquidated"', async () => {
    await mine(CONFIG.minimalBlocksBeforeLiquidation - 1);

    const liquidatedCluster = await trackGas(
      ssvNetwork.write.liquidate([cluster1.owner, cluster1.operatorIds, cluster1.cluster], {
        account: owners[4].account,
      }),
    );
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;

    expect(
      await ssvViews.read.isLiquidated([updatedCluster.owner, updatedCluster.operatorIds, updatedCluster.cluster]),
    ).to.equal(true);
    await expect(
      ssvViews.read.getBalance([owners[4].account.address, updatedCluster.operatorIds, updatedCluster.cluster]),
    ).to.be.rejectedWith('ClusterIsLiquidated');
  });

  it('Check operator earnings, cluster balances and network earnings', async () => {
    // 2 exisiting clusters
    // update network fee
    // register a new validator with some shared operators
    // update network fee

    // progress blocks in the process
    await mine(1);

    expect(await ssvViews.read.getOperatorEarnings([1])).to.equal(
      CONFIG.minimalOperatorFee * 3n + CONFIG.minimalOperatorFee,
    );
    expect(
      await ssvViews.read.getBalance([owners[4].account.address, cluster1.operatorIds, cluster1.cluster]),
    ).to.equal(minDepositAmount - burnPerBlock);
    expect((await ssvViews.read.getNetworkEarnings()) - initNetworkFeeBalance).to.equal(networkFee * 2n);

    const newNetworkFee = networkFee * 2n;
    await ssvNetwork.write.updateNetworkFee([newNetworkFee]);

    const newBurnPerBlock = CONFIG.minimalOperatorFee * 4n + newNetworkFee;
    await mine(1);

    expect(
      await ssvViews.read.getBalance([owners[4].account.address, cluster1.operatorIds, cluster1.cluster]),
    ).to.equal(minDepositAmount - burnPerBlock * 2n - newBurnPerBlock);
    expect((await ssvViews.read.getNetworkEarnings()) - initNetworkFeeBalance).to.equal(
      networkFee * 4n + newNetworkFee * 2n,
    );

    const minDep2 = minDepositAmount * 2n;

    const cluster2 = await bulkRegisterValidators(4, 1, [3, 4, 5, 6], minDep2, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    await mine(2);

    expect(await ssvViews.read.getOperatorEarnings([1])).to.equal(
      CONFIG.minimalOperatorFee * 8n + CONFIG.minimalOperatorFee * 8n,
    );
    expect(await ssvViews.read.getOperatorEarnings([3])).to.equal(
      CONFIG.minimalOperatorFee * 8n + CONFIG.minimalOperatorFee * 8n + CONFIG.minimalOperatorFee * 2n,
    );

    expect(await ssvViews.read.getOperatorEarnings([5])).to.equal(CONFIG.minimalOperatorFee * 2n);
    expect(
      await ssvViews.read.getBalance([owners[4].account.address, cluster1.operatorIds, cluster1.cluster]),
    ).to.equal(minDepositAmount - burnPerBlock * 2n - newBurnPerBlock * 5n);
    expect(
      await ssvViews.read.getBalance([owners[4].account.address, cluster2.args.operatorIds, cluster2.args.cluster]),
    ).to.equal(minDep2 - newBurnPerBlock * 2n);

    // cold cluster + cluster1 * networkFee (4) + (cold cluster + cluster1 * newNetworkFee (5 + 5)) + cluster2 * newNetworkFee (2)
    expect((await ssvViews.read.getNetworkEarnings()) - initNetworkFeeBalance).to.equal(
      networkFee * 4n + newNetworkFee * 5n + newNetworkFee * 4n + newNetworkFee * 3n,
    );

    await ssvNetwork.write.updateNetworkFee([networkFee]);
    await mine(4);

    expect(
      await ssvViews.read.getBalance([owners[4].account.address, cluster1.operatorIds, cluster1.cluster]),
    ).to.equal(minDepositAmount - burnPerBlock * 2n - newBurnPerBlock * 6n - burnPerBlock * 4n);
    expect(
      await ssvViews.read.getBalance([owners[4].account.address, cluster2.args.operatorIds, cluster2.args.cluster]),
    ).to.equal(minDep2 - newBurnPerBlock * 3n - burnPerBlock * 4n);

    expect(await ssvViews.read.getOperatorEarnings([1])).to.equal(
      CONFIG.minimalOperatorFee * 14n + CONFIG.minimalOperatorFee * 12n,
    );
    expect(await ssvViews.read.getOperatorEarnings([3])).to.equal(
      CONFIG.minimalOperatorFee * 14n + CONFIG.minimalOperatorFee * 12n + CONFIG.minimalOperatorFee * 7n,
    );
    expect(await ssvViews.read.getOperatorEarnings([5])).to.equal(
      CONFIG.minimalOperatorFee * 2n + CONFIG.minimalOperatorFee * 5n,
    );

    // cold cluster + cluster1 * networkFee (4) + (cold cluster + cluster1 * newNetworkFee (6 + 6)) + cluster2 * newNetworkFee (3) + (cold cluster + cluster1 + cluster2 * networkFee (4 + 4 + 4))
    expect((await ssvViews.read.getNetworkEarnings()) - initNetworkFeeBalance).to.equal(
      networkFee * 4n + newNetworkFee * 6n + newNetworkFee * 6n + newNetworkFee * 3n + networkFee * 12n,
    );
  });

  it('Check cluster balance after withdraw and deposit', async () => {
    await mine(1);
    expect(
      await ssvViews.read.getBalance([owners[4].account.address, cluster1.operatorIds, cluster1.cluster]),
    ).to.equal(minDepositAmount - burnPerBlock);

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount * 2n], {
      account: owners[4].account,
    });
    let validator2 = await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(3),
          DEFAULT_OPERATOR_IDS[4],
          await DataGenerator.shares(4, 3, DEFAULT_OPERATOR_IDS[4]),
          minDepositAmount * 2n,
          cluster1.cluster,
        ],
        {
          account: owners[4].account,
        },
      ),
    );
    let cluster2 = validator2.eventsByName.ValidatorAdded[0];

    expect(
      await ssvViews.read.getBalance([owners[4].account.address, cluster2.args.operatorIds, cluster2.args.cluster]),
    ).to.equal(minDepositAmount * 3n - burnPerBlock * 3n);

    validator2 = await trackGas(
      ssvNetwork.write.withdraw([cluster2.args.operatorIds, CONFIG.minimalOperatorFee, cluster2.args.cluster], {
        account: owners[4].account,
      }),
    );
    cluster2 = validator2.eventsByName.ClusterWithdrawn[0];

    expect(
      await ssvViews.read.getBalance([owners[4].account.address, cluster2.args.operatorIds, cluster2.args.cluster]),
    ).to.equal(minDepositAmount * 3n - burnPerBlock * 4n - burnPerBlock - CONFIG.minimalOperatorFee);

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], {
      account: owners[4].account,
    });
    validator2 = await trackGas(
      ssvNetwork.write.deposit(
        [owners[4].account.address, cluster2.args.operatorIds, CONFIG.minimalOperatorFee, cluster2.args.cluster],
        {
          account: owners[4].account,
        },
      ),
    );
    cluster2 = validator2.eventsByName.ClusterDeposited[0];
    await mine(2);

    expect(
      await ssvViews.read.getBalance([owners[4].account.address, cluster2.args.operatorIds, cluster2.args.cluster]),
    ).to.equal(
      minDepositAmount * 3n -
        burnPerBlock * 8n -
        burnPerBlock * 5n -
        CONFIG.minimalOperatorFee +
        CONFIG.minimalOperatorFee,
    );
  });

  it('Check cluster and operators balance after 10 validators bulk registration and removal', async () => {
    const clusterDeposit = minDepositAmount * 10n;

    // Register 10 validators in a cluster
    const { args, pks } = await bulkRegisterValidators(2, 10, [5, 6, 7, 8], minDepositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    await mine(2);

    // check cluster balance
    expect(await ssvViews.read.getBalance([owners[2].account.address, args.operatorIds, args.cluster])).to.equal(
      clusterDeposit - burnPerBlock * 10n * 2n,
    );

    // check operators' earnings
    expect(await ssvViews.read.getOperatorEarnings([5])).to.equal(CONFIG.minimalOperatorFee * 10n * 2n);
    expect(await ssvViews.read.getOperatorEarnings([6])).to.equal(CONFIG.minimalOperatorFee * 10n * 2n);
    expect(await ssvViews.read.getOperatorEarnings([7])).to.equal(CONFIG.minimalOperatorFee * 10n * 2n);
    expect(await ssvViews.read.getOperatorEarnings([8])).to.equal(CONFIG.minimalOperatorFee * 10n * 2n);

    // bulk remove 5 validators
    const result = await trackGas(
      ssvNetwork.write.bulkRemoveValidator([pks.slice(0, 5), args.operatorIds, args.cluster], {
        account: owners[2].account,
      }),
    );

    const removed = result.eventsByName.ValidatorRemoved[0].args;

    await mine(2);

    // check cluster balance
    expect(await ssvViews.read.getBalance([owners[2].account.address, removed.operatorIds, removed.cluster])).to.equal(
      clusterDeposit - burnPerBlock * 10n * 3n - burnPerBlock * 5n * 2n,
    );

    // check operators' earnings
    expect(await ssvViews.read.getOperatorEarnings([5])).to.equal(
      CONFIG.minimalOperatorFee * 10n * 3n + CONFIG.minimalOperatorFee * 5n * 2n,
    );
    expect(await ssvViews.read.getOperatorEarnings([6])).to.equal(
      CONFIG.minimalOperatorFee * 10n * 3n + CONFIG.minimalOperatorFee * 5n * 2n,
    );
    expect(await ssvViews.read.getOperatorEarnings([7])).to.equal(
      CONFIG.minimalOperatorFee * 10n * 3n + CONFIG.minimalOperatorFee * 5n * 2n,
    );
    expect(await ssvViews.read.getOperatorEarnings([8])).to.equal(
      CONFIG.minimalOperatorFee * 10n * 3n + CONFIG.minimalOperatorFee * 5n * 2n,
    );
  });

  it('Remove validators from a liquidated cluster', async () => {
    const clusterDeposit = minDepositAmount * 10n;
    // 3 operators cluster burnPerBlock
    const newBurnPerBlock = CONFIG.minimalOperatorFee * 3n + networkFee;

    // register 10 validators
    const { args, pks } = await bulkRegisterValidators(2, 10, [5, 6, 7, 8], minDepositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0n,
      active: true,
    });

    await mine(2);

    // remove one operator
    await ssvNetwork.write.removeOperator([8]);

    await mine(2);

    // bulk remove 10 validators
    const result = await trackGas(
      ssvNetwork.write.bulkRemoveValidator([pks, args.operatorIds, args.cluster], {
        account: owners[2].account,
      }),
    );
    const removed = result.eventsByName.ValidatorRemoved[0].args;

    await mine(2);

    // check operators' balances
    expect(await ssvViews.read.getOperatorEarnings([5])).to.equal(CONFIG.minimalOperatorFee * 10n * 6n);
    expect(await ssvViews.read.getOperatorEarnings([6])).to.equal(CONFIG.minimalOperatorFee * 10n * 6n);
    expect(await ssvViews.read.getOperatorEarnings([7])).to.equal(CONFIG.minimalOperatorFee * 10n * 6n);
    expect(await ssvViews.read.getOperatorEarnings([8])).to.equal(0);

    // check cluster balance
    expect(await ssvViews.read.getBalance([owners[2].account.address, removed.operatorIds, removed.cluster])).to.equal(
      clusterDeposit - burnPerBlock * 10n * 3n - newBurnPerBlock * 10n * 3n,
    );
  });
});

describe('Balance Tests (reduce fee)', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = await initializeContract();
    ssvNetwork = metadata.ssvNetwork;
    ssvViews = metadata.ssvNetworkViews;
    ssvToken = metadata.ssvToken;

    // Register operators
    await registerOperators(0, 14, CONFIG.minimalOperatorFee * 2n);

    networkFee = CONFIG.minimalOperatorFee;
    burnPerBlock = CONFIG.minimalOperatorFee * 2n * 4n + networkFee;
    minDepositAmount = BigInt(CONFIG.minimalBlocksBeforeLiquidation) * burnPerBlock;

    // Set network fee
    await ssvNetwork.write.updateNetworkFee([networkFee]);

    // Register validators
    // cold register
    await coldRegisterValidator();

    cluster1 = (
      await bulkRegisterValidators(4, 1, DEFAULT_OPERATOR_IDS[4], minDepositAmount, {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0n,
        active: true,
      })
    ).args;
  });

  it('Check operator earnings and cluster balance when reducing operator fee"', async () => {
    const prevOperatorFee = CONFIG.minimalOperatorFee * 2n;
    const newFee = CONFIG.minimalOperatorFee;
    await ssvNetwork.write.reduceOperatorFee([1, newFee]);

    await mine(2);

    expect(await ssvViews.read.getOperatorEarnings([1])).to.equal(
      prevOperatorFee * 4n + (prevOperatorFee + newFee * 2n),
    );
    expect(
      await ssvViews.read.getBalance([owners[4].account.address, cluster1.operatorIds, cluster1.cluster]),
    ).to.equal(minDepositAmount - burnPerBlock - (prevOperatorFee * 3n + networkFee) * 2n - newFee * 2n);
  });
});

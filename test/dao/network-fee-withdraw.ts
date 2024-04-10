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

import { mine } from '@nomicfoundation/hardhat-network-helpers';

import { expect } from 'chai';

// Declare globals
let ssvNetwork: any, ssvViews: any, minDepositAmount: BigInt, burnPerBlock: BigInt, networkFee: BigInt;

describe('DAO Network Fee Withdraw Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = await initializeContract();
    ssvNetwork = metadata.ssvNetwork;
    ssvViews = metadata.ssvNetworkViews;

    // Define minumum allowed network fee to pass shrinkable validation
    networkFee = CONFIG.minimalOperatorFee;

    // Register operators
    await registerOperators(0, 14, CONFIG.minimalOperatorFee);

    burnPerBlock = CONFIG.minimalOperatorFee * 4n + networkFee;
    minDepositAmount = BigInt(CONFIG.minimalBlocksBeforeLiquidation) * burnPerBlock;

    // Set network fee
    await ssvNetwork.write.updateNetworkFee([networkFee]);

    // Register validators
    // cold register
    await coldRegisterValidator();

    await bulkRegisterValidators(
      4,
      1,
      DEFAULT_OPERATOR_IDS[4],
      minDepositAmount,
      { validatorCount: 0, networkFeeIndex: 0, index: 0, balance: 0n, active: true },
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE],
    );
    await mine(10);
  });

  it('Withdraw network earnings emits "NetworkEarningsWithdrawn"', async () => {
    const amount = await ssvViews.read.getNetworkEarnings();

    await assertEvent(ssvNetwork.write.withdrawNetworkEarnings([amount]), [
      {
        contract: ssvNetwork,
        eventName: 'NetworkEarningsWithdrawn',
        argNames: ['value', 'recipient'],
        argValuesList: [[amount, owners[0].account.address]],
      },
    ]);
  });

  it('Withdraw network earnings gas limits', async () => {
    const amount = await ssvViews.read.getNetworkEarnings();
    await trackGas(ssvNetwork.write.withdrawNetworkEarnings([amount]), [GasGroup.WITHDRAW_NETWORK_EARNINGS]);
  });

  it('Get withdrawable network earnings', async () => {
    expect(await ssvViews.read.getNetworkEarnings()).to.above(0);
  });

  it('Get withdrawable network earnings as not owner', async () => {
    expect(
      await ssvViews.read.getNetworkEarnings([], {
        account: owners[3].account,
      }),
    ).to.equal(CONFIG.minimalOperatorFee * 12n + CONFIG.minimalOperatorFee * 10n);
  });

  it('Withdraw network earnings with not enough balance reverts "InsufficientBalance"', async () => {
    const amount = (await ssvViews.read.getNetworkEarnings()) * 2n;
    await expect(ssvNetwork.write.withdrawNetworkEarnings([amount])).to.be.rejectedWith('InsufficientBalance');
  });

  it('Withdraw network earnings from an address thats not the DAO reverts "caller is not the owner"', async () => {
    const amount = await ssvViews.read.getNetworkEarnings();
    await expect(
      ssvNetwork.write.withdrawNetworkEarnings([amount], {
        account: owners[3].account,
      }),
    ).to.be.rejectedWith('Ownable: caller is not the owner');
  });

  it('Withdraw network earnings providing UINT64 max value reverts "Max value exceeded"', async () => {
    const amount = 2n ** 64n * 100000000n;
    await expect(ssvNetwork.write.withdrawNetworkEarnings([amount])).to.be.rejectedWith('Max value exceeded');
  });

  it('Withdraw network earnings sequentially when not enough balance reverts "InsufficientBalance"', async () => {
    const amount = (await ssvViews.read.getNetworkEarnings()) / 2n;

    await ssvNetwork.write.withdrawNetworkEarnings([amount]);
    expect(await ssvViews.read.getNetworkEarnings()).to.be.equals(networkFee * 13n + networkFee * 11n - amount);

    await ssvNetwork.write.withdrawNetworkEarnings([amount]);
    expect(await ssvViews.read.getNetworkEarnings()).to.be.equals(networkFee * 14n + networkFee * 12n - amount * 2n);

    await expect(ssvNetwork.write.withdrawNetworkEarnings([amount])).to.be.rejectedWith('InsufficientBalance');
  });
});

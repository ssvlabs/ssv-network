// Declare imports
import { owners, initializeContract, CONFIG } from '../helpers/contract-helpers';
import { assertEvent } from '../helpers/utils/test';

import { trackGas, GasGroup } from '../helpers/gas-usage';

import { expect } from 'chai';

// Declare globals
let ssvNetwork: any, ssvViews: any, networkFee: any;

describe('Liquidation Threshold Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = await initializeContract();
    ssvNetwork = metadata.ssvNetwork;
    ssvViews = metadata.ssvNetworkViews;

    // Define minumum allowed network fee to pass shrinkable validation
    networkFee = CONFIG.minimalOperatorFee / 10n;
  });

  it('Change liquidation threshold period emits "LiquidationThresholdPeriodUpdated"', async () => {
    await assertEvent(ssvNetwork.write.updateLiquidationThresholdPeriod([CONFIG.minimalBlocksBeforeLiquidation + 10]), [
      {
        contract: ssvNetwork,
        eventName: 'LiquidationThresholdPeriodUpdated',
        argNames: ['value'],
        argValuesList: [[CONFIG.minimalBlocksBeforeLiquidation + 10]],
      },
    ]);
  });

  it('Change liquidation threshold period gas limits', async () => {
    await trackGas(ssvNetwork.write.updateLiquidationThresholdPeriod([CONFIG.minimalBlocksBeforeLiquidation + 10]), [
      GasGroup.CHANGE_LIQUIDATION_THRESHOLD_PERIOD,
    ]);
  });

  it('Get liquidation threshold period', async () => {
    expect(await ssvViews.read.getLiquidationThresholdPeriod()).to.equal(CONFIG.minimalBlocksBeforeLiquidation);
  });

  it('Change liquidation threshold period reverts "NewBlockPeriodIsBelowMinimum"', async () => {
    await expect(
      ssvNetwork.write.updateLiquidationThresholdPeriod([CONFIG.minimalBlocksBeforeLiquidation - 10]),
    ).to.be.rejectedWith('NewBlockPeriodIsBelowMinimum');
  });

  it('Change liquidation threshold period reverts "caller is not the owner"', async () => {
    await expect(
      ssvNetwork.write.updateLiquidationThresholdPeriod([CONFIG.minimalBlocksBeforeLiquidation], {
        account: owners[3].account,
      }),
    ).to.be.rejectedWith('Ownable: caller is not the owner');
  });
});

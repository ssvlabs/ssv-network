// Declare imports
import { owners, initializeContract, CONFIG } from '../helpers/contract-helpers';
import { assertEvent } from '../helpers/utils/test';

import { trackGas, GasGroup } from '../helpers/gas-usage';

import { expect } from 'chai';

// Declare globals
let ssvNetwork: any, ssvViews: any, networkFee: BigInt;

describe('Liquidation Collateral Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = await initializeContract();
    ssvNetwork = metadata.ssvNetwork;
    ssvViews = metadata.ssvNetworkViews;

    // Define minumum allowed network fee to pass shrinkable validation
    networkFee = CONFIG.minimalOperatorFee / 10n;
  });

  it('Change minimum collateral emits "MinimumLiquidationCollateralUpdated"', async () => {
    await assertEvent(ssvNetwork.write.updateMinimumLiquidationCollateral([CONFIG.minimumLiquidationCollateral * 2]), [
      {
        contract: ssvNetwork,
        eventName: 'MinimumLiquidationCollateralUpdated',
        argNames: ['value'],
        argValuesList: [[CONFIG.minimumLiquidationCollateral * 2]],
      },
    ]);
  });

  it('Change minimum collateral gas limits', async () => {
    await trackGas(ssvNetwork.write.updateMinimumLiquidationCollateral([CONFIG.minimumLiquidationCollateral * 2]), [
      GasGroup.CHANGE_MINIMUM_COLLATERAL,
    ]);
  });

  it('Get minimum collateral', async () => {
    expect(await ssvViews.read.getMinimumLiquidationCollateral()).to.equal(CONFIG.minimumLiquidationCollateral);
  });

  it('Change minimum collateral reverts "caller is not the owner"', async () => {
    await expect(
      ssvNetwork.write.updateMinimumLiquidationCollateral([CONFIG.minimumLiquidationCollateral * 2], {
        account: owners[3].account,
      }),
    ).to.be.rejectedWith('Ownable: caller is not the owner');
  });
});

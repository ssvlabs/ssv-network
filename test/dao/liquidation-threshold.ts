// Declare imports
import * as helpers from '../helpers/contract-helpers';
import { expect } from 'chai';

// Declare globals
let ssvNetworkContract: any, networkFee: any;

describe('Liquidation Threshold Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    // Define minumum allowed network fee to pass shrinkable validation
    networkFee = helpers.CONFIG.minimalOperatorFee / 10;
  });

  it('Change liquidation threshold period emits "LiquidationThresholdPeriodUpdate"', async () => {
    await expect(ssvNetworkContract.updateLiquidationThresholdPeriod(helpers.CONFIG.minimalBlocksBeforeLiquidation + 10)).to.emit(ssvNetworkContract, 'LiquidationThresholdPeriodUpdate').withArgs(helpers.CONFIG.minimalBlocksBeforeLiquidation + 10);
  });

  it('Get liquidation threshold period', async () => {
    expect(await ssvNetworkContract.getLiquidationThresholdPeriod()).to.equal(helpers.CONFIG.minimalBlocksBeforeLiquidation);
  });

  it('Change liquidation threshold period reverts "BelowMinimumBlockPeriod"', async () => {
    await expect(ssvNetworkContract.updateLiquidationThresholdPeriod(helpers.CONFIG.minimalBlocksBeforeLiquidation - 10)).to.be.revertedWithCustomError(ssvNetworkContract,'BelowMinimumBlockPeriod');
  });

  it('Change liquidation threshold period reverts "caller is not the owner"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[3]).updateLiquidationThresholdPeriod(helpers.CONFIG.minimalBlocksBeforeLiquidation)).to.be.revertedWith('Ownable: caller is not the owner');
  });
});

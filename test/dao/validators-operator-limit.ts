// Declare imports
import * as helpers from '../helpers/contract-helpers';
import { expect } from 'chai';

// Declare globals
let ssvNetworkContract: any;

describe('Liquidation Threshold Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;
  });

  it('Change validators per operator limit emits "ValidatorsPerOperatorLimitUpdate"', async () => {
    await expect(ssvNetworkContract.updateValidatorsPerOperatorLimit(10)).to.emit(ssvNetworkContract, 'ValidatorsPerOperatorLimitUpdate').withArgs(10);
  });

  it('Get validators per operator limit', async () => {
    expect(await ssvNetworkContract.getValidatorsPerOperatorLimit()).to.equal(helpers.CONFIG.validatorsPerOperatorLimit);
  });

  it('Change validators per operator limit reverts "caller is not the owner"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[3]).updateValidatorsPerOperatorLimit(10)).to.be.revertedWith('caller is not the owner');
  });
});

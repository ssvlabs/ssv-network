// Declare imports
import * as helpers from '../helpers/contract-helpers';
import { expect } from 'chai';

// Declare globals
let ssvNetworkContract: any, networkFee: any;

describe('Network Fee Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    ssvNetworkContract = (await helpers.initializeContract()).contract;

    // Define minumum allowed network fee to pass shrinkable validation
    networkFee = helpers.CONFIG.minimalOperatorFee / 10;
  });
  
  it('Get network fee', async () => {
    expect(await ssvNetworkContract.getNetworkFee()).to.equal(0);
  });

  it('Change network fee emits "NetworkFeeUpdate"', async () => {
    await expect(ssvNetworkContract.updateNetworkFee(networkFee
    )).to.emit(ssvNetworkContract, 'NetworkFeeUpdate').withArgs(0, networkFee);
  });

  it('Change network fee is too low reverts "Precision is over the maximum defined"', async () => {
    await expect(ssvNetworkContract.updateNetworkFee(networkFee - 1
    )).to.be.revertedWith('Precision is over the maximum defined');
  });

  it('Not a Dao change network fee reverts "caller is not the owner"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[3]).updateNetworkFee(networkFee
    )).to.be.revertedWith('caller is not the owner');
  });
});

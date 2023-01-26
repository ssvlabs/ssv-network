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

  it('Change network fee emits "NetworkFeeUpdated"', async () => {
    await expect(ssvNetworkContract.updateNetworkFee(networkFee
    )).to.emit(ssvNetworkContract, 'NetworkFeeUpdated').withArgs(0, networkFee);
  });

  it('Get network fee', async () => {
    expect(await ssvNetworkContract.getNetworkFee()).to.equal(0);
  });

  it('Change the network fee to a number below the minimum fee reverts "Max precision exceeded"', async () => {
    await expect(ssvNetworkContract.updateNetworkFee(networkFee - 1
    )).to.be.revertedWith('Max precision exceeded');
  });

  it('Change network fee from an address thats not the DAO reverts "caller is not the owner"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[3]).updateNetworkFee(networkFee
    )).to.be.revertedWith('Ownable: caller is not the owner');
  });
});
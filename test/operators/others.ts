// Declare imports
import * as helpers from '../helpers/contract-helpers';
import { expect } from 'chai';

// Declare globals
let ssvNetworkContract: any;

describe('Others Operator Tests', () => {
  beforeEach(async () => {
    ssvNetworkContract = (await helpers.initializeContract()).contract;
  });

  it('Add fee recipient address emits "FeeRecipientAddressUpdated"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).setFeeRecipientAddress(
      helpers.DB.owners[2].address
    ))
      .to.emit(ssvNetworkContract, 'FeeRecipientAddressUpdated')
      .withArgs(helpers.DB.owners[1].address, helpers.DB.owners[2].address);
  });

  it('Update max number of validators per operator', async () => {
    expect((await ssvNetworkContract.validatorsPerOperatorLimit())).to.equal(2000);

    const SSVNetwork_v2 = await ethers.getContractFactory("SSVNetwork_v2");
    const ssvNetwork_v2 = await upgrades.upgradeProxy(ssvNetworkContract.address, SSVNetwork_v2, {
      kind: 'uups',
      call: {
        fn: 'initializev2',
        args: [50]
      }
    });
    await ssvNetwork_v2.deployed();

    expect((await ssvNetwork_v2.validatorsPerOperatorLimit())).to.equal(50);
  });

});
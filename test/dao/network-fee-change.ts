// Declare imports
import * as helpers from '../helpers/contract-helpers';
import { progressTime } from '../helpers/utils';
import { expect } from 'chai';
import { time } from "@nomicfoundation/hardhat-network-helpers";

// Declare globals
let ssvNetworkContract: any, ssvViews: any, networkFee: any;

describe('Network Fee Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = (await helpers.initializeContract());
    ssvNetworkContract = metadata.contract;
    ssvViews = metadata.ssvViews;

    // Define minumum allowed network fee to pass shrinkable validation
    networkFee = helpers.CONFIG.minimalOperatorFee / 10;
  });

  it('Change network fee emits "NetworkFeeUpdated"', async () => {
    const timestamp = await time.latest() + 1;
    const releaseDate = timestamp + (86400 * 2);
    const selector = ssvNetworkContract.interface.getSighash("updateNetworkFee(uint256)");

    await expect(ssvNetworkContract.updateNetworkFee(networkFee)).to.emit(ssvNetworkContract, 'FunctionLocked').withArgs(selector, releaseDate);
    await progressTime(172800); // 2 days

    await expect(ssvNetworkContract.updateNetworkFee(networkFee
    )).to.emit(ssvNetworkContract, 'NetworkFeeUpdated').withArgs(0, networkFee);
  });

  it('Change network fee before 2 days period reverts "FunctionIsLocked"', async () => {
    const timestamp = await time.latest() + 1;
    const releaseDate = timestamp + (86400 * 2);
    const selector = ssvNetworkContract.interface.getSighash("updateNetworkFee(uint256)");

    await expect(ssvNetworkContract.updateNetworkFee(networkFee * 2)).to.emit(ssvNetworkContract, 'FunctionLocked').withArgs(selector, releaseDate);
    await progressTime(86400); // 1 day
    await expect(ssvNetworkContract.updateNetworkFee(networkFee * 2)).to.be.revertedWithCustomError(ssvNetworkContract, 'FunctionIsLocked');
  });

  it('Get network fee', async () => {
    expect(await ssvViews.getNetworkFee()).to.equal(0);
  });

  it('Change the network fee to a number below the minimum fee reverts "Max precision exceeded"', async () => {
    await expect(ssvNetworkContract.updateNetworkFee(networkFee - 1
    )).to.be.revertedWith('Max precision exceeded');
  });

  it('Change network fee from an address thats not the DAO reverts "caller is not the owner"', async () => {
    await expect(ssvNetworkContract.connect(helpers.DB.owners[3]).updateNetworkFee(networkFee
    )).to.be.revertedWith('Ownable: caller is not the owner');
  });

  it('Multiple network fee updates can be locked and updated after 2 days period', async () => {
    const signature = ssvNetworkContract.interface.getSighash("updateNetworkFee(uint256)");
    const oneNetworkFee = networkFee * 2;
    const twoNetworkFee = networkFee * 3;

    let releaseDate = await time.latest() + 1 + (86400 * 2);
    await expect(ssvNetworkContract.updateNetworkFee(oneNetworkFee)).to.emit(ssvNetworkContract, 'FunctionLocked').withArgs(signature, releaseDate);

    await progressTime(86400); // 1 day
    releaseDate = await time.latest() + 1 + (86400 * 2);
    await expect(ssvNetworkContract.updateNetworkFee(twoNetworkFee)).to.emit(ssvNetworkContract, 'FunctionLocked').withArgs(signature, releaseDate);

    await progressTime(86400); // 1 day
    await ssvNetworkContract.updateNetworkFee(oneNetworkFee);
    expect(await ssvViews.getNetworkFee()).to.equal(oneNetworkFee);

    await progressTime(86400); // 1 day
    await ssvNetworkContract.updateNetworkFee(twoNetworkFee);
    expect(await ssvViews.getNetworkFee()).to.equal(twoNetworkFee);
  });
});
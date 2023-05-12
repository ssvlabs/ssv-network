// Declare imports
import * as helpers from '../helpers/contract-helpers';
import { expect } from 'chai';
import { trackGas } from '../helpers/gas-usage';

// Declare globals
let ssvNetworkContract: any, registerAuth: any;

describe('Others Operator Tests', () => {
  beforeEach(async () => {
    const metadata = (await helpers.initializeContract());
    ssvNetworkContract = metadata.contract;
    registerAuth = metadata.registerAuth;
  });

  it('Add fee recipient address emits "FeeRecipientAddressUpdated"', async () => {
    await registerAuth.setAuth(helpers.DB.owners[1].address, [true, false]);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).setFeeRecipientAddress(
      helpers.DB.owners[2].address
    ))
      .to.emit(ssvNetworkContract, 'FeeRecipientAddressUpdated')
      .withArgs(helpers.DB.owners[1].address, helpers.DB.owners[2].address);
  });

  it('Update max number of validators per operator', async () => {
    expect((await ssvNetworkContract.validatorsPerOperatorLimit())).to.equal(500);

    const SSVNetworkValidatorsPerOperator = await ethers.getContractFactory("SSVNetworkValidatorsPerOperator");
    const ssvNetwork = await upgrades.upgradeProxy(ssvNetworkContract.address, SSVNetworkValidatorsPerOperator, {
      kind: 'uups',
      unsafeAllow: ['constructor'],
      constructorArgs: [registerAuth.address],
      call: {
        fn: 'initializev2',
        args: [50]
      }
    });
    await ssvNetwork.deployed();

    expect((await ssvNetwork.validatorsPerOperatorLimit())).to.equal(50);
  });

  it('Remove operator whitelisted address', async () => {
    const result = await trackGas(ssvNetworkContract.registerOperator(
      helpers.DataGenerator.publicKey(1),
      helpers.CONFIG.minimalOperatorFee
    ));
    const { operatorId } = result.eventsByName.OperatorAdded[0].args;

    await ssvNetworkContract.setOperatorWhitelist(operatorId, helpers.DB.owners[2].address);

    await expect(ssvNetworkContract.setOperatorWhitelist(operatorId, ethers.constants.AddressZero))
      .to.emit(ssvNetworkContract, 'OperatorWhitelistUpdated')
      .withArgs(operatorId, ethers.constants.AddressZero);
  });

  it('Non-owner remove operator whitelisted address reverts "CallerNotOwner"', async () => {
    await registerAuth.setAuth(helpers.DB.owners[1].address, [true, false]);
    const result = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerOperator(
      helpers.DataGenerator.publicKey(1),
      helpers.CONFIG.minimalOperatorFee
    ));
    const { operatorId } = result.eventsByName.OperatorAdded[0].args;

    await ssvNetworkContract.connect(helpers.DB.owners[1]).setOperatorWhitelist(operatorId, helpers.DB.owners[2].address);

    await expect(ssvNetworkContract.setOperatorWhitelist(operatorId, ethers.constants.AddressZero))
      .to.be.revertedWithCustomError(ssvNetworkContract, 'CallerNotOwner');
  });

  it('Update operator whitelisted address', async () => {
    const result = await trackGas(ssvNetworkContract.registerOperator(
      helpers.DataGenerator.publicKey(1),
      helpers.CONFIG.minimalOperatorFee
    ));
    const { operatorId } = result.eventsByName.OperatorAdded[0].args;

    await expect(ssvNetworkContract.setOperatorWhitelist(operatorId, helpers.DB.owners[2].address))
      .to.emit(ssvNetworkContract, 'OperatorWhitelistUpdated')
      .withArgs(operatorId, helpers.DB.owners[2].address);
  });

  it('Non-owner update operator whitelisted address reverts "CallerNotOwner"', async () => {
    await registerAuth.setAuth(helpers.DB.owners[1].address, [true, false]);
    const result = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerOperator(
      helpers.DataGenerator.publicKey(1),
      helpers.CONFIG.minimalOperatorFee
    ));
    const { operatorId } = result.eventsByName.OperatorAdded[0].args;

    await expect(ssvNetworkContract.setOperatorWhitelist(operatorId, helpers.DB.owners[2].address))
      .to.be.revertedWithCustomError(ssvNetworkContract, 'CallerNotOwner');
  });

});
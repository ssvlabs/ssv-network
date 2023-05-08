// Declare imports
import * as helpers from '../helpers/contract-helpers';
import { expect } from 'chai';

// Declare globals
let ssvNetworkContract: any, ssvViews: any, registerAuth: any;

describe.only('Register Auth Operator Tests', () => {
  before(async () => {
    const metadata = (await helpers.initializeContract());
    ssvNetworkContract = metadata.contract;
    ssvViews = metadata.ssvViews;
    registerAuth = metadata.registerAuth;
  });

  it('Register operator with unauthorized address reverts "Not authorized"', async () => {
    const publicKey = helpers.DataGenerator.publicKey(0);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerOperator(
      publicKey,
      helpers.CONFIG.minimalOperatorFee
    )).to.be.revertedWith('Not authorized');

  });

  it('Register operator with unauthorized address reverts "Not authorized" (2)', async () => {
    await registerAuth.setAuth(helpers.DB.owners[1].address, { registerOperator: false, registerValidator: true });

    const publicKey = helpers.DataGenerator.publicKey(0);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerOperator(
      publicKey,
      helpers.CONFIG.minimalOperatorFee
    )).to.be.revertedWith('Not authorized');

  });

  it('Register operator emits "OperatorAdded"', async () => {
    await registerAuth.setAuth(helpers.DB.owners[1].address, { registerOperator: true, registerValidator: false });

    const publicKey = helpers.DataGenerator.publicKey(0);
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).registerOperator(
      publicKey,
      helpers.CONFIG.minimalOperatorFee
    )).to.emit(ssvNetworkContract, 'OperatorAdded').withArgs(1, helpers.DB.owners[1].address, publicKey, helpers.CONFIG.minimalOperatorFee);

  });

  it('Get authorization from a non trusted address reverts "Call not authorized"', async () => {
    await expect(registerAuth.connect(helpers.DB.owners[2]).getAuth(helpers.DB.owners[2].address)).to.be.revertedWith('Call not authorized');
  });

  it('Get authorization from contract owner returns address auth', async () => {
    await registerAuth.setAuth(helpers.DB.owners[1].address, { registerOperator: true, registerValidator: true });

    expect(await registerAuth.getAuth(helpers.DB.owners[1].address)).to.deep.equal([true, true]);
  });


});
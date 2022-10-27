import * as helpers from '../helpers/contract-helpers';

let ssvNetworkContract: any;

describe('Withdraw Tests', () => {
  beforeEach(async () => {
    const contractData = await helpers.initializeContract();
    ssvNetworkContract = contractData.contract;
  });

  it('Withdraw', async () => {

  });

  it('Withdraw errors', async () => {

  });

  it('Withdraw gas limits', async () => {

  });

});

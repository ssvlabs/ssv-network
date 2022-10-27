import * as helpers from '../helpers/contract-helpers';

let ssvNetworkContract: any;

describe('Deposit Tests', () => {
  beforeEach(async () => {
    const contractData = await helpers.initializeContract();
    ssvNetworkContract = contractData.contract;
  });

  it('Deposit', async () => {

  });

  it('Deposit errors', async () => {

  });

  it('Deposit gas limits', async () => {

  });

});

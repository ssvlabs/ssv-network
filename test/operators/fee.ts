import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any;

describe('Operator Fee Tests', () => {
  beforeEach(async () => {
    ssvNetworkContract = (await helpers.initializeContract()).contract;
  });

  it('Declare fee success', async () => {
  });

  it('Declare fee success as contract owner', async () => {
  });

  it('Declare fee fails no owner', async () => {
  });

  it('Declare fee fails fee too low', async () => {
  });

  it('Declare fee fails fee exceeds increase limit', async () => {
  });

  it('Cancel declared fee success', async () => {
  });

  it('Cancel declared fee success as contract owner', async () => {
  });

  it('Cancel declared fee fails no owner', async () => {
  });

  it('Execute fee success', async () => {
  });

  it('Execute fee success as contract owner', async () => {
  });

  it('Execute fee fee fails no owner', async () => {
  });

  it('Execute fee fails no pending request', async () => {
  });

  it('Execute fee fails not within timeframe', async () => {
  });

});

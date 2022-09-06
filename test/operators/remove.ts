import * as helpers from '../helpers/contract-helpers';

import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any;

describe('Remove Operator Tests', () => {
  beforeEach(async () => {
    ssvNetworkContract = (await helpers.initializeContract()).contract;
  });

  it('Remove operator emits OperatorRemoved event', async () => {
    await helpers.registerOperators(0, 1, '10');
    await expect(ssvNetworkContract.connect(helpers.DB.owners[0]).removeOperator(1))
      .to.emit(ssvNetworkContract, 'OperatorRemoved').withArgs(1);
  });

  it('Fails to remove operator with no owner', async () => {
    await helpers.registerOperators(0, 1, '10');
    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).removeOperator(1))
      .to.be.revertedWith('CallerNotOwner');
  });

  it('Remove operator gas limits', async () => {
    await helpers.registerOperators(0, 1, '10');
    await trackGas(ssvNetworkContract.removeOperator(1), [GasGroup.REMOVE_OPERATOR]);
  });

});

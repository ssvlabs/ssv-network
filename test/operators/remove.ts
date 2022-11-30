import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';

import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any;

describe('Remove Operator Tests', () => {
  beforeEach(async () => {
    ssvNetworkContract = (await helpers.initializeContract()).contract;
  });

  it('Remove operator emits OperatorRemoved event', async () => {
    const { eventsByName } = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerOperator(helpers.DataGenerator.publicKey(1), helpers.CONFIG.minimalOperatorFee), [GasGroup.REGISTER_OPERATOR]);
    const args = eventsByName.OperatorMetadataUpdated[0].args;

    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).removeOperator(args.operator))
      .to.emit(ssvNetworkContract, 'OperatorRemoved').withArgs(1);
  });

  it('Fails to remove operator with no owner', async () => {
    const { eventsByName } = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[0]).registerOperator(helpers.DataGenerator.publicKey(1), helpers.CONFIG.minimalOperatorFee), [GasGroup.REGISTER_OPERATOR]);
    const args = eventsByName.OperatorMetadataUpdated[0].args;

    await expect(ssvNetworkContract.connect(helpers.DB.owners[1]).removeOperator(args.operator))
      .to.be.revertedWith('OperatorWithPublicKeyNotExist');
  });

  it('Remove operator gas limits', async () => {
    const { eventsByName } = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[0]).registerOperator(helpers.DataGenerator.publicKey(1), helpers.CONFIG.minimalOperatorFee), [GasGroup.REGISTER_OPERATOR]);
    const args = eventsByName.OperatorMetadataUpdated[0].args;

    await trackGas(ssvNetworkContract.removeOperator(args.operator), [GasGroup.REMOVE_OPERATOR]);
  });

  it('Remove operator with withdraw emits OperatorFundsWithdrawal event', async () => {
    await helpers.registerOperators(0, 4, helpers.CONFIG.minimalOperatorFee);
    await helpers.registerValidators(4, 1, `${helpers.CONFIG.minimalBlocksBeforeLiquidation * helpers.CONFIG.minimalOperatorFee * 4}`, helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_COLD_START]);
    await utils.progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    await expect(ssvNetworkContract.removeOperator(helpers.DB.operators[1].operator)).to.emit(ssvNetworkContract, 'OperatorFundsWithdrawal');
  });

  it('Remove operator with withdraw gas limits', async () => {
    await helpers.registerOperators(0, 4, helpers.CONFIG.minimalOperatorFee);
    await helpers.registerValidators(4, 1, `${helpers.CONFIG.minimalBlocksBeforeLiquidation * helpers.CONFIG.minimalOperatorFee * 4}`, helpers.DataGenerator.cluster.new(), [GasGroup.REGISTER_VALIDATOR_COLD_START]);
    await trackGas(ssvNetworkContract.removeOperator(helpers.DB.operators[1].operator), [GasGroup.REMOVE_OPERATOR_WITH_WITHDRAW]);
  });
});

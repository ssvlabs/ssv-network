// Declare imports
import {
  owners,
  initializeContract,
  registerOperators,
  bulkRegisterValidators,
  coldRegisterValidator,
  DataGenerator,
  CONFIG,
  DEFAULT_OPERATOR_IDS,
} from '../helpers/contract-helpers';
import { assertEvent } from '../helpers/utils/test';
import { trackGas, GasGroup } from '../helpers/gas-usage';

import { ethers } from 'hardhat';
import { expect } from 'chai';

// Declare globals
let ssvNetwork: any, ssvViews: any;

describe('Remove Operator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = await initializeContract();
    ssvNetwork = metadata.ssvNetwork;
    ssvViews = metadata.ssvNetworkViews;

    // Register operators
    await registerOperators(0, 14, CONFIG.minimalOperatorFee);

    // Register a validator
    // cold register
    await coldRegisterValidator();
  });

  it('Remove operator emits "OperatorRemoved"', async () => {
    await assertEvent(ssvNetwork.write.removeOperator([1]), [
      {
        contract: ssvNetwork,
        eventName: 'OperatorRemoved',
        argNames: ['operatorId'],
        argValuesList: [[1]],
      },
    ]);
  });

  it('Remove private operator emits "OperatorRemoved"', async () => {
    const result = await trackGas(
      ssvNetwork.write.registerOperator([DataGenerator.publicKey(22), CONFIG.minimalOperatorFee, true]),
    );
    const { operatorId } = result.eventsByName.OperatorAdded[0].args;

    await ssvNetwork.write.setOperatorsWhitelists([[operatorId], [owners[2].account.address]]);

    await assertEvent(ssvNetwork.write.removeOperator([operatorId]), [
      {
        contract: ssvNetwork,
        eventName: 'OperatorRemoved',
        argNames: ['operatorId'],
        argValuesList: [[operatorId]],
      },
    ]);

    expect(await ssvViews.read.getOperatorById([operatorId])).to.deep.equal([
      owners[0].account.address, // owner
      0, // fee
      0, // validatorCount
      ethers.ZeroAddress, // whitelisting contract address
      true, // isPrivate
      false, // active
    ]);
  });

  it('Remove operator gas limits', async () => {
    await trackGas(ssvNetwork.write.removeOperator([1]), [GasGroup.REMOVE_OPERATOR]);
  });

  it('Remove operator with a balance emits "OperatorWithdrawn"', async () => {
    await bulkRegisterValidators(
      4,
      1,
      DEFAULT_OPERATOR_IDS[4],
      BigInt(CONFIG.minimalBlocksBeforeLiquidation) * CONFIG.minimalOperatorFee * 4n,
      {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0n,
        active: true,
      },
    );

    await assertEvent(ssvNetwork.write.removeOperator([1]), [
      {
        contract: ssvNetwork,
        eventName: 'OperatorRemoved',
        argNames: ['operatorId'],
        argValuesList: [[1]],
      },
    ]);
  });

  it('Remove operator with a balance gas limits', async () => {
    await bulkRegisterValidators(
      4,
      1,
      DEFAULT_OPERATOR_IDS[4],
      BigInt(CONFIG.minimalBlocksBeforeLiquidation) * CONFIG.minimalOperatorFee * 4n,
      {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0n,
        active: true,
      },
    );
    await trackGas(ssvNetwork.write.removeOperator([1]), [GasGroup.REMOVE_OPERATOR_WITH_WITHDRAW]);
  });

  it('Remove operator I do not own reverts "CallerNotOwnerWithData"', async () => {
    await expect(
      ssvNetwork.write.removeOperator([1], {
        account: owners[1].account,
      }),
    ).to.be.rejectedWith('CallerNotOwnerWithData');
  });

  it('Remove same operator twice reverts "OperatorDoesNotExist"', async () => {
    await ssvNetwork.write.removeOperator([1]);
    await expect(ssvNetwork.write.removeOperator([1])).to.be.rejectedWith('OperatorDoesNotExist');
  });
});

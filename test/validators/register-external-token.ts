// Declare imports
import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';
import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';

let ssvNetworkContract: any, ssvViews: any, ssvToken: any, type1Token: any, minDepositAmount: any, cluster1: any;

describe('Register Validator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = (await helpers.initializeContract());
    ssvNetworkContract = metadata.contract;
    ssvToken = metadata.ssvToken;
    type1Token = metadata.type1Token;
    ssvViews = metadata.ssvViews;

    // Register operators
    await helpers.registerOperatorsTokenFee(0, 14, helpers.CONFIG.minimalOperatorFee, type1Token.address);

    minDepositAmount = (helpers.CONFIG.minimalBlocksBeforeLiquidation + 2) * helpers.CONFIG.minimalOperatorFee * 13;

    // cold register
    await ssvNetworkContract.setRegisterAuth(helpers.DB.owners[6].address, false, true);
    await helpers.DB.ssvToken.connect(helpers.DB.owners[6]).approve(helpers.DB.ssvNetwork.contract.address, '1000000000000000');
    await helpers.DB.type1Token.connect(helpers.DB.owners[6]).approve(helpers.DB.ssvNetwork.contract.address, '1000000000000000');

    cluster1 = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[6]).registerTokenValidator(
      helpers.DataGenerator.publicKey(90),
      [1, 2, 3, 4],
      helpers.DataGenerator.shares(4),
      '1000000000000000',
      '1000000000000000',
      {
        base: {
          validatorCount: 0,
          networkFeeIndex: 0,
          index: 0,
          ssvBalance: 0,
          active: true
        },
        tokenBalance: 0,
        tokenAddress: type1Token.address
      }
    ));

    await ssvNetworkContract.setRegisterAuth(helpers.DB.owners[1].address, true, true);
    await ssvNetworkContract.setRegisterAuth(helpers.DB.owners[0].address, true, true);
  });

  it.only('Register validator with 4 operators gas limit', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await helpers.DB.type1Token.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);

    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerTokenValidator(
      helpers.DataGenerator.publicKey(1),
      [1, 2, 3, 4],
      helpers.DataGenerator.shares(4),
      minDepositAmount,
      minDepositAmount,
      {
        base: {
          validatorCount: 0,
          networkFeeIndex: 0,
          index: 0,
          ssvBalance: 0,
          active: true
        },
        tokenBalance: 0,
        tokenAddress: type1Token.address
      }
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);
  });

  it('Register 2 validators into the same cluster gas limit', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await helpers.DB.type1Token.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);

    const { eventsByName } = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerTokenValidator(
      helpers.DataGenerator.publicKey(1),
      [1, 2, 3, 4],
      helpers.DataGenerator.shares(4),
      minDepositAmount,
      minDepositAmount,
      {
        base: {
          validatorCount: 0,
          networkFeeIndex: 0,
          index: 0,
          ssvBalance: 0,
          active: true
        },
        tokenBalance: 0,
        tokenAddress: type1Token.address
      }
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);

    const args = eventsByName.ValidatorAdded[0].args;

    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await helpers.DB.type1Token.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);

    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerTokenValidator(
      helpers.DataGenerator.publicKey(2),
      [1, 2, 3, 4],
      helpers.DataGenerator.shares(4),
      minDepositAmount,
      minDepositAmount,
      args.cluster
    ), [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER]);
  });

  it.only('Register 2 validators into the same cluster with one time deposit gas limit', async () => {
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await helpers.DB.type1Token.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);

    const { eventsByName } = await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerTokenValidator(
      helpers.DataGenerator.publicKey(1),
      [1, 2, 3, 4],
      helpers.DataGenerator.shares(4),
      minDepositAmount,
      minDepositAmount,
      {
        base: {
          validatorCount: 0,
          networkFeeIndex: 0,
          index: 0,
          ssvBalance: 0,
          active: true
        },
        tokenBalance: 0,
        tokenAddress: type1Token.address
      }
    ), [GasGroup.REGISTER_VALIDATOR_NEW_STATE]);

    const args = eventsByName.ValidatorAdded[0].args;

    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await helpers.DB.type1Token.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);

    await trackGas(ssvNetworkContract.connect(helpers.DB.owners[1]).registerTokenValidator(
      helpers.DataGenerator.publicKey(2),
      [1, 2, 3, 4],
      helpers.DataGenerator.shares(4),
      0,
      0,
      args.cluster
    ), [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT]);
  });

});

// Declare imports
import * as helpers from '../helpers/contract-helpers';
import * as utils from '../helpers/utils';
import { expect } from 'chai';
import { trackGas, GasGroup } from '../helpers/gas-usage';
import { progressBlocks } from '../helpers/utils';

let ssvNetworkContract: any, ssvViews: any, ssvToken: any, minDepositAmount: any, cluster1: any;
const exceedValidatorsLimit = 5;

describe('Revert Validator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = await helpers.initializeContract(exceedValidatorsLimit);
    ssvNetworkContract = metadata.contract;
    ssvToken = metadata.ssvToken;
    ssvViews = metadata.ssvViews;

    // Register operators
    await helpers.registerOperators(0, 14, helpers.CONFIG.minimalOperatorFee);

    minDepositAmount = (helpers.CONFIG.minimalBlocksBeforeLiquidation + 2) * helpers.CONFIG.minimalOperatorFee * 13;

    await helpers.DB.ssvToken
      .connect(helpers.DB.owners[1])
      .approve(helpers.DB.ssvNetwork.contract.address, '1000000000000000');

    cluster1 = await trackGas(
      ssvNetworkContract
        .connect(helpers.DB.owners[1])
        .registerValidator(
          helpers.DataGenerator.publicKey(exceedValidatorsLimit + 1),
          [1, 2, 3, 4],
          helpers.DataGenerator.shares(1, exceedValidatorsLimit + 1, 4),
          '1000000000000000',
          helpers.getClusterForValidator(0, 0, 0, 0, true),
        ),
    );
  });

  it('Register validators with exceed limit for an operator reverts "ExceedValidatorLimit"', async () => {
    const args = cluster1.eventsByName.ValidatorAdded[0].args;
    await expect(
      helpers.bulkRegisterValidators(1, exceedValidatorsLimit, [1, 2, 3, 4], minDepositAmount, args.cluster),
    ).to.be.revertedWithCustomError(ssvNetworkContract, 'ExceedValidatorLimit');
  });

  it('Reactivate a cluster with exceed limit for an operator reverts "ExceedValidatorLimit"', async () => {
    // liquidate the 1st validator
    const firstCluster = cluster1.eventsByName.ValidatorAdded[0].args;
    await progressBlocks(helpers.CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(
      ssvNetworkContract
        .connect(helpers.DB.owners[1])
        .liquidate(firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster),
      [GasGroup.LIQUIDATE_CLUSTER_4],
    );
    let updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;

    // check the operator's validatorCount is decreased.
    expect(await ssvViews.getOperatorById(1)).to.deep.equal([
      helpers.DB.owners[0].address, // owner
      helpers.CONFIG.minimalOperatorFee, // fee
      0, // validatorCount
      ethers.constants.AddressZero, // whitelisted
      false, // isPrivate
      true, // active
    ]);

    // register validators with maximum limit count
    await helpers.DB.ssvToken.connect(helpers.DB.owners[2]).approve(ssvNetworkContract.address, minDepositAmount);
    await helpers.bulkRegisterValidators(2, exceedValidatorsLimit, [1, 2, 3, 4], minDepositAmount, {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0,
      active: true,
    });

    // when the 1st validator will be reactive, revert with ExceedValidatorLimit
    await helpers.DB.ssvToken.connect(helpers.DB.owners[1]).approve(ssvNetworkContract.address, minDepositAmount);
    await expect(
      ssvNetworkContract
        .connect(helpers.DB.owners[1])
        .reactivate(updatedCluster.operatorIds, minDepositAmount, updatedCluster.cluster),
    ).to.be.revertedWithCustomError(ssvNetworkContract, 'ExceedValidatorLimit');
  });

  it('Register validators with invalid count 3 of operators reverts "InvalidOperatorIdsLength"', async () => {
    await expect(
      ssvNetworkContract
        .connect(helpers.DB.owners[1])
        .registerValidator(
          helpers.DataGenerator.publicKey(3),
          [1, 2, 3],
          helpers.DataGenerator.shares(1, 3, 4),
          minDepositAmount,
          helpers.getClusterForValidator(0, 0, 0, 0, true),
        ),
    ).to.be.revertedWithCustomError(ssvNetworkContract, 'InvalidOperatorIdsLength');
  });

  it('Register validators with invalid count 15 of operators reverts "InvalidOperatorIdsLength"', async () => {
    await expect(
      ssvNetworkContract
        .connect(helpers.DB.owners[1])
        .registerValidator(
          helpers.DataGenerator.publicKey(3),
          [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15],
          helpers.DataGenerator.shares(1, 3, 4),
          minDepositAmount,
          helpers.getClusterForValidator(0, 0, 0, 0, true),
        ),
    ).to.be.revertedWithCustomError(ssvNetworkContract, 'InvalidOperatorIdsLength');
  });

  it('Register validators with invalid count 6 of operators reverts "InvalidOperatorIdsLength"', async () => {
    await expect(
      ssvNetworkContract
        .connect(helpers.DB.owners[1])
        .registerValidator(
          helpers.DataGenerator.publicKey(3),
          [1, 2, 3, 4, 5, 6],
          helpers.DataGenerator.shares(1, 3, 4),
          minDepositAmount,
          helpers.getClusterForValidator(0, 0, 0, 0, true),
        ),
    ).to.be.revertedWithCustomError(ssvNetworkContract, 'InvalidOperatorIdsLength');
  });

  it('Bulk register validators with invalid length of pubkeys reverts "InvalidPublicKeyLength"', async () => {
    await expect(
      ssvNetworkContract
        .connect(helpers.DB.owners[1])
        .registerValidator(
          helpers.DataGenerator.publicKey(3).substring(0, 48),
          [1, 2, 3, 4],
          helpers.DataGenerator.shares(1, 3, 4),
          minDepositAmount,
          helpers.getClusterForValidator(0, 0, 0, 0, true),
        ),
    ).to.be.revertedWithCustomError(ssvNetworkContract, 'InvalidPublicKeyLength');
  });
});

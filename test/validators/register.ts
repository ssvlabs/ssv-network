// Declare imports
import {
  owners,
  initializeContract,
  registerOperators,
  bulkRegisterValidators,
  DataGenerator,
  CONFIG,
  DEFAULT_OPERATOR_IDS,
} from '../helpers/contract-helpers';
import { assertEvent } from '../helpers/utils/test';
import { trackGas, GasGroup } from '../helpers/gas-usage';

import { mine } from '@nomicfoundation/hardhat-network-helpers';
import { expect } from 'chai';

let ssvNetwork: any, ssvViews: any, ssvToken: any, minDepositAmount: BigInt, cluster1: any;

describe('Register Validator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = await initializeContract();
    ssvNetwork = metadata.ssvNetwork;
    ssvViews = metadata.ssvNetworkViews;
    ssvToken = metadata.ssvToken;

    // Register operators
    await registerOperators(0, 14, CONFIG.minimalOperatorFee);

    minDepositAmount = (BigInt(CONFIG.minimalBlocksBeforeLiquidation) + 2n) * CONFIG.minimalOperatorFee * 13n;

    cluster1 = (
      await bulkRegisterValidators(6, 1, DEFAULT_OPERATOR_IDS[4], 1000000000000000n, {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0n,
        active: true,
      })
    ).args;
  });

  it('Register validator with 4 operators emits "ValidatorAdded"', async () => {
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });

    await assertEvent(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          DEFAULT_OPERATOR_IDS[4],
          await DataGenerator.shares(1, 1, DEFAULT_OPERATOR_IDS[4]),
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
      [
        {
          contract: ssvNetwork,
          eventName: 'ValidatorAdded',
        },
        {
          contract: ssvToken,
          eventName: 'Transfer',
        },
      ],
    );
  });

  it('Register validator with 4 operators gas limit', async () => {
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });
    const balance = await ssvToken.read.balanceOf([ssvNetwork.address]);

    await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          DEFAULT_OPERATOR_IDS[4],
          await DataGenerator.shares(1, 1, DEFAULT_OPERATOR_IDS[4]),
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE],
    );

    expect(await ssvToken.read.balanceOf([ssvNetwork.address])).to.be.equal(balance + minDepositAmount);
  });

  it('Register 2 validators into the same cluster gas limit', async () => {
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });
    const { eventsByName } = await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          DEFAULT_OPERATOR_IDS[4],
          await DataGenerator.shares(1, 1, DEFAULT_OPERATOR_IDS[4]),
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE],
    );

    const args = eventsByName.ValidatorAdded[0].args;

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });
    await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(2),
          DEFAULT_OPERATOR_IDS[4],
          await DataGenerator.shares(1, 2, DEFAULT_OPERATOR_IDS[4]),
          minDepositAmount,
          args.cluster,
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER],
    );
  });

  it('Register 2 validators into the same cluster and 1 validator into a new cluster gas limit', async () => {
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });
    const { eventsByName } = await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          DEFAULT_OPERATOR_IDS[4],
          await DataGenerator.shares(1, 1, DEFAULT_OPERATOR_IDS[4]),
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE],
    );

    const args = eventsByName.ValidatorAdded[0].args;

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });
    await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(2),
          DEFAULT_OPERATOR_IDS[4],
          await DataGenerator.shares(1, 2, DEFAULT_OPERATOR_IDS[4]),
          minDepositAmount,
          args.cluster,
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER],
    );

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[2].account });

    await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(4),
          [2, 3, 4, 5],
          await DataGenerator.shares(2, 4, DEFAULT_OPERATOR_IDS[4]),
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[2].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE],
    );
  });

  it('Register 2 validators into the same cluster with one time deposit gas limit', async () => {
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount * 2n], { account: owners[1].account });

    const { eventsByName } = await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          DEFAULT_OPERATOR_IDS[4],
          await DataGenerator.shares(1, 1, DEFAULT_OPERATOR_IDS[4]),
          minDepositAmount * 2n,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE],
    );

    const args = eventsByName.ValidatorAdded[0].args;
    await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(2),
          DEFAULT_OPERATOR_IDS[4],
          await DataGenerator.shares(1, 2, DEFAULT_OPERATOR_IDS[4]),
          0,
          args.cluster,
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT],
    );
  });

  it('Bulk register 10 validators with 4 operators into the same cluster', async () => {
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });
    const { eventsByName } = await trackGas(
      ssvNetwork.write.bulkRegisterValidator(
        [
          [DataGenerator.publicKey(12)],
          DEFAULT_OPERATOR_IDS[4],
          [await DataGenerator.shares(1, 11, DEFAULT_OPERATOR_IDS[4])],
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
    );

    const args = eventsByName.ValidatorAdded[0].args;

    await bulkRegisterValidators(1, 10, DEFAULT_OPERATOR_IDS[4], minDepositAmount, args.cluster, [
      GasGroup.BULK_REGISTER_10_VALIDATOR_EXISTING_CLUSTER_4,
    ]);
  });

  it('Bulk register 10 validators with 4 operators new cluster', async () => {
    await bulkRegisterValidators(
      1,
      10,
      DEFAULT_OPERATOR_IDS[4],
      minDepositAmount,
      {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0n,
        active: true,
      },
      [GasGroup.BULK_REGISTER_10_VALIDATOR_NEW_STATE_4],
    );
  });

  // 7 operators

  it('Register validator with 7 operators gas limit', async () => {
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });
    await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(2),
          DEFAULT_OPERATOR_IDS[7],
          await DataGenerator.shares(1, 2, DEFAULT_OPERATOR_IDS[7]),
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE_7],
    );
  });

  it('Register 2 validators with 7 operators into the same cluster gas limit', async () => {
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });
    const { eventsByName } = await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          DEFAULT_OPERATOR_IDS[7],
          await DataGenerator.shares(1, 1, DEFAULT_OPERATOR_IDS[7]),
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE_7],
    );

    const args = eventsByName.ValidatorAdded[0].args;

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });
    await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(2),
          DEFAULT_OPERATOR_IDS[7],
          await DataGenerator.shares(1, 2, DEFAULT_OPERATOR_IDS[7]),
          minDepositAmount,
          args.cluster,
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_7],
    );
  });

  it('Register 2 validators with 7 operators into the same cluster and 1 validator into a new cluster with 7 operators gas limit', async () => {
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });
    const { eventsByName } = await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          DEFAULT_OPERATOR_IDS[7],
          await DataGenerator.shares(1, 1, DEFAULT_OPERATOR_IDS[7]),
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE_7],
    );

    const args = eventsByName.ValidatorAdded[0].args;

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });
    await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(2),
          DEFAULT_OPERATOR_IDS[7],
          await DataGenerator.shares(1, 2, DEFAULT_OPERATOR_IDS[7]),
          minDepositAmount,
          args.cluster,
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_7],
    );

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[2].account });

    await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(4),
          [2, 3, 4, 5, 6, 7, 8],
          await DataGenerator.shares(2, 4, DEFAULT_OPERATOR_IDS[7]),
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[2].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE_7],
    );
  });

  it('Register 2 validators with 7 operators into the same cluster with one time deposit gas limit', async () => {
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount * 2n], { account: owners[1].account });

    const { eventsByName } = await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          DEFAULT_OPERATOR_IDS[7],
          await DataGenerator.shares(1, 1, DEFAULT_OPERATOR_IDS[7]),
          minDepositAmount * 2n,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE_7],
    );

    const args = eventsByName.ValidatorAdded[0].args;
    await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(2),
          DEFAULT_OPERATOR_IDS[7],
          await DataGenerator.shares(1, 2, DEFAULT_OPERATOR_IDS[7]),
          0,
          args.cluster,
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT_7],
    );
  });

  it('Bulk register 10 validators with 7 operators into the same cluster', async () => {
    const operatorIds = DEFAULT_OPERATOR_IDS[7];

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });
    const { eventsByName } = await trackGas(
      ssvNetwork.write.bulkRegisterValidator(
        [
          [DataGenerator.publicKey(12)],
          operatorIds,
          [await DataGenerator.shares(1, 11, operatorIds)],
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
    );

    const args = eventsByName.ValidatorAdded[0].args;

    await bulkRegisterValidators(1, 10, operatorIds, minDepositAmount, args.cluster, [
      GasGroup.BULK_REGISTER_10_VALIDATOR_EXISTING_CLUSTER_7,
    ]);
  });

  it('Bulk register 10 validators with 7 operators new cluster', async () => {
    await bulkRegisterValidators(
      1,
      10,
      DEFAULT_OPERATOR_IDS[7],
      minDepositAmount,
      {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0n,
        active: true,
      },
      [GasGroup.BULK_REGISTER_10_VALIDATOR_NEW_STATE_7],
    );
  });

  // 10 operators

  it('Register validator with 10 operators gas limit', async () => {
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });
    await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          DEFAULT_OPERATOR_IDS[10],
          await DataGenerator.shares(1, 1, DEFAULT_OPERATOR_IDS[10]),
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE_10],
    );
  });

  it('Register 2 validators with 10 operators into the same cluster gas limit', async () => {
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });
    const { eventsByName } = await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          DEFAULT_OPERATOR_IDS[10],
          await DataGenerator.shares(1, 1, DEFAULT_OPERATOR_IDS[10]),
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE_10],
    );

    const args = eventsByName.ValidatorAdded[0].args;

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });
    await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(2),
          DEFAULT_OPERATOR_IDS[10],
          await DataGenerator.shares(1, 2, DEFAULT_OPERATOR_IDS[10]),
          minDepositAmount,
          args.cluster,
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_10],
    );
  });

  it('Register 2 validators with 10 operators into the same cluster and 1 validator into a new cluster with 10 operators gas limit', async () => {
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });
    const { eventsByName } = await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          DEFAULT_OPERATOR_IDS[10],
          await DataGenerator.shares(1, 1, DEFAULT_OPERATOR_IDS[10]),
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE_10],
    );

    const args = eventsByName.ValidatorAdded[0].args;

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });
    await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(2),
          DEFAULT_OPERATOR_IDS[10],
          await DataGenerator.shares(1, 2, DEFAULT_OPERATOR_IDS[10]),
          minDepositAmount,
          args.cluster,
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_10],
    );

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[2].account });

    await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(4),
          DEFAULT_OPERATOR_IDS[10],
          await DataGenerator.shares(2, 4, DEFAULT_OPERATOR_IDS[10]),
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[2].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE_10],
    );
  });

  it('Register 2 validators with 10 operators into the same cluster with one time deposit gas limit', async () => {
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount * 2n], { account: owners[1].account });

    const { eventsByName } = await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          DEFAULT_OPERATOR_IDS[10],
          await DataGenerator.shares(1, 1, DEFAULT_OPERATOR_IDS[10]),
          minDepositAmount * 2n,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE_10],
    );

    const args = eventsByName.ValidatorAdded[0].args;
    await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(2),
          DEFAULT_OPERATOR_IDS[10],
          await DataGenerator.shares(1, 2, DEFAULT_OPERATOR_IDS[10]),
          0,
          args.cluster,
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT_10],
    );
  });

  it('Bulk register 10 validators with 10 operators into the same cluster', async () => {
    const operatorIds = DEFAULT_OPERATOR_IDS[10];

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });
    const { eventsByName } = await trackGas(
      ssvNetwork.write.bulkRegisterValidator(
        [
          [DataGenerator.publicKey(12)],
          operatorIds,
          [await DataGenerator.shares(1, 10, operatorIds)],
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
    );

    const args = eventsByName.ValidatorAdded[0].args;

    await bulkRegisterValidators(1, 10, operatorIds, minDepositAmount, args.cluster, [
      GasGroup.BULK_REGISTER_10_VALIDATOR_EXISTING_CLUSTER_10,
    ]);
  });

  it('Bulk register 10 validators with 10 operators new cluster', async () => {
    await bulkRegisterValidators(
      1,
      10,
      DEFAULT_OPERATOR_IDS[10],
      minDepositAmount,

      {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0,
        active: true,
      },
      [GasGroup.BULK_REGISTER_10_VALIDATOR_NEW_STATE_10],
    );
  });

  // 13 operators

  it('Register validator with 13 operators gas limit', async () => {
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });
    await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          DEFAULT_OPERATOR_IDS[13],
          await DataGenerator.shares(1, 1, DEFAULT_OPERATOR_IDS[13]),
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE_13],
    );
  });

  it('Register 2 validators with 13 operators into the same cluster gas limit', async () => {
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });
    const { eventsByName } = await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          DEFAULT_OPERATOR_IDS[13],
          await DataGenerator.shares(1, 1, DEFAULT_OPERATOR_IDS[13]),
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE_13],
    );
    const args = eventsByName.ValidatorAdded[0].args;

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });
    await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(2),
          DEFAULT_OPERATOR_IDS[13],
          await DataGenerator.shares(1, 2, DEFAULT_OPERATOR_IDS[13]),
          minDepositAmount,
          args.cluster,
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_13],
    );
  });

  it('Register 2 validators with 13 operators into the same cluster and 1 validator into a new cluster with 13 operators gas limit', async () => {
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });
    const { eventsByName } = await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          DEFAULT_OPERATOR_IDS[13],
          await DataGenerator.shares(1, 1, DEFAULT_OPERATOR_IDS[13]),
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE_13],
    );
    const args = eventsByName.ValidatorAdded[0].args;

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });
    await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(2),
          DEFAULT_OPERATOR_IDS[13],
          await DataGenerator.shares(1, 2, DEFAULT_OPERATOR_IDS[13]),
          minDepositAmount,
          args.cluster,
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_13],
    );

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[2].account });
    await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(4),
          DEFAULT_OPERATOR_IDS[13],
          await DataGenerator.shares(2, 4, DEFAULT_OPERATOR_IDS[13]),
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[2].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE_13],
    );
  });

  it('Register 2 validators with 13 operators into the same cluster with one time deposit gas limit', async () => {
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount * 2n], { account: owners[1].account });

    const { eventsByName } = await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          DEFAULT_OPERATOR_IDS[13],
          await DataGenerator.shares(1, 1, DEFAULT_OPERATOR_IDS[13]),
          minDepositAmount * 2n,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE_13],
    );

    const args = eventsByName.ValidatorAdded[0].args;
    await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(2),
          DEFAULT_OPERATOR_IDS[13],
          await DataGenerator.shares(1, 2, DEFAULT_OPERATOR_IDS[13]),
          0,
          args.cluster,
        ],
        { account: owners[1].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_WITHOUT_DEPOSIT_13],
    );
  });

  it('Bulk register 10 validators with 13 operators into the same cluster', async () => {
    const operatorIds = DEFAULT_OPERATOR_IDS[13];

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[1].account });
    const { eventsByName } = await trackGas(
      ssvNetwork.write.bulkRegisterValidator(
        [
          [DataGenerator.publicKey(12)],
          operatorIds,
          [await DataGenerator.shares(1, 11, operatorIds)],
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
    );

    const args = eventsByName.ValidatorAdded[0].args;

    await bulkRegisterValidators(1, 10, operatorIds, minDepositAmount, args.cluster, [
      GasGroup.BULK_REGISTER_10_VALIDATOR_EXISTING_CLUSTER_13,
    ]);
  });

  it('Bulk register 10 validators with 13 operators new cluster', async () => {
    await bulkRegisterValidators(
      1,
      10,
      DEFAULT_OPERATOR_IDS[13],
      minDepositAmount,

      {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0n,
        active: true,
      },
      [GasGroup.BULK_REGISTER_10_VALIDATOR_NEW_STATE_13],
    );
  });

  it('Get cluster burn rate', async () => {
    const networkFee = CONFIG.minimalOperatorFee;
    await ssvNetwork.write.updateNetworkFee([networkFee]);

    let clusterData = cluster1.cluster;
    expect(await ssvViews.read.getBurnRate([owners[6].account.address, DEFAULT_OPERATOR_IDS[4], clusterData])).to.equal(
      CONFIG.minimalOperatorFee * 4n + networkFee,
    );

    await ssvToken.write.approve([ssvNetwork.address, 1000000000000000n], { account: owners[6].account });

    const validator2 = await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(2),
          DEFAULT_OPERATOR_IDS[4],
          await DataGenerator.shares(6, 2, DEFAULT_OPERATOR_IDS[4]),
          '1000000000000000',
          clusterData,
        ],
        { account: owners[6].account },
      ),
    );
    clusterData = validator2.eventsByName.ValidatorAdded[0].args.cluster;
    expect(await ssvViews.read.getBurnRate([owners[6].account.address, DEFAULT_OPERATOR_IDS[4], clusterData])).to.equal(
      (CONFIG.minimalOperatorFee * 4n + networkFee) * 2n,
    );
  });

  it('Get cluster burn rate when one of the operators does not exist', async () => {
    const clusterData = cluster1.cluster;
    await expect(ssvViews.read.getBurnRate([owners[6].account.address, [1, 2, 3, 41], clusterData])).to.be.rejectedWith(
      'ClusterDoesNotExists',
    );
  });

  it('Register validator with incorrect input data reverts "IncorrectClusterState"', async () => {
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount * 2n], { account: owners[1].account });

    await ssvNetwork.write.registerValidator(
      [
        DataGenerator.publicKey(2),
        DEFAULT_OPERATOR_IDS[4],
        await DataGenerator.shares(1, 2, DEFAULT_OPERATOR_IDS[4]),
        minDepositAmount,
        {
          validatorCount: 0,
          networkFeeIndex: 0,
          index: 0,
          balance: 0,
          active: true,
        },
      ],
      { account: owners[1].account },
    );

    await expect(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(3),
          DEFAULT_OPERATOR_IDS[4],
          await DataGenerator.shares(1, 3, DEFAULT_OPERATOR_IDS[4]),
          minDepositAmount,
          {
            validatorCount: 2,
            networkFeeIndex: 10,
            index: 0,
            balance: 0,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
    ).to.be.rejectedWith('IncorrectClusterState');
  });

  it('Register validator in a new cluster with incorrect input data reverts "IncorrectClusterState"', async () => {
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount * 2n], { account: owners[1].account });

    await expect(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(3),
          DEFAULT_OPERATOR_IDS[4],
          await DataGenerator.shares(1, 3, DEFAULT_OPERATOR_IDS[4]),
          minDepositAmount,
          {
            validatorCount: 2,
            networkFee: 10,
            networkFeeIndex: 10,
            index: 10,
            balance: 10,
            active: false,
          },
        ],
        { account: owners[1].account },
      ),
    ).to.be.rejectedWith('IncorrectClusterState');
  });

  it('Register validator when an operator does not exist in the cluster reverts "OperatorDoesNotExist"', async () => {
    await expect(
      ssvNetwork.write.registerValidator([
        DataGenerator.publicKey(2),
        [1, 2, 3, 25],
        await DataGenerator.shares(1, 2, DEFAULT_OPERATOR_IDS[4]),
        minDepositAmount,
        {
          validatorCount: 0,
          networkFeeIndex: 0,
          index: 0,
          balance: 0,
          active: true,
        },
      ]),
    ).to.be.rejectedWith('OperatorDoesNotExist');
  });

  it('Register validator with a removed operator in the cluster reverts "OperatorDoesNotExist"', async () => {
    await ssvNetwork.write.removeOperator([1]);
    await expect(
      ssvNetwork.write.registerValidator([
        DataGenerator.publicKey(4),
        DEFAULT_OPERATOR_IDS[4],
        await DataGenerator.shares(0, 4, DEFAULT_OPERATOR_IDS[4]),
        minDepositAmount,
        {
          validatorCount: 0,
          networkFeeIndex: 0,
          index: 0,
          balance: 0,
          active: true,
        },
      ]),
    ).to.be.rejectedWith('OperatorDoesNotExist');
  });

  it('Register cluster with unsorted operators reverts "UnsortedOperatorsList"', async () => {
    await expect(
      ssvNetwork.write.registerValidator([
        DataGenerator.publicKey(1),
        [3, 2, 1, 4],
        await DataGenerator.shares(0, 1, DEFAULT_OPERATOR_IDS[4]),
        minDepositAmount,
        {
          validatorCount: 0,
          networkFeeIndex: 0,
          index: 0,
          balance: 0,
          active: true,
        },
      ]),
    ).to.be.rejectedWith('UnsortedOperatorsList');
  });

  it('Register cluster with duplicated operators reverts "OperatorsListNotUnique"', async () => {
    await expect(
      ssvNetwork.write.registerValidator([
        DataGenerator.publicKey(1),
        [3, 6, 12, 12],
        await DataGenerator.shares(0, 1, DEFAULT_OPERATOR_IDS[4]),
        minDepositAmount,
        {
          validatorCount: 0,
          networkFeeIndex: 0,
          index: 0,
          balance: 0,
          active: true,
        },
      ]),
    ).to.be.rejectedWith('OperatorsListNotUnique');
  });

  it('Register validator with not enough balance reverts "InsufficientBalance"', async () => {
    await ssvToken.write.approve([ssvNetwork.address, CONFIG.minimalOperatorFee]);
    await expect(
      ssvNetwork.write.registerValidator([
        DataGenerator.publicKey(1),
        DEFAULT_OPERATOR_IDS[4],
        await DataGenerator.shares(0, 1, DEFAULT_OPERATOR_IDS[4]),
        CONFIG.minimalOperatorFee,
        {
          validatorCount: 0,
          networkFeeIndex: 0,
          index: 0,
          balance: 0,
          active: true,
        },
      ]),
    ).to.be.rejectedWith('InsufficientBalance');
  });

  it('Register validator in a liquidatable cluster with not enough balance reverts "InsufficientBalance"', async () => {
    const depositAmount = BigInt(CONFIG.minimalBlocksBeforeLiquidation) * (CONFIG.minimalOperatorFee * 4n);

    await ssvToken.write.approve([ssvNetwork.address, depositAmount], { account: owners[1].account });

    const { eventsByName } = await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          DEFAULT_OPERATOR_IDS[4],
          await DataGenerator.shares(1, 1, DEFAULT_OPERATOR_IDS[4]),
          depositAmount,
          {
            validatorCount: 0,
            networkFee: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
    );
    const cluster1 = eventsByName.ValidatorAdded[0].args;

    await mine(CONFIG.minimalBlocksBeforeLiquidation + 10);

    await ssvToken.write.approve([ssvNetwork.address, CONFIG.minimalOperatorFee], { account: owners[1].account });

    await expect(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(2),
          DEFAULT_OPERATOR_IDS[4],
          await DataGenerator.shares(1, 2, DEFAULT_OPERATOR_IDS[4]),
          CONFIG.minimalOperatorFee,
          cluster1.cluster,
        ],
        { account: owners[1].account },
      ),
    ).to.be.rejectedWith('InsufficientBalance');
  });

  it('Register an existing validator with same operators setup reverts "ValidatorAlreadyExistsWithData"', async () => {
    await ssvToken.write.approve([ssvNetwork.address, CONFIG.minimalOperatorFee], { account: owners[6].account });

    await expect(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          DEFAULT_OPERATOR_IDS[4],
          await DataGenerator.shares(6, 1, DEFAULT_OPERATOR_IDS[4]),
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[6].account },
      ),
    ).to.be.rejectedWith('ValidatorAlreadyExistsWithData', DataGenerator.publicKey(1));
  });

  it('Register an existing validator with different operators setup reverts "ValidatorAlreadyExistsWithData"', async () => {
    await ssvToken.write.approve([ssvNetwork.address, CONFIG.minimalOperatorFee], { account: owners[6].account });
    await expect(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          [1, 2, 5, 6],
          await DataGenerator.shares(6, 1, DEFAULT_OPERATOR_IDS[4]),
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[6].account },
      ),
    ).to.be.rejectedWith('ValidatorAlreadyExistsWithData', DataGenerator.publicKey(1));
  });

  it('Register validator with an empty public key reverts "InvalidPublicKeyLength"', async () => {
    await expect(
      ssvNetwork.write.registerValidator([
        '0x',
        [1, 2, 3, 4],
        await DataGenerator.shares(0, 4, DEFAULT_OPERATOR_IDS[4]),
        minDepositAmount,
        {
          validatorCount: 0,
          networkFeeIndex: 0,
          index: 0,
          balance: 0n,
          active: true,
        },
      ]),
    ).to.be.rejectedWith('InvalidPublicKeyLength');
  });

  it('Bulk register 10 validators with empty public keys list reverts "EmptyPublicKeysList"', async () => {
    await expect(
      ssvNetwork.write.bulkRegisterValidator(
        [
          [],
          [1, 2, 3, 4],
          [],
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
    ).to.be.rejectedWith('EmptyPublicKeysList');
  });

  it('Bulk register 10 validators with different pks/shares lenght reverts "PublicKeysSharesLengthMismatch"', async () => {
    const pks = Array.from({ length: 10 }, (_, index) => DataGenerator.publicKey(index + 1));
    const shares = await Promise.all(
      Array.from({ length: 8 }, (_, index) => DataGenerator.shares(1, index, DEFAULT_OPERATOR_IDS[4])),
    );

    await expect(
      ssvNetwork.write.bulkRegisterValidator(
        [
          pks,
          [1, 2, 3, 4],
          shares,
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
    ).to.be.rejectedWith('PublicKeysSharesLengthMismatch');
  });

  it('Bulk register 10 validators with wrong operators length reverts "InvalidOperatorIdsLength"', async () => {
    const pks = Array.from({ length: 10 }, (_, index) => DataGenerator.publicKey(index + 1));
    const shares = await Promise.all(
      Array.from({ length: 10 }, (_, index) => DataGenerator.shares(1, index, DEFAULT_OPERATOR_IDS[4])),
    );

    await expect(
      ssvNetwork.write.bulkRegisterValidator(
        [
          pks,
          [1, 2, 3, 4, 5],
          shares,
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
    ).to.be.rejectedWith('InvalidOperatorIdsLength');
  });

  it('Bulk register 10 validators with empty operators list reverts "InvalidOperatorIdsLength"', async () => {
    const pks = Array.from({ length: 10 }, (_, index) => DataGenerator.publicKey(index + 1));
    const shares = await Promise.all(
      Array.from({ length: 10 }, (_, index) => DataGenerator.shares(1, index, DEFAULT_OPERATOR_IDS[4])),
    );

    await expect(
      ssvNetwork.write.bulkRegisterValidator(
        [
          pks,
          [],
          shares,
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[1].account },
      ),
    ).to.be.rejectedWith('InvalidOperatorIdsLength');
  });

  it('Retrieve an existing validator', async () => {
    expect(await ssvViews.read.getValidator([owners[6].account.address, DataGenerator.publicKey(1)])).to.be.equals(
      true,
    );
  });

  it('Retrieve a non-existing validator', async () => {
    expect(await ssvViews.read.getValidator([owners[2].account.address, DataGenerator.publicKey(1)])).to.equal(false);
  });
});

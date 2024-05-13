// Declare imports
import hre from 'hardhat';

import {
  owners,
  initializeContract,
  registerOperators,
  bulkRegisterValidators,
  DataGenerator,
  getTransactionReceipt,
  coldRegisterValidator,
  CONFIG,
  DEFAULT_OPERATOR_IDS,
  publicClient,
} from '../helpers/contract-helpers';
import { assertPostTxEvent } from '../helpers/utils/test';
import { trackGas, GasGroup, trackGasFromReceipt } from '../helpers/gas-usage';

import { mine } from '@nomicfoundation/hardhat-toolbox-viem/network-helpers';
import { expect } from 'chai';

let ssvNetwork: any, ssvViews: any, ssvToken: any, minDepositAmount: BigInt;

describe('Register Validator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = await initializeContract();
    ssvNetwork = metadata.ssvNetwork;
    ssvViews = metadata.ssvNetworkViews;
    ssvToken = metadata.ssvToken;

    // Register operators
    await registerOperators(0, 14, CONFIG.minimalOperatorFee);

    minDepositAmount = (BigInt(CONFIG.minimalBlocksBeforeLiquidation) + 2n) * CONFIG.minimalOperatorFee * 4n;
    // cold register
    await coldRegisterValidator();
  });

  it('Register whitelisted validator in 1 operator with 4 operators emits "ValidatorAdded"/gas limits/logic', async () => {
    const result = await trackGas(
      ssvNetwork.write.registerOperator([DataGenerator.publicKey(20), CONFIG.minimalOperatorFee], {
        account: owners[1].account,
      }),
    );
    const { operatorId } = result.eventsByName.OperatorAdded[0].args;

    await ssvNetwork.write.setOperatorWhitelist([operatorId, owners[3].account.address], {
      account: owners[1].account,
    });

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[3].account });

    const receipt = await getTransactionReceipt(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          [1, 2, 3, operatorId],
          await DataGenerator.shares(3, 1, 4),
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[3].account },
      ),
    );

    await assertPostTxEvent([
      {
        contract: ssvNetwork,
        eventName: 'ValidatorAdded',
      },
    ]);

    await trackGasFromReceipt(receipt, [GasGroup.REGISTER_VALIDATOR_NEW_STATE_1_WHITELISTED_4]);

    expect(await ssvViews.read.getOperatorById([operatorId])).to.deep.equal([
      owners[1].account.address, // owner
      CONFIG.minimalOperatorFee, // fee
      1, // validatorCount
      ethers.ZeroAddress, // whitelisting contract address
      true, // isPrivate
      true, // active
    ]);
  });

  it('Register whitelisted validator in 4 operators in 4 operators cluster gas limits/logic', async () => {
    await ssvNetwork.write.setOperatorMultipleWhitelists([DEFAULT_OPERATOR_IDS[4], [owners[3].account.address]], {
      account: owners[0].account,
    });

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[3].account });

    await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          DEFAULT_OPERATOR_IDS[4],
          await DataGenerator.shares(3, 1, 4),
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[3].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_NEW_STATE_4_WHITELISTED_4],
    );

    // Check totalValidatorsCount is incremented for all operators
    for (let i = 0; i < DEFAULT_OPERATOR_IDS[4].length; i++) {
      const operatorData = await ssvViews.read.getOperatorById([DEFAULT_OPERATOR_IDS[4][i]]);
      expect(operatorData[2]).to.be.equal(2); // validatorCount starts with 1 because coldRegiserValidator
    }
  });

  it('Register non-whitelisted validator in 1 public operator with 4 operators emits "ValidatorAdded"/logic', async () => {
    await ssvNetwork.write.setOperatorMultipleWhitelists([[5], [owners[3].account.address]]);

    await ssvNetwork.write.setOperatorsPublicUnchecked([[5]]);

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[3].account });

    await ssvNetwork.write.registerValidator(
      [
        DataGenerator.publicKey(1),
        [5, 6, 7, 8],
        await DataGenerator.shares(3, 1, 4),
        minDepositAmount,
        {
          validatorCount: 0,
          networkFeeIndex: 0,
          index: 0,
          balance: 0n,
          active: true,
        },
      ],
      { account: owners[3].account },
    );

    expect(await ssvViews.read.getOperatorById([5])).to.deep.equal([
      owners[0].account.address, // owner
      CONFIG.minimalOperatorFee, // fee
      1, // validatorCount
      ethers.ZeroAddress, // whitelisting contract address
      false, // isPrivate
      true, // active
    ]);
  });

  it('Register whitelisted validator in 4 operator in 4 operators existing cluster gas limits', async () => {
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[3].account });
    const { eventsByName } = await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          DEFAULT_OPERATOR_IDS[4],
          await DataGenerator.shares(3, 1, 4),
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[3].account },
      ),
    );

    const args = eventsByName.ValidatorAdded[0].args;

    await ssvNetwork.write.setOperatorMultipleWhitelists([DEFAULT_OPERATOR_IDS[4], [owners[3].account.address]]);

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[3].account });
    await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(2),
          DEFAULT_OPERATOR_IDS[4],
          await DataGenerator.shares(3, 1, 4),
          minDepositAmount,
          args.cluster,
        ],
        { account: owners[3].account },
      ),
      [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_4_WHITELISTED_4],
    );
  });

  it('Register using non-authorized account for 1 operator with 4 operators cluster reverts "CallerNotWhitelisted"', async () => {
    await ssvNetwork.write.setOperatorMultipleWhitelists([[3], [owners[3].account.address]], {
      account: owners[0].account,
    });

    await expect(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          DEFAULT_OPERATOR_IDS[4],
          await DataGenerator.shares(2, 1, 4),
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
    ).to.be.rejectedWith('CallerNotWhitelisted');
  });

  it('Register using non-authorized account for 1 operator with 4 operators cluster reverts "CallerNotWhitelisted"', async () => {
    await ssvNetwork.write.setOperatorsPrivateUnchecked([[2]]);

    await expect(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          DEFAULT_OPERATOR_IDS[4],
          await DataGenerator.shares(2, 1, 4),
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
    ).to.be.rejectedWith('CallerNotWhitelisted');
  });

  it('Register using fake whitelisting contract reverts', async () => {
    const fakeWhitelistingContract = await hre.viem.deployContract(
      'FakeWhitelistingContract',
      [await ssvNetwork.address],
      {
        client: owners[0].client,
      },
    );

    // Set the whitelisting contract for operators 1,2,3,4
    await ssvNetwork.write.setOperatorsWhitelistingContract(
      [DEFAULT_OPERATOR_IDS[4], await fakeWhitelistingContract.address],
      {
        account: owners[0].account,
      },
    );
    await ssvNetwork.write.setOperatorsPrivateUnchecked([DEFAULT_OPERATOR_IDS[4]], {
      account: owners[0].account,
    });

    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[3].account });

    const pk = DataGenerator.publicKey(1);
    const shares = await DataGenerator.shares(3, 1, 4);

    // set the 2nd registerValidator input data with a new validator public key
    await fakeWhitelistingContract.write.setRegisterValidatorData([
      '0xa063fa1434f4ae9bb63488cd79e2f76dea59e0e2d6cdec7236c2bb49ffb37da37cb7966be74eca5a171f659fee7bc502',
      [4, 5, 6, 7],
      shares,
      minDepositAmount,
      {
        validatorCount: 0,
        networkFeeIndex: 0,
        index: 0,
        balance: 0n,
        active: true,
      },
    ]);

    await expect(
      ssvNetwork.write.registerValidator(
        [
          pk,
          [4, 5, 6, 7],
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
        { account: owners[3].account },
      ),
    ).to.be.rejectedWith('Call failed or was reverted'); // reverts in the fake whitelisting contract
  });

  it('Read-only reentrancy attack reverts', async () => {
    // This test replicates a Read-only reentrancy attack, where a malicious whitelisting contract
    // acts as an intermediary for a malicious contract that serves as an operator owner.
    // It performs an attempt of withdrawing the operator earnings when the SSVNetwork contract
    // still doesn't receive the funds, resulting in an inconsistent state of the contract.
    // Expected result is a revert from the SSVNetwork contract because the
    // ISSVWhitelistingContract.isWhitelisted function has the view modifier.
    // The flow of the attack is the following:
    // AttackerContract -> SSVNetwork.registerValidator() -> BadOperatorWhitelisting.fallback()
    // -> BeneficiaryContract.withdrawOperatorEarnings() -> SSVNetwork.withdrawOperatorEarnings()

    const beneficiaryContract = await hre.viem.deployContract('BeneficiaryContract', [await ssvNetwork.address], {
      client: owners[1].client,
    });

    const badOperatorWhitelistingContract = await hre.viem.deployContract(
      'BadOperatorWhitelistingContract',
      [await beneficiaryContract.address],
      {
        client: owners[1].client,
      },
    );

    const attackerContract = await hre.viem.deployContract('AttackerContract', [await ssvNetwork.address], {
      client: owners[1].client,
    });

    // BeneficiaryContract register the target operator
    const { result: beneficiaryOperatorId } = await publicClient.simulateContract({
      address: await beneficiaryContract.address,
      abi: beneficiaryContract.abi,
      functionName: 'registerOperator',
      account: owners[1].account,
    });

    await beneficiaryContract.write.registerOperator();
    await beneficiaryContract.write.setTargetOperatorId([beneficiaryOperatorId]);

    // Register a new operator, good owner
    const { result: goodOperatorId } = await publicClient.simulateContract({
      address: await ssvNetwork.address,
      abi: ssvNetwork.abi,
      functionName: 'registerOperator',
      args: ['0xabcd', CONFIG.minimalOperatorFee],
      account: owners[0].account,
    });

    await ssvNetwork.write.registerOperator(['0xabcd', CONFIG.minimalOperatorFee]);
    // Whitelist the new operator with the attacker contract
    await ssvNetwork.write.setOperatorsWhitelistingContract(
      [[goodOperatorId], await badOperatorWhitelistingContract.address],
      {
        account: owners[0].account,
      },
    );

    const goodUser = owners[1].account;

    // A good user calls registerValidator with operators:
    // 1, 2, 3, beneficiaryOperatorId
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: goodUser });

    let pk = DataGenerator.publicKey(2);
    let shares = await DataGenerator.shares(1, 1, 4);

    await ssvNetwork.write.registerValidator(
      [
        pk,
        [1, 2, 3, beneficiaryOperatorId],
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
      { account: goodUser },
    );

    // forward blocks so beneficiaryOperator generates revenue
    await mine(10);

    // The attacker contract calls registerValidator with operators:
    // 1, 2, beneficiaryOperatorId, goodOperatorId
    const badUser = owners[3].account;

    pk = DataGenerator.publicKey(3);
    shares = await DataGenerator.shares(3, 1, 4);

    // AttackerContract starts the attact
    await expect(
      attackerContract.write.startAttack(
        [
          pk,
          [1, 2, beneficiaryOperatorId, goodOperatorId],
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
        { account: badUser },
      ),
    ).to.be.rejected;
  });

  describe('Register using whitelisting contract', () => {
    let mockWhitelistingContractAddress: any;
    beforeEach(async () => {
      // Whitelist whitelistedCaller using an external contract
      const mockWhitelistingContract = await hre.viem.deployContract(
        'MockWhitelistingContract',
        [[owners[3].account.address]],
        {
          client: owners[0].client,
        },
      );
      mockWhitelistingContractAddress = await mockWhitelistingContract.address;

      // Set the whitelisting contract for operators 1,2,3,4
      await ssvNetwork.write.setOperatorsWhitelistingContract(
        [DEFAULT_OPERATOR_IDS[4], mockWhitelistingContractAddress],
        {
          account: owners[0].account,
        },
      );
      await ssvNetwork.write.setOperatorsPrivateUnchecked([DEFAULT_OPERATOR_IDS[4]], {
        account: owners[0].account,
      });
    });

    it('Register using whitelisting contract for 1 operator in 4 operators cluster gas limits/events/logic', async () => {
      await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[3].account });

      const pk = DataGenerator.publicKey(1);
      const shares = await DataGenerator.shares(3, 1, 4);

      const receipt = await getTransactionReceipt(
        ssvNetwork.write.registerValidator(
          [
            pk,
            [4, 5, 6, 7],
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
          { account: owners[3].account },
        ),
      );

      let registeredCluster = await trackGasFromReceipt(receipt, [
        GasGroup.REGISTER_VALIDATOR_NEW_STATE_1_WHITELISTING_CONTRACT_4,
      ]);
      registeredCluster = registeredCluster.eventsByName.ValidatorAdded[0].args;

      await assertPostTxEvent([
        {
          contract: ssvNetwork,
          eventName: 'ValidatorAdded',
          argNames: ['owner', 'operatorIds', 'publicKey', 'shares', 'cluster'],
          argValuesList: [[owners[3].account.address, [4, 5, 6, 7], pk, shares, registeredCluster.cluster]],
        },
      ]);

      expect(await ssvViews.read.getOperatorById([4])).to.deep.equal([
        owners[0].account.address, // owner
        CONFIG.minimalOperatorFee, // fee
        2, // validatorCount -> starts with 1 validator because coldRegisterValidator
        mockWhitelistingContractAddress, // whitelisting contract address
        true, // isPrivate
        true, // active
      ]);
    });

    it('Bulk register 10 validators using whitelisting contract for 1 operator in 4 operators cluster gas limits/logic', async () => {
      await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[3].account });
      const { eventsByName } = await trackGas(
        ssvNetwork.write.bulkRegisterValidator(
          [
            [DataGenerator.publicKey(12)],
            [4, 5, 6, 7],
            [await DataGenerator.shares(3, 11, 4)],
            minDepositAmount,
            {
              validatorCount: 0,
              networkFeeIndex: 0,
              index: 0,
              balance: 0,
              active: true,
            },
          ],
          { account: owners[3].account },
        ),
      );

      const args = eventsByName.ValidatorAdded[0].args;

      await bulkRegisterValidators(3, 10, [4, 5, 6, 7], minDepositAmount, args.cluster, [
        GasGroup.BULK_REGISTER_10_VALIDATOR_1_WHITELISTING_CONTRACT_EXISTING_CLUSTER_4,
      ]);

      expect(await ssvViews.read.getOperatorById([4])).to.deep.equal([
        owners[0].account.address, // owner
        CONFIG.minimalOperatorFee, // fee
        12, // validatorCount -> starts with 1 validator because coldRegisterValidator
        mockWhitelistingContractAddress, // whitelisting contract address
        true, // isPrivate
        true, // active
      ]);
    });

    it('Register using whitelisting contract for 1 public operator in 4 operators cluster', async () => {
      await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[3].account });

      await ssvNetwork.write.setOperatorsPublicUnchecked([[4]]);

      await ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          [4, 5, 6, 7],
          await DataGenerator.shares(3, 1, 4),
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[3].account },
      );

      expect(await ssvViews.read.getOperatorById([4])).to.deep.equal([
        owners[0].account.address, // owner
        CONFIG.minimalOperatorFee, // fee
        2, // validatorCount -> starts with 1 validator because coldRegisterValidator
        mockWhitelistingContractAddress, // whitelisting contract address
        false, // isPrivate
        true, // active
      ]);
    });

    it('Register using whitelisting contract for 1 operator & EOA for 1 operator in 4 operators cluster', async () => {
      await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[3].account });

      await ssvNetwork.write.setOperatorMultipleWhitelists([[6], [owners[3].account.address]]);

      await ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          [4, 5, 6, 7],
          await DataGenerator.shares(3, 1, 4),
          minDepositAmount,
          {
            validatorCount: 0,
            networkFeeIndex: 0,
            index: 0,
            balance: 0n,
            active: true,
          },
        ],
        { account: owners[3].account },
      );

      expect(await ssvViews.read.getOperatorById([4])).to.deep.equal([
        owners[0].account.address, // owner
        CONFIG.minimalOperatorFee, // fee
        2, // validatorCount -> starts with 1 validator because coldRegisterValidator
        mockWhitelistingContractAddress, // whitelisting contract address
        true, // isPrivate
        true, // active
      ]);

      expect(await ssvViews.read.getOperatorById([6])).to.deep.equal([
        owners[0].account.address, // owner
        CONFIG.minimalOperatorFee, // fee
        1, // validatorCount
        ethers.ZeroAddress, // whitelisting contract address
        true, // isPrivate
        true, // active
      ]);
    });

    it('Register using whitelisting contract with an unauthorized account reverts "CallerNotWhitelisted"', async () => {
      await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[4].account });

      const pk = DataGenerator.publicKey(1);
      const shares = await DataGenerator.shares(4, 1, 4);

      await expect(
        ssvNetwork.write.registerValidator(
          [
            pk,
            [4, 5, 6, 7],
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
          { account: owners[4].account },
        ),
      ).to.be.rejectedWith('CallerNotWhitelisted');
    });

    it('Register using whitelisting contract but a public operator allows registration', async () => {
      // This test checks a non-whitelisted account (owners[4]) in a whitelisting contract
      // can register validators in a public operator

      await ssvNetwork.write.setOperatorsPublicUnchecked([[4]], {
        account: owners[0].account,
      });

      await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[4].account });

      const pk = DataGenerator.publicKey(1);
      const shares = await DataGenerator.shares(4, 1, 4);

      await ssvNetwork.write.registerValidator(
        [
          pk,
          [4, 5, 6, 7],
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
        { account: owners[4].account },
      );

      expect(await ssvViews.read.getOperatorById([4])).to.deep.equal([
        owners[0].account.address, // owner
        CONFIG.minimalOperatorFee, // fee
        2, // validatorCount -> starts with 1 validator because coldRegisterValidator
        mockWhitelistingContractAddress, // whitelisting contract address
        false, // isPrivate
        true, // active
      ]);
    });
  });
});

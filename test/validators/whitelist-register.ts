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
  MOCK_SHARES,
  publicClient,
} from '../helpers/contract-helpers';
import { assertPostTxEvent, assertEvent } from '../helpers/utils/test';
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
  });

  describe('Generic Tests', () => {
    beforeEach(async () => {
      // Register operators
      await registerOperators(0, 14, CONFIG.minimalOperatorFee);

      minDepositAmount = (BigInt(CONFIG.minimalBlocksBeforeLiquidation) + 2n) * CONFIG.minimalOperatorFee * 4n;

      // cold register
      await coldRegisterValidator();
    });

    it('Register whitelisted validator in 1 operator with 4 operators emits "ValidatorAdded"/gas limits/logic', async () => {
      const operatorId = await registerOperators(1, 1, CONFIG.minimalOperatorFee);

      await ssvNetwork.write.setOperatorsWhitelists([[operatorId], [owners[3].account.address]], {
        account: owners[1].account,
      });
      await ssvNetwork.write.setOperatorsPrivateUnchecked([[operatorId]], {
        account: owners[1].account,
      });

      await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[3].account });

      const receipt = await getTransactionReceipt(
        ssvNetwork.write.registerValidator(
          [
            DataGenerator.publicKey(1),
            [1, 2, 3, operatorId],
            await DataGenerator.shares(3, 1, [1, 2, 3, operatorId]),
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
      await ssvNetwork.write.setOperatorsWhitelists([DEFAULT_OPERATOR_IDS[4], [owners[3].account.address]], {
        account: owners[0].account,
      });

      await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[3].account });

      await trackGas(
        ssvNetwork.write.registerValidator(
          [
            DataGenerator.publicKey(1),
            DEFAULT_OPERATOR_IDS[4],
            await DataGenerator.shares(3, 1, DEFAULT_OPERATOR_IDS[4]),
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
      await ssvNetwork.write.setOperatorsWhitelists([[5], [owners[3].account.address]]);

      await ssvNetwork.write.setOperatorsPublicUnchecked([[5]]);

      await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[3].account });

      await ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          [5, 6, 7, 8],
          await DataGenerator.shares(3, 1, [5, 6, 7, 8]),
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
            await DataGenerator.shares(3, 1, DEFAULT_OPERATOR_IDS[4]),
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

      await ssvNetwork.write.setOperatorsWhitelists([DEFAULT_OPERATOR_IDS[4], [owners[3].account.address]]);

      await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[3].account });
      await trackGas(
        ssvNetwork.write.registerValidator(
          [
            DataGenerator.publicKey(2),
            DEFAULT_OPERATOR_IDS[4],
            await DataGenerator.shares(3, 1, DEFAULT_OPERATOR_IDS[4]),
            minDepositAmount,
            args.cluster,
          ],
          { account: owners[3].account },
        ),
        [GasGroup.REGISTER_VALIDATOR_EXISTING_CLUSTER_4_WHITELISTED_4],
      );
    });

    it('Register using non-authorized account for 1 operator with 4 operators cluster reverts "CallerNotWhitelistedWithData"', async () => {
      await ssvNetwork.write.setOperatorsWhitelists([[3], [owners[3].account.address]], {
        account: owners[0].account,
      });

      await ssvNetwork.write.setOperatorsPrivateUnchecked([[3]], {
        account: owners[0].account,
      });

      await expect(
        ssvNetwork.write.registerValidator(
          [
            DataGenerator.publicKey(1),
            DEFAULT_OPERATOR_IDS[4],
            await DataGenerator.shares(2, 1, DEFAULT_OPERATOR_IDS[4]),
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
      ).to.be.rejectedWith('CallerNotWhitelistedWithData');
    });

    it('Register using non-authorized account for 1 operator with 4 operators cluster reverts "CallerNotWhitelistedWithData"', async () => {
      await ssvNetwork.write.setOperatorsPrivateUnchecked([[2]]);

      await expect(
        ssvNetwork.write.registerValidator(
          [
            DataGenerator.publicKey(1),
            DEFAULT_OPERATOR_IDS[4],
            await DataGenerator.shares(2, 1, DEFAULT_OPERATOR_IDS[4]),
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
      ).to.be.rejectedWith('CallerNotWhitelistedWithData');
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
      const shares = await DataGenerator.shares(3, 1, [4, 5, 6, 7]);

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
        args: ['0xabcd', CONFIG.minimalOperatorFee, true],
        account: owners[0].account,
      });

      await ssvNetwork.write.registerOperator(['0xabcd', CONFIG.minimalOperatorFee, true]);
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

      await ssvNetwork.write.registerValidator(
        [
          pk,
          [1, 2, 3, beneficiaryOperatorId],
          MOCK_SHARES,
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

      // AttackerContract starts the attact
      await expect(
        attackerContract.write.startAttack(
          [
            pk,
            [1, 2, beneficiaryOperatorId, goodOperatorId],
            MOCK_SHARES,
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

      it('Register using whitelisting contract and SSV whitelisting module for 2 operators', async () => {
        // Account A whitelists account B on SSV whitelisting module
        // Account A adds a whitelisting contract
        // Account A adds account C to that whitelist contract
        // Register validator with account B and C both work

        // Account A = owners[0]
        // Account B = owners[3]
        // Account C = owners[4]

        // Account A whitelists account B on SSV whitelisting module (operator 5)
        await ssvNetwork.write.setOperatorsWhitelists([[5], [owners[3].account.address]]);

        // Account A adds account C to that whitelist contract
        const whitelistingContract = await hre.viem.deployContract(
          'MockWhitelistingContract',
          [[owners[4].account.address]],
          {
            client: owners[0].client,
          },
        );
        const whitelistingContractAddress = await whitelistingContract.address;

        // Account A adds a whitelisting contract (operator 6)
        await ssvNetwork.write.setOperatorsWhitelistingContract([[6], whitelistingContractAddress], {
          account: owners[0].account,
        });

        await ssvNetwork.write.setOperatorsPrivateUnchecked([[5, 6]], {
          account: owners[0].account,
        });

        await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[3].account });

        // Register validator with account B works
        await assertEvent(
          ssvNetwork.write.registerValidator(
            [
              DataGenerator.publicKey(1),
              [2, 3, 4, 5],
              MOCK_SHARES,
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
          [
            {
              contract: ssvNetwork,
              eventName: 'ValidatorAdded',
              argNames: ['owner', 'operatorIds'],
              argValuesList: [[owners[3].account.address, [2, 3, 4, 5]]],
            },
          ],
        );

        // Check the operator 5 increased validatorCount
        expect(await ssvViews.read.getOperatorById([5])).to.deep.equal([
          owners[0].account.address, // owner
          CONFIG.minimalOperatorFee, // fee
          1,
          ethers.ZeroAddress,
          true, // isPrivate
          true, // active
        ]);

        await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[4].account });

        // Register validator with account C works
        await assertEvent(
          ssvNetwork.write.registerValidator(
            [
              DataGenerator.publicKey(1),
              [6, 7, 8, 9],
              MOCK_SHARES,
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
          [
            {
              contract: ssvNetwork,
              eventName: 'ValidatorAdded',
              argNames: ['owner', 'operatorIds'],
              argValuesList: [[owners[4].account.address, [6, 7, 8, 9]]],
            },
          ],
        );

        // Check the operator 6 increased validatorCount
        expect(await ssvViews.read.getOperatorById([6])).to.deep.equal([
          owners[0].account.address, // owner
          CONFIG.minimalOperatorFee, // fee
          1,
          whitelistingContractAddress,
          true, // isPrivate
          true, // active
        ]);
      });

      it('Register using whitelisting contract for 1 operator in 4 operators cluster gas limits/events/logic', async () => {
        await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[3].account });

        const pk = DataGenerator.publicKey(1);
        const shares = await DataGenerator.shares(3, 1, [4, 5, 6, 7]);

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
              [await DataGenerator.shares(3, 11, [4, 5, 6, 7])],
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
            await DataGenerator.shares(3, 1, [4, 5, 6, 7]),
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

        await ssvNetwork.write.setOperatorsWhitelists([[6], [owners[3].account.address]]);

        await ssvNetwork.write.setOperatorsPrivateUnchecked([[6]]);

        await ssvNetwork.write.registerValidator(
          [
            DataGenerator.publicKey(1),
            [4, 5, 6, 7],
            await DataGenerator.shares(3, 1, [4, 5, 6, 7]),
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

      it('Register using whitelisting contract with an unauthorized account reverts "CallerNotWhitelistedWithData"', async () => {
        await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[4].account });

        const pk = DataGenerator.publicKey(1);
        const shares = await DataGenerator.shares(4, 1, [4, 5, 6, 7]);

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
        ).to.be.rejectedWith('CallerNotWhitelistedWithData');
      });

      it('Register using whitelisting contract but a public operator allows registration', async () => {
        // This test checks a non-whitelisted account (owners[4]) in a whitelisting contract
        // can register validators in a public operator

        await ssvNetwork.write.setOperatorsPublicUnchecked([[4]], {
          account: owners[0].account,
        });

        await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[4].account });

        const pk = DataGenerator.publicKey(1);
        const shares = await DataGenerator.shares(4, 1, [4, 5, 6, 7]);

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
  describe('Whitelist Edge Cases Tests', () => {
    it('WT-1 - Register validator, 13 whitelisted operators, 1 block index each', async () => {
      const minDepositAmount = (BigInt(CONFIG.minimalBlocksBeforeLiquidation) + 2n) * CONFIG.minimalOperatorFee * 13n;

      await registerOperators(2, 3100, CONFIG.minimalOperatorFee);

      const operatorIds = [2, 258, 514, 770, 1026, 1282, 1538, 1794, 2050, 2306, 2562, 2818, 3074];

      await ssvNetwork.write.setOperatorsWhitelists([operatorIds, [owners[3].account.address]], {
        account: owners[2].account,
      });

      await ssvNetwork.write.setOperatorsPrivateUnchecked([operatorIds], {
        account: owners[2].account,
      });

      await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[3].account });

      await ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          operatorIds,
          await DataGenerator.shares(3, 1, operatorIds),
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

      for (let i = 0; i < operatorIds.length; i++) {
        const operatorData = await ssvViews.read.getOperatorById([operatorIds[i]]);
        expect(operatorData[2]).to.be.equal(1);
      }
    });

    it('WT-2 - Register 2 validators using 2 accounts and remove the first', async () => {
      // 1. Account A registers a validator [1,2,3,4] (all public)
      // 2. Whitelist operator without that owner from above (make 1 private account B)
      // 3. Trying to register another validator fails using account A
      // 4. Remove validator from step 1 and check cluster.validatorCount = 0

      // operators' owner -> owners[1]
      // Account A -> owners[2]
      // Account B -> owners[3]

      // Step 1
      const minDepositAmount = (BigInt(CONFIG.minimalBlocksBeforeLiquidation) + 2n) * CONFIG.minimalOperatorFee * 4n;

      await registerOperators(1, 4, CONFIG.minimalOperatorFee);

      await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[2].account });
      let clusterData = await trackGas(
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
          { account: owners[2].account },
        ),
      );

      clusterData = clusterData.eventsByName.ValidatorAdded[0].args;

      // Step 2
      await ssvNetwork.write.setOperatorsWhitelists([[2], [owners[3].account.address]], {
        account: owners[1].account,
      });
      await ssvNetwork.write.setOperatorsPrivateUnchecked([[2]], {
        account: owners[1].account,
      });

      // Step 3
      await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[2].account });
      await expect(
        ssvNetwork.write.registerValidator(
          [
            DataGenerator.publicKey(2),
            DEFAULT_OPERATOR_IDS[4],
            await DataGenerator.shares(1, 2, DEFAULT_OPERATOR_IDS[4]),
            minDepositAmount,
            clusterData.cluster,
          ],
          { account: owners[2].account },
        ),
      ).to.be.rejectedWith('CallerNotWhitelistedWithData');

      // Step 4
      clusterData = await trackGas(
        ssvNetwork.write.removeValidator([DataGenerator.publicKey(1), DEFAULT_OPERATOR_IDS[4], clusterData.cluster], {
          account: owners[2].account,
        }),
      );

      clusterData = clusterData.eventsByName.ValidatorRemoved[0].args;

      expect(clusterData.cluster.validatorCount).to.be.equal(0);
    });
  });
});

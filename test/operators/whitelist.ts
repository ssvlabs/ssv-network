// Declare imports
import hre from 'hardhat';

import { owners, initializeContract, registerOperators, DataGenerator, CONFIG } from '../helpers/contract-helpers';
import { assertEvent } from '../helpers/utils/test';
import { trackGas, GasGroup } from '../helpers/gas-usage';

import { ethers } from 'hardhat';
import { expect } from 'chai';

// Declare globals
let ssvNetwork: any, ssvViews: any, mockWhitelistingContract: any, mockWhitelistingContractAddress: any;
const OPERATOR_IDS_10 = Array.from({ length: 10 }, (_, i) => i + 1);

describe('Whitelisting Operator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = await initializeContract();
    ssvNetwork = metadata.ssvNetwork;
    ssvViews = metadata.ssvNetworkViews;

    mockWhitelistingContract = await hre.viem.deployContract('MockWhitelistingContract', [[]], {
      client: owners[0].client,
    });
    mockWhitelistingContractAddress = await mockWhitelistingContract.address;
  });

  /* GAS LIMITS */
  it('Set operator whitelisting contract (1 operator) gas limits', async () => {
    await ssvNetwork.write.registerOperator([DataGenerator.publicKey(0), CONFIG.minimalOperatorFee], {
      account: owners[1].account,
    });
    await trackGas(
      ssvNetwork.write.setOperatorsWhitelistingContract([[1], mockWhitelistingContractAddress], {
        account: owners[1].account,
      }),
      [GasGroup.SET_OPERATOR_WHITELISTING_CONTRACT],
    );
  });

  it('Update operator whitelisting contract (1 operator) gas limits', async () => {
    await ssvNetwork.write.registerOperator([DataGenerator.publicKey(0), CONFIG.minimalOperatorFee], {
      account: owners[1].account,
    });

    const fakeWhitelistingContract = await hre.viem.deployContract(
      'FakeWhitelistingContract',
      [await ssvNetwork.address],
      {
        client: owners[0].client,
      },
    );

    ssvNetwork.write.setOperatorsWhitelistingContract([[1], await fakeWhitelistingContract.address], {
      account: owners[1].account,
    });

    await trackGas(
      ssvNetwork.write.setOperatorsWhitelistingContract([[1], mockWhitelistingContractAddress], {
        account: owners[1].account,
      }),
      [GasGroup.SET_OPERATOR_WHITELISTING_CONTRACT],
    );
  });

  it('Set operator whitelisting contract (10 operators) gas limits', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    await trackGas(
      ssvNetwork.write.setOperatorsWhitelistingContract([OPERATOR_IDS_10, mockWhitelistingContractAddress], {
        account: owners[1].account,
      }),
      [GasGroup.SET_OPERATOR_WHITELISTING_CONTRACT_10],
    );
  });

  it('Remove operator whitelisting contract (1 operator) gas limits', async () => {
    await ssvNetwork.write.registerOperator([DataGenerator.publicKey(0), CONFIG.minimalOperatorFee], {
      account: owners[1].account,
    });

    await ssvNetwork.write.setOperatorsWhitelistingContract([[1], mockWhitelistingContractAddress], {
      account: owners[1].account,
    });

    await trackGas(
      ssvNetwork.write.removeOperatorsWhitelistingContract([[1]], {
        account: owners[1].account,
      }),
      [GasGroup.REMOVE_OPERATOR_WHITELISTING_CONTRACT],
    );
  });

  it('Remove operator whitelisting contract (10 operators) gas limits', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    await ssvNetwork.write.setOperatorsWhitelistingContract([OPERATOR_IDS_10, mockWhitelistingContractAddress], {
      account: owners[1].account,
    });

    await trackGas(
      ssvNetwork.write.removeOperatorsWhitelistingContract([OPERATOR_IDS_10], {
        account: owners[1].account,
      }),
      [GasGroup.REMOVE_OPERATOR_WHITELISTING_CONTRACT_10],
    );
  });

  it('Set 10 whitelist addresses (EOAs) for 10 operators gas limits', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    const whitelistAddresses = owners.slice(0, 10).map(owner => owner.account.address);

    await trackGas(
      ssvNetwork.write.setOperatosWhitelists([OPERATOR_IDS_10, whitelistAddresses], {
        account: owners[1].account,
      }),
      [GasGroup.SET_MULTIPLE_OPERATOR_WHITELIST_10_10],
    );ƒ
  });

  it('Remove 10 whitelist addresses (EOAs) for 10 operators gas limits', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);
    const whitelistAddresses = owners.slice(0, 10).map(owner => owner.account.address);

    await ssvNetwork.write.setOperatosWhitelists([OPERATOR_IDS_10, whitelistAddresses], {
      account: owners[1].account,
    });

    await trackGas(
      ssvNetwork.write.removeOperatorsWhitelists([OPERATOR_IDS_10, whitelistAddresses], {
        account: owners[1].account,
      }),
      [GasGroup.REMOVE_MULTIPLE_OPERATOR_WHITELIST_10_10],
    );
  });

  it('Set operators private (10 operators) gas limits', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    await trackGas(
      ssvNetwork.write.setOperatorsPrivateUnchecked([OPERATOR_IDS_10], {
        account: owners[1].account,
      }),
      [GasGroup.SET_OPERATORS_PRIVATE_10],
    );
  });

  it('Set operators public (10 operators) gas limits', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    await ssvNetwork.write.setOperatorsPrivateUnchecked([OPERATOR_IDS_10], {
      account: owners[1].account,
    });

    await trackGas(
      ssvNetwork.write.setOperatorsPublicUnchecked([OPERATOR_IDS_10], {
        account: owners[1].account,
      }),
      [GasGroup.SET_OPERATORS_PUBLIC_10],
    );
  });

  /* EVENTS */
  it('Set operator whitelisting contract (10 operators) emits "OperatorWhitelistingContractUpdated"', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    await assertEvent(
      ssvNetwork.write.setOperatorsWhitelistingContract([OPERATOR_IDS_10, mockWhitelistingContractAddress], {
        account: owners[1].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'OperatorWhitelistingContractUpdated',
          argNames: ['operatorIds', 'whitelistingContract'],
          argValuesList: [[OPERATOR_IDS_10, mockWhitelistingContractAddress]],
        },
      ],
    );
  });

  it('Remove operator whitelisting contract (10 operators) emits "OperatorWhitelistingContractUpdated"', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    await ssvNetwork.write.setOperatorsWhitelistingContract([OPERATOR_IDS_10, mockWhitelistingContractAddress], {
      account: owners[1].account,
    });

    await assertEvent(
      ssvNetwork.write.removeOperatorsWhitelistingContract([OPERATOR_IDS_10], {
        account: owners[1].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'OperatorWhitelistingContractUpdated',
          argNames: ['operatorIds', 'whitelistingContract'],
          argValuesList: [[OPERATOR_IDS_10, ethers.ZeroAddress]],
        },
      ],
    );
  });

  it('Set 10 whitelist addresses (EOAs) for 10 operators emits "OperatorMultipleWhitelistUpdated"', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    const whitelistAddresses = owners.slice(0, 10).map(owner => owner.account.address);

    await assertEvent(
      ssvNetwork.write.setOperatosWhitelists([OPERATOR_IDS_10, whitelistAddresses], {
        account: owners[1].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'OperatorMultipleWhitelistUpdated',
          argNames: ['operatorIds', 'whitelistAddresses'],
          argValuesList: [[OPERATOR_IDS_10, whitelistAddresses]],
        },
      ],
    );
  });

  it('Remove 10 whitelist addresses (EOAs) for 10 operators emits "OperatorMultipleWhitelistRemoved"', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);
    const whitelistAddresses = owners.slice(0, 10).map(owner => owner.account.address);

    await ssvNetwork.write.setOperatosWhitelists([OPERATOR_IDS_10, whitelistAddresses], {
      account: owners[1].account,
    });

    await assertEvent(
      ssvNetwork.write.removeOperatorsWhitelists([OPERATOR_IDS_10, whitelistAddresses], {
        account: owners[1].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'OperatorMultipleWhitelistRemoved',
          argNames: ['operatorIds', 'whitelistAddresses'],
          argValuesList: [[OPERATOR_IDS_10, whitelistAddresses]],
        },
      ],
    );
  });

  it('Set operators private (10 operators) emits "OperatorPrivacyStatusUpdated"', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    await assertEvent(
      ssvNetwork.write.setOperatorsPrivateUnchecked([OPERATOR_IDS_10], {
        account: owners[1].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'OperatorPrivacyStatusUpdated',
          argNames: ['operatorIds', 'toPrivate'],
          argValuesList: [[OPERATOR_IDS_10, true]],
        },
      ],
    );
  });

  it('Set operators public (10 operators) emits "OperatorPrivacyStatusUpdated"', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    await assertEvent(
      ssvNetwork.write.setOperatorsPublicUnchecked([OPERATOR_IDS_10], {
        account: owners[1].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'OperatorPrivacyStatusUpdated',
          argNames: ['operatorIds', 'toPrivate'],
          argValuesList: [[OPERATOR_IDS_10, false]],
        },
      ],
    );
  });

  /* REVERTS */
  it('Set operator whitelisted address (EOA) in non-existing operator reverts "OperatorDoesNotExist"', async () => {
    await expect(ssvNetwork.write.setOperatosWhitelists([[1], [owners[2].account.address]])).to.be.rejectedWith(
      'OperatorDoesNotExist',
    );
  });

  it('Set multiple operator whitelisted addresses (zero address) reverts "ZeroAddressNotAllowed"', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    await expect(
      ssvNetwork.write.setOperatosWhitelists([OPERATOR_IDS_10, [ethers.ZeroAddress]], {
        account: owners[1].account,
      }),
    ).to.be.rejectedWith('ZeroAddressNotAllowed');
  });

  it('Non-owner sets multiple operator whitelisted addresses (EOA) reverts "CallerNotOwnerWithData"', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    const whitelistAddresses = owners.slice(0, 10).map(owner => owner.account.address);

    await expect(
      ssvNetwork.write.setOperatosWhitelists([OPERATOR_IDS_10, whitelistAddresses], {
        account: owners[2].account,
      }),
    ).to.be.rejectedWith('CallerNotOwnerWithData');
  });

  it('Set multiple operator whitelisted addresses (EOA) with empty operator IDs reverts "InvalidOperatorIdsLength"', async () => {
    const whitelistAddresses = owners.slice(0, 10).map(owner => owner.account.address);

    await expect(ssvNetwork.write.setOperatosWhitelists([[], whitelistAddresses])).to.be.rejectedWith(
      'InvalidOperatorIdsLength',
    );
  });

  it('Set multiple operator whitelisted addresses (EOA) with empty addresses IDs reverts "InvalidWhitelistAddressesLength"', async () => {
    await expect(ssvNetwork.write.setOperatosWhitelists([OPERATOR_IDS_10, []])).to.be.rejectedWith(
      'InvalidWhitelistAddressesLength',
    );
  });

  it('Set multiple operator whitelisted addresses (EOA) passing unsorted operator IDs reverts "UnsortedOperatorsList"', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    const whitelistAddresses = owners.slice(0, 10).map(owner => owner.account.address);

    const unsortedOperatorIds = [1, 3, 2, 4, 5];
    await expect(
      ssvNetwork.write.setOperatosWhitelists([unsortedOperatorIds, whitelistAddresses], {
        account: owners[1].account,
      }),
    ).to.be.rejectedWith('UnsortedOperatorsList');
  });

  it('Set multiple operator whitelisted addresses (EOA) passing a whitelisting contract reverts "AddressIsWhitelistingContract"', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    const whitelistAddresses = owners.slice(0, 10).map(owner => owner.account.address);
    whitelistAddresses.push(mockWhitelistingContractAddress);

    await expect(
      ssvNetwork.write.setOperatosWhitelists([OPERATOR_IDS_10, whitelistAddresses], {
        account: owners[1].account,
      }),
    ).to.be.rejectedWith('AddressIsWhitelistingContract', mockWhitelistingContractAddress);
  });

  it('Non-owner removes multiple operator whitelisted addresses (EOA) reverts "CallerNotOwnerWithData"', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    const whitelistAddresses = owners.slice(0, 10).map(owner => owner.account.address);

    await ssvNetwork.write.setOperatosWhitelists([OPERATOR_IDS_10, whitelistAddresses], {
      account: owners[1].account,
    });

    await expect(
      ssvNetwork.write.removeOperatorsWhitelists([OPERATOR_IDS_10, whitelistAddresses], {
        account: owners[2].account,
      }),
    ).to.be.rejectedWith('CallerNotOwnerWithData');
  });

  it('Remove multiple operator whitelisted addresses (EOA) passing unsorted operator IDs reverts "UnsortedOperatorsList"', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    const whitelistAddresses = owners.slice(0, 10).map(owner => owner.account.address);

    const unsortedOperatorIds = [1, 3, 2, 4, 5];

    await expect(
      ssvNetwork.write.removeOperatorsWhitelists([unsortedOperatorIds, whitelistAddresses], {
        account: owners[1].account,
      }),
    ).to.be.rejectedWith('UnsortedOperatorsList');
  });

  it('Remove multiple operator whitelisted addresses (EOA) with empty operator IDs reverts "InvalidOperatorIdsLength"', async () => {
    const whitelistAddresses = owners.slice(0, 10).map(owner => owner.account.address);

    await expect(ssvNetwork.write.removeOperatorsWhitelists([[], whitelistAddresses])).to.be.rejectedWith(
      'InvalidOperatorIdsLength',
    );
  });

  it('Remove multiple operator whitelisted addresses (EOA) with empty addresses IDs reverts "InvalidWhitelistAddressesLength"', async () => {
    await expect(ssvNetwork.write.removeOperatorsWhitelists([OPERATOR_IDS_10, []])).to.be.rejectedWith(
      'InvalidWhitelistAddressesLength',
    );
  });

  it('Remove multiple operator whitelisted addresses (EOA) passing a whitelisting contract reverts "AddressIsWhitelistingContract"', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    const whitelistAddresses = owners.slice(0, 10).map(owner => owner.account.address);
    whitelistAddresses.push(mockWhitelistingContractAddress);

    await expect(
      ssvNetwork.write.removeOperatorsWhitelists([OPERATOR_IDS_10, whitelistAddresses], {
        account: owners[1].account,
      }),
    ).to.be.rejectedWith('AddressIsWhitelistingContract', mockWhitelistingContractAddress);
  });

  it('Set operator whitelisting contract with an EOA reverts "InvalidWhitelistingContract"', async () => {
    await expect(
      ssvNetwork.write.setOperatorsWhitelistingContract([OPERATOR_IDS_10, owners[2].account.address]),
    ).to.be.rejectedWith('InvalidWhitelistingContract');
  });

  it('Set operator whitelisting contract with empty operator IDs reverts "InvalidOperatorIdsLength"', async () => {
    await expect(
      ssvNetwork.write.setOperatorsWhitelistingContract([[], mockWhitelistingContractAddress]),
    ).to.be.rejectedWith('InvalidOperatorIdsLength');
  });

  it('Non-owner sets operator whitelisting contract reverts "CallerNotOwnerWithData"', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    await expect(
      ssvNetwork.write.setOperatorsWhitelistingContract([OPERATOR_IDS_10, mockWhitelistingContractAddress], {
        account: owners[2].account,
      }),
    ).to.be.rejectedWith('CallerNotOwnerWithData');
  });

  it('Sets operator whitelisting contract for a non-existing operator reverts "OperatorDoesNotExist"', async () => {
    await expect(
      ssvNetwork.write.setOperatorsWhitelistingContract([OPERATOR_IDS_10, mockWhitelistingContractAddress]),
    ).to.be.rejectedWith('OperatorDoesNotExist');
  });

  it('Remove operator whitelisting contract with empty operator IDs reverts "InvalidOperatorIdsLength"', async () => {
    await expect(ssvNetwork.write.removeOperatorsWhitelistingContract([[]])).to.be.rejectedWith(
      'InvalidOperatorIdsLength',
    );
  });

  it('Non-owner removes operator whitelisting contract reverts "CallerNotOwnerWithData"', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    await expect(
      ssvNetwork.write.removeOperatorsWhitelistingContract([OPERATOR_IDS_10], {
        account: owners[2].account,
      }),
    ).to.be.rejectedWith('CallerNotOwnerWithData');
  });

  it('Set operators private with empty operator IDs reverts "InvalidOperatorIdsLength"', async () => {
    await expect(ssvNetwork.write.setOperatorsPrivateUnchecked([[]])).to.be.rejectedWith('InvalidOperatorIdsLength');
  });

  it('Set operators public with empty operator IDs reverts "InvalidOperatorIdsLength"', async () => {
    await expect(ssvNetwork.write.setOperatorsPublicUnchecked([[]])).to.be.rejectedWith('InvalidOperatorIdsLength');
  });

  it('Non-owner set operators private reverts "CallerNotOwnerWithData"', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    await expect(
      ssvNetwork.write.setOperatorsPrivateUnchecked([OPERATOR_IDS_10], {
        account: owners[2].account,
      }),
    ).to.be.rejectedWith('CallerNotOwnerWithData');
  });

  it('Non-owner set operators public reverts "CallerNotOwnerWithData"', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    await expect(
      ssvNetwork.write.setOperatorsPublicUnchecked([OPERATOR_IDS_10], {
        account: owners[2].account,
      }),
    ).to.be.rejectedWith('CallerNotOwnerWithData');
  });

  it('Whitelist accounts passing repeated operator IDs reverts "OperatorsListNotUnique"', async () => {
    // register 10 operators
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    await expect(
      ssvNetwork.write.setOperatosWhitelists(
        [
          [2, 2, 2, 2, 4, 4, 4, 4, 6, 6, 6, 6, 8, 8, 8, 8],
          [owners[4].account.address, owners[5].account.address],
        ],
        {
          account: owners[1].account,
        },
      ),
    ).to.be.rejectedWith('OperatorsListNotUnique');
  });

  it('Remove whitelist addresses passing repeated operator IDs reverts "OperatorsListNotUnique"', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);
    const whitelistAddresses = owners.slice(0, 10).map(owner => owner.account.address);

    await ssvNetwork.write.setOperatosWhitelists([OPERATOR_IDS_10, whitelistAddresses], {
      account: owners[1].account,
    });

    await expect(
      ssvNetwork.write.removeOperatorsWhitelists(
        [[2, 2, 2, 2, 4, 4, 4, 4, 6, 6, 6, 6, 8, 8, 8, 8], whitelistAddresses],
        {
          account: owners[1].account,
        },
      ),
    ).to.be.rejectedWith('OperatorsListNotUnique');
  });

  /* LOGIC */

  it('Get whitelisted address for no operators returns empty list', async () => {
    expect(await ssvViews.read.getWhitelistedOperators([[], owners[1].account.address])).to.be.deep.equal([]);
  });

  it('Get whitelisted zero address for operators returns empty list', async () => {
    expect(await ssvViews.read.getWhitelistedOperators([[1, 2], ethers.ZeroAddress])).to.be.deep.equal([]);
  });

  it('Get whitelisted address for operators returns only the whitelisted operators', async () => {
    const whitelistAddress = owners[4].account.address;

    // Register 1000 operators to have 4 bitmap blocks
    await registerOperators(1, 1000, CONFIG.minimalOperatorFee);

    await ssvNetwork.write.setOperatosWhitelists([[100, 200, 300, 400, 500, 600, 700, 800], [whitelistAddress]], {
      account: owners[1].account,
    });

    expect(await ssvViews.read.getWhitelistedOperators([[100, 200], whitelistAddress])).to.be.deep.equal([100, 200]);
    expect(await ssvViews.read.getWhitelistedOperators([[200, 400, 600, 800], whitelistAddress])).to.be.deep.equal([
      200, 400, 600, 800,
    ]);
    expect(
      await ssvViews.read.getWhitelistedOperators([[1, 60, 150, 200, 320, 400, 512, 715, 800, 905], whitelistAddress]),
    ).to.be.deep.equal([200, 400, 800]);
    expect(
      await ssvViews.read.getWhitelistedOperators([[1, 60, 150, 320, 512, 715, 905], whitelistAddress]),
    ).to.be.deep.equal([]);
  });

  it('Get private operator by id', async () => {
    await ssvNetwork.write.registerOperator([DataGenerator.publicKey(0), CONFIG.minimalOperatorFee], {
      account: owners[1].account,
    });

    await ssvNetwork.write.setOperatorsWhitelistingContract([[1], mockWhitelistingContractAddress], {
      account: owners[1].account,
    });

    await ssvNetwork.write.setOperatorsPrivateUnchecked([[1]], {
      account: owners[1].account,
    });

    expect(await ssvViews.read.getOperatorById([1])).to.deep.equal([
      owners[1].account.address, // owner
      CONFIG.minimalOperatorFee, // fee
      0, // validatorCount
      mockWhitelistingContractAddress, // whitelisting contract address
      true, // isPrivate
      true, // active
    ]);
  });

  it('Get removed private operator by id', async () => {
    await ssvNetwork.write.registerOperator([DataGenerator.publicKey(0), CONFIG.minimalOperatorFee], {
      account: owners[1].account,
    });

    await ssvNetwork.write.setOperatorsWhitelistingContract([[1], mockWhitelistingContractAddress], {
      account: owners[1].account,
    });

    await ssvNetwork.write.removeOperator([1], {
      account: owners[1].account,
    });

    expect(await ssvViews.read.getOperatorById([1])).to.deep.equal([
      owners[1].account.address, // owner
      0, // fee
      0, // validatorCount
      ethers.ZeroAddress, // whitelisting contract address
      false, // isPrivate
      false, // active
    ]);
  });

  it('Check if an address is a whitelisting contract', async () => {
    // whitelisting contract
    expect(await ssvViews.read.isWhitelistingContract([mockWhitelistingContractAddress])).to.be.true;
    // EOA
    expect(await ssvViews.read.isWhitelistingContract([owners[1].account.address])).to.be.false;
    // generic contract
    expect(await ssvViews.read.isWhitelistingContract([ssvViews.address])).to.be.false;
  });

  it('Set operators private (10 operators)', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    await ssvNetwork.write.setOperatorsPrivateUnchecked([OPERATOR_IDS_10], {
      account: owners[1].account,
    });

    for (let i = 0; i < OPERATOR_IDS_10.length; i++) {
      const operatorData = await ssvViews.read.getOperatorById([OPERATOR_IDS_10[i]]);
      expect(operatorData[4]).to.be.true;
    }
  });

  it('Set operators private (10 operators)', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    await ssvNetwork.write.setOperatorsPrivateUnchecked([OPERATOR_IDS_10], {
      account: owners[1].account,
    });

    await ssvNetwork.write.setOperatorsPublicUnchecked([OPERATOR_IDS_10], {
      account: owners[1].account,
    });

    for (let i = 0; i < OPERATOR_IDS_10.length; i++) {
      const operatorData = await ssvViews.read.getOperatorById([OPERATOR_IDS_10[i]]);
      expect(operatorData[4]).to.be.false;
    }
  });

  it('Check account is whitelisted in a whitelisting contract', async () => {
    await mockWhitelistingContract.write.setWhitelistedAddress([owners[4].account.address]);

    expect(
      await ssvViews.read.isAddressWhitelistedInWhitelistingContract([
        owners[4].account.address,
        0,
        mockWhitelistingContractAddress,
      ]),
    ).to.be.true;
  });

  it('Check account is not whitelisted in a whitelisting contract', async () => {
    await mockWhitelistingContract.write.setWhitelistedAddress([owners[4].account.address]);

    expect(
      await ssvViews.read.isAddressWhitelistedInWhitelistingContract([
        owners[2].account.address,
        0,
        mockWhitelistingContractAddress,
      ]),
    ).to.be.false;
  });

  it('Check address(0) account in a whitelisting contract', async () => {
    await mockWhitelistingContract.write.setWhitelistedAddress([owners[4].account.address]);

    expect(
      await ssvViews.read.isAddressWhitelistedInWhitelistingContract([
        ethers.ZeroAddress,
        0,
        mockWhitelistingContractAddress,
      ]),
    ).to.be.false;
  });

  it('Check account in an address(0) contract', async () => {
    expect(
      await ssvViews.read.isAddressWhitelistedInWhitelistingContract([
        owners[2].account.address,
        0,
        ethers.ZeroAddress,
      ]),
    ).to.be.false;
  });

  it('Set multiple whitelisted addresses to one operator', async () => {
    await registerOperators(1, 1, CONFIG.minimalOperatorFee);

    const whitelistAddresses = owners.slice(0, 10).map(owner => owner.account.address);

    await assertEvent(
      ssvNetwork.write.setOperatosWhitelists([[1], whitelistAddresses], {
        account: owners[1].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'OperatorMultipleWhitelistUpdated',
          argNames: ['operatorIds', 'whitelistAddresses'],
          argValuesList: [[[1], whitelistAddresses]],
        },
      ],
    );

    for (let i = 0; i < whitelistAddresses.length; i++) {
      expect(
        await ssvViews.read.getWhitelistedOperators([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], whitelistAddresses[i]]),
      ).to.be.deep.equal([1]);
    }

    expect(
      await ssvViews.read.getWhitelistedOperators([[1, 2, 3, 4, 5, 6, 7, 8, 9, 10], owners[11].account.address]),
    ).to.be.deep.equal([]);
  });

  it('Set 10 whitelist addresses (EOAs) for 10 operators', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    const whitelistAddresses = owners.slice(0, 10).map(owner => owner.account.address);

    await assertEvent(
      ssvNetwork.write.setOperatosWhitelists([OPERATOR_IDS_10, whitelistAddresses], {
        account: owners[1].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'OperatorMultipleWhitelistUpdated',
          argNames: ['operatorIds', 'whitelistAddresses'],
          argValuesList: [[OPERATOR_IDS_10, whitelistAddresses]],
        },
      ],
    );

    for (let i = 0; i < whitelistAddresses.length; i++) {
      expect(await ssvViews.read.getWhitelistedOperators([OPERATOR_IDS_10, whitelistAddresses[i]])).to.be.deep.equal(
        OPERATOR_IDS_10,
      );
      expect(await ssvViews.read.getWhitelistedOperators([[500], whitelistAddresses[i]])).to.be.deep.equal([]);
    }
  });

  it('Set 1 whitelist addresses for 1 operator', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    await assertEvent(
      ssvNetwork.write.setOperatosWhitelists([[2], [owners[3].account.address]], {
        account: owners[1].account,
      }),
      [
        {
          contract: ssvNetwork,
          eventName: 'OperatorMultipleWhitelistUpdated',
          argNames: ['operatorIds', 'whitelistAddresses'],
          argValuesList: [[[2], [owners[3].account.address]]],
        },
      ],
    );

    expect(await ssvViews.read.getWhitelistedOperators([OPERATOR_IDS_10, owners[3].account.address])).to.be.deep.equal([
      2,
    ]);
    expect(await ssvViews.read.getWhitelistedOperators([OPERATOR_IDS_10, owners[2].account.address])).to.be.deep.equal(
      [],
    );
  });
});

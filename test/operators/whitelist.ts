// Declare imports
import hre from 'hardhat';

import { owners, initializeContract, registerOperators, DataGenerator, CONFIG } from '../helpers/contract-helpers';
import { assertEvent } from '../helpers/utils/test';
import { trackGas, GasGroup } from '../helpers/gas-usage';

import { ethers } from 'hardhat';
import { expect } from 'chai';

import { mine } from '@nomicfoundation/hardhat-network-helpers';

// Declare globals
let ssvNetwork: any, ssvViews: any, ssvToken: any, mockWhitelistingContract: any, mockWhitelistingContractAddress: any;
const OPERATOR_IDS_10 = Array.from({ length: 10 }, (_, i) => i + 1);

describe('Whitelisting Operator Tests', () => {
  beforeEach(async () => {
    // Initialize contract
    const metadata = await initializeContract();
    ssvNetwork = metadata.ssvNetwork;
    ssvViews = metadata.ssvNetworkViews;
    ssvToken = metadata.ssvToken;

    mockWhitelistingContract = await hre.viem.deployContract('MockWhitelistingContract', [[]], {
      client: owners[0].client,
    });
    mockWhitelistingContractAddress = await mockWhitelistingContract.address;
  });

  /* GAS LIMITS */
  it('Set operator whitelisting contract (1 operator) gas limits', async () => {
    await ssvNetwork.write.registerOperator([DataGenerator.publicKey(0), CONFIG.minimalOperatorFee, true], {
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
    await ssvNetwork.write.registerOperator([DataGenerator.publicKey(0), CONFIG.minimalOperatorFee, true], {
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
    await ssvNetwork.write.registerOperator([DataGenerator.publicKey(0), CONFIG.minimalOperatorFee, true], {
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
      ssvNetwork.write.setOperatorsWhitelists([OPERATOR_IDS_10, whitelistAddresses], {
        account: owners[1].account,
      }),
      [GasGroup.SET_MULTIPLE_OPERATOR_WHITELIST_10_10],
    );
  });

  it('Remove 10 whitelist addresses (EOAs) for 10 operators gas limits', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);
    const whitelistAddresses = owners.slice(0, 10).map(owner => owner.account.address);

    await ssvNetwork.write.setOperatorsWhitelists([OPERATOR_IDS_10, whitelistAddresses], {
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
      ssvNetwork.write.setOperatorsWhitelists([OPERATOR_IDS_10, whitelistAddresses], {
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

    await ssvNetwork.write.setOperatorsWhitelists([OPERATOR_IDS_10, whitelistAddresses], {
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
    await expect(ssvNetwork.write.setOperatorsWhitelists([[1], [owners[2].account.address]])).to.be.rejectedWith(
      'OperatorDoesNotExist',
    );
  });

  it('Set multiple operator whitelisted addresses (zero address) reverts "ZeroAddressNotAllowed"', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    await expect(
      ssvNetwork.write.setOperatorsWhitelists([OPERATOR_IDS_10, [ethers.ZeroAddress]], {
        account: owners[1].account,
      }),
    ).to.be.rejectedWith('ZeroAddressNotAllowed');
  });

  it('Non-owner sets multiple operator whitelisted addresses (EOA) reverts "CallerNotOwnerWithData"', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    const whitelistAddresses = owners.slice(0, 10).map(owner => owner.account.address);

    await expect(
      ssvNetwork.write.setOperatorsWhitelists([OPERATOR_IDS_10, whitelistAddresses], {
        account: owners[2].account,
      }),
    ).to.be.rejectedWith('CallerNotOwnerWithData');
  });

  it('Set multiple operator whitelisted addresses (EOA) with empty operator IDs reverts "InvalidOperatorIdsLength"', async () => {
    const whitelistAddresses = owners.slice(0, 10).map(owner => owner.account.address);

    await expect(ssvNetwork.write.setOperatorsWhitelists([[], whitelistAddresses])).to.be.rejectedWith(
      'InvalidOperatorIdsLength',
    );
  });

  it('Set multiple operator whitelisted addresses (EOA) with empty addresses IDs reverts "InvalidWhitelistAddressesLength"', async () => {
    await expect(ssvNetwork.write.setOperatorsWhitelists([OPERATOR_IDS_10, []])).to.be.rejectedWith(
      'InvalidWhitelistAddressesLength',
    );
  });

  it('Set multiple operator whitelisted addresses (EOA) passing unsorted operator IDs reverts "UnsortedOperatorsList"', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    const whitelistAddresses = owners.slice(0, 10).map(owner => owner.account.address);

    const unsortedOperatorIds = [1, 3, 2, 4, 5];
    await expect(
      ssvNetwork.write.setOperatorsWhitelists([unsortedOperatorIds, whitelistAddresses], {
        account: owners[1].account,
      }),
    ).to.be.rejectedWith('UnsortedOperatorsList');
  });

  it('Set multiple operator whitelisted addresses (EOA) passing a whitelisting contract reverts "AddressIsWhitelistingContract"', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    const whitelistAddresses = owners.slice(0, 10).map(owner => owner.account.address);
    whitelistAddresses.push(mockWhitelistingContractAddress);

    await expect(
      ssvNetwork.write.setOperatorsWhitelists([OPERATOR_IDS_10, whitelistAddresses], {
        account: owners[1].account,
      }),
    ).to.be.rejectedWith('AddressIsWhitelistingContract', mockWhitelistingContractAddress);
  });

  it('Non-owner removes multiple operator whitelisted addresses (EOA) reverts "CallerNotOwnerWithData"', async () => {
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    const whitelistAddresses = owners.slice(0, 10).map(owner => owner.account.address);

    await ssvNetwork.write.setOperatorsWhitelists([OPERATOR_IDS_10, whitelistAddresses], {
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
    ).to.not.be.rejectedWith('AddressIsWhitelistingContract', mockWhitelistingContractAddress);
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
      ssvNetwork.write.setOperatorsWhitelists(
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

    await ssvNetwork.write.setOperatorsWhitelists([OPERATOR_IDS_10, whitelistAddresses], {
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

  it('Get whitelisted address for operators returns the whitelisted operators (only SSV whitelisting module)', async () => {
    const whitelistAddress = owners[4].account.address;

    // Register 1000 operators to have 4 bitmap blocks
    await registerOperators(1, 1000, CONFIG.minimalOperatorFee);

    await ssvNetwork.write.setOperatorsWhitelists([[100, 200, 300, 400, 500, 600, 700, 800], [whitelistAddress]], {
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

  it('Get whitelisted address for operators returns the whitelisted operators (only externally whitelisted)', async () => {
    const whitelistAddress = owners[4].account.address;

    // Register 1000 operators to have 4 bitmap blocks
    await registerOperators(1, 1000, CONFIG.minimalOperatorFee);

    await ssvNetwork.write.setOperatorsWhitelistingContract(
      [[100, 200, 300, 400, 500, 600, 700, 800], mockWhitelistingContractAddress],
      {
        account: owners[1].account,
      },
    );

    await mockWhitelistingContract.write.setWhitelistedAddress([whitelistAddress]);

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

  it('Get whitelisted address for operators returns the whitelisted operators (internally and externally whitelisted)', async () => {
    const whitelistAddress = owners[4].account.address;

    // Register 1000 operators to have 4 bitmap blocks
    await registerOperators(1, 1000, CONFIG.minimalOperatorFee);

    // Whitelist using external whitelisting contract
    await ssvNetwork.write.setOperatorsWhitelistingContract([[100, 400, 700, 800], mockWhitelistingContractAddress], {
      account: owners[1].account,
    });

    await mockWhitelistingContract.write.setWhitelistedAddress([whitelistAddress]);

    // Whitelist using SSV whitelisting module
    await ssvNetwork.write.setOperatorsWhitelists([[200, 300, 500, 600], [whitelistAddress]], {
      account: owners[1].account,
    });

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

  it('Get whitelisted address for a single operator whitelisted both internally and externally', async () => {
    const whitelistAddress = owners[4].account.address;

    // Register operators
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    // Whitelist using external whitelisting contract
    await ssvNetwork.write.setOperatorsWhitelistingContract([[1], mockWhitelistingContractAddress], {
      account: owners[1].account,
    });

    await mockWhitelistingContract.write.setWhitelistedAddress([whitelistAddress]);

    // Whitelist using SSV whitelisting module
    await ssvNetwork.write.setOperatorsWhitelists([[1], [whitelistAddress]], {
      account: owners[1].account,
    });

    expect(await ssvViews.read.getWhitelistedOperators([[1], whitelistAddress])).to.be.deep.equal([1]);
  });

  it('Get whitelisted address for overlapping internal and external whitelisting', async () => {
    const whitelistAddress = owners[4].account.address;

    // Register operators
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    // Whitelist using external whitelisting contract
    await ssvNetwork.write.setOperatorsWhitelistingContract([[1, 2, 3], mockWhitelistingContractAddress], {
      account: owners[1].account,
    });

    await mockWhitelistingContract.write.setWhitelistedAddress([whitelistAddress]);

    // Whitelist using SSV whitelisting module
    await ssvNetwork.write.setOperatorsWhitelists([[2, 3, 4], [whitelistAddress]], {
      account: owners[1].account,
    });

    expect(await ssvViews.read.getWhitelistedOperators([[1, 2, 3, 4], whitelistAddress])).to.be.deep.equal([
      1, 2, 3, 4,
    ]);
  });

  it('Get whitelisted address for a list containing non-whitelisted operators', async () => {
    const whitelistAddress = owners[4].account.address;

    // Register operators
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    // Whitelist using SSV whitelisting module
    await ssvNetwork.write.setOperatorsWhitelists([[2, 4, 6], [whitelistAddress]], {
      account: owners[1].account,
    });

    expect(await ssvViews.read.getWhitelistedOperators([[1, 2, 3, 4, 5, 6, 7, 8], whitelistAddress])).to.be.deep.equal([
      2, 4, 6,
    ]);
  });

  it('Get whitelisted address for non-existent operator IDs', async () => {
    const whitelistAddress = owners[4].account.address;

    // Register operators
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    // Whitelist using SSV whitelisting module
    await ssvNetwork.write.setOperatorsWhitelists([[2, 4, 6], [whitelistAddress]], {
      account: owners[1].account,
    });

    expect(await ssvViews.read.getWhitelistedOperators([[11, 12, 13], whitelistAddress])).to.be.deep.equal([]);
  });

  it('Get whitelisted address for mixed whitelisted and non-whitelisted addresses', async () => {
    const whitelistAddress1 = owners[4].account.address;
    const whitelistAddress2 = owners[5].account.address;

    // Register operators
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    // Whitelist using SSV whitelisting module
    await ssvNetwork.write.setOperatorsWhitelists([[2, 4, 6], [whitelistAddress1]], {
      account: owners[1].account,
    });

    await ssvNetwork.write.setOperatorsWhitelists([[3, 5, 7], [whitelistAddress2]], {
      account: owners[1].account,
    });

    expect(await ssvViews.read.getWhitelistedOperators([[1, 2, 3, 4, 5, 6, 7, 8], whitelistAddress1])).to.be.deep.equal(
      [2, 4, 6],
    );
    expect(await ssvViews.read.getWhitelistedOperators([[1, 2, 3, 4, 5, 6, 7, 8], whitelistAddress2])).to.be.deep.equal(
      [3, 5, 7],
    );
  });

  it('Get whitelisted address for unsorted operators', async () => {
    const whitelistAddress = owners[4].account.address;

    // Register operators
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    // Whitelist using SSV whitelisting module
    await ssvNetwork.write.setOperatorsWhitelists([[2, 4, 6], [whitelistAddress]], {
      account: owners[1].account,
    });

    await expect(ssvViews.read.getWhitelistedOperators([[6, 2, 4], whitelistAddress])).to.be.rejectedWith(
      'UnsortedOperatorsList',
    );
  });

  it('Get whitelisted address for duplicate operator IDs', async () => {
    const whitelistAddress = owners[4].account.address;

    // Register operators
    await registerOperators(1, 10, CONFIG.minimalOperatorFee);

    // Whitelist using SSV whitelisting module
    await ssvNetwork.write.setOperatorsWhitelists([[2, 4, 6], [whitelistAddress]], {
      account: owners[1].account,
    });

    await expect(ssvViews.read.getWhitelistedOperators([[2, 2, 4, 6, 6], whitelistAddress])).to.be.rejectedWith(
      'OperatorsListNotUnique',
    );
  });

  (process.env.SOLIDITY_COVERAGE ? it.skip : it)(
    'Get whitelisted address for a large number of operator IDs',
    async () => {
      const whitelistAddress = owners[4].account.address;

      // Register a large number of operators
      const largeNumber = 3000;
      await registerOperators(1, largeNumber, CONFIG.minimalOperatorFee);

      let operatorIds = [];
      for (let i = 1; i <= largeNumber; i++) {
        operatorIds.push(i);
      }

      await ssvNetwork.write.setOperatorsWhitelists([operatorIds, [whitelistAddress]], {
        account: owners[1].account,
      });

      expect(await ssvViews.read.getWhitelistedOperators([operatorIds, whitelistAddress])).to.be.deep.equal(
        operatorIds,
      );
    },
  );

  it('Get private operator by id', async () => {
    await ssvNetwork.write.registerOperator([DataGenerator.publicKey(0), CONFIG.minimalOperatorFee, false], {
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
    await ssvNetwork.write.registerOperator([DataGenerator.publicKey(0), CONFIG.minimalOperatorFee, false], {
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
      ssvNetwork.write.setOperatorsWhitelists([[1], whitelistAddresses], {
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
      ssvNetwork.write.setOperatorsWhitelists([OPERATOR_IDS_10, whitelistAddresses], {
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
      ssvNetwork.write.setOperatorsWhitelists([[2], [owners[3].account.address]], {
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

  it('Custom test: Operators balances sync', async () => {
    // owners[2] -> operators' owner
    // owners[3] -> whitelisted address for all 4 operators

    // create 4 operators with a fee
    const operatorIds = await registerOperators(2, 4, CONFIG.minimalOperatorFee);

    // set operators private
    ssvNetwork.write.setOperatorsPrivateUnchecked([operatorIds], {
      account: owners[2].account,
    });

    // whitelist owners[3] address for all operators
    await ssvNetwork.write.setOperatorsWhitelists([operatorIds, [owners[3].account.address]], {
      account: owners[2].account,
    });

    // owners[3] registers a validator
    const minDepositAmount = (BigInt(CONFIG.minimalBlocksBeforeLiquidation) + 2n) * CONFIG.minimalOperatorFee * 4n;
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[3].account });
    const { eventsByName } = await trackGas(
      ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          operatorIds,
          await DataGenerator.shares(2, 1, operatorIds),
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

    const firstCluster = eventsByName.ValidatorAdded[0].args;

    // liquidate the cluster
    await mine(CONFIG.minimalBlocksBeforeLiquidation);
    const liquidatedCluster = await trackGas(
      ssvNetwork.write.liquidate([firstCluster.owner, firstCluster.operatorIds, firstCluster.cluster]),
    );
    const updatedCluster = liquidatedCluster.eventsByName.ClusterLiquidated[0].args;

    // withdraw all operators' earnings
    for (let i = 0; i < operatorIds.length; i++) {
      await ssvNetwork.write.withdrawAllOperatorEarnings([operatorIds[i]], {
        account: owners[2].account,
      });
    }

    // de-whitelist owners[3] address for all operators
    await ssvNetwork.write.removeOperatorsWhitelists([operatorIds, [owners[3].account.address]], {
      account: owners[2].account,
    });

    // check operators' balance is 0 after few blocks
    await mine(1000);
    for (let i = 0; i < operatorIds.length; i++) {
      expect(await ssvViews.read.getOperatorEarnings([operatorIds[i]])).to.equal(0);
    }

    // reactivate the cluster
    await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], { account: owners[3].account });
    await ssvNetwork.write.reactivate([updatedCluster.operatorIds, minDepositAmount, updatedCluster.cluster], {
      account: owners[3].account,
    });

    // all operators have have the right balance
    await mine(100);
    for (let i = 0; i < operatorIds.length; i++) {
      expect(await ssvViews.read.getOperatorEarnings([operatorIds[i]])).to.equal(CONFIG.minimalOperatorFee * 100n);
    }
  });
});

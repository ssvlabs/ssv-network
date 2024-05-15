// Declare imports
import hre from 'hardhat';

import { setBalance } from '@nomicfoundation/hardhat-toolbox-viem/network-helpers';

import { expect } from 'chai';
import { ethers } from 'hardhat';

import { DataGenerator, MOCK_SHARES } from '../test/helpers/contract-helpers';
import { assertPostTxEvent } from '../test/helpers/utils/test';

import { Address, TestClient } from 'viem';

// Declare globals
let ssvNetwork: any, ssvViews: any, ssvToken: any, owners: any[], client: TestClient;

const ssvNetworkAddress = '0xDD9BC35aE942eF0cFa76930954a156B3fF30a4E1';
const ssvNetworkViewsAddress = '0xafE830B6Ee262ba11cce5F32fDCd760FFE6a66e4';
const ssvTokenAddress = '0x9D65fF81a3c488d585bBfb0Bfe3c7707c7917f54';

describe('Whitelisting Tests (fork)', () => {
  beforeEach(async () => {
    owners = await hre.viem.getWalletClients();

    client = await hre.viem.getTestClient();
    await client.impersonateAccount({ address: '0xb35096b074fdb9bBac63E3AdaE0Bbde512B2E6b6' });

    await setBalance('0xb35096b074fdb9bBac63E3AdaE0Bbde512B2E6b6', 2000000000000000000n);

    ssvNetwork = await hre.viem.getContractAt('SSVNetwork', ssvNetworkAddress);
    ssvViews = await hre.viem.getContractAt('SSVNetworkViews', ssvNetworkViewsAddress as Address);
    ssvToken = await hre.viem.getContractAt('SSVToken', ssvTokenAddress as Address);
  });

  describe('After Upgrade SSV Core Contracts Tests', () => {
    beforeEach(async () => {
      const ssvNetworkUpgrade = await hre.viem.deployContract('SSVNetwork', [], {
        account: { address: '0xb35096b074fdb9bBac63E3AdaE0Bbde512B2E6b6' },
      });
      await ssvNetwork.write.upgradeTo([await ssvNetworkUpgrade.address], {
        account: { address: '0xb35096b074fdb9bBac63E3AdaE0Bbde512B2E6b6' },
      });

      const ssvViewsUpgrade = await hre.viem.deployContract('SSVNetworkViews', [], {
        account: { address: '0xb35096b074fdb9bBac63E3AdaE0Bbde512B2E6b6' },
      });
      await ssvViews.write.upgradeTo([await ssvViewsUpgrade.address], {
        account: { address: '0xb35096b074fdb9bBac63E3AdaE0Bbde512B2E6b6' },
      });

      await upgradeModule('SSVOperators', 0);
      await upgradeModule('SSVClusters', 1);
      await upgradeModule('SSVViews', 3);
      await upgradeModule('SSVOperatorsWhitelist', 4);

      await client.stopImpersonatingAccount({
        address: '0xb35096b074fdb9bBac63E3AdaE0Bbde512B2E6b6',
      });
    });
    it('Check an existing whitelisted operator is whitelisted but not using an external contract', async () => {
      const operatorData = await ssvViews.read.getOperatorById([314]);

      expect(operatorData[3]).to.not.equal(ethers.ZeroAddress);
      expect(operatorData[4]).to.equal(true);
      expect(operatorData[5]).to.equal(true);

      expect(await ssvViews.read.isWhitelistingContract([operatorData[3]])).to.equal(false);
    });

    it('Register with an operator that uses a non-whitelisting contract reverts "InvalidWhitelistingContract"', async () => {
      // SSV contracts owner
      await client.impersonateAccount({ address: '0xb35096b074fdb9bBac63E3AdaE0Bbde512B2E6b6' });

      // 0xB4084F25DfCb2c1bf6636b420b59eda807953769 -> whitelisted address for operators 314, 315, 316, 317
      const liquidationCollateral = await ssvViews.read.getMinimumLiquidationCollateral();
      const minDepositAmount = liquidationCollateral * 2n;

      // give the sender enough SSV tokens
      await ssvToken.write.mint([owners[2].account.address, minDepositAmount], {
        account: { address: '0xb35096b074fdb9bBac63E3AdaE0Bbde512B2E6b6' },
      });

      await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], {
        account: owners[2].account,
      });

      await expect(
        ssvNetwork.write.registerValidator(
          [
            DataGenerator.publicKey(1),
            [314, 315, 316, 317],
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
          { account: owners[2].account },
        ),
      ).to.be.rejectedWith('InvalidWhitelistingContract');
    });

    it('Register using legacy whitelisted operators in 4 operators cluster events/logic', async () => {
      // get the current number of validators for these operators
      const operatorsValidatorsCount = {
        '314': (await ssvViews.read.getOperatorById([314]))[2],
        '315': (await ssvViews.read.getOperatorById([315]))[2],
        '316': (await ssvViews.read.getOperatorById([316]))[2],
        '317': (await ssvViews.read.getOperatorById([317]))[2],
      };

      // SSV contracts owner
      await client.impersonateAccount({ address: '0xb35096b074fdb9bBac63E3AdaE0Bbde512B2E6b6' });

      // 0xB4084F25DfCb2c1bf6636b420b59eda807953769 -> whitelisted address for operators 314, 315, 316, 317
      await client.impersonateAccount({ address: '0xB4084F25DfCb2c1bf6636b420b59eda807953769' });
      await setBalance('0xB4084F25DfCb2c1bf6636b420b59eda807953769', 500000000000000000n);

      const liquidationCollateral = await ssvViews.read.getMinimumLiquidationCollateral();
      const minDepositAmount = liquidationCollateral * 2n;

      // give the sender enough SSV tokens
      await ssvToken.write.mint(['0xB4084F25DfCb2c1bf6636b420b59eda807953769', minDepositAmount], {
        account: { address: '0xb35096b074fdb9bBac63E3AdaE0Bbde512B2E6b6' },
      });

      await ssvToken.write.approve([ssvNetwork.address, minDepositAmount], {
        account: { address: '0xB4084F25DfCb2c1bf6636b420b59eda807953769' },
      });

      await ssvNetwork.write.registerValidator(
        [
          DataGenerator.publicKey(1),
          [314, 315, 316, 317],
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
        { account: { address: '0xB4084F25DfCb2c1bf6636b420b59eda807953769' } },
      );

      // event confirms full execution
      await assertPostTxEvent([
        {
          contract: ssvNetwork,
          eventName: 'ValidatorAdded',
          argNames: ['owner'],
          argValuesList: [['0xB4084F25DfCb2c1bf6636b420b59eda807953769']],
        },
      ]);

      // check the operators increased the number of validators by one
      for (let i = 314; i < 318; i++) {
        expect((await ssvViews.read.getOperatorById([i]))[2]).to.equal(operatorsValidatorsCount[i] + 1);
      }
    });

    it('Replace a whitelisted address by an external whitelisting contract', async () => {
      // owner of the operator 314
      await client.impersonateAccount({ address: '0xB4084F25DfCb2c1bf6636b420b59eda807953769' });
      await setBalance('0xB4084F25DfCb2c1bf6636b420b59eda807953769', 500000000000000000n);

      // get the current whitelisted address
      const prevWhitelistedAddress = (await ssvViews.read.getOperatorById([314]))[3];

      const whitelistingContract = await hre.viem.deployContract(
        'MockWhitelistingContract',
        [['0xB4084F25DfCb2c1bf6636b420b59eda807953769']],
        {
          client: owners[0].client,
        },
      );
      const whitelistingContractAddress = await whitelistingContract.address;
      // Set the whitelisting contract for operators 1,2,3,4
      await ssvNetwork.write.setOperatorsWhitelistingContract([[314], whitelistingContractAddress], {
        account: { address: '0xB4084F25DfCb2c1bf6636b420b59eda807953769' },
      });

      // the operator now uses the whitelisting contract
      expect((await ssvViews.read.getOperatorById([314]))[3]).to.deep.equal(whitelistingContractAddress);

      // and the previous whitelisted address was passed to the SSV whitelisting module
      expect(await ssvViews.read.getWhitelistedOperators([[314], prevWhitelistedAddress])).to.deep.equal([314n]);
    });

    it('Whitelist multiple operators for an already whitelisted operator', async () => {
      // owner of the operator 314
      await client.impersonateAccount({ address: '0xB4084F25DfCb2c1bf6636b420b59eda807953769' });
      await setBalance('0xB4084F25DfCb2c1bf6636b420b59eda807953769', 500000000000000000n);

      // get the current whitelisted address
      const prevWhitelistedAddress = (await ssvViews.read.getOperatorById([314]))[3];

      await ssvNetwork.write.setOperatorMultipleWhitelists([[314, 315, 316, 317], [owners[2].account.address]], {
        account: { address: '0xB4084F25DfCb2c1bf6636b420b59eda807953769' },
      });

      expect(
        await ssvViews.read.getWhitelistedOperators([[314, 315, 316, 317], owners[2].account.address]),
      ).to.deep.equal([314n, 315n, 316n, 317n]);

      // the operator uses the previous whitelisting main address
      expect((await ssvViews.read.getOperatorById([314]))[3]).to.deep.equal(prevWhitelistedAddress);
    });
  });
});

//* HELPERS */

const upgradeModule = async function (contractName: string, id: number) {
  const ssvModule = await hre.viem.deployContract(contractName, [], {
    account: { address: '0xb35096b074fdb9bBac63E3AdaE0Bbde512B2E6b6' },
  });
  await ssvNetwork.write.updateModule([id, await ssvModule.address], {
    account: { address: '0xb35096b074fdb9bBac63E3AdaE0Bbde512B2E6b6' },
  });
};

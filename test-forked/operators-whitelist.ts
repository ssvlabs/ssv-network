// Declare imports
import hre from 'hardhat';

import { setBalance } from '@nomicfoundation/hardhat-toolbox-viem/network-helpers';

import { expect } from 'chai';
import { ethers } from 'hardhat';

import { DataGenerator } from '../test/helpers/contract-helpers';
import { assertPostTxEvent } from '../test/helpers/utils/test';

import { Address, TestClient } from 'viem';

// Declare globals
let ssvNetwork: any, ssvViews: any, ssvToken: any, owners: any[], client: TestClient;

const ssvNetworkAddress = '0xDD9BC35aE942eF0cFa76930954a156B3fF30a4E1';
const ssvNetworkViewsAddress = '0xafE830B6Ee262ba11cce5F32fDCd760FFE6a66e4';
const ssvTokenAddress = '0x9D65fF81a3c488d585bBfb0Bfe3c7707c7917f54';

const MOCK_SHARES =
  '0x8f5f07aac10b2113fc18c178080e34665931f4bcefb743a888acdee7799fbf70c2db26c7dd9d102161aad3751b1db06c177659c3fe9af62ddae8e70dd1461267e97fe751974e09d4a8e1176e73567e29b2329566dd759ba464eab259111d3cb7b2843fe292c8b8d295c3b30b98ee77cd5d4aaf14dbfa3f63fb092b44d002a851fa9c16f4c1f1356fbff61757fff5d1c493826db56c37b7487bb50e0cd5cbb3f4698797f31f2c22373e6b601cae505233b5fa4e1dc583f0b7203372a807684990a7dfd9c775f6f3105f4d0200b63779b575bc709b4a55461f6597e506c9be2d253c8732a4acacc8292983218a516eced8a176064fad697ecd82b17adcee4d10a57f3fe9b539b467cb66fdf36e3f0b0591f1f161fcaf7c4bbb1ed000d50c8cc4e1960cc20b17c3c55c7b7a1f6b3c530f40f7b74225d38aff51cfdbfcacb78a9bdf6f31a5cf21b99c4d1055416935280b9b8f38850139a31263d625b7d4098f521225ae8941131c54fcf5a1b2589a01b96759ec92e869ad6c80ba73085a37034c291cd2716b6b1e9e8633b6037cf9312a7de72c9d04db5c52801e84b636f6c51762b63e48b454dba198fc604d326a3249370de6851a3f7ed4cbe2d3ff92de780ea7c9708df9012be9c115849c44533d574a35bce635e98e8835818052155bedd8aade6d27e480a6c497c804815b740489bd0790be851f97947fbbaf2526d84a05c9aebd0ad2161e117a2878a24e49932c7a2dff4b20725d20c1600c2103fcbadae04f5cb95ec413923e710b332be42ebc0264128b8f250063fa346be2f55108e917a9dd0c64a5159411ff4f99801f546c77891c88e4f6db6dddb8f18bd87be91a9ba0eaa076994448f97b4f3273ccc5aa51c0c6cbf6cf69f446862a0a5bbc0ca590a961871f8ef8f38f446db9cadd76675f53df8f41350d76a4015fa5b700b3caf07f9b2014778bf3400d9a43962c3ace37f1dadaa7afb546825acbf6081f2168e8496468f25fefac1b884f434f3884eb12a3e9536914a9c87b9a3dee92e83be856dc29718ae387f0066ca04ff0c8f07855a295b568358c4cf7de4964ecc9d69e0efd7102f915d0a343c85f3519e4ac0ba32b4912b2016389e3ebb9d1412b1118a428fc036b8a599614d033d89f764446b6486103bf98f782dcbdda5cfb415ff18a1fbe16d2cd448227b63bb6e2989cd54170cd4ca4400802910d77adf0bc670eba3c8c8a1571fbb73040b2f5fb391f5bbfa4f3e8b62cf8f516ce9ed6726516c19a956df1b7a20ab4fb82a0a3b0235518cc0c52fff7a59ca52a49c4b15f652466048933f6651a66abfa8eb4c8836ccc1db2a5fa7cba133923fc7ebbdda2f3db26c9e1a194dcb51543df4e06d401ec24d17bc42db2d822abad9e6a775ef6c33bfb54760839adb02cf5bd9740a59aca9a6dd20b0b90a68a940626094df638fb0a3405b1324508492a9549a316d0c8c7ab27303668fe6d61f3c75a27fc4a6008cbf948084881e9b34cdbfe2773d595d637b2ab1444219a9aad51e8f6d4a4905a5845e58cbc8ef743f30a9c17869dd5ce8adef13fe4e43fce4f380fe5a3e502e7699868ad8baa5aeb52d8c9f498a665365fac845fe6df6949a653af825e20e1e9966363ffbb0c3babe48165f72643cfded8cc451553edc1c2fd6e513533c9c51cc3ce6c12930f17fc27cec2ead93b095dc452dc3f988bb72e730e1f4c67b4852c4d20f9d8bc198d2b09962de51518d2c93f3f33a49b5d64a3ab20a4f1bbc0a972d075ab3f482c060f46d3b31c124ed8f8d89e056e3f40853f15cf92a34796c5435f2e44a1a3a941aa3afe9333b83f2a23617b715442ea13a256f7575cea9cce1c07e485';

describe('Whitelisting Tests (fork)', () => {
  beforeEach(async () => {
    owners = await hre.viem.getWalletClients();

    client = await hre.viem.getTestClient();
    await client.impersonateAccount({ address: '0xb35096b074fdb9bBac63E3AdaE0Bbde512B2E6b6' });

    await setBalance('0xb35096b074fdb9bBac63E3AdaE0Bbde512B2E6b6', 2000000000000000000n);

    ssvNetwork = await hre.viem.getContractAt('SSVNetwork', ssvNetworkAddress);
    ssvViews = await hre.viem.getContractAt('SSVNetworkViews', ssvNetworkViewsAddress as Address);
    ssvToken = await hre.viem.getContractAt('SSVToken', ssvTokenAddress as Address);

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

//* HELPERS */

const upgradeModule = async function (contractName: string, id: number) {
  const ssvModule = await hre.viem.deployContract(contractName, [], {
    account: { address: '0xb35096b074fdb9bBac63E3AdaE0Bbde512B2E6b6' },
  });
  await ssvNetwork.write.updateModule([id, await ssvModule.address], {
    account: { address: '0xb35096b074fdb9bBac63E3AdaE0Bbde512B2E6b6' },
  });
};

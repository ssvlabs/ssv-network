import hre from 'hardhat';
import { ethers, upgrades } from 'hardhat';
import { Address, keccak256, toBytes } from 'viem';
import { trackGas, GasGroup } from './gas-usage';

import { SSVKeys, KeyShares, EncryptShare } from 'ssv-keys';
import { Validator, Operator, SSVConfig, Cluster } from './types';
import validatorKeys from './json/validatorKeys.json';
import operatorKeys from './json/operatorKeys.json';

const nonces = new Map();
let lastValidatorId: number = 0;
let lastOperatorId: number = 0;
const mockedValidators = validatorKeys as Validator[];
const mockedOperators = operatorKeys as Operator[];
let ssvToken: any;

export let ssvNetwork: any;
export let owners: any[];

export let publicClient: any;

export const CONFIG: SSVConfig = {
  initialVersion: 'v1.1.0',
  operatorMaxFeeIncrease: 1000,
  declareOperatorFeePeriod: 3600, // HOUR
  executeOperatorFeePeriod: 86400, // DAY
  minimalOperatorFee: 1000000000n,
  minimalBlocksBeforeLiquidation: 100800,
  minimumLiquidationCollateral: 200000000,
  validatorsPerOperatorLimit: 500,
  maximumOperatorFee: BigInt(76528650000000),
};

export const DEFAULT_OPERATOR_IDS = {
  4: [1, 2, 3, 4],
  7: [1, 2, 3, 4, 5, 6, 7],
  10: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10],
  13: [1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13],
};

export const MOCK_SHARES =
  '0x8f5f07aac10b2113fc18c178080e34665931f4bcefb743a888acdee7799fbf70c2db26c7dd9d102161aad3751b1db06c177659c3fe9af62ddae8e70dd1461267e97fe751974e09d4a8e1176e73567e29b2329566dd759ba464eab259111d3cb7b2843fe292c8b8d295c3b30b98ee77cd5d4aaf14dbfa3f63fb092b44d002a851fa9c16f4c1f1356fbff61757fff5d1c493826db56c37b7487bb50e0cd5cbb3f4698797f31f2c22373e6b601cae505233b5fa4e1dc583f0b7203372a807684990a7dfd9c775f6f3105f4d0200b63779b575bc709b4a55461f6597e506c9be2d253c8732a4acacc8292983218a516eced8a176064fad697ecd82b17adcee4d10a57f3fe9b539b467cb66fdf36e3f0b0591f1f161fcaf7c4bbb1ed000d50c8cc4e1960cc20b17c3c55c7b7a1f6b3c530f40f7b74225d38aff51cfdbfcacb78a9bdf6f31a5cf21b99c4d1055416935280b9b8f38850139a31263d625b7d4098f521225ae8941131c54fcf5a1b2589a01b96759ec92e869ad6c80ba73085a37034c291cd2716b6b1e9e8633b6037cf9312a7de72c9d04db5c52801e84b636f6c51762b63e48b454dba198fc604d326a3249370de6851a3f7ed4cbe2d3ff92de780ea7c9708df9012be9c115849c44533d574a35bce635e98e8835818052155bedd8aade6d27e480a6c497c804815b740489bd0790be851f97947fbbaf2526d84a05c9aebd0ad2161e117a2878a24e49932c7a2dff4b20725d20c1600c2103fcbadae04f5cb95ec413923e710b332be42ebc0264128b8f250063fa346be2f55108e917a9dd0c64a5159411ff4f99801f546c77891c88e4f6db6dddb8f18bd87be91a9ba0eaa076994448f97b4f3273ccc5aa51c0c6cbf6cf69f446862a0a5bbc0ca590a961871f8ef8f38f446db9cadd76675f53df8f41350d76a4015fa5b700b3caf07f9b2014778bf3400d9a43962c3ace37f1dadaa7afb546825acbf6081f2168e8496468f25fefac1b884f434f3884eb12a3e9536914a9c87b9a3dee92e83be856dc29718ae387f0066ca04ff0c8f07855a295b568358c4cf7de4964ecc9d69e0efd7102f915d0a343c85f3519e4ac0ba32b4912b2016389e3ebb9d1412b1118a428fc036b8a599614d033d89f764446b6486103bf98f782dcbdda5cfb415ff18a1fbe16d2cd448227b63bb6e2989cd54170cd4ca4400802910d77adf0bc670eba3c8c8a1571fbb73040b2f5fb391f5bbfa4f3e8b62cf8f516ce9ed6726516c19a956df1b7a20ab4fb82a0a3b0235518cc0c52fff7a59ca52a49c4b15f652466048933f6651a66abfa8eb4c8836ccc1db2a5fa7cba133923fc7ebbdda2f3db26c9e1a194dcb51543df4e06d401ec24d17bc42db2d822abad9e6a775ef6c33bfb54760839adb02cf5bd9740a59aca9a6dd20b0b90a68a940626094df638fb0a3405b1324508492a9549a316d0c8c7ab27303668fe6d61f3c75a27fc4a6008cbf948084881e9b34cdbfe2773d595d637b2ab1444219a9aad51e8f6d4a4905a5845e58cbc8ef743f30a9c17869dd5ce8adef13fe4e43fce4f380fe5a3e502e7699868ad8baa5aeb52d8c9f498a665365fac845fe6df6949a653af825e20e1e9966363ffbb0c3babe48165f72643cfded8cc451553edc1c2fd6e513533c9c51cc3ce6c12930f17fc27cec2ead93b095dc452dc3f988bb72e730e1f4c67b4852c4d20f9d8bc198d2b09962de51518d2c93f3f33a49b5d64a3ab20a4f1bbc0a972d075ab3f482c060f46d3b31c124ed8f8d89e056e3f40853f15cf92a34796c5435f2e44a1a3a941aa3afe9333b83f2a23617b715442ea13a256f7575cea9cce1c07e485';

const getSecretSharedPayload = async function (validator: Validator, operatorIds: number[], ownerId: number) {
  const numberIds = operatorIds.map(id => Number(id));

  const selOperators = mockedOperators.filter((item: Operator) => item.id !== undefined && numberIds.includes(item.id));
  const operators = selOperators.map((item: Operator) => ({ id: item.id, operatorKey: item.operatorKey }));

  const ssvKeys = new SSVKeys();
  const keyShares = new KeyShares();

  const publicKey = validator.publicKey;
  const privateKey = validator.privateKey;

  const threshold = await ssvKeys.createThreshold(privateKey, operators);
  const encryptedShares: EncryptShare[] = await ssvKeys.encryptShares(operators, threshold.shares);

  let ownerNonce = 0;

  if (nonces.has(owners[ownerId].address)) {
    ownerNonce = nonces.get(owners[ownerId].address);
  }
  nonces.set(owners[ownerId].address, ownerNonce + 1);

  const payload = await keyShares.buildPayload(
    {
      publicKey,
      operators,
      encryptedShares,
    },
    {
      ownerAddress: owners[ownerId].address,
      ownerNonce,
      privateKey,
    },
  );
  return payload;
};

export const DataGenerator = {
  publicKey: (id: number) => {
    const validators = mockedValidators.filter((item: Validator) => item.id === id);
    if (validators.length > 0) {
      return validators[0].publicKey;
    }
    return `0x${id.toString(16).padStart(48, '0')}`;
  },
  shares: async (ownerId: number, validatorId: number, operatorIds: number[]) => {
    let shared: any;
    const validators = mockedValidators.filter((item: Validator) => item.id === validatorId);
    if (validators.length > 0) {
      const validator = validators[0];
      const payload = await getSecretSharedPayload(validator, operatorIds, ownerId);
      shared = payload.sharesData;
    } else {
      shared = `0x${validatorId.toString(16).padStart(48, '0')}`;
    }
    return shared;
  },
};

export const initializeContract = async function () {
  owners = await hre.viem.getWalletClients();

  lastValidatorId = 1;
  lastOperatorId = 0;

  ssvToken = await hre.viem.deployContract('SSVToken');
  const ssvOperatorsMod = await hre.viem.deployContract('SSVOperators');
  const ssvClustersMod = await hre.viem.deployContract('SSVClusters');
  const ssvDAOMod = await hre.viem.deployContract('SSVDAO');
  const ssvViewsMod = await hre.viem.deployContract('contracts/modules/SSVViews.sol:SSVViews');
  const ssvWhitelistMod = await hre.viem.deployContract('SSVOperatorsWhitelist');

  const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
  const ssvNetworkProxy = await await upgrades.deployProxy(
    ssvNetworkFactory,
    [
      ssvToken.address,
      ssvOperatorsMod.address,
      ssvClustersMod.address,
      ssvDAOMod.address,
      ssvViewsMod.address,
      CONFIG.minimalBlocksBeforeLiquidation,
      CONFIG.minimumLiquidationCollateral,
      CONFIG.validatorsPerOperatorLimit,
      CONFIG.declareOperatorFeePeriod,
      CONFIG.executeOperatorFeePeriod,
      CONFIG.operatorMaxFeeIncrease,
    ],
    {
      kind: 'uups',
      unsafeAllow: ['delegatecall'],
    },
  );
  await ssvNetworkProxy.waitForDeployment();
  const ssvNetworkAddress = await ssvNetworkProxy.getAddress();
  ssvNetwork = await hre.viem.getContractAt('SSVNetwork', ssvNetworkAddress as Address);

  const ssvNetworkViewsFactory = await ethers.getContractFactory('SSVNetworkViews');
  const ssvNetworkViewsProxy = await await upgrades.deployProxy(ssvNetworkViewsFactory, [ssvNetworkAddress], {
    kind: 'uups',
    unsafeAllow: ['delegatecall'],
  });
  await ssvNetworkViewsProxy.waitForDeployment();
  const ssvNetworkViewsAddress = await ssvNetworkViewsProxy.getAddress();
  const ssvNetworkViews = await hre.viem.getContractAt('SSVNetworkViews', ssvNetworkViewsAddress as Address);

  await ssvNetwork.write.updateMaximumOperatorFee([CONFIG.maximumOperatorFee as bigint]);

  ssvNetwork.write.updateModule([4, await ssvWhitelistMod.address]);

  for (let i = 1; i < 7; i++) {
    await ssvToken.write.mint([owners[i].account.address, 10000000000000000000n]);
  }

  return {
    ssvContractsOwner: owners[0].account,
    ssvNetwork,
    ssvNetworkViews,
    ssvToken,
  };
};

export const registerOperators = async function (
  ownerId: number,
  numberOfOperators: number,
  fee: BigInt,
  gasGroups: GasGroup[] = [GasGroup.REGISTER_OPERATOR],
) {
  const newOperatorIds = [];
  const targetOperatorId = lastOperatorId + numberOfOperators;
  for (let i = lastOperatorId; i < lastOperatorId + numberOfOperators && i < mockedOperators.length; i++) {
    const operator = mockedOperators[i];
    operator.publicKey = keccak256(toBytes(operator.operatorKey));

    const { eventsByName } = await trackGas(
      ssvNetwork.write.registerOperator([operator.publicKey, fee, false], {
        account: owners[ownerId].account,
      }),
      gasGroups,
    );

    const event = eventsByName.OperatorAdded[0];
    operator.id = Number(event.args.operatorId);
    mockedOperators[i] = operator;
    newOperatorIds.push(operator.id);
  }
  lastOperatorId = targetOperatorId;
  return newOperatorIds;
};

export const coldRegisterValidator = async function () {
  const ssvKeys = new SSVKeys();
  const keyShares = new KeyShares();

  const validator = mockedValidators[0];
  const operators = mockedOperators
    .slice(0, 4)
    .map((item: Operator) => ({ id: item.id, operatorKey: item.operatorKey }));

  const publicKey = validator.publicKey;
  const privateKey = validator.privateKey;
  const threshold = await ssvKeys.createThreshold(privateKey, operators);
  const encryptedShares: EncryptShare[] = await ssvKeys.encryptShares(operators, threshold.shares);

  let ownerNonce = 0;

  if (nonces.has(owners[0].address)) {
    ownerNonce = nonces.get(owners[0].address);
  }
  nonces.set(owners[0].address, ownerNonce + 1);

  const payload = await keyShares.buildPayload(
    {
      publicKey,
      operators,
      encryptedShares,
    },
    {
      ownerAddress: owners[0].address,
      ownerNonce,
      privateKey,
    },
  );

  const amount = 1000000000000000n;
  await ssvToken.write.approve([ssvNetwork.address, amount]);
  await ssvNetwork.write.registerValidator([
    payload.publicKey,
    payload.operatorIds,
    payload.sharesData,
    amount,
    {
      validatorCount: 0,
      networkFeeIndex: 0,
      index: 0,
      balance: 0,
      active: true,
    },
  ]);
  lastValidatorId = validator.id;
};

export const bulkRegisterValidators = async function (
  ownerId: number,
  numberOfValidators: number,
  operatorIds: number[],
  minDepositAmount: BigInt,
  cluster: Cluster,
  gasGroups?: GasGroup[],
) {
  const validatorIndex = lastValidatorId;
  const pks = Array.from({ length: numberOfValidators }, (_, index) => DataGenerator.publicKey(index + validatorIndex));
  const shares = await Promise.all(
    Array.from({ length: numberOfValidators }, (_, index) =>
      DataGenerator.shares(ownerId, index + validatorIndex, operatorIds),
    ),
  );
  const depositAmount = minDepositAmount * BigInt(numberOfValidators);

  await ssvToken.write.approve([ssvNetwork.address, depositAmount], {
    account: owners[ownerId].account,
  });

  const result = await trackGas(
    ssvNetwork.write.bulkRegisterValidator([pks, operatorIds, shares, depositAmount, cluster], {
      account: owners[ownerId].account,
    }),
    gasGroups,
  );

  lastValidatorId += numberOfValidators;

  return {
    args: result.eventsByName.ValidatorAdded[0].args,
    pks,
  };
};

export const deposit = async function (
  ownerId: number,
  ownerAddress: Address,
  operatorIds: number[],
  depositAmount: BigInt,
  cluster: Cluster,
) {
  await ssvToken.write.approve([ssvNetwork.address, depositAmount], {
    account: owners[ownerId].account,
  });

  const depositedCluster = await trackGas(
    ssvNetwork.write.deposit([ownerAddress, operatorIds, depositAmount, cluster], {
      account: owners[ownerId].account,
    }),
  );
  return depositedCluster.eventsByName.ClusterDeposited[0].args;
};

export const withdraw = async function (ownerId: number, operatorIds: number[], amount: BigInt, cluster: Cluster) {
  const withdrawnCluster = await trackGas(
    ssvNetwork.write.withdraw([operatorIds, amount, cluster], {
      account: owners[ownerId].account,
    }),
  );

  return withdrawnCluster.eventsByName.ClusterWithdrawn[0].args;
};

export const removeValidator = async function (ownerId: number, pk: string, operatorIds: number[], cluster: Cluster) {
  const removedValidator = await trackGas(
    ssvNetwork.write.removeValidator([pk, operatorIds, cluster], {
      account: owners[ownerId].account,
    }),
  );
  return removedValidator.eventsByName.ValidatorRemoved[0].args;
};

export const liquidate = async function (ownerAddress: Address, operatorIds: number[], cluster: Cluster) {
  const liquidatedCluster = await trackGas(ssvNetwork.write.liquidate([ownerAddress, operatorIds, cluster]));
  return liquidatedCluster.eventsByName.ClusterLiquidated[0].args;
};

export const reactivate = async function (ownerId: number, operatorIds: number[], amount: BigInt, cluster: Cluster) {
  await ssvToken.write.approve([ssvNetwork.address, amount], { account: owners[ownerId].account });
  const reactivatedCluster = await trackGas(
    ssvNetwork.write.reactivate([operatorIds, amount, cluster], { account: owners[ownerId].account }),
  );
  return reactivatedCluster.eventsByName.ClusterReactivated[0].args;
};

export const getTransactionReceipt = async function (tx: Promise<any>) {
  const hash = await tx;

  const receipt = await publicClient.waitForTransactionReceipt({
    hash,
  });

  return receipt;
};

async function initialize() {
  publicClient = await hre.viem.getPublicClient();
}
initialize();

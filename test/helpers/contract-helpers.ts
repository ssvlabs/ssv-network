import hre from 'hardhat';
import { ethers, upgrades } from 'hardhat';
import { Address, keccak256, toBytes } from 'viem';
import { trackGas, GasGroup } from './gas-usage';

import { SSVKeys, KeyShares, EncryptShare } from 'ssv-keys';
import { Validator, Operator, SSVConfig, Cluster } from './types';
import validatorKeys from './json/validatorKeys.json';
import operatorKeys from './json/operatorKeys.json';

let nonce: number = 0;
let lastValidatorId: number = 0;
const mockedValidators = validatorKeys as Validator[];
const mockedOperators = operatorKeys as Operator[];
let ssvToken: any;

export let ssvNetwork: any; // TODO
export let owners: any[];

export let publicClient: any;

export const CONFIG: SSVConfig = {
  initialVersion: 'v1.1.0',
  operatorMaxFeeIncrease: 1000,
  declareOperatorFeePeriod: 3600, // HOUR
  executeOperatorFeePeriod: 86400, // DAY
  minimalOperatorFee: 100000000n,
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

const getSecretSharedPayload = async function (validator: Validator, operatorIds: number[], ownerId: number) {
  const selOperators = mockedOperators.filter((item: Operator) => operatorIds.includes(item.id));
  const operators = selOperators.map((item: Operator) => ({ id: item.id, operatorKey: item.operatorKey }));

  const ssvKeys = new SSVKeys();
  const keyShares = new KeyShares();

  const publicKey = validator.publicKey;
  const privateKey = validator.privateKey;

  const threshold = await ssvKeys.createThreshold(privateKey, operators);
  const encryptedShares: EncryptShare[] = await ssvKeys.encryptShares(operators, threshold.shares);
  const payload = await keyShares.buildPayload(
    {
      publicKey,
      operators,
      encryptedShares,
    },
    {
      ownerAddress: owners[ownerId].address,
      ownerNonce: nonce,
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
  shares: async (ownerId: number, validatorId: number, operatorCount: number) => {
    let shared: any;
    const validators = mockedValidators.filter((item: Validator) => item.id === validatorId);
    if (validators.length > 0) {
      const validator = validators[0];
      const operatorIds: number[] = [];
      for (let i = 1; i <= operatorCount; i++) {
        operatorIds.push(i);
      }
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

  ssvToken = await hre.viem.deployContract('SSVToken');
  const ssvOperatorsMod = await hre.viem.deployContract('SSVOperators');
  const ssvClustersMod = await hre.viem.deployContract('SSVClusters');
  const ssvDAOMod = await hre.viem.deployContract('SSVDAO');
  const ssvViewsMod = await hre.viem.deployContract('contracts/modules/SSVViews.sol:SSVViews');

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
  for (let i = 0; i < numberOfOperators && i < mockedOperators.length; i++) {
    const operator = mockedOperators[i];
    operator.publicKey = keccak256(toBytes(operator.operatorKey));

    const { eventsByName } = await trackGas(
      ssvNetwork.write.registerOperator([operator.publicKey, fee], {
        account: owners[ownerId].account,
      }),
      gasGroups,
    );

    const event = eventsByName.OperatorAdded[0];
    operator.id = Number(event.args.operatorId);
    mockedOperators[i] = operator;
  }
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
  const payload = await keyShares.buildPayload(
    {
      publicKey,
      operators,
      encryptedShares,
    },
    {
      ownerAddress: owners[0].address,
      ownerNonce: 1,
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
      DataGenerator.shares(ownerId, index + validatorIndex, operatorIds.length),
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

async function initialize() {
  publicClient = await hre.viem.getPublicClient();
}
initialize();

// Imports
declare const ethers: any;
declare const upgrades: any;

import { trackGas, GasGroup } from './gas-usage';

export let DB: any;
export let CONFIG: any;

export const DataGenerator = {
  publicKey: (index: number) => `0x${index.toString(16).padStart(96, '1')}`,
  shares: (index: number) => `0x${index.toString(16).padStart(360, '1')}`,
  cluster: {
    new: (size = 4) => {
      const usedOperatorIds: any = {};
      for (const clusterId in DB.clusters) {
        for (const operatorId of DB.clusters[clusterId].operatorIds) {
          usedOperatorIds[operatorId] = true;
        }
      }

      const result = [];
      for (const operator of DB.operators) {
        if (operator && !usedOperatorIds[operator.id]) {
          result.push(operator.id);
          usedOperatorIds[operator.id] = true;

          if (result.length == size) {
            break;
          }
        }
      }
      if (result.length < size) {
        throw new Error('No new clusters. Try to register more operators.');
      }

      return result;
    },
    byId: (id: any) => DB.clusters[id].operatorIds
  }
};

export const initializeContract = async () => {
  CONFIG = {
    operatorMaxFeeIncrease: 1000,
    declareOperatorFeePeriod: 3600, // HOUR
    executeOperatorFeePeriod: 86400, // DAY
    minimalOperatorFee: 100000000,
    minimalBlocksBeforeLiquidation: 50,
  };

  DB = {
    owners: [],
    validators: [],
    operators: [],
    clusters: [],
    ssvNetwork: {},
    ssvToken: {},
  };

  // Define accounts
  DB.owners = await ethers.getSigners();

  // Initialize contract
  const ssvNetwork = await ethers.getContractFactory('SSVNetwork');
  const ssvToken = await ethers.getContractFactory('SSVTokenMock');

  DB.ssvToken = await ssvToken.deploy();
  await DB.ssvToken.deployed();

  DB.ssvNetwork.contract = await upgrades.deployProxy(ssvNetwork, [
    DB.ssvToken.address,
    CONFIG.operatorMaxFeeIncrease,
    CONFIG.declareOperatorFeePeriod,
    CONFIG.executeOperatorFeePeriod
  ]);

  await DB.ssvNetwork.contract.deployed();

  DB.ssvNetwork.owner = DB.owners[0];

  await DB.ssvToken.mint(DB.owners[1].address, '1000000000000000');
  await DB.ssvToken.mint(DB.owners[2].address, '1000000000000000');
  await DB.ssvToken.mint(DB.owners[3].address, '1000000000000000');
  await DB.ssvToken.mint(DB.owners[4].address, '1000000000000000');
  await DB.ssvToken.mint(DB.owners[5].address, '1000000000000000');

  return { contract: DB.ssvNetwork.contract, owner: DB.ssvNetwork.owner, ssvToken: DB.ssvToken };
};

export const registerOperators = async (ownerId: number, numberOfOperators: number, fee: string, gasGroups: GasGroup[] = [GasGroup.REGISTER_OPERATOR]) => {
  for (let i = 0; i < numberOfOperators; ++i) {
    const { eventsByName } = await trackGas(
      DB.ssvNetwork.contract.connect(DB.owners[ownerId]).registerOperator(DataGenerator.publicKey(i), fee),
      gasGroups
    );
    const event = eventsByName.OperatorAdded[0];
    DB.operators[event.args.id] = {
      id: event.args.id, ownerId: ownerId, publicKey: DataGenerator.publicKey(i)
    };
  }
};

export const deposit = async (ownerId: number, clusterId: string, amount: string) => {
  await DB.ssvToken.connect(DB.owners[ownerId]).approve(DB.ssvNetwork.contract.address, amount);
  await DB.ssvNetwork.contract.connect(DB.owners[ownerId])['deposit(bytes32,uint256)'](clusterId, amount);
};

export const registerPodAndDeposit = async(ownerId: number, operatorIds: number[], amount: string): Promise<any> => {
  let clusterId;
  try {
    clusterId = await DB.ssvNetwork.contract.getClusterId(operatorIds);
    if (+amount > 0) {
      await deposit(ownerId, clusterId, amount);
    }
  } catch (e) {
    await DB.ssvToken.connect(DB.owners[ownerId]).approve(DB.ssvNetwork.contract.address, amount);
    const clusterTx = await (await DB.ssvNetwork.contract.connect(DB.owners[ownerId]).registerPod(operatorIds, amount)).wait();
    clusterId = clusterTx.events[0].args.clusterId;
  }
  return { clusterId };
};

export const registerValidators = async (ownerId: number, numberOfValidators: number, amount: string, operatorIds: number[], gasGroups?: GasGroup[]) => {
  const validators: any = [];
  let clusterId: any;

  // Register validators to contract
  for (let i = 0; i < numberOfValidators; i++) {
    const publicKey = DataGenerator.publicKey(DB.validators.length);
    const shares = DataGenerator.shares(DB.validators.length);

    const { eventsByName } = await trackGas(DB.ssvNetwork.contract.connect(DB.owners[ownerId]).registerValidator(
      publicKey,
      (await registerPodAndDeposit(ownerId, operatorIds, amount)).clusterId,
      shares,
    ), gasGroups);
    clusterId = eventsByName.ValidatorAdded[0].args.clusterId;
    DB.clusters[clusterId] = ({ id: clusterId, operatorIds });
    DB.validators.push({ publicKey, clusterId, shares });
    validators.push({ publicKey, shares });
  }

  return { validators, clusterId };
};

export const transferValidator = async (ownerId: number, publicKey: string, operatorIds: number[], amount: string, gasGroups?: GasGroup[]) => {
  // let podId: any;
  const shares = DataGenerator.shares(DB.validators.length);

  // Transfer validator
  await trackGas(DB.ssvNetwork.contract.connect(DB.owners[ownerId]).transferValidator(
    publicKey,
    (await registerPodAndDeposit(ownerId, operatorIds, amount)).clusterId,
    shares,
  ), gasGroups);

  // FOR ADAM TO UPDATE
  // podId = eventsByName.ValidatorTransferred[0].args.podId;
  // DB.clusters[podId] = ({ id: podId, operatorIds });
  // DB.validators[publicKey].podId = podId;
  // DB.validators[publicKey].shares = shares;

  // return { podId };
};


export const bulkTransferValidator = async (ownerId: number, publicKey: string[], fromCluster: string, toCluster: string, amount: string, gasGroups?: GasGroup[]) => {
  const shares = Array(publicKey.length).fill(DataGenerator.shares(0));

  await registerPodAndDeposit(ownerId, DataGenerator.cluster.byId(toCluster), amount);

  // Bulk transfer validators
  await trackGas(DB.ssvNetwork.contract.connect(DB.owners[ownerId]).bulkTransferValidators(
    publicKey,
    fromCluster,
    toCluster,
    shares,
  ), gasGroups);

  // FOR ADAM TO UPDATE
  // podId = eventsByName.ValidatorTransferred[0].args.podId;
  // DB.clusters[podId] = ({ id: podId, operatorIds });
  // DB.validators[publicKey].podId = podId;
  // DB.validators[publicKey].shares = shares;

  // return { podId };
};

export const liquidate = async (executorOwnerId: number, liquidatedOwnerId: number, operatorIds: number[], gasGroups?: GasGroup[]) => {
  const { eventsByName } = await trackGas(DB.ssvNetwork.contract.connect(DB.owners[executorOwnerId]).liquidate(
    DB.owners[liquidatedOwnerId].address,
    await DB.ssvNetwork.contract.getClusterId(operatorIds),
  ), gasGroups);

  const clusterId = eventsByName.AccountLiquidated[0].args.clusterId;
  return { clusterId };
};


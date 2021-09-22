import { ethers, upgrades } from 'hardhat';
import { progressBlocks, snapshot, mine } from '../utils';

declare var network: any;

const operatorPublicKeyPrefix = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345';
const validatorPublicKeyPrefix = '98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765';
const minimumBlocksBeforeLiquidation = 50;

export let ssvToken, ssvRegistry, ssvNetwork;
export let owner, account1, account2, account3;

export const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`);
export const validatorsPub = Array.from(Array(10).keys()).map(k => `0x${validatorPublicKeyPrefix}${k}`);

const operatorData = [];
const addressData = {};
const globalData = {
  networkFeeIndexBlockNumber: 0,
  networkFeeIndex: 0,
  networkFee: 0,
};

export const initContracts = async() => {
  [owner, account1, account2, account3] = await ethers.getSigners();
  // for tests
  initAddressData(account1.address);
  initAddressData(account2.address);
  initAddressData(account3.address);
  //
  const ssvTokenFactory = await ethers.getContractFactory('SSVToken');
  const ssvRegistryFactory = await ethers.getContractFactory('SSVRegistry');
  const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
  ssvToken = await ssvTokenFactory.deploy();
  ssvRegistry = await upgrades.deployProxy(ssvRegistryFactory, { initializer: false });
  await ssvToken.deployed();
  await ssvRegistry.deployed();
  ssvNetwork = await upgrades.deployProxy(ssvNetworkFactory, [ssvRegistry.address, ssvToken.address, minimumBlocksBeforeLiquidation]);
  await ssvNetwork.deployed();
  await ssvToken.mint(account1.address, '1000000');
}

const initAddressData = (address) => {
  addressData[address] = {
    operatorIdxs: [],
    operatorsInUse: {},
    used: 0,
    withdrawn: 0,
    deposited: 0,
    earned: 0,
    networkFee: 0,
    networkFeeIndex: 0,
    activeValidators: 0,
  }
};

const globalNetworkFeeIndex = async() => {
  return globalData.networkFeeIndex +
    (+await ethers.provider.getBlockNumber() - globalData.networkFeeIndexBlockNumber) *
    globalData.networkFee;
}

export const operatorIndexOf = async(idx) => {
  const currentBlockNumber = await ethers.provider.getBlockNumber();
  const value = operatorData[idx].index +
    (currentBlockNumber - operatorData[idx].indexBlockNumber) *
    operatorData[idx].fee;
  return value;
}

const operatorExpenseOf = async(address, oidx) => {
  return addressData[address].operatorsInUse[oidx].used + 
    (await operatorIndexOf(oidx) - addressData[address].operatorsInUse[oidx].index) *
    addressData[address].operatorsInUse[oidx].validatorsCount;
}

export const operatorBalanceOf = async(idx) => {
  const currentBlockNumber = await ethers.provider.getBlockNumber();
  const value = operatorData[idx].balance +
    (currentBlockNumber - operatorData[idx].blockNumber) *
    operatorData[idx].fee * operatorData[idx].validatorsCount;
  return value;
}

export const addressNetworkFee = async(address) => {
  let {
    activeValidators,
    networkFee,
    networkFeeIndex,
  } = addressData[address];

  return networkFee +
    (+await globalNetworkFeeIndex() - networkFeeIndex) * activeValidators;
}


export const addressBalanceOf = async(address) => {
  let {
    deposited,
    earned,
    operatorIdxs,
    withdrawn,
    networkFee,
    used,
    operatorsInUse
  } = addressData[address];
  let total = deposited + earned;

  for (const oidx of operatorIdxs) {
    total += await operatorBalanceOf(oidx);
  }

  for (const oidx of Object.keys(operatorsInUse)) {
    used += await operatorExpenseOf(address, oidx);
  }

  total -= withdrawn + used + networkFee;

  return total;
}

export const registerOperator = async (account, idx, fee) => {
  await ssvNetwork.connect(account).registerOperator(`testOperator ${idx}`, operatorsPub[idx], fee);
  await progressBlocks(1);
  operatorData[idx] = {
    fee,
    blockNumber: await ethers.provider.getBlockNumber(),
    indexBlockNumber: await ethers.provider.getBlockNumber(),
    index: 0,
    validatorsCount: 0,
    balance: 0,
  };

  addressData[account.address].operatorIdxs.push(idx);
}

export const registerValidator = async (account, validatorIdx, operatorIdxs, depositAmount) => {
  await ssvToken.connect(account).approve(ssvNetwork.address, depositAmount);
  await ssvNetwork.connect(account).registerValidator(
    validatorsPub[validatorIdx],
    operatorIdxs.map(oidx => operatorsPub[oidx]),
    operatorIdxs.map(oidx => operatorsPub[oidx]),
    operatorIdxs.map(oidx => operatorsPub[oidx]),
    `${depositAmount}`,
  );
  await updateAddressNetworkFee(account.address);
  await progressBlocks(1);
  for (const oidx of operatorIdxs) {
    await updateOperatorBalance(oidx);
    operatorData[oidx].validatorsCount += 1
    addressData[account.address].operatorsInUse[oidx] = addressData[account.address].operatorsInUse[oidx] || { validatorsCount: 0, index: 0, used: 0 };
    addressData[account.address].operatorsInUse[oidx].used = await operatorExpenseOf(account.address, oidx);
    addressData[account.address].operatorsInUse[oidx].validatorsCount += 1;
    addressData[account.address].operatorsInUse[oidx].index = await operatorIndexOf(oidx);
  };
  addressData[account.address].activeValidators++;
  addressData[account.address].deposited += depositAmount;
}

export const deposit = async(account, amount) => {
  await ssvToken.connect(account).approve(ssvNetwork.address, `${amount}`);
  await ssvNetwork.connect(account).deposit(`${amount}`);
  addressData[account.address].deposited += amount;
}

export const withdraw = async(account, amount) => {
  await ssvNetwork.connect(account).withdraw(`${amount}`);
  addressData[account.address].withdrawn += amount;
}

export const updateOperatorFee = async (account, idx, fee) => {
  await ssvNetwork.connect(account).updateOperatorFee(operatorsPub[idx], fee);
  await progressBlocks(1);
  // update balance
  await updateOperatorBalance(idx);
  // update index
  operatorData[idx].index = +await operatorIndexOf(idx);
  operatorData[idx].indexBlockNumber = await ethers.provider.getBlockNumber();
  operatorData[idx].fee = fee;
}

const updateAddressNetworkFee = async (address) => {
  addressData[address].networkFee = await addressNetworkFee(address);
  addressData[address].networkFeeIndex = await globalNetworkFeeIndex();
}

export const updateNetworkFee = async (fee) => {
  await ssvNetwork.updateNetworkFee(fee);
  // await progressBlocks(1);
  globalData.networkFeeIndex = await globalNetworkFeeIndex();
  globalData.networkFee = fee;
  globalData.networkFeeIndexBlockNumber = await ethers.provider.getBlockNumber();
}

export const updateOperatorBalance = async (idx) => {
  operatorData[idx].balance = +await operatorBalanceOf(idx);
  operatorData[idx].blockNumber = await ethers.provider.getBlockNumber();
}

export const processTestCase = async (testFlow) => {
  await network.provider.send('evm_setAutomine', [false]);
  for (const blockNumber of Object.keys(testFlow)) {
    const diffBlocks = +blockNumber - +await ethers.provider.getBlockNumber();
    const { funcs, asserts } = testFlow[blockNumber];
    await progressBlocks(diffBlocks);
    if (Array.isArray(asserts)) {
      for (const assert of asserts) {
        await assert();
      }
    }
    if (Array.isArray(funcs)) {
      for (const func of funcs) {
        await func();
        await progressBlocks(1);
      }
    }
  }
}
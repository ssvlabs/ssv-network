import { ethers, upgrades } from 'hardhat';
import { progressTime, progressBlocks, snapshot, mine } from '../utils';

declare var network: any;

const operatorPublicKeyPrefix = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345';
const validatorPublicKeyPrefix = '98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765';
const minimumBlocksBeforeLiquidation = 50;
const operatorMaxFeeIncrease = 10;

export let utils, ssvToken, ssvRegistry, ssvNetwork;
export let owner, account1, account2, account3;

export const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`);
export const validatorsPub = Array.from(Array(10).keys()).map(k => `0x${validatorPublicKeyPrefix}${k}`);

const DAY = 86400;
const YEAR = 365 * DAY;

const operatorData = [];
const addressData = {};
const globalData: any = {};

export const initContracts = async() => {
  [owner, account1, account2, account3] = await ethers.getSigners();

  // for tests
  initGlobalData();
  initAddressData(account1.address);
  initAddressData(account2.address);
  initAddressData(account3.address);
  //
  const utilsFactory = await ethers.getContractFactory('Utils');
  const ssvTokenFactory = await ethers.getContractFactory('SSVToken');
  const ssvRegistryFactory = await ethers.getContractFactory('SSVRegistry');
  const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
  utils = await utilsFactory.deploy();
  ssvToken = await ssvTokenFactory.deploy();
  ssvRegistry = await upgrades.deployProxy(ssvRegistryFactory, { initializer: false });
  await utils.deployed();
  await ssvToken.deployed();
  await ssvRegistry.deployed();
  ssvNetwork = await upgrades.deployProxy(ssvNetworkFactory, [ssvRegistry.address, ssvToken.address, minimumBlocksBeforeLiquidation, operatorMaxFeeIncrease]);
  await ssvNetwork.deployed();
  await ssvToken.mint(account1.address, '1000000');
  await ssvToken.mint(account2.address, '1000000');
}

const initGlobalData = () => {
  globalData.networkFeeIndexBlockNumber = 0;
  globalData.networkFeeIndex = 0;
  globalData.networkFee = 0;
  globalData.validatorCount = 0;
  globalData.networkEarnings = 0;
  globalData.networkEarningsBlockNumber = 0;
  globalData.withdrawnFromTreasury = 0;
}

const initAddressData = (address) => {
  addressData[address] = {
    operatorIdxs: [],
    operatorsInUse: {},
    validatorOperators: {},
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
    (+await utils.blockNumber() - globalData.networkFeeIndexBlockNumber) *
    globalData.networkFee;
}

export const operatorIndexOf = async(idx) => {
  const currentBlockNumber = await utils.blockNumber();
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

export const operatorEarningsOf = async(idx) => {
  const currentBlockNumber = await utils.blockNumber();
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
    withdrawn,
    networkFee,
    used,
    operatorsInUse,
  } = addressData[address];
  let total = deposited;

  total += await totalEarningsOf(address);

  for (const oidx of Object.keys(operatorsInUse)) {
    used += await operatorExpenseOf(address, oidx);
  }

  total -= withdrawn + used + await addressNetworkFee(address);

  return total;
}

export const totalEarningsOf = async(address) => {
  let {
    earned,
    operatorIdxs,
  } = addressData[address];

  let total = earned;

  for (const oidx of operatorIdxs) {
    total += await operatorEarningsOf(oidx);
  }

  return total;
}

export const registerOperator = async (account, idx, fee) => {
  await ssvNetwork.connect(account).registerOperator(`testOperator ${idx}`, operatorsPub[idx], fee);
  await progressBlocks(1);
  operatorData[idx] = {
    fee,
    blockNumber: await utils.blockNumber(),
    indexBlockNumber: await utils.blockNumber(),
    index: 0,
    validatorsCount: 0,
    balance: 0,
  };

  addressData[account.address].operatorIdxs.push(idx);
  console.log(`      | Register operator ${idx} > [ADDRESS] ${account.address} | [ACTUAL_BLOCK] ${await utils.blockNumber()}`);
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
  await progressBlocks(1);
  await updateNetworkEarnings();
  await updateAddressNetworkFee(account.address);

  addressData[account.address].validatorOperators[validatorIdx] = [];

  for (const oidx of operatorIdxs) {
    await updateOperatorBalance(oidx);
    operatorData[oidx].validatorsCount += 1;
    addressData[account.address].operatorsInUse[oidx] = addressData[account.address].operatorsInUse[oidx] || { validatorsCount: 0, index: 0, used: 0 };
    addressData[account.address].operatorsInUse[oidx].used = await operatorExpenseOf(account.address, oidx);
    addressData[account.address].operatorsInUse[oidx].validatorsCount += 1;
    addressData[account.address].operatorsInUse[oidx].index = await operatorIndexOf(oidx);
    //
    addressData[account.address].validatorOperators[validatorIdx].push(oidx);
  };
  addressData[account.address].activeValidators++;
  addressData[account.address].deposited += depositAmount;
  globalData.validatorCount++;

  console.log(`      | Register validator ${validatorIdx} > [ADDRESS] ${account.address} [ACTUAL_BLOCK] ${await utils.blockNumber()}`);
}

export const updateValidator = async (account, validatorIdx, operatorIdxs, depositAmount) => {
  await ssvToken.connect(account).approve(ssvNetwork.address, depositAmount);
  await ssvNetwork.connect(account).updateValidator(
    validatorsPub[validatorIdx],
    operatorIdxs.map(oidx => operatorsPub[oidx]),
    operatorIdxs.map(oidx => operatorsPub[oidx]),
    operatorIdxs.map(oidx => operatorsPub[oidx]),
    `${depositAmount}`,
  );
  await progressBlocks(1);
  for (const oidx of addressData[account.address].validatorOperators[validatorIdx]) {
    await updateOperatorBalance(oidx);
    operatorData[oidx].validatorsCount -= 1;
    addressData[account.address].operatorsInUse[oidx].used = await operatorExpenseOf(account.address, oidx);
    addressData[account.address].operatorsInUse[oidx].validatorsCount -= 1;
    addressData[account.address].operatorsInUse[oidx].index = await operatorIndexOf(oidx);
  }
  addressData[account.address].validatorOperators[validatorIdx] = [];

  for (const oidx of operatorIdxs) {
    await updateOperatorBalance(oidx);
    operatorData[oidx].validatorsCount += 1
    addressData[account.address].operatorsInUse[oidx] = addressData[account.address].operatorsInUse[oidx] || { validatorsCount: 0, index: 0, used: 0 };
    addressData[account.address].operatorsInUse[oidx].used = await operatorExpenseOf(account.address, oidx);
    addressData[account.address].operatorsInUse[oidx].validatorsCount += 1;
    addressData[account.address].operatorsInUse[oidx].index = await operatorIndexOf(oidx);

    addressData[account.address].validatorOperators[validatorIdx].push(oidx);
  };
  addressData[account.address].deposited += depositAmount;
  console.log(`      | Update validator ${validatorIdx} >  [ACTUAL_BLOCK] ${await utils.blockNumber()}`);
}

export const deleteValidator = async (account, validatorIdx) => {
  await ssvNetwork.connect(account).deleteValidator(validatorsPub[validatorIdx]);
  await progressBlocks(1);
  await updateNetworkEarnings();
  await updateAddressNetworkFee(account.address);
  for (const oidx of addressData[account.address].validatorOperators[validatorIdx]) {
    await updateOperatorBalance(oidx);
    operatorData[oidx].validatorsCount -= 1;
    addressData[account.address].operatorsInUse[oidx].used = await operatorExpenseOf(account.address, oidx);
    addressData[account.address].operatorsInUse[oidx].validatorsCount -= 1;
    addressData[account.address].operatorsInUse[oidx].index = await operatorIndexOf(oidx);
  }
  addressData[account.address].validatorOperators[validatorIdx] = [];
  addressData[account.address].activeValidators--;
  globalData.validatorCount--;
  console.log(`      | Delete validator ${validatorIdx} >  [ACTUAL_BLOCK] ${await utils.blockNumber()}`);
}

export const deposit = async(account, amount) => {
  await ssvToken.connect(account).approve(ssvNetwork.address, `${amount}`);
  await ssvNetwork.connect(account).deposit(`${amount}`);
  addressData[account.address].deposited += amount;
  console.log(`      | Deposited [ADDRESS] ${account.address} | [VALUE]: ${amount}`);
}

export const withdraw = async(account, amount) => {
  await ssvNetwork.connect(account).withdraw(`${amount}`);
  addressData[account.address].withdrawn += amount;
}

export const updateOperatorFee = async (account, idx, fee) => {
  await progressTime(4 * DAY);
  await ssvNetwork.connect(account).updateOperatorFee(operatorsPub[idx], fee);
  await progressBlocks(1);
  // update balance
  await updateOperatorBalance(idx);
  // update index
  operatorData[idx].index = +await operatorIndexOf(idx);
  operatorData[idx].indexBlockNumber = await utils.blockNumber();
  operatorData[idx].fee = fee;
  console.log(`      | Update operator fee ${idx} > [VALUE] ${fee} [ACTUAL_BLOCK] ${await utils.blockNumber()}`);
}

const getNetworkEarnings = async () => {
  return globalData.networkEarnings + ((await utils.blockNumber()) - globalData.networkEarningsBlockNumber) * globalData.networkFee * globalData.validatorCount;
}

export const getNetworkTreasury = async () => {
  return (await getNetworkEarnings()) - globalData.withdrawnFromTreasury;
}

const updateAddressNetworkFee = async (address) => {
  addressData[address].networkFee = await addressNetworkFee(address);
  addressData[address].networkFeeIndex = await globalNetworkFeeIndex();
}

const updateNetworkEarnings = async () => {
  globalData.networkEarnings = await getNetworkEarnings();
  globalData.networkEarningsBlockNumber = await utils.blockNumber();
}

export const updateNetworkFee = async (fee) => {
  await ssvNetwork.updateNetworkFee(fee);
  await progressBlocks(1);
  globalData.networkFeeIndex = await globalNetworkFeeIndex();
  globalData.networkFee = fee;
  globalData.networkFeeIndexBlockNumber = await utils.blockNumber();
  console.log(`      | Update network fee > [VALUE] ${fee} [ACTUAL_BLOCK] ${await utils.blockNumber()}`);
}

export const updateOperatorBalance = async (idx) => {
  operatorData[idx].balance = +await operatorEarningsOf(idx);
  operatorData[idx].blockNumber = await utils.blockNumber();
}

export const processTestCase = async (testFlow) => {
  const baseBlockNumber = await utils.blockNumber();
  await network.provider.send('evm_setAutomine', [false]);
  for (const blockNumber of Object.keys(testFlow)) {
    const targetBlock = +blockNumber - -baseBlockNumber;
    const diffBlocks = targetBlock - (await utils.blockNumber());
    const { funcs, asserts } = testFlow[blockNumber];
    await progressBlocks(diffBlocks);
    console.log(`[BLOCK] ${+await utils.blockNumber()} (${blockNumber})`);
    await network.provider.send('evm_setAutomine', [true]);
    if (Array.isArray(asserts)) {
      for (const assert of asserts) {
        await assert();
      }
    }
    await network.provider.send('evm_setAutomine', [false]);
    if (Array.isArray(funcs)) {
      for (const func of funcs) {
        await func();
        await progressBlocks(1);
      }
    }
  }

  await network.provider.send('evm_setAutomine', [true]);
}
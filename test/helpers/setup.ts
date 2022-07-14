import { ethers, upgrades } from 'hardhat';
import { progressTime, progressBlocks, snapshot, mine } from './utils';

declare var network: any;

const operatorPublicKeyPrefix = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345';
const validatorPublicKeyPrefix = '98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765';
const minimumBlocksBeforeLiquidation = 7000;
const operatorMaxFeeIncrease = 10;

//@ts-ignore
export let ssvToken: any, ssvRegistry: any, ssvNetwork: any, utils: any;
//@ts-ignore
export let owner: any, account1: any, account2: any, account3: any, account4: any;

export const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`);
export const validatorsPub = Array.from(Array(10).keys()).map(k => `0x${validatorPublicKeyPrefix}${k}`);
export const operatorsIds = Array.from(Array(10).keys()).map(k => k + 1);

const DAY = 86400;
const YEAR = 365 * DAY;

const setOperatorFeePeriod = 0;
const approveOperatorFeePeriod = DAY;

const operatorData: any = [];
const addressData: any = {};
const globalData: any = {};

export const initContracts = async () => {
  [owner, account1, account2, account3] = await ethers.getSigners();

  // for tests
  initGlobalData();
  initAddressData(account1.address);
  initAddressData(account2.address);
  initAddressData(account3.address);
  //
  const utilsFactory = await ethers.getContractFactory('Utils');
  const ssvTokenFactory = await ethers.getContractFactory('SSVTokenMock');
  const ssvRegistryFactory = await ethers.getContractFactory('SSVRegistry');
  const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
  utils = await utilsFactory.deploy();
  ssvToken = await ssvTokenFactory.deploy();
  ssvRegistry = await upgrades.deployProxy(ssvRegistryFactory, { initializer: false });
  await utils.deployed();
  await ssvToken.deployed();
  await ssvRegistry.deployed();
  ssvNetwork = await upgrades.deployProxy(ssvNetworkFactory, [ssvRegistry.address, ssvToken.address, minimumBlocksBeforeLiquidation, operatorMaxFeeIncrease, setOperatorFeePeriod, approveOperatorFeePeriod]);
  await ssvNetwork.deployed();
  await ssvToken.mint(account1.address, '100000000000');
  await ssvToken.mint(account2.address, '100000000000');
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
//@ts-ignore
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

const globalNetworkFeeIndex = async () => {
  return globalData.networkFeeIndex +
    (+await utils.blockNumber() - globalData.networkFeeIndexBlockNumber) *
    globalData.networkFee;
}
//@ts-ignore
export const operatorIndexOf = async (idx) => {
  const currentBlockNumber = await utils.blockNumber();
  const value = operatorData[idx].index +
    (currentBlockNumber - operatorData[idx].indexBlockNumber) *
    operatorData[idx].fee;
  return value;
}
//@ts-ignore
const operatorExpenseOf = async (address, oidx) => {
  return addressData[address].operatorsInUse[oidx].used +
    (await operatorIndexOf(oidx) - addressData[address].operatorsInUse[oidx].index) *
    addressData[address].operatorsInUse[oidx].validatorsCount;
}
//@ts-ignore
export const operatorEarningsOf = async (idx) => {
  const currentBlockNumber = await utils.blockNumber();
  const value = operatorData[idx].balance +
    (currentBlockNumber - operatorData[idx].blockNumber) *
    operatorData[idx].fee * operatorData[idx].validatorsCount;
  return value;
}
//@ts-ignore
export const addressNetworkFee = async (address) => {
  let {
    activeValidators,
    networkFee,
    networkFeeIndex,
  } = addressData[address];
  return networkFee +
    (+await globalNetworkFeeIndex() - networkFeeIndex) * activeValidators;
}
//@ts-ignore
export const addressBalanceOf = async (address) => {
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
//@ts-ignore
export const totalEarningsOf = async (address) => {
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
//@ts-ignore
export const registerOperator = async (operators) => {
  for (const operatorObject of operators) {
    await ssvNetwork.connect(operatorObject.account).registerOperator(`testOperator ${operatorObject.idx}`, operatorsPub[operatorObject.idx], operatorObject.fee);
    await progressBlocks(1);
    const fee = operatorObject.fee
    operatorData[operatorObject.idx] = {
      fee,
      blockNumber: await utils.blockNumber(),
      indexBlockNumber: await utils.blockNumber(),
      index: 0,
      validatorsCount: 0,
      balance: 0,
    };

    addressData[operatorObject.account.address].operatorIdxs.push(operatorObject.idx);
    console.log(`      | Register operator ${operatorObject.idx} > [ADDRESS] ${operatorObject.account.address} | [ACTUAL_BLOCK] ${await utils.blockNumber()}`);
  }
}
//@ts-ignore
export const registerValidator = async (validators) => {
  for (const validatorObject of validators) {
    await ssvToken.connect(validatorObject.account).approve(ssvNetwork.address, validatorObject.depositAmount);
    await ssvNetwork.connect(validatorObject.account).registerValidator(
      validatorsPub[validatorObject.validatorIdx],
      validatorObject.operatorIdxs.map((oidx: number) => operatorsIds[oidx]),
      validatorObject.operatorIdxs.map((oidx: number) => operatorsPub[oidx]),
      validatorObject.operatorIdxs.map((oidx: number) => operatorsPub[oidx]),
      `${validatorObject.depositAmount}`,
    );
    console.log(`[ACTUAL_BLOCK] ${await utils.blockNumber()}`)
    await progressBlocks(1);
    await updateAddressNetworkFee(validatorObject.account.address);
    await updateNetworkEarnings();
    addressData[validatorObject.account.address].validatorOperators[validatorObject.validatorIdx] = [];
    for (const oidx of validatorObject.operatorIdxs) {
      await updateOperatorBalance(oidx);
      operatorData[oidx].validatorsCount += 1;
      addressData[validatorObject.account.address].operatorsInUse[oidx] = addressData[validatorObject.account.address].operatorsInUse[oidx] || { validatorsCount: 0, index: 0, used: 0 };
      addressData[validatorObject.account.address].operatorsInUse[oidx].used = await operatorExpenseOf(validatorObject.account.address, oidx);
      addressData[validatorObject.account.address].operatorsInUse[oidx].validatorsCount += 1;
      addressData[validatorObject.account.address].operatorsInUse[oidx].index = await operatorIndexOf(oidx);
      //
      addressData[validatorObject.account.address].validatorOperators[validatorObject.validatorIdx].push(oidx);
    };
    addressData[validatorObject.account.address].activeValidators++;
    addressData[validatorObject.account.address].deposited += validatorObject.depositAmount;
    globalData.validatorCount++;

    console.log(`      | Register validator ${validatorObject.validatorIdx} > [ADDRESS] ${validatorObject.account.address} [ACTUAL_BLOCK] ${await utils.blockNumber()}`);
  }
}
//@ts-ignore
export const updateValidator = async (account, validatorIdx, operatorIdxs, depositAmount) => {
  await ssvToken.connect(account).approve(ssvNetwork.address, depositAmount);
  await ssvNetwork.connect(account).updateValidator(
    validatorsPub[validatorIdx],
    operatorIdxs.map((oidx: number) => operatorsIds[oidx]),
    operatorIdxs.map((oidx: number) => operatorsPub[oidx]),
    operatorIdxs.map((oidx: number) => operatorsPub[oidx]),
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
//@ts-ignore
export const removeValidator = async (account, validatorIdx) => {
  await ssvNetwork.connect(account).removeValidator(validatorsPub[validatorIdx]);
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
  console.log(`      | Remove validator ${validatorIdx} >  [ACTUAL_BLOCK] ${await utils.blockNumber()}`);
}
//@ts-ignore
export const deposit = async (account, amount) => {
  await ssvToken.connect(account).approve(ssvNetwork.address, `${amount}`);
  await ssvNetwork.connect(account).deposit(account.address, `${amount}`);
  addressData[account.address].deposited += amount;
  console.log(`      | Deposited [ADDRESS] ${account.address} | [VALUE]: ${amount}`);
}
//@ts-ignore
export const withdraw = async (account, amount) => {
  await ssvNetwork.connect(account).withdraw(`${amount}`);
  addressData[account.address].withdrawn += amount;
}
//@ts-ignore
export const liquidate = async (account) => {
  await ssvToken.connect(account).liquidate(account.address);
  console.log(`      | Liquidated [ADDRESS] ${account.address}`);
}
//@ts-ignore
export const updateOperatorFee = async (account, idx, fee) => {
  await ssvNetwork.connect(account).declareOperatorFee(operatorsIds[idx], fee);
  await ssvNetwork.connect(account).executeOperatorFee(operatorsIds[idx]);
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
  console.log("-> det", globalData.networkEarnings, (await utils.blockNumber()),  globalData.networkEarningsBlockNumber, globalData.networkFee, globalData.validatorCount)
  return globalData.networkEarnings + ((await utils.blockNumber()) - globalData.networkEarningsBlockNumber) * globalData.networkFee * globalData.validatorCount;
}

export const getNetworkTreasury = async () => {
  return (await getNetworkEarnings()) - globalData.withdrawnFromTreasury;
}
//@ts-ignore
const updateAddressNetworkFee = async (address) => {
  addressData[address].networkFee = await addressNetworkFee(address);
  addressData[address].networkFeeIndex = await globalNetworkFeeIndex();
}

const updateNetworkEarnings = async () => {
  globalData.networkEarnings = await getNetworkEarnings();
  globalData.networkEarningsBlockNumber = await utils.blockNumber();
}
//@ts-ignore
export const updateNetworkFee = async (fee) => {
  await ssvNetwork.updateNetworkFee(fee);
  await progressBlocks(1);
  globalData.networkFeeIndex = await globalNetworkFeeIndex();
  globalData.networkFee = fee;
  globalData.networkFeeIndexBlockNumber = await utils.blockNumber();
  console.log(`      | Update network fee > [VALUE] ${fee} [ACTUAL_BLOCK] ${await utils.blockNumber()}`);
}
//@ts-ignore
export const updateOperatorBalance = async (idx) => {
  operatorData[idx].balance = +await operatorEarningsOf(idx);
  operatorData[idx].blockNumber = await utils.blockNumber();
}
//@ts-ignore
// export const currentBurnRate = async (address) => {
// let operatorFees = 0
//   for (const operators of addressData[address].operatorsInUse) {
//     operatorFees += operators.fees
//   }

//   operatorData[idx].balance = +await operatorEarningsOf(idx);
//   operatorData[idx].blockNumber = await utils.blockNumber();
// }
//@ts-ignore
export const processTestCase = async (testFlow) => {
  const baseBlockNumber = await utils.blockNumber();
  // await network.provider.send('evm_setAutomine', [false]);
  for (const blockNumber of Object.keys(testFlow)) {
    const targetBlock = +blockNumber - -baseBlockNumber;
    const diffBlocks = targetBlock - (await utils.blockNumber());
    const { funcs, asserts } = testFlow[blockNumber];
    await progressBlocks(diffBlocks);
    console.log(`[BLOCK] ${+await utils.blockNumber()} (${blockNumber})`);
    // await network.provider.send('evm_setAutomine', [true]);
    if (Array.isArray(asserts)) for (const assert of asserts) await assert();
    // await network.provider.send('evm_setAutomine', [false]);
    if (Array.isArray(funcs)) {
      for (const func of funcs) {
        await func();
        await progressBlocks(1);
      }
    }
  }

  await network.provider.send('evm_setAutomine', [true]);
}
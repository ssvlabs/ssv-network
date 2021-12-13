import { ethers, upgrades } from 'hardhat';
import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
const { expect } = chai;

import {
  operatorsPub,
  operatorEarningsOf,
  operatorIndexOf,
  addressBalanceOf,
  totalEarningsOf,
  getNetworkTreasury,
  ssvNetwork,
} from './setup';

import { progressBlocks } from '../utils';


export const checkOperatorBalances = async(operatorIdxs) => {
  for (const oidx of operatorIdxs) {
    console.log(`      | Operator Balance >  [OPERATOR] ${oidx} | [VALUE] ${+await operatorEarningsOf(oidx)}`);
    expect(+await ssvNetwork.operatorEarningsOf(operatorsPub[oidx])).to.equal(+await operatorEarningsOf(oidx));
  }
}

export const checkOperatorIndexes = async(operatorIdxs) => {
  for (const oidx of operatorIdxs) {
    console.log(`      | Operator Index >  [OPERATOR] ${oidx} | [VALUE] ${+await operatorIndexOf(oidx)}`);
    expect(+await ssvNetwork.test_operatorIndexOf(operatorsPub[oidx])).to.equal(+await operatorIndexOf(oidx));
  }
}

export const checkTotalBalance = async(address) => {
  console.log(`      | Total balance >  [ADDRESS] ${address} | [VALUE] ${+await addressBalanceOf(address)} | [BLOCKCHAIN] ${await ssvNetwork.totalBalanceOf(address)}`);
  expect(+await ssvNetwork.totalBalanceOf(address)).to.equal(+await addressBalanceOf(address));
}

export const checkTotalEarnings = async (address) => {
  console.log(`      | Total Earnings >  [ADDRESS] ${address} | [VALUE] ${+await totalEarningsOf(address)} | [BLOCKCHAIN] ${await ssvNetwork.totalEarningsOf(address)}`);
  expect(+await ssvNetwork.totalEarningsOf(address)).to.equal(+await totalEarningsOf(address));
}

export const checkWithdrawFail = async(account, amount) => {
  await expect(ssvNetwork.connect(account).withdraw(`${amount}`)).to.be.revertedWith('not enough balance');
}

export const checkUpdateOperatorFeeFail = async(account, idx, fee) => {
  await expect(ssvNetwork.connect(account).updateOperatorFee(operatorsPub[idx], fee)).to.be.revertedWith('fee updated in last 72 hours');
}

export const checkNetworkTreasury = async() => {
  expect(await ssvNetwork.getNetworkTreasury()).to.equal(await getNetworkTreasury());
}
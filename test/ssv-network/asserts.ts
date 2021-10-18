import { ethers, upgrades } from 'hardhat';
import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
const { expect } = chai;

import {
  operatorsPub,
  operatorBalanceOf,
  operatorIndexOf,
  addressBalanceOf,
  ssvNetwork,
} from './setup';

import { progressBlocks } from '../utils';


export const checkOperatorBalances = async(operatorIdxs) => {
  for (const oidx of operatorIdxs) {
    console.log(`      | Operator Balance >  [OPERATOR] ${oidx} | [VALUE] ${+await operatorBalanceOf(oidx)}`);
    expect(+await ssvNetwork.operatorBalanceOf(operatorsPub[oidx])).to.equal(+await operatorBalanceOf(oidx));
  }
}

export const checkOperatorIndexes = async(operatorIdxs) => {
  for (const oidx of operatorIdxs) {
    console.log(`      | Operator Index >  [OPERATOR] ${oidx} | [VALUE] ${+await operatorIndexOf(oidx)}`);
    expect(+await ssvNetwork.test_operatorIndexOf(operatorsPub[oidx])).to.equal(+await operatorIndexOf(oidx));
  }
}

export const checkTotalBalance = async(address) => {
  console.log(`      | Total balance >  [ADDRESS] ${address} | [VALUE] ${+await addressBalanceOf(address)}`);
  expect(+await ssvNetwork.totalBalanceOf(address)).to.equal(+await addressBalanceOf(address));
}

export const checkWithdrawFail = async(account, amount) => {
  await expect(ssvNetwork.connect(account).withdraw(`${amount}`)).to.be.revertedWith('not enough balance');
}

export const checkUpdateOperatorFeeFail = async(account, idx, fee) => {
  await expect(ssvNetwork.connect(account).updateOperatorFee(operatorsPub[idx], fee)).to.be.revertedWith('fee updated in last 72 hours');
}
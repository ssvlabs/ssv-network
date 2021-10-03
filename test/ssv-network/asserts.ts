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
    expect(+await ssvNetwork.operatorBalanceOf(operatorsPub[oidx])).to.equal(+await operatorBalanceOf(oidx));
  }
}

export const checkOperatorIndexes = async(operatorIdxs) => {
  for (const oidx of operatorIdxs) {
    expect(+await ssvNetwork.test_operatorIndexOf(operatorsPub[oidx])).to.equal(+await operatorIndexOf(oidx));
  }
}

export const checkTotalBalance = async(address) => {
  expect(+await ssvNetwork.totalBalanceOf(address)).to.equal(+await addressBalanceOf(address));
}

export const checkWithdrawFail = async(account, amount) => {
  await expect(ssvNetwork.connect(account).withdraw(`${amount}`)).to.be.revertedWith('not enough balance');
}

export const checkUpdateOperatorFeeFail = async(account, idx, fee) => {
  await expect(ssvNetwork.connect(account).updateOperatorFee(operatorsPub[idx], fee)).to.be.revertedWith('Executes after 72 hours from last update');
}

export const checkUpdateNetworkFeeFail = async(fee) => {
  await expect(ssvNetwork.updateNetworkFee(fee)).to.be.revertedWith('Executes after 72 hours from last update');
}
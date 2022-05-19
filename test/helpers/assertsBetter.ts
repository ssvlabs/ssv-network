import { ethers, upgrades } from 'hardhat';
import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';
const { expect } = chai;

import {
  operatorsIds,
  operatorEarningsOf,
  addressBalanceOf,
  totalEarningsOf,
  getNetworkTreasury,
  ssvNetwork,
} from './setupBetter';

//@ts-ignore
export const checkOperatorBalances = async (operatorIdxs) => {
  for (const oidx of operatorIdxs) {
    // console.log(`      | Operator Balance >  [OPERATOR] ${oidx} | [VALUE] ${+await operatorEarningsOf(oidx)}`);
    // expect(+await ssvNetwork.operatorEarningsOf(operatorsIds[oidx])).to.equal(+await operatorEarningsOf(oidx));
    console.log(+await ssvNetwork.operatorEarningsOf(operatorsIds[oidx]))
  }
}

//@ts-ignore
export const checkTotalBalance = async (addresses) => {
  for (const address of addresses) {
    console.log(`      | Total balance >  [ADDRESS] ${address} | [VALUE] ${+await addressBalanceOf(address)} | [BLOCKCHAIN] ${await ssvNetwork.totalBalanceOf(address)}`);
    expect(+await ssvNetwork.totalBalanceOf(address)).to.equal(+await addressBalanceOf(address));
  }
}

//@ts-ignore
export const checkTotalEarnings = async (addresses) => {
  for (const address of addresses) {
    console.log(`      | Total Earnings >  [ADDRESS] ${address} | [VALUE] ${+await totalEarningsOf(address)} | [BLOCKCHAIN] ${await ssvNetwork.totalEarningsOf(address)}`);
    expect(+await ssvNetwork.totalEarningsOf(address)).to.equal(+await totalEarningsOf(address));
  }
}

//@ts-ignore
export const checkLiquidationStatus = async (address, result) => {
  console.log(`      | Liquidation Status >  [ADDRESS] ${address} | [STATUS] ${await ssvNetwork.liquidatable(address)} | [BLOCKCHAIN] ${await ssvNetwork.totalEarningsOf(address)}`);
  expect(await ssvNetwork.liquidatable(address)).to.equal(result)
}

//@ts-ignore
export const checkWithdrawFail = async (account, amount) => await expect(ssvNetwork.connect(account).withdraw(`${amount}`)).to.be.revertedWith('not enough balance');

export const checkNetworkTreasury = async () => expect(await ssvNetwork.getNetworkTreasury()).to.equal(await getNetworkTreasury());
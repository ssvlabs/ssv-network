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
} from './setup';

//@ts-ignore
export const checkOperatorBalances = async (operatorIdxs) => {
  for (const oidx of operatorIdxs) {
    console.log(`      | Operator Balance >  [OPERATOR] ${oidx} | [VALUE] ${+await operatorEarningsOf(oidx)}`);
    // expect(+await ssvNetwork.getOperatorEarnings(operatorsIds[oidx])).to.equal(+await operatorEarningsOf(oidx));
  }
}

//@ts-ignore
export const checkTotalBalance = async (addresses) => {
  for (const address of addresses) {
    console.log(`      | Total balance >  [ADDRESS] ${address} | [VALUE] ${+await addressBalanceOf(address)} | [BLOCKCHAIN] ${await ssvNetwork.getAddressBalance(address)}`);
    expect(+await ssvNetwork.getAddressBalance(address)).to.equal(+await addressBalanceOf(address));
  }
}

//@ts-ignore
export const checkTotalEarnings = async (addresses) => {
  for (const address of addresses) {
    console.log(`      | Total Earnings >  [ADDRESS] ${address} | [VALUE] ${+await totalEarningsOf(address)}`); //  | [BLOCKCHAIN] ${await ssvNetwork.getAddressEarnings(address)}
    // expect(+await ssvNetwork.getAddressEarnings(address)).to.equal(+await totalEarningsOf(address));
  }
}

//@ts-ignore
export const checkLiquidationStatus = async (address, result) => {
  console.log(`      | Liquidation Status >  [ADDRESS] ${address} | [STATUS] ${await ssvNetwork.isLiquidatable(address)}`); //  | [BLOCKCHAIN] ${await ssvNetwork.getAddressEarnings(address)}
  expect(await ssvNetwork.isLiquidatable(address)).to.equal(result)
}

//@ts-ignore
export const checkWithdrawFail = async (account, amount) => await expect(ssvNetwork.connect(account).withdraw(`${amount}`)).to.be.revertedWith('NotEnoughBalance');

export const checkNetworkTreasury = async () => {
  console.log("====>", await ssvNetwork.getNetworkEarnings(), await getNetworkTreasury())
  expect(await ssvNetwork.getNetworkEarnings()).to.equal(await getNetworkTreasury())
};
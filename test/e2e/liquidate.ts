import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import {
  initContracts,
  registerOperator,
  registerValidator,
  liquidate,
  processTestCase,
  updateNetworkFee,
  account1,
  account2,
  account3
} from '../helpers/setupBetter';

import {
  checkOperatorBalances,
  checkTotalBalance,
  checkTotalEarnings,
  checkNetworkTreasury,
} from '../helpers/assertsBetter';

beforeEach(() => {
  chai.should();
  chai.use(chaiAsPromised);
});

const { expect } = chai;

describe('Liquidation', function () {
  beforeEach(async function () { await initContracts() })

  it('Liquidation Flow', async function () {
    const testFlow = {
      3: {
        funcs: [
          () => updateNetworkFee(0),
          () => registerOperator([
            {account: account1, idx: 0, fee: 10000},
            {account: account1, idx: 1, fee: 10000},
            {account: account1, idx: 2, fee: 10000},
            {account: account2, idx: 3, fee: 10000},
          ]),
          // () => registerOperator(account2, 4, 10000),
          // () => registerOperator(account2, 5, 10000),
          // () => registerOperator(account2, 6, 10000),
          // () => registerOperator(account2, 7, 10000),
          // () => registerOperator(account3, 8, 100000),
        ],
        asserts: [
         // () => checkNetworkTreasury()
        ],
      },
      100: {
        funcs: [
          () => registerValidator([
            { account: account1, validatorIdx: 0, operatorIdxs: [0, 1, 2, 3], depositAmount: 250000 },
            { account: account2, validatorIdx: 1, operatorIdxs: [0, 1, 2, 3], depositAmount: 250000 },
          ]),
          // () => registerValidator(account1, 1, [4, 5, 6, 7], 250000),
          // () => registerValidator(account1, 2, [0, 1, 5, 6], 250000),
          // () => registerValidator(account2, 3, [4, 5, 6, 7], 250000),
          // () => registerValidator(account2, 4, [0, 1, 2, 3], 250000),
          // () => registerValidator(account2, 5, [0, 1, 6, 8], 250000),

        ],
        asserts: [
          //  () => checkOperatorBalances([0, 1, 2, 3]),
          //() => checkNetworkTreasury()
        ],
      },
      120: {
        funcs: [
          //() => liquidate(account2)
        ],
        asserts: [
          () => checkOperatorBalances([0, 1, 2, 3]),
          // () => checkTotalEarnings([account1.address, account2.address, account3.address]),
          // () => checkTotalBalance([account1.address, account2.address, account3.address]),
          // CHECK BURN RATE
          // CHECK IF ACCOUNTS ARE LIQUIDATABLE
          // () => checkNetworkTreasury(),
        ],
      },
      // 21: {
      //   funcs: [
      //     () => updateNetworkFee(10000),
      //   ],
      //   asserts: [
      //     // ACCOUNT 1 IS LIQUIDATED
      //     () => checkOperatorBalances([0, 1, 2, 3, 4, 5, 6, 7, 8]),
      //     () => checkTotalEarnings([account1.address, account2.address, account3.address]),
      //     () => checkTotalBalance([account1.address, account2.address, account3.address]),
      //     // CHECK BURN RATE
      //     // CHECK IF ACCOUNTS ARE LIQUIDATABLE
      //     () => checkNetworkTreasury(),
      //   ],
      // },
      // 45: {
      //   funcs: [
      //     // DEPOSIT COINS TO ACCOUNT 2 SO NO LONGER LIQUIDATABLE
      //     // LIQUIDATE ACCOUNT2
      //   ],
      //   asserts: [
      //     // ACCOUNT 1 IS LIQUIDATED
      //     // ACCOUNT 2 IS NOT LIQUIDATED
      //     () => checkOperatorBalances([0, 1, 2, 3]),
      //     () => checkTotalBalance(account1.address),
      //     () => checkTotalBalance(account2.address),
      //     () => checkTotalEarnings(account1.address),
      //     () => checkTotalEarnings(account2.address),
      //     () => checkNetworkTreasury(),
      //   ],
      // },
      // 101: {
      //   funcs: [
      //     // LIQUIDATE ACCOUNT2
      //     () => updateNetworkFee(1000),
      //     () => updateOperatorFee(account3, 8, 10000),
      //     // DEPOSIT COINS TO ACCOUNT1
      //     // REACTIVATE ACCOUNT1
      //   ],
      //   asserts: [
      //     // ACCOUNT 1 IS LIQUIDATED
      //     // ACCOUNT 2 IS NOT LIQUIDATED
      //     () => checkOperatorBalances([0, 1, 2, 3]),
      //     () => checkTotalBalance(account1.address),
      //     () => checkTotalBalance(account2.address),
      //     () => checkTotalEarnings(account1.address),
      //     () => checkTotalEarnings(account2.address),
      //     () => checkNetworkTreasury(),
      //   ]
      // },
      // 220: {
      //   funcs: [
      //     // REMOVE 2 OPERATORS FROM ACCOUNT2
      //   ],
      //   asserts: [
      //     // ACCOUNT 2 IS LIQUIDATED
      //     // ACCOUNT 1 IS NOT LIQUIDATED
      //     () => checkOperatorBalances([0, 1, 2, 3]),
      //     () => checkTotalBalance(account1.address),
      //     () => checkTotalBalance(account2.address),
      //     () => checkTotalEarnings(account1.address),
      //     () => checkTotalEarnings(account2.address),
      //     () => checkNetworkTreasury(),
      //   ]
      // },
      // 240: {
      //   funcs: [
      //     // DEPOSIT TO ACCOUNT2 (STILL LIQUIDATABLE)
      //     // REACTIVATE ACCOUNT2
      //     // LIQUIDATE ACCOUNT1
      //     // LIQUIDATE ACCOUNT2
      //   ],
      //   asserts: [
      //     // ACCOUNT 2 IS LIQUIDATED
      //     // ACCOUNT 1 IS NOT LIQUIDATED
      //     () => checkOperatorBalances([0, 1, 2, 3]),
      //     () => checkTotalBalance(account1.address),
      //     () => checkTotalBalance(account2.address),
      //     () => checkTotalEarnings(account1.address),
      //     () => checkTotalEarnings(account2.address),
      //     () => checkNetworkTreasury(),
      //   ]
      // },
      // 241: {
      //   funcs: [
      //     // LIQUIDATE ACCOUNT1
      //     // LIQUIDATE ACCOUNT2
      //   ],
      //   asserts: [
      //     // ACCOUNT 2 IS NOT LIQUIDATED
      //     // ACCOUNT 1 IS NOT LIQUIDATED
      //     () => checkOperatorBalances([0, 1, 2, 3]),
      //     () => checkTotalBalance(account1.address),
      //     () => checkTotalBalance(account2.address),
      //     () => checkTotalEarnings(account1.address),
      //     () => checkTotalEarnings(account2.address),
      //     () => checkNetworkTreasury(),
      //   ]
      // },
      // 242: {
      //   asserts: [
      //     // ACCOUNT 2 IS LIQUIDATED
      //     // ACCOUNT 1 IS NOT LIQUIDATED
      //     () => checkOperatorBalances([0, 1, 2, 3]),
      //     () => checkTotalBalance(account1.address),
      //     () => checkTotalBalance(account2.address),
      //     () => checkTotalEarnings(account1.address),
      //     () => checkTotalEarnings(account2.address),
      //     () => checkNetworkTreasury(),
      //   ]
      // }
    };

    await processTestCase(testFlow);
  });
});
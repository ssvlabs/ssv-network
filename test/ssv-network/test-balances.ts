import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';

import {
  initContracts,
  registerOperator,
  registerValidator,
  updateOperatorFee,
  processTestCase,
  updateNetworkFee,
  account1,
  account2,
} from './setup';

import {
  // checkOperatorIndexes,
  checkOperatorBalances,
  checkTotalBalance,
  checkTotalEarnings,
  // checkUpdateOperatorFeeFail,
  checkNetworkTreasury,
} from './asserts';

before(() => {
  chai.should();
  chai.use(chaiAsPromised);
});

const { expect } = chai;

describe('SSV Network', function() {
  before(async function () {
    await initContracts();
  });

  it('Operator and validator balances', async function() {
    const testFlow = {
      10: {
        funcs: [
          () => updateNetworkFee(1000),
          () => registerOperator(account2, 0, 20000),
          () => registerOperator(account2, 1, 10000),
          () => registerOperator(account2, 2, 10000),
          () => registerOperator(account2, 3, 30000),
        ],
        asserts: [
          () => checkNetworkTreasury(),
        ],
      },
      20: {
        funcs: [
          () => registerValidator(account1, 0, [0, 1, 2, 3], 10000000),
        ],
        asserts: [
          // () => checkOperatorIndexes([0, 1, 2, 3]),
          () => checkOperatorBalances([0, 1, 2, 3]),
          () => checkNetworkTreasury(),
        ],
      },
      30: {
        funcs: [
          () => updateOperatorFee(account2, 0, 11000),
          () => registerValidator(account1, 1, [0, 1, 2, 3], 10000000),
        ],
        asserts: [
          // () => checkOperatorIndexes([0, 1, 2, 3]),
          () => checkOperatorBalances([0, 1, 2, 3]),
          () => checkNetworkTreasury(),
        ],
      },
      40: {
        funcs: [
          () => registerValidator(account1, 2, [0, 1, 2, 3], 10000000),
        ],
        asserts: [
          // () => checkOperatorIndexes([0, 1, 2, 3]),
          () => checkOperatorBalances([0, 1, 2, 3]),
          () => checkNetworkTreasury(),
        ],
      },
      50: {
        funcs: [
          () => registerValidator(account1, 3, [0, 1, 2, 3], 10000000),
        ],
        asserts: [
          // () => checkOperatorIndexes([0, 1, 2, 3]),
          () => checkOperatorBalances([0, 1, 2, 3]),
          () => checkTotalBalance(account1.address),
          () => checkTotalBalance(account2.address),
          () => checkTotalEarnings(account1.address),
          () => checkTotalEarnings(account2.address),
          () => checkNetworkTreasury(),
        ],
      },
      100: {
        asserts: [
          () => checkOperatorBalances([0, 1, 2, 3]),
          () => checkTotalBalance(account1.address),
          () => checkTotalBalance(account2.address),
          () => checkTotalEarnings(account1.address),
          () => checkTotalEarnings(account2.address),
          () => checkNetworkTreasury(),
        ]
      }
    };

    await processTestCase(testFlow);
  });
});
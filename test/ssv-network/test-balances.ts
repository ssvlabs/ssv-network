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
  checkOperatorIndexes,
  checkOperatorBalances,
  checkTotalBalance,
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
          () => updateNetworkFee(1),
          () => registerOperator(account2, 0, 2),
          () => registerOperator(account2, 1, 1),
          () => registerOperator(account2, 2, 1),
          () => registerOperator(account2, 3, 3),
        ],
        asserts: [],
      },
      20: {
        funcs: [
          () => registerValidator(account1, 0, [0, 1, 2, 3], 1000),
        ],
        asserts: [
          () => checkOperatorIndexes([0, 1, 2, 3]),
          () => checkOperatorBalances([0, 1, 2, 3]),
        ],
      },
      30: {
        funcs: [
          () => updateOperatorFee(account2, 0, 3),
          () => registerValidator(account1, 1, [0, 1, 2, 3], 1000),
        ],
        asserts: [
          () => checkOperatorIndexes([0, 1, 2, 3]),
          () => checkOperatorBalances([0, 1, 2, 3]),
        ],
      },
      40: {
        funcs: [
          () => registerValidator(account1, 2, [0, 1, 2, 3], 1000),
        ],
        asserts: [
          () => checkOperatorIndexes([0, 1, 2, 3]),
          () => checkOperatorBalances([0, 1, 2, 3]),
        ],
      },
      50: {
        funcs: [
          // () => updateOperatorFee(account2, 0, 1),
          // () => updateNetworkFee(2),
          () => registerValidator(account1, 3, [0, 1, 2, 3], 1000),
        ],
        asserts: [
          () => checkOperatorIndexes([0, 1, 2, 3]),
          () => checkOperatorBalances([0, 1, 2, 3]),
        ],
      },
      100: {
        asserts: [
          () => checkOperatorBalances([0, 1, 2, 3]),
          () => checkTotalBalance(account1.address),
          () => checkTotalBalance(account2.address),
        ]
      }
    };

    await processTestCase(testFlow);
  });
});
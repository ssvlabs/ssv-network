import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';

import {
  initContracts,
  registerOperator,
  registerValidator,
  updateValidator,
  removeValidator,
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
          () => updateNetworkFee(10000),
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
          () => registerValidator(account1, 0, [0, 1, 2, 3], 20000000),
        ],
        asserts: [
          // () => checkOperatorIndexes([0, 1, 2, 3]),
          () => checkOperatorBalances([0, 1, 2, 3]),
          () => checkNetworkTreasury(),
        ],
      },
      100: {
        funcs: [
          () => updateValidator(account1, 0, [0, 1, 2, 3], 25000000),
        ],
      },
      140: {
        asserts: [
          () => checkTotalBalance(account1.address),
          () => checkTotalBalance(account2.address),
          () => checkNetworkTreasury(),
        ]
      },
      150: {
        funcs: [
          () => removeValidator(account1, 0),
        ],
      },
      180: {
        asserts: [
          () => checkTotalBalance(account1.address),
          () => checkTotalBalance(account2.address),
          () => checkTotalEarnings(account1.address),
          () => checkTotalEarnings(account2.address),
          () => checkNetworkTreasury(),
        ]
      },
    };

    await processTestCase(testFlow);
  });
});
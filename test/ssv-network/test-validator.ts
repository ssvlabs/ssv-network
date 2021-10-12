import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';

import {
  initContracts,
  registerOperator,
  registerValidator,
  updateValidator,
  deleteValidator,
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
          () => registerValidator(account1, 0, [0, 1, 2, 3], 2000),
        ],
        asserts: [
          () => checkOperatorIndexes([0, 1, 2, 3]),
          () => checkOperatorBalances([0, 1, 2, 3]),
        ],
      },
      100: {
        funcs: [
          () => updateValidator(account1, 0, [0, 1, 2, 3], 2500),
        ],
      },
      140: {
        asserts: [
          () => checkTotalBalance(account1.address),
          () => checkTotalBalance(account2.address),
        ]
      },
      150: {
        funcs: [
          () => deleteValidator(account1, 0),
        ],
      },
      180: {
        asserts: [
          () => checkTotalBalance(account1.address),
          () => checkTotalBalance(account2.address),
        ]
      },
    };

    await processTestCase(testFlow);
  });
});
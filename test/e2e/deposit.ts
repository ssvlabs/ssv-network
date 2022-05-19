import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';

import {
  initContracts,
  registerOperator,
  registerValidator,
  deposit,
  processTestCase,
  account1,
  account2,
} from '../helpers/setup';

import {
  checkTotalBalance,
  checkTotalEarnings,
} from '../helpers/asserts';

before(() => {
  chai.should();
  chai.use(chaiAsPromised);
});

const { expect } = chai;

describe('SSV Network', function() {
  before(async function () {
    await initContracts();
  });

  it('Deposit', async function() {
    const testFlow = {
      10: {
        funcs: [
          () => registerOperator(account2, 0, 20000),
          () => registerOperator(account2, 1, 10000),
          () => registerOperator(account2, 2, 10000),
          () => registerOperator(account2, 3, 30000),
        ],
        asserts: [],
      },
      20: {
        funcs: [
          () => registerValidator(account1, 0, [0, 1, 2, 3], 10000000),
        ],
        asserts: [
          () => checkTotalEarnings(account1.address),
          () => checkTotalEarnings(account2.address),
          () => checkTotalBalance(account1.address),
        ],
      },
      30: {
        funcs: [
          () => deposit(account1, 5000),
        ],
        asserts: [
          () => checkTotalEarnings(account1.address),
          () => checkTotalEarnings(account2.address),
          () => checkTotalBalance(account1.address),
        ],
      },
      40: {
        asserts: [
          () => checkTotalEarnings(account1.address),
          () => checkTotalEarnings(account2.address),
          () => checkTotalBalance(account1.address),
        ],
      },
    };

    await processTestCase(testFlow);
  });
});
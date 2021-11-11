import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';

import {
  initContracts,
  registerOperator,
  registerValidator,
  deposit,
  processTestCase,
  account1,
  account2,
} from './setup';

import {
  checkTotalBalance,
  checkTotalEarnings,
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

  it('Deposit', async function() {
    const testFlow = {
      10: {
        funcs: [
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
          () => checkTotalEarnings(account1.address),
          () => checkTotalEarnings(account2.address),
          () => checkTotalBalance(account1.address),
        ],
      },
      30: {
        funcs: [
          () => deposit(account1, 500),
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
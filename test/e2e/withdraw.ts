// Withdraw E2E Test

// Declare all imports
import {
  initContracts,
  registerOperator,
  registerValidator,
  withdraw,
  processTestCase,
  account1,
  account2
} from '../helpers/setup'

import {
  checkWithdrawFail,
  checkTotalBalance,
  checkTotalEarnings
} from '../helpers/asserts'

describe('SSV Network', function () {
  beforeEach(async function () {
    await initContracts()
  })

  it('Withdraw', async function () {
    const testFlow = {
      10: {
        funcs: [
          () => registerOperator([
            { account: account2, idx: 0, fee: 20000 },
            { account: account2, idx: 1, fee: 10000 },
            { account: account1, idx: 2, fee: 10000 },
            { account: account2, idx: 3, fee: 30000 }
          ])
        ]
      },
      20: {
        funcs: [
          () => registerValidator([{ account: account1, validatorIdx: 0, operatorIdxs: [0, 1, 2, 3], depositAmount: 1000000000 },])
        ],
        asserts: [
          () => checkTotalBalance([account1.address, account2.address]),
          () => checkTotalEarnings([account1.address, account2.address])
        ]
      },
      100: {
        funcs: [
          () => withdraw(account2, 500000000)
        ],
        asserts: [
          () => checkTotalBalance([account1.address, account2.address]),
          () => checkTotalEarnings([account1.address, account2.address])
        ]
      },
      110: {
        asserts: [() => checkWithdrawFail(account2, 10000000000000)]
      },
      120: {
        asserts: [
          // () => checkTotalBalance([account1.address, account2.address]),
          () => checkTotalEarnings([account1.address, account2.address]),
          () => checkWithdrawFail(account2, 1000000000)
        ]
      }
    }

    // await processTestCase(testFlow)
  })
})
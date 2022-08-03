// Balances E2E Test

// Declare all imports
import {
  initContracts,
  registerOperator,
  registerValidator,
  updateOperatorFee,
  processTestCase,
  updateNetworkFee,
  account1,
  account2
} from '../helpers/setup'

import {
  checkOperatorBalances,
  checkTotalBalance,
  checkTotalEarnings,
  checkNetworkTreasury
} from '../helpers/asserts'

describe('SSV Network', function () {
  beforeEach(async function () {
    await initContracts()
  })

  it('Operator and validator balances', async function () {
    const testFlow = {
      10: {
        funcs: [
          () => updateNetworkFee(20000000),
          () => registerOperator([
            { account: account2, idx: 0, fee: 20000000 },
            { account: account2, idx: 1, fee: 40000000 },
            { account: account1, idx: 2, fee: 50000000 },
            { account: account2, idx: 3, fee: 30000000 }
          ])
        ],
        asserts: [
          () => checkNetworkTreasury()
        ]
      },
      20: {
        funcs: [
          () => registerValidator([{ account: account1, validatorIdx: 0, operatorIdxs: [0, 1, 2, 3], depositAmount: 1000000000 },])
        ],
        asserts: [
          () => checkOperatorBalances([0, 1, 2, 3]),
          () => checkNetworkTreasury()
        ]
      },
      30: {
        funcs: [
          () => updateOperatorFee(account2, 0, 11000),
          () => registerValidator([{ account: account1, validatorIdx: 1, operatorIdxs: [0, 1, 2, 3], depositAmount: 1000000000 },])
        ],
        asserts: [
          () => checkOperatorBalances([0, 1, 2, 3]),
          () => checkNetworkTreasury()
        ]
      },
      40: {
        funcs: [
          () => registerValidator([{ account: account1, validatorIdx: 2, operatorIdxs: [0, 1, 2, 3], depositAmount: 1000000000 },])
        ],
        asserts: [
          () => checkOperatorBalances([0, 1, 2, 3]),
          () => checkNetworkTreasury()
        ]
      },
      50: {
        funcs: [
          () => registerValidator([{ account: account1, validatorIdx: 3, operatorIdxs: [0, 1, 2, 3], depositAmount: 1000000000 },])
        ],
        asserts: [
          () => checkOperatorBalances([0, 1, 2, 3]),
          () => checkTotalBalance([account1.address, account2.address]),
          () => checkTotalEarnings([account1.address, account2.address]),
          () => checkNetworkTreasury()
        ]
      },
      100: {
        asserts: [
          () => checkOperatorBalances([0, 1, 2, 3]),
          () => checkTotalBalance([account1.address, account2.address]),
          () => checkTotalEarnings([account1.address, account2.address]),
          () => checkNetworkTreasury()
        ]
      }
    }

    // await processTestCase(testFlow)
  })
})
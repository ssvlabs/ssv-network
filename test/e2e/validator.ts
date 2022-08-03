// Validator E2E Test

// Declare all imports
import {
  initContracts,
  registerOperator,
  registerValidator,
  updateValidator,
  removeValidator,
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
          () => updateNetworkFee(10000),
          () => registerOperator([
            { account: account2, idx: 0, fee: 20000 },
            { account: account2, idx: 1, fee: 10000 },
            { account: account1, idx: 2, fee: 10000 },
            { account: account2, idx: 3, fee: 30000 }
          ])
        ],
        asserts: [
          () => checkNetworkTreasury()
        ]
      },
      20: {
        funcs: [
          () => registerValidator([{ account: account1, validatorIdx: 0, operatorIdxs: [0, 1, 2, 3], depositAmount: 2000000000 },])
        ],
        asserts: [
          () => checkOperatorBalances([0, 1, 2, 3]),
          () => checkNetworkTreasury()
        ]
      },
      100: {
        funcs: [
          () => updateValidator(account1, 0, [0, 1, 2, 3], 2500000000)
        ]
      },
      140: {
        asserts: [
          () => checkTotalBalance([account1.address, account2.address]),
          () => checkNetworkTreasury()
        ]
      },
      150: {
        funcs: [
          () => removeValidator(account1, 0)
        ]
      },
      180: {
        asserts: [
          () => checkTotalBalance([account1.address, account2.address]),
          () => checkTotalEarnings([account1.address, account2.address]),
          () => checkNetworkTreasury()
        ]
      }
    }

    // await processTestCase(testFlow)
  })
})
const { expect } = require("chai");
import { trackGas } from "../helpers/gas-usage"

import * as helpers from "../helpers/contract-helpers"
let registryContract: any, operatorIDs: any, shares: any, owner: any
const numberOfOperators = 4
const operatorFee = 4

describe("Register Validator Tests", () => {
    beforeEach(async () => {
        const contractData = await helpers.initializeContract(numberOfOperators, operatorFee)
        registryContract = contractData.contract
        operatorIDs = contractData.operatorIDs
        shares = contractData.shares
    })

    it("Register validator", async () => {
        const validatorPK = `0x98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098100`
        await trackGas(registryContract.registerValidator(
            `${validatorPK}0`,
            [1, 2, 3, 4],
            shares[0],
            "10000"
        ), 'registerValidator', 500000);
    })

    it("Register validator errors", async () => {

    })
});
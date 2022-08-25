const { expect } = require("chai");

import * as helpers from "../helpers/contract-helpers"
let registryContract: any, operatorIDs: any, shares: any, owner: any
const numberOfOperators = 4
const operatorFee = 4

describe("DAO Network Fee Withdraw Tests", () => {
    beforeEach(async () => {
        const contractData = await helpers.initializeContract(numberOfOperators, operatorFee)
        registryContract = contractData.contract
        operatorIDs = contractData.operatorIDs
        shares = contractData.shares
    })

    it("Get withdrawable network fee amount", async () => {

    })

    it("Withdraw network fee", async () => {

    })

    it("Withdraw network fee errors", async () => {

    })

});

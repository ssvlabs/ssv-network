const { expect } = require("chai");

import * as helpers from "../helpers/contract-helpers"
let registryContract: any, operatorIDs: any, shares: any, owner: any
const numberOfOperators = 4
const operatorFee = 4

describe("DAO Network Fee Change Tests", () => {
    beforeEach(async () => {
        const contractData = await helpers.initializeContract(numberOfOperators, operatorFee)
        registryContract = contractData.contract
        operatorIDs = contractData.operatorIDs
        shares = contractData.shares
    })

    it("Get network fee", async () => {

    })

    it("Change network fee", async () => {

    })

    it("Change network fee errors", async () => {

    })

});

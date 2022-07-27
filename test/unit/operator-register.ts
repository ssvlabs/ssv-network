// Operator Registration Unit Tests

// Declare all imports
import * as chai from 'chai'
import chaiAsPromised from 'chai-as-promised'
beforeEach(() => {
    chai.should()
    chai.use(chaiAsPromised)
})

// Define global variables
declare const ethers: any
declare const upgrades: any
const { expect } = chai
const DAY = 86400
const minimumBlocksBeforeLiquidation = 7000
const operatorMaxFeeIncrease = 1000
const setOperatorFeePeriod = 0
const approveOperatorFeePeriod = DAY
const operatorPublicKeyPrefix = '12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345'
let ssvToken: any, ssvRegistry: any, ssvNetwork: any
let owner: any, account1: any, account2: any, account3: any
const operatorsPub = Array.from(Array(10).keys()).map(k => `0x${operatorPublicKeyPrefix}${k}`)
const operatorsIds = Array.from(Array(10).keys()).map(k => k + 1)

describe('Register Operators', function () {
    beforeEach(async function () {
        // Create accounts
        [owner, account1, account2, account3] = await ethers.getSigners()

        // Deploy Contracts 
        const ssvTokenFactory = await ethers.getContractFactory('SSVTokenMock')
        const ssvRegistryFactory = await ethers.getContractFactory('SSVRegistry')
        const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork')
        ssvToken = await ssvTokenFactory.deploy()
        ssvRegistry = await upgrades.deployProxy(ssvRegistryFactory, { initializer: false })
        await ssvToken.deployed()
        await ssvRegistry.deployed()
        ssvNetwork = await upgrades.deployProxy(ssvNetworkFactory, [ssvRegistry.address, ssvToken.address, minimumBlocksBeforeLiquidation, operatorMaxFeeIncrease, setOperatorFeePeriod, approveOperatorFeePeriod])
        await ssvNetwork.deployed()

        // Mint tokens
        await ssvToken.mint(account1.address, '1000000000000000000')

        // Register operators
        await expect(ssvNetwork.connect(account2).registerOperator('testOperator 0', operatorsPub[0], 100000000000))
            .to.emit(ssvNetwork, 'OperatorRegistration').withArgs(operatorsIds[0], 'testOperator 0', account2.address, operatorsPub[0], 100000000000)
        await ssvNetwork.connect(account2).registerOperator('testOperator 1', operatorsPub[1], 200000000000)
        await ssvNetwork.connect(account3).registerOperator('testOperator 2', operatorsPub[2], 300000000000)
        await ssvNetwork.connect(account3).registerOperator('testOperator 3', operatorsPub[3], 400000000000)
    })


    it('Get operators by ID', async function () {
        expect((await ssvNetwork.getOperatorById(operatorsIds[1]))[0]).to.equal('testOperator 1')
        expect((await ssvNetwork.getOperatorById(operatorsIds[1]))[1]).to.equal(account2.address)
        expect((await ssvNetwork.getOperatorById(operatorsIds[1]))[2]).to.equal(operatorsPub[1])
        expect((await ssvNetwork.getOperatorById(operatorsIds[1]))[3]).to.equal('0')
        expect((await ssvNetwork.getOperatorById(operatorsIds[1]))[4]).to.equal(200000000000)
        expect((await ssvNetwork.getOperatorById(operatorsIds[1]))[5]).to.equal('0')
        expect((await ssvNetwork.getOperatorById(operatorsIds[1]))[6]).to.equal(true)

        // Non-existing operator
        expect((await ssvNetwork.getOperatorById(operatorsIds[5]))[1]).to.equal('0x0000000000000000000000000000000000000000')
    })

    it('Register validator with same public key', async function () {
        await expect(ssvNetwork.connect(account2).registerOperator('testOperator 0', operatorsPub[0], 100000000000))
            .to.emit(ssvNetwork, 'OperatorRegistration').withArgs(operatorsIds[4], 'testOperator 0', account2.address, operatorsPub[0], 100000000000)
    })

    it('Try to register operator with errors', async function () {
        // Try to register operator with public key too many characters
        await ssvNetwork
            .connect(account3).registerOperator('invalid pubkey', `${operatorsPub[1]}7`, 100000000000)
            .should.eventually.be.rejectedWith('hex data is odd-length')

        // Try to register operator with invalid public key
        await ssvNetwork
            .connect(account3).registerOperator('invalid pubkey', '1234567890123456789-123456789012345678901234567890123456789012345678901234567890123456789012345', 100000000000)
            .should.eventually.be.rejectedWith('invalid arrayify value')

        // Try to register operator SSV amount too small
        await ssvNetwork
            .connect(account3).registerOperator('invalid pubkey', operatorsPub[1], 9999999)
            .should.eventually.be.rejectedWith('Precision is over the maximum defined')
    })
})
const { expect } = require("chai");
const { progressBlocks, blockNumber } = require('./utils');
const operator_fee_block = 1;


async function mineNBlocks(n) {
    for (let index = 0; index < n; index++) {
        await ethers.provider.send('evm_mine');
    }
}

const operatorsIndexes = Array.from(Array(5).keys()).map(k => k + 1);


describe("Validators", () => {
    var deployedRegistryContract
    beforeEach(async () => {
        const Registry = await ethers.getContractFactory("SSVRegistryNew");
        deployedRegistryContract = await Registry.deploy();
        await deployedRegistryContract.deployed();

        await progressBlocks(99);
        for (let i = 0; i < 2; i++) { // operatorsIndexes.length
            var encryptionPK = "0x123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123451";
            await (await deployedRegistryContract.registerOperator(encryptionPK, operator_fee_block)).wait();
            console.log(`[BLOCK] ${await blockNumber()}`)
            console.log('> register operator', i);
        }
        // await deployedRegistryContract.addOperatorToValidator([], operatorsIndexes, []);
    })

    it("should register validator", async () => {
        const validatorPK = "0x987654321098765432109876543210987654321098765432109876543210987654321098765432109876543210987651";
        const sharePKs = Array.from(Array(10).keys()).map(k => `0x98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765${k}`);
        const encryptedShares = Array.from(Array(10).keys()).map(k => `0x98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765${k}98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765${k}`);
        // const operatorsIndexes = Array.from(Array(10).keys()).map(k => k + 1);

        // await deployedRegistryContract.createGroup([1,2,3,4]);
        // await deployedRegistryContract.createGroup([1,2,3,4]);

        await deployedRegistryContract.deposit("100000000000");
        console.log(`[BLOCK] ${await blockNumber()}`)
        console.log('> deposit');
        console.log('> 1 operator balance', await deployedRegistryContract.test_getOperatorBalance(1), 'index', await deployedRegistryContract.test_operatorCurrentIndex(1));
        console.log('> 2 operator balance', await deployedRegistryContract.test_getOperatorBalance(2), 'index', await deployedRegistryContract.test_operatorCurrentIndex(2));
        // console.log('> 3 operator balance', await deployedRegistryContract.test_getOperatorBalance(3), 'index', await deployedRegistryContract.test_operatorCurrentIndex(3));
        // console.log('> 4 operator balance', await deployedRegistryContract.test_getOperatorBalance(4), 'index', await deployedRegistryContract.test_operatorCurrentIndex(4));
        // validator 1
        await progressBlocks(97);
        const resultRegister = (await (await deployedRegistryContract.registerValidator(
            [1, 2],
            validatorPK,
            sharePKs.slice(0, 4),
            encryptedShares.slice(0, 4),
            "10000"
        )).wait()).logs[0];
        const interfaceRegister = new ethers.utils.Interface(['event ValidatorAdded(bytes validatorPK, bytes32 groupId)']);
        const outputRegister = interfaceRegister.decodeEventLog('ValidatorAdded', resultRegister.data, resultRegister.topics);
        console.log(`[BLOCK] ${await blockNumber()}`)
        console.log('> 1 operator balance', await deployedRegistryContract.test_getOperatorBalance(1), 'index', await deployedRegistryContract.test_operatorCurrentIndex(1));
        console.log("> register validator", outputRegister.validatorPK, outputRegister.groupId);
        await progressBlocks(1);
        console.log(`[BLOCK] ${await blockNumber()}`)
        console.log('> 1 operator balance', await deployedRegistryContract.test_getOperatorBalance(1), 'index', await deployedRegistryContract.test_operatorCurrentIndex(1));
        console.log("> 2 operator balance", await deployedRegistryContract.test_getOperatorBalance(2));
        console.log("> group index", await deployedRegistryContract.test_groupCurrentIndex(outputRegister.groupId));
        console.log("> group usage", await deployedRegistryContract.test_groupCurrentUsage(outputRegister.groupId));
        console.log("> group balance", await deployedRegistryContract.test_groupBalance(outputRegister.groupId));
        await progressBlocks(1);
        console.log(`[BLOCK] ${await blockNumber()}`)
        console.log('> 1 operator balance', await deployedRegistryContract.test_getOperatorBalance(1), 'index', await deployedRegistryContract.test_operatorCurrentIndex(1));
        console.log("> 2 operator balance", await deployedRegistryContract.test_getOperatorBalance(2));
        console.log("> group index", await deployedRegistryContract.test_groupCurrentIndex(outputRegister.groupId));
        console.log("> group usage", await deployedRegistryContract.test_groupCurrentUsage(outputRegister.groupId));
        console.log("> group balance", await deployedRegistryContract.test_groupBalance(outputRegister.groupId));
        await progressBlocks(1);
        console.log(`[BLOCK] ${await blockNumber()}`)
        console.log('> 1 operator balance', await deployedRegistryContract.test_getOperatorBalance(1), 'index', await deployedRegistryContract.test_operatorCurrentIndex(1));
        console.log("> 2 operator balance", await deployedRegistryContract.test_getOperatorBalance(2));
        console.log("> group index", await deployedRegistryContract.test_groupCurrentIndex(outputRegister.groupId));
        console.log("> group usage", await deployedRegistryContract.test_groupCurrentUsage(outputRegister.groupId));
        console.log("> group balance", await deployedRegistryContract.test_groupBalance(outputRegister.groupId));
        await (await deployedRegistryContract.updateOperatorFee(
            1,
            2
        )).wait();
        console.log(`[BLOCK] ${await blockNumber()}`)
        console.log("> 1 operator fee updated to", 2);
        console.log('> 1 operator balance', await deployedRegistryContract.test_getOperatorBalance(1), 'index', await deployedRegistryContract.test_operatorCurrentIndex(1));
        console.log("> 2 operator balance", await deployedRegistryContract.test_getOperatorBalance(2));
        console.log("> group index", await deployedRegistryContract.test_groupCurrentIndex(outputRegister.groupId));
        console.log("> group usage", await deployedRegistryContract.test_groupCurrentUsage(outputRegister.groupId));
        console.log("> group balance", await deployedRegistryContract.test_groupBalance(outputRegister.groupId));
        await progressBlocks(1);
        console.log(`[BLOCK] ${await blockNumber()}`)
        console.log('> 1 operator balance', await deployedRegistryContract.test_getOperatorBalance(1), 'index', await deployedRegistryContract.test_operatorCurrentIndex(1));
        console.log("> 2 operator balance", await deployedRegistryContract.test_getOperatorBalance(2));
        console.log("> group index", await deployedRegistryContract.test_groupCurrentIndex(outputRegister.groupId));
        console.log("> group usage", await deployedRegistryContract.test_groupCurrentUsage(outputRegister.groupId));
        console.log("> group balance", await deployedRegistryContract.test_groupBalance(outputRegister.groupId));
        await progressBlocks(1);
        console.log(`[BLOCK] ${await blockNumber()}`)
        console.log('> 1 operator balance', await deployedRegistryContract.test_getOperatorBalance(1), 'index', await deployedRegistryContract.test_operatorCurrentIndex(1));
        console.log("> 2 operator balance", await deployedRegistryContract.test_getOperatorBalance(2));
        console.log("> group index", await deployedRegistryContract.test_groupCurrentIndex(outputRegister.groupId));
        console.log("> group usage", await deployedRegistryContract.test_groupCurrentUsage(outputRegister.groupId));
        console.log("> group balance", await deployedRegistryContract.test_groupBalance(outputRegister.groupId));
        
    
        /*
        // validator 2
        await expect(await deployedRegistryContract.registerValidator(
            [1,2,3,4],
            validatorPK,
            sharePKs.slice(0, 4),
            encryptedShares.slice(0, 4),
            "10000"
        ))
            .to.emit(deployedRegistryContract, 'ValidatorAdded');
            // .withArgs(validatorPK);


        const resultRegister = (await (await deployedRegistryContract.registerValidator(
            [1,2,3,4],
            validatorPK,
            sharePKs.slice(0, 4),
            encryptedShares.slice(0, 4),
            '10000'
        )).wait()).logs[0];
        const interfaceRegister = new ethers.utils.Interface(['event ValidatorAdded(bytes validatorPK, bytes32 groupId)']);
        const outputRegister = interfaceRegister.decodeEventLog('ValidatorAdded', resultRegister.data, resultRegister.topics);
        expect(outputRegister.validatorPK).to.equal(validatorPK);

        console.log("register ---->", outputRegister.validatorPK, outputRegister.groupId);
        console.log("operatorIdsAfterRegister ---->", await deployedRegistryContract.test_getOperatorsByGroupId(outputRegister.groupId));
        
        const resultUpdate = (await (await deployedRegistryContract.updateValidator(
          [2,3,4,5],
          validatorPK,
          outputRegister.groupId,
          '10000'
        )).wait()).logs[0];;
        const interfaceUpdate = new ethers.utils.Interface(['event ValidatorUpdated(bytes validatorPK, bytes32 groupId)']);
        const outputUpdate = interfaceUpdate.decodeEventLog('ValidatorUpdated', resultUpdate.data, resultUpdate.topics);
        expect(outputRegister.groupId).not.equal(outputUpdate.groupId);
        expect(outputRegister.validatorPK).to.equal(outputUpdate.validatorPK);

        console.log("update ---->", outputUpdate.validatorPK, outputUpdate.groupId);
        console.log("operatorIdsAfterUpdate ---->", await deployedRegistryContract.test_getOperatorsByGroupId(outputUpdate.groupId));

        await expect(await deployedRegistryContract.removeValidator(
            validatorPK,
            outputUpdate.groupId
          ))
          .to.emit(deployedRegistryContract, 'ValidatorRemoved')
          .withArgs(validatorPK, outputUpdate.groupId);

        */
        // await deployedRegistryContract.liquidate("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "0x392791df626408017a264f53fde61065d5a93a32b60171df9d8a46afdf82992d");
    });
});

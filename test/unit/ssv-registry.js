const { expect } = require("chai");
const { progressBlocks, blockNumber } = require('./utils');
const operator_fee_block = 1;


async function mineNBlocks(n) {
    for (let index = 0; index < n; index++) {
        await ethers.provider.send('evm_mine');
    }
}

const operatorsIndexes = Array.from(Array(5).keys()).map(k => k + 1);
let deployedRegistryContract;

async function log({ action='', operatorIds = [], groupIds = [] }) {
    console.log(`[BLOCK] ${await blockNumber()}`)
    if (action) {
        console.log(`> ${action}`);
    }
    if (operatorIds.length) {
        for (const id of operatorIds) {
            console.log(
                `> operator #${id}`,
                'balance', await deployedRegistryContract.test_getOperatorBalance(id),
                'index', await deployedRegistryContract.test_operatorCurrentIndex(id),
            );
        }
    }
    if (groupIds.length) {
        for (const id of groupIds) {
            console.log(
                `> group #$${id}`,
                'balance', await deployedRegistryContract.test_groupBalance(id),
                'index', await deployedRegistryContract.test_groupCurrentIndex(id),
            );
        }
    }
}

describe("Validators", () => {
    beforeEach(async () => {
        const Registry = await ethers.getContractFactory("SSVRegistryNew");
        deployedRegistryContract = await Registry.deploy();
        await deployedRegistryContract.deployed();

        await progressBlocks(99);
        for (let i = 0; i < 8; i++) { // operatorsIndexes.length
            var encryptionPK = "0x123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123451";
            await (await deployedRegistryContract.registerOperator(encryptionPK, operator_fee_block)).wait();
            await log({ action: `register operator #${i+1}` });
        }
        // await deployedRegistryContract.addOperatorToValidator([], operatorsIndexes, []);
    })

    it("should register validator", async () => {
        const validatorPK = "0x987654321098765432109876543210987654321098765432109876543210987654321098765432109876543210987651";
        const sharePKs = Array.from(Array(10).keys()).map(k => `0x12345678901234567890123456789012345678901234567890123456789012345678901234567890123456789012345${k}`);
        const encryptedShares = Array.from(Array(10).keys()).map(k => `0x98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765${k}98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765${k}`);
        // const operatorsIndexes = Array.from(Array(10).keys()).map(k => k + 1);

        // await deployedRegistryContract.createGroup([1,2,3,4]);
        // await deployedRegistryContract.createGroup([1,2,3,4]);

        await deployedRegistryContract.deposit("100000000000");
        await log({
            action: 'deposit',
            operatorIds: [1, 2, 3, 4]
        });
        // validator 1
        await progressBlocks(97);
        let resultRegister = (await (await deployedRegistryContract.registerValidator(
            [1,2,3,4],
            validatorPK,
            sharePKs.slice(0, 4),
            encryptedShares.slice(0, 4),
            '10000'
        )).wait()).logs[0];
        let interfaceRegister = new ethers.utils.Interface(['event ValidatorAdded(bytes validatorPK, bytes32 groupId)']); // , bytes[] sharesPublicKeys, bytes[] encryptedShares
        let outputRegister = interfaceRegister.decodeEventLog('ValidatorAdded', resultRegister.data, resultRegister.topics);
        await log({
            action: `register validator #1: ${outputRegister.validatorPK} : ${outputRegister.groupId}`,
            operatorIds: [1, 2, 3, 4]
        });
        await progressBlocks(1);
        await log({
            operatorIds: [1, 2, 3, 4],
            groupIds: [outputRegister.groupId]
        });

        let resultUpdate = (await (await deployedRegistryContract.updateValidator(
            [4,5,6,7],
            validatorPK,
            outputRegister.groupId,
            sharePKs.slice(0, 4),
            encryptedShares.slice(0, 4),
            '10000'
        )).wait()).logs[0];;
        let interfaceUpdate = new ethers.utils.Interface(['event ValidatorUpdated(bytes validatorPK, bytes32 groupId)']); // , bytes[] sharesPublicKeys, bytes[] encryptedShares
        let outputUpdate = interfaceUpdate.decodeEventLog('ValidatorUpdated', resultUpdate.data, resultUpdate.topics);
        expect(outputRegister.groupId).not.equal(outputUpdate.groupId);
        expect(outputRegister.validatorPK).to.equal(outputUpdate.validatorPK);
  
        await log({
            action: `update validator #1: ${outputUpdate.validatorPK} : ${outputUpdate.groupId}`,
            operatorIds: [1, 2, 3, 4, 5, 6, 7, 8],
            groupIds: [outputRegister.groupId, outputUpdate.groupId]
        });
        await progressBlocks(1);
        await log({
            operatorIds: [1, 2, 3, 4, 5, 6, 7, 8],
            groupIds: [outputRegister.groupId, outputUpdate.groupId]
        });
        await progressBlocks(1);
        await log({
            operatorIds: [1, 2, 3, 4, 5, 6, 7, 8],
            groupIds: [outputRegister.groupId, outputUpdate.groupId]
        });

        // move back validator 1 to group 1
        resultRegister = (await (await deployedRegistryContract.updateValidator(
            [1,2,3,4],
            validatorPK,
            outputUpdate.groupId,
            sharePKs.slice(0, 4),
            encryptedShares.slice(0, 4),
            '10000'
        )).wait()).logs[0];;
        interfaceRegister = new ethers.utils.Interface(['event ValidatorUpdated(bytes validatorPK, bytes32 groupId)']); // , bytes[] sharesPublicKeys, bytes[] encryptedShares
        outputRegister = interfaceUpdate.decodeEventLog('ValidatorUpdated', resultRegister.data, resultRegister.topics);
        await log({
            action: `update validator #1: ${outputRegister.validatorPK} : ${outputRegister.groupId}`,
            operatorIds: [1, 2, 3, 4, 5, 6, 7, 8],
            groupIds: [outputRegister.groupId, outputUpdate.groupId]
        });
        await progressBlocks(1);
        await log({
            operatorIds: [1, 2, 3, 4, 5, 6, 7, 8],
            groupIds: [outputRegister.groupId, outputUpdate.groupId]
        });
        const resultRegister2 = (await (await deployedRegistryContract.registerValidator(
            [5,6,7,8],
            validatorPK,
            sharePKs.slice(0, 4),
            encryptedShares.slice(0, 4),
            "1000"
        )).wait()).logs[0];
        const interfaceRegister2 = new ethers.utils.Interface(['event ValidatorAdded(bytes validatorPK, bytes32 groupId)']); // , bytes[] sharesPublicKeys, bytes[] encryptedShares
        const outputRegister2 = interfaceRegister2.decodeEventLog('ValidatorAdded', resultRegister2.data, resultRegister2.topics);
        await log({
            action: `register validator #2: ${outputRegister2.validatorPK} : ${outputRegister2.groupId}`,
            operatorIds: [1, 2, 3, 4, 5, 6, 7, 8],
            groupIds: [outputRegister.groupId, outputRegister2.groupId]
        });
        await progressBlocks(1);
        await log({
            operatorIds: [1, 2, 3, 4, 5, 6, 7, 8],
            groupIds: [outputRegister.groupId, outputRegister2.groupId]
        });
        await progressBlocks(1);
        await log({
            operatorIds: [1, 2, 3, 4, 5, 6, 7, 8],
            groupIds: [outputRegister.groupId, outputRegister2.groupId]
        });
        await (await deployedRegistryContract.updateOperatorFee(
            1,
            2
        )).wait();
        await log({
            action: 'operator #1 fee updated 2',
            operatorIds: [1, 2, 3, 4, 5, 6, 7, 8],
            groupIds: [outputRegister.groupId, outputRegister2.groupId]
        });
        await progressBlocks(1);
        await log({
            operatorIds: [1, 2, 3, 4, 5, 6, 7, 8],
            groupIds: [outputRegister.groupId, outputRegister2.groupId]
        });
        await progressBlocks(1);
        await log({
            operatorIds: [1, 2, 3, 4, 5, 6, 7, 8],
            groupIds: [outputRegister.groupId, outputRegister2.groupId]
        });
        await (await deployedRegistryContract.removeValidator(outputRegister2.validatorPK, outputRegister2.groupId)).wait();
        await log({
            action: 'remove validator #2',
            operatorIds: [1, 2, 3, 4, 5, 6, 7, 8],
            groupIds: [outputRegister.groupId, outputRegister2.groupId]
        });
        await progressBlocks(1);
        await log({
            operatorIds: [1, 2, 3, 4, 5, 6, 7, 8],
            groupIds: [outputRegister.groupId, outputRegister2.groupId]
        });
        await progressBlocks(1);
        await log({
            operatorIds: [1, 2, 3, 4, 5, 6, 7, 8],
            groupIds: [outputRegister.groupId, outputRegister2.groupId]
        });
    
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

const { expect } = require("chai");
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

        for (let i = 0; i < operatorsIndexes.length; i++) {
            var encryptionPK = "0x123456789012345678901234567890123456789012345678901234567890123456789012345678901234567890123451";
            await deployedRegistryContract.registerOperator(encryptionPK, operator_fee_block);
        }
        // await deployedRegistryContract.addOperatorToValidator([], operatorsIndexes, []);
    })

    it("should create group", async () => {
        // await deployedRegistryContract.createGroup([1,2,3,4]);
    })

    it("should register validator", async () => {
        const validatorPK = "0x987654321098765432109876543210987654321098765432109876543210987654321098765432109876543210987651";
        const sharePKs = Array.from(Array(10).keys()).map(k => `0x98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765${k}`);
        const encryptedShares = Array.from(Array(10).keys()).map(k => `0x98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765${k}98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098765${k}`);
        // const operatorsIndexes = Array.from(Array(10).keys()).map(k => k + 1);

        // await deployedRegistryContract.createGroup([1,2,3,4]);
        // await deployedRegistryContract.createGroup([1,2,3,4]);

        await deployedRegistryContract.deposit("100000000000");

        // validator 1
        await expect(await deployedRegistryContract.registerValidator(
                [1,2,3,4],
                validatorPK,
                sharePKs.slice(0, 4),
                encryptedShares.slice(0, 4),
                "10000"
            ))
            .to.emit(deployedRegistryContract, 'ValidatorAdded')
            .withArgs(validatorPK);

        // validator 2
        await expect(await deployedRegistryContract.registerValidator(
            [1,2,3,4],
            validatorPK,
            sharePKs.slice(0, 4),
            encryptedShares.slice(0, 4),
            "10000"
        ))
            .to.emit(deployedRegistryContract, 'ValidatorAdded')
            .withArgs(validatorPK);


        const resultRegister = (await (await deployedRegistryContract.registerValidator(
            [1,2,3,4],
            validatorPK,
            sharePKs.slice(0, 4),
            encryptedShares.slice(0, 4),
            '10000'
        )).wait()).logs[0];
        const interfaceRegister = new ethers.utils.Interface(['event ValidatorAdded(bytes validatorPK, bytes32 groupId)']);
        const outputRegister = interfaceRegister.decodeEventLog('ValidatorAdded', resultRegister.data, resultRegister.topics);
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
        console.log("update ---->", outputUpdate.validatorPK, outputUpdate.groupId);
        console.log("operatorIdsAfterUpdate ---->", await deployedRegistryContract.test_getOperatorsByGroupId(outputUpdate.groupId));

        await expect(await deployedRegistryContract.removeValidator(
            validatorPK,
            outputUpdate.groupId
          ))
          .to.emit(deployedRegistryContract, 'ValidatorRemoved')
          .withArgs(validatorPK, outputUpdate.groupId);

        // await deployedRegistryContract.liquidate("0xf39fd6e51aad88f6f4ce6ab8827279cfffb92266", "0x392791df626408017a264f53fde61065d5a93a32b60171df9d8a46afdf82992d");
    });
});

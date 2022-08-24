const { expect } = require("chai");
const operator_fee_block = 1;
const { progressBlocks } = require('../helpers/utils');

const operatorsIndexes = Array.from(Array(8).keys()).map(k => k + 1);
let sharePKs, encryptedShares
const validatorBalance = 100000000000

describe("Balance Test", () => {
    var deployedRegistryContract
    beforeEach(async () => {
        const Registry = await ethers.getContractFactory("SSVRegistryNew");
        deployedRegistryContract = await Registry.deploy();
        await deployedRegistryContract.deployed();

        // Register 4 operators
        for (let i = 0; i < operatorsIndexes.length; i++) {
            const encryptionPK = "0x000000000000000000000000000000000000000000000000000000000000002000000000000000000000000000000000000000000000000000000000000002644c5330744c5331435255644a54694253553045675546564354456c4449457446575330744c533074436b314a53554a4a616b464f516d64726357687261556335647a424351564646526b464254304e425554684254556c4a516b4e6e53304e42555556424e5756554e557777563068365a54647954575a506232787456484d4b64577449513245344b336474625577324f54464a5131527052454531556b4a31546b787153565132576b4530597a4d78635652495933464256486c3565566b774c7a6b3352336c4b5a32646f596e6c465232526f5a516f76616c6836615756544f584a325279744a56474631516a684d566c686b656b78475956517857455a5765466c6e4e327832546c42344f5552504c315a6f526b686b5757786e54334932643052745633466a52476f33436c68575557464f57454674526e67334e6a56514e546c584e585a7a564752585657464852577858536d3933536b5a4b646e6332556c5249536b5a315456686a537a5a5661574a3063555a4d536d4a774f57356b6455674b516a6c4c537a4e57636d59725a6d744a4f5752425a327478524446484f456c785130744b4d566c33626a557965477878625452434e69744f4f475a555a45314d53314a75635770465a6d527a563164774d46567a4d51704c54573976535863796333426f6158417a5546704e596e4a61615530774e6a4a325a556f3055336f76596a424f62576450546e685464304a4a546e4e7863473534516a68465556517853544e6a4e6b6c714e586868436d35525355524255554643436930744c5330745255354549464a545153425156554a4d53554d675330565a4c5330744c53304b00000000000000000000000000000000000000000000000000000000";
            await deployedRegistryContract.registerOperator(encryptionPK, i !== 4 ? operator_fee_block : 100);
        }
        sharePKs = Array.from(Array(10).keys()).map(k => `0xa20a622ecbc816c89896f92a18214905a57beedbe8df6120ba644453a7e35672a365c3b73ce35b8738eeb5dade9107d${k}`);
        encryptedShares = Array.from(Array(10).keys()).map(k => `0x00000000000000000000000000000000000000000000000000000000000000200000000000000000000000000000000000000000000000000000000000000158513741566f733037584a4537767275644b366c7a647a76634143313563636b5152492b6143766f31617a374979787a517233506a4361632b545745394d45307a4f6d49${k}36947472f46312f38613556786d71383948366e6b71436130415573782b37326c43306f686a4b3874396853746953746732596e2b304d2f4e3732744c6d5951394c325976654c56564a35556c586a425777${k}4377a5537732f3142435653727862415431376f2f704858474c46644170697a4c5332704b48354b71746545786e3033566b4a4244527538596c5055334634656c554937697a667a474444626d49677536484862305777344669743745543745422f357056457a547279445a5179516753336a4858714d63637359396e52494250724f2f2f367370544736646e5831304e4872356b716a305136464b64684d6a4162644d43773966527274672b72766979584e6674464945445478304768314f513d3d0000000000000000`);

        await deployedRegistryContract.deposit(validatorBalance.toString())

    })

    it("Check balances", async () => {
        // Register 1000 validators
        const validatorPK = `0x98765432109876543210987654321098765432109876543210987654321098765432109876543210987654321098100`

        expect(await deployedRegistryContract.test_getOperatorBalance(1)).to.equal('0')

        // Register a validator
        const validator1 = (await (await deployedRegistryContract.registerValidator(
            [1, 2, 3, 4],
            `${validatorPK}0`,
            sharePKs.slice(0, 4),
            encryptedShares.slice(0, 4),
            "10000"
        )).wait()).logs[0]
        const interfaceRegister = new ethers.utils.Interface(['event ValidatorAdded(bytes validatorPK, bytes32 groupId)']);
        const outputRegister = interfaceRegister.decodeEventLog('ValidatorAdded', validator1.data, validator1.topics);

        // Progress 50 blocks and check operator balances and group balance
        await progressBlocks(50)
        expect(await deployedRegistryContract.test_getOperatorBalance(1)).to.equal('50')
        expect(await deployedRegistryContract.test_getOperatorBalance(2)).to.equal('50')
        expect(await deployedRegistryContract.test_getOperatorBalance(3)).to.equal('50')
        expect(await deployedRegistryContract.test_getOperatorBalance(4)).to.equal('50')
        expect(await deployedRegistryContract.test_groupBalance(outputRegister.groupId)).to.equal(10000 - 150)

        // Update one of the operator fees
        await deployedRegistryContract.updateOperatorFee(1, 10)

        // Progress 50 blocks and check operator balances and group balance
        await progressBlocks(50)
        expect(await deployedRegistryContract.test_getOperatorBalance(1)).to.equal('551')
        expect(await deployedRegistryContract.test_getOperatorBalance(2)).to.equal('101')
        expect(await deployedRegistryContract.test_getOperatorBalance(3)).to.equal('101')
        expect(await deployedRegistryContract.test_getOperatorBalance(4)).to.equal('101')
        expect(await deployedRegistryContract.test_groupBalance(outputRegister.groupId)).to.equal(10000 - 904)

        // Update 3 operator fees
        await deployedRegistryContract.updateOperatorFee(2, 20)
        await deployedRegistryContract.updateOperatorFee(3, 20)
        await deployedRegistryContract.updateOperatorFee(4, 20)

        // Progress 50 blocks and check operator balances and group balance
        await progressBlocks(50)
        expect(await deployedRegistryContract.test_getOperatorBalance(1)).to.equal('1081')
        expect(await deployedRegistryContract.test_getOperatorBalance(2)).to.equal('1142')
        expect(await deployedRegistryContract.test_getOperatorBalance(3)).to.equal('1123')
        expect(await deployedRegistryContract.test_getOperatorBalance(4)).to.equal('1104')
        expect(await deployedRegistryContract.test_groupBalance(outputRegister.groupId)).to.equal(10000 - 4500)

        // Add another validator
        await deployedRegistryContract.registerValidator(
            [1, 2, 3, 5],
            `${validatorPK}1`,
            sharePKs.slice(0, 4),
            encryptedShares.slice(0, 4),
            "10000"
        )

        // Progress 50 blocks and check operator balances and group balance
        await progressBlocks(50)
        expect(await deployedRegistryContract.test_getOperatorBalance(1)).to.equal('2091')
        expect(await deployedRegistryContract.test_getOperatorBalance(2)).to.equal('3162')
        expect(await deployedRegistryContract.test_getOperatorBalance(3)).to.equal('3143')
        expect(await deployedRegistryContract.test_getOperatorBalance(4)).to.equal('2124')
        expect(await deployedRegistryContract.test_getOperatorBalance(5)).to.equal('5000')
        expect(await deployedRegistryContract.test_groupBalance(outputRegister.groupId)).to.equal(10000 - 4500)

        // Remove an operator
        await deployedRegistryContract.removeOperator(1)

        // Progress 50 blocks and check operator balances and group balance
        await progressBlocks(50)
        expect(await deployedRegistryContract.test_getOperatorBalance(1)).to.equal('2091')
        expect(await deployedRegistryContract.test_getOperatorBalance(2)).to.equal('3162')
        expect(await deployedRegistryContract.test_getOperatorBalance(3)).to.equal('3143')
        expect(await deployedRegistryContract.test_getOperatorBalance(4)).to.equal('2124')
        expect(await deployedRegistryContract.test_getOperatorBalance(5)).to.equal('5000')
        expect(await deployedRegistryContract.test_groupBalance(outputRegister.groupId)).to.equal(10000 - 4500)

        // Update a validator
        await deployedRegistryContract.updateValidator(
            [1, 2, 3, 5],
            `${validatorPK}0`,
            outputRegister.groupId,
            sharePKs.slice(0, 4),
            encryptedShares.slice(0, 4),
            "10"
        )

        // Progress 50 blocks and check operator balances and group balance
        await progressBlocks(50)
        expect(await deployedRegistryContract.test_getOperatorBalance(1)).to.equal('2091')
        expect(await deployedRegistryContract.test_getOperatorBalance(2)).to.equal('3162')
        expect(await deployedRegistryContract.test_getOperatorBalance(3)).to.equal('3143')
        expect(await deployedRegistryContract.test_getOperatorBalance(4)).to.equal('2124')
        expect(await deployedRegistryContract.test_getOperatorBalance(5)).to.equal('5000')
        expect(await deployedRegistryContract.test_groupBalance(outputRegister.groupId)).to.equal(10000 - 4500)

        // Remove a validator
        await deployedRegistryContract.removeValidator(`${validatorPK}0`, outputRegister.groupId)

        // Progress 50 blocks and check operator balances and group balance
        await progressBlocks(50)
        expect(await deployedRegistryContract.test_getOperatorBalance(1)).to.equal('2091')
        expect(await deployedRegistryContract.test_getOperatorBalance(2)).to.equal('3162')
        expect(await deployedRegistryContract.test_getOperatorBalance(3)).to.equal('3143')
        expect(await deployedRegistryContract.test_getOperatorBalance(4)).to.equal('2124')
        expect(await deployedRegistryContract.test_getOperatorBalance(5)).to.equal('5000')
        expect(await deployedRegistryContract.test_groupBalance(outputRegister.groupId)).to.equal(10000 - 4500)
    })

});

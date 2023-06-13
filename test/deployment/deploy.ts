// Imports
import { CONFIG, DB, SSV_MODULES, initializeContract, DataGenerator } from '../helpers/contract-helpers';
import { expect } from 'chai';

describe('Deployment tests', () => {
    let ssvNetworkContract: any, ssvNetworkViews: any;

    beforeEach(async () => {
        const metadata = await initializeContract();
        ssvNetworkContract = metadata.contract;
        ssvNetworkViews = metadata.ssvViews;
    });

    it('Upgrade SSVNetwork contract. Check new function execution', async () => {
        await ssvNetworkContract.setRegisterAuth(DB.owners[1].address, [true, false]);

        await ssvNetworkContract.connect(DB.owners[1]).registerOperator(
            DataGenerator.publicKey(0),
            CONFIG.minimalOperatorFee);

        const BasicUpgrade = await ethers.getContractFactory("SSVNetworkBasicUpgrade");
        const ssvNetworkUpgrade = await upgrades.upgradeProxy(ssvNetworkContract.address, BasicUpgrade, {
            kind: 'uups',
            unsafeAllow:['delegatecall']
        });
        await ssvNetworkUpgrade.deployed();

        await ssvNetworkUpgrade.resetNetworkFee();
        expect((await ssvNetworkViews.getNetworkFee())).to.equal(10000000);
    });

    it('Upgrade SSVNetwork contract. Check base contract is not re-initialized', async () => {
        const BasicUpgrade = await ethers.getContractFactory("SSVNetworkBasicUpgrade");
        const ssvNetworkUpgrade = await upgrades.upgradeProxy(ssvNetworkContract.address, BasicUpgrade, {
            kind: 'uups',
            unsafeAllow:['delegatecall']
        });
        await ssvNetworkUpgrade.deployed();

        const address = await upgrades.erc1967.getImplementationAddress(ssvNetworkUpgrade.address);
        const instance = await ssvNetworkUpgrade.attach(address);

        await expect(instance.connect(DB.owners[1]).initialize(
            '0x6471F70b932390f527c6403773D082A0Db8e8A9F',
            '0x6471F70b932390f527c6403773D082A0Db8e8A9F',
            '0x6471F70b932390f527c6403773D082A0Db8e8A9F',
            '0x6471F70b932390f527c6403773D082A0Db8e8A9F',
            '0x6471F70b932390f527c6403773D082A0Db8e8A9F',
            2000000,
            2000000,
            2000000,
            2000000,
            2000000,
            2000)).to.be.revertedWith('Function must be called through delegatecall');
    });

    it('Upgrade SSVNetwork contract. Check functions only can be called from proxy contract', async () => {
        const BasicUpgrade = await ethers.getContractFactory("SSVNetworkBasicUpgrade");
        const ssvNetworkUpgrade = await upgrades.upgradeProxy(ssvNetworkContract.address, BasicUpgrade, {
            kind: 'uups',
            unsafeAllow:['delegatecall']
        });
        await ssvNetworkUpgrade.deployed();

        const address = await upgrades.erc1967.getImplementationAddress(ssvNetworkUpgrade.address);
        const instance = await ssvNetworkUpgrade.attach(address);

        await expect(instance.connect(DB.owners[1]).removeOperator(1)).to.be.revertedWithCustomError(ssvNetworkContract, 'TargetModuleDoesNotExist');
    });

    it('Remove registerAuth from SSVNetwork contract', async () => {
        const publicKey = DataGenerator.publicKey(4);
        await ssvNetworkContract.setRegisterAuth(DB.owners[1].address, [true, false]);

        await ssvNetworkContract.connect(DB.owners[1]).registerOperator(
            publicKey,
            CONFIG.minimalOperatorFee);

        const SSVNetworkUpgrade = await ethers.getContractFactory("SSVNetworkUpgrade");
        const ssvNetworkUpgrade = await upgrades.upgradeProxy(ssvNetworkContract.address, SSVNetworkUpgrade, {
            kind: 'uups',
            unsafeAllow:['delegatecall']
        });
        await ssvNetworkUpgrade.deployed();

        expect(await ssvNetworkViews.getOperatorById(1)).to.deep.equal(
            [DB.owners[1].address, // owner
            CONFIG.minimalOperatorFee, // fee
                0, // validatorCount
                ethers.constants.AddressZero, // whitelisted
                false, // isPrivate
                true // active
            ]);

        await expect(ssvNetworkContract.connect(DB.owners[4]).registerOperator(
            publicKey,
            CONFIG.minimalOperatorFee
        )).to.be.revertedWithCustomError(ssvNetworkContract, 'OperatorAlreadyExists');

        await expect(ssvNetworkContract.connect(DB.owners[1]).registerOperator(
            DataGenerator.publicKey(2),
            CONFIG.minimalOperatorFee
        )).to.emit(ssvNetworkContract, 'OperatorAdded').withArgs(2, DB.owners[1].address, DataGenerator.publicKey(2), CONFIG.minimalOperatorFee);

    });

});

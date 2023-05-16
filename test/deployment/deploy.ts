// Imports
import { CONFIG, DB, initializeContract, DataGenerator } from '../helpers/contract-helpers';
import { expect } from 'chai';

describe('Deployment tests', () => {
    let ssvNetworkContract: any, ssvNetworkViews: any, registerAuth: any;

    beforeEach(async () => {
        const metadata = (await initializeContract());
        ssvNetworkContract = metadata.contract;
        ssvNetworkViews = metadata.ssvViews;
        registerAuth = metadata.registerAuth;
    });


    it('Test initial deployment of SSVNetwork and SSVNetworkViews', async () => {
        await registerAuth.setAuth(DB.owners[1].address, [true, false]);
        await ssvNetworkContract.connect(DB.owners[1]).registerOperator(
            DataGenerator.publicKey(0),
            CONFIG.minimalOperatorFee
        );

        expect((await ssvNetworkViews.getOperatorById(1))[0]).to.equal(DB.owners[1].address); // owner
        expect((await ssvNetworkViews.getOperatorById(1))[1]).to.equal(CONFIG.minimalOperatorFee); // fee
        expect((await ssvNetworkViews.getOperatorById(1))[2]).to.equal(0); // validatorCount
    });

    it('Upgrade SSVNetwork contract failed when using not owner account', async () => {
        const BasicUpgrade = await ethers.getContractFactory("SSVNetworkBasicUpgrade", DB.owners[2]);
        await expect(upgrades.upgradeProxy(ssvNetworkContract.address, BasicUpgrade, {
            kind: 'uups', unsafeAllow: ['constructor'],
            constructorArgs: [registerAuth.address],
        })).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Upgrade SSVNetwork contract. Check new function execution', async () => {
        await registerAuth.setAuth(DB.owners[1].address, [true, false]);

        await ssvNetworkContract.connect(DB.owners[1]).registerOperator(
            DataGenerator.publicKey(0),
            CONFIG.minimalOperatorFee);

        const BasicUpgrade = await ethers.getContractFactory("SSVNetworkBasicUpgrade");
        const ssvNetworkUpgrade = await upgrades.upgradeProxy(ssvNetworkContract.address, BasicUpgrade, {
            kind: 'uups', unsafeAllow: ['constructor'],
            constructorArgs: [registerAuth.address],
        });
        await ssvNetworkUpgrade.deployed();

        await ssvNetworkUpgrade.connect(DB.owners[1]).resetOperatorFee(1);
        expect((await ssvNetworkViews.getOperatorById(1))[1]).to.equal(0); // fee
        expect((await ssvNetworkUpgrade.operatorsUpdated())).to.equal(1);
    });

    it('Upgrade SSVNetwork contract. Check base contract is not re-initialized', async () => {
        const BasicUpgrade = await ethers.getContractFactory("SSVNetworkBasicUpgrade");
        const ssvNetworkUpgrade = await upgrades.upgradeProxy(ssvNetworkContract.address, BasicUpgrade, {
            kind: 'uups', unsafeAllow: ['constructor'],
            constructorArgs: [registerAuth.address],
        });
        await ssvNetworkUpgrade.deployed();

        const address = await upgrades.erc1967.getImplementationAddress(ssvNetworkUpgrade.address);
        const instance = await ssvNetworkUpgrade.attach(address);

        await expect(instance.connect(DB.owners[1]).initialize(
            "0.0.2",
            '0x6471F70b932390f527c6403773D082A0Db8e8A9F',
            2000000,
            2000000,
            2000000,
            2000000,
            2000000,
            2000)).to.be.revertedWith('Initializable: contract is already initialized');
    });

    it('Upgrade SSVNetwork contract with a new initializer', async () => {
        const SSVNetworkReinitializable = await ethers.getContractFactory("SSVNetworkReinitializable");
        const ssvNetworkUpgrade = await upgrades.upgradeProxy(ssvNetworkContract.address, SSVNetworkReinitializable, {
            kind: 'uups',
            call: 'initializeV2',
            unsafeAllow: ['constructor'],
            constructorArgs: [registerAuth.address],
        });
        await ssvNetworkUpgrade.deployed();

        expect((await ssvNetworkUpgrade.count())).to.equal(100);
    });

    it('Upgrade SSVNetwork contract reusing initializer version', async () => {
        const SSVNetworkReinitializable = await ethers.getContractFactory("SSVNetworkReinitializable");
        let ssvNetworkUpgrade = await upgrades.upgradeProxy(ssvNetworkContract.address, SSVNetworkReinitializable, {
            kind: 'uups',
            call: 'initializeV2',
            unsafeAllow: ['constructor'],
            constructorArgs: [registerAuth.address],
        });
        await ssvNetworkUpgrade.deployed();

        await expect(upgrades.upgradeProxy(ssvNetworkContract.address, SSVNetworkReinitializable, {
            kind: 'uups',
            call: 'initializeV2',
            unsafeAllow: ['constructor'],
            constructorArgs: [registerAuth.address],
        })).to.be.revertedWith('Initializable: contract is already initialized');

    });

    it('Upgrade SSVNetworkViews contract failed when using not owner account', async () => {
        const SSVNetworkViewsBasicUpgrade = await ethers.getContractFactory("SSVNetworkViewsBasicUpgrade", DB.owners[2]);
        await expect(upgrades.upgradeProxy(ssvNetworkViews.address, SSVNetworkViewsBasicUpgrade, { kind: 'uups' })).to.be.revertedWith('Ownable: caller is not the owner');
    });

    it('Upgrade SSVNetworkViews contract. Check new function execution', async () => {
        await registerAuth.setAuth(DB.owners[1].address, [true, false]);
        await ssvNetworkContract.connect(DB.owners[1]).registerOperator(
            DataGenerator.publicKey(0),
            CONFIG.minimalOperatorFee);

        const SSVNetworkViewsBasicUpgrade = await ethers.getContractFactory("SSVNetworkViewsBasicUpgrade");
        const ssvNetworkUpgrade = await upgrades.upgradeProxy(ssvNetworkViews.address, SSVNetworkViewsBasicUpgrade, { kind: 'uups' });
        await ssvNetworkUpgrade.deployed();

        expect(await ssvNetworkUpgrade.connect(DB.owners[0]).getOperatorOwnerdById(1)).to.equal(DB.owners[1].address);
    });

    it('Upgrade SSVNetworkViews contract with a new initializer', async () => {
        const SSVNetworkViewsReinitializable = await ethers.getContractFactory("SSVNetworkViewsReinitializable");
        const ssvNetworkUpgrade = await upgrades.upgradeProxy(ssvNetworkViews.address, SSVNetworkViewsReinitializable, {
            kind: 'uups',
            call: {
                fn: 'initializeV2',
                args: [4000]
            }
        });
        await ssvNetworkUpgrade.deployed();

        expect((await ssvNetworkUpgrade.validatorsPerOperatorListed())).to.equal(4000);
    });

    it('Upgrade SSVNetworkViews contract reusing initializer version', async () => {
        const SSVNetworkViewsReinitializable = await ethers.getContractFactory("SSVNetworkViewsReinitializable");
        let ssvNetworkUpgrade = await upgrades.upgradeProxy(ssvNetworkViews.address, SSVNetworkViewsReinitializable, {
            kind: 'uups',
            call: {
                fn: 'initializeV2',
                args: [4000]
            }
        });
        await ssvNetworkUpgrade.deployed();

        await expect(upgrades.upgradeProxy(ssvNetworkViews.address, SSVNetworkViewsReinitializable, {
            kind: 'uups',
            call: {
                fn: 'initializeV2',
                args: [4000]
            }
        })).to.be.revertedWith('Initializable: contract is already initialized');

    });

    it('Update NetworkLib and updgrade SSVNetwork and SSVNetworkViews', async () => {
        const SSVNetworkLibUpgrade = await ethers.getContractFactory("SSVNetworkLibUpgrade");
        const ssvNetworkUpgrade = await upgrades.upgradeProxy(ssvNetworkContract.address, SSVNetworkLibUpgrade, {
            kind: 'uups', unsafeAllow: ['constructor'],
            constructorArgs: [registerAuth.address],
        });
        await ssvNetworkUpgrade.deployed();

        const SSVNetworkViewsLibUpgrade = await ethers.getContractFactory("SSVNetworkViewsLibUpgrade");
        const ssvNetworkViewsUpgrade = await upgrades.upgradeProxy(ssvNetworkViews.address, SSVNetworkViewsLibUpgrade, { kind: 'uups' });
        await ssvNetworkViewsUpgrade.deployed();

        expect(await ssvNetworkUpgrade.connect(DB.owners[0]).getFixedNetworkRawBalance()).to.equal(100);
        expect(await ssvNetworkViewsUpgrade.connect(DB.owners[0]).getFixedNetworkRawBalance()).to.equal(100);

    });
});

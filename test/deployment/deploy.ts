// Imports
import { CONFIG, DB, initializeContract, DataGenerator } from '../helpers/contract-helpers';
import { expect } from 'chai';

describe('Deployment tests', () => {
    let ssvNetworkContract: any, ssvNetworkViews: any;

    beforeEach(async () => {
        const metadata = (await initializeContract());
        ssvNetworkContract = metadata.contract;
        ssvNetworkViews = metadata.ssvViews;
    });


    it('Test initial deployment of SSVNetwork and SSVNetworkViews', async () => {
        await ssvNetworkContract.connect(DB.owners[1]).registerOperator(
            DataGenerator.publicKey(0),
            CONFIG.minimalOperatorFee,
        );

        expect((await ssvNetworkViews.getOperatorById(1))[0]).to.equal(DB.owners[1].address); // owner
        expect((await ssvNetworkViews.getOperatorById(1))[1]).to.equal(CONFIG.minimalOperatorFee); // fee
        expect((await ssvNetworkViews.getOperatorById(1))[2]).to.equal(0); // validatorCount
    });

    it('Upgrade SSVNetwork contract. Check new function execution', async () => {
        await ssvNetworkContract.connect(DB.owners[1]).registerOperator(
            DataGenerator.publicKey(0),
            CONFIG.minimalOperatorFee,
        );

        const SSVNetwork_V2 = await ethers.getContractFactory("SSVNetwork_V2");
        const ssvNetworkV2 = await upgrades.upgradeProxy(ssvNetworkContract.address, SSVNetwork_V2, { kind: 'uups' });
        await ssvNetworkV2.deployed();

        await ssvNetworkV2.connect(DB.owners[1]).resetOperatorFee(1);
        expect((await ssvNetworkViews.getOperatorById(1))[1]).to.equal(0); // fee
        expect((await ssvNetworkV2.operatorsUpdated())).to.equal(1);
    });

    it('Upgrade SSVNetwork contract. Check base contract is not re-initialized', async () => {
        const SSVNetwork_V2 = await ethers.getContractFactory("SSVNetwork_V2");
        const ssvNetworkV2 = await upgrades.upgradeProxy(ssvNetworkContract.address, SSVNetwork_V2, { kind: 'uups' });
        await ssvNetworkV2.deployed();

        const address = await upgrades.erc1967.getImplementationAddress(ssvNetworkV2.address);
        const instance = await SSVNetwork_V2.attach(address);

        await expect(instance.connect(DB.owners[1]).initialize('0x6471F70b932390f527c6403773D082A0Db8e8A9F',
            2000000,
            2000000,
            2000000,
            2000000)).to.be.revertedWith('Function must be called through delegatecall');
    });

    it('Upgrade SSVNetwork contract with a new initializer', async () => {
        const SSVNetwork_V2_1 = await ethers.getContractFactory("SSVNetwork_V2_1");
        const ssvNetworkV2_1 = await upgrades.upgradeProxy(ssvNetworkContract.address, SSVNetwork_V2_1, {
            kind: 'uups',
            call: 'initializeV2'
        });
        await ssvNetworkV2_1.deployed();

        expect((await ssvNetworkV2_1.count())).to.equal(100);
    });

    it('Upgrade SSVNetwork contract reusing initializer version', async () => {
        const SSVNetwork_V2_1 = await ethers.getContractFactory("SSVNetwork_V2_1");
        let ssvNetworkV2_1 = await upgrades.upgradeProxy(ssvNetworkContract.address, SSVNetwork_V2_1, {
            kind: 'uups',
            call: 'initializeV2'
        });
        await ssvNetworkV2_1.deployed();

        await expect(upgrades.upgradeProxy(ssvNetworkContract.address, SSVNetwork_V2_1, {
            kind: 'uups',
            call: 'initializeV2'
        })).to.be.revertedWith('Initializable: contract is already initialized');

    });

    it('Upgrade SSVNetworkViews contract. Check new function execution', async () => {
        await ssvNetworkContract.connect(DB.owners[1]).registerOperator(
            DataGenerator.publicKey(0),
            CONFIG.minimalOperatorFee,
        );

        const SSVNetworkViews_V2 = await ethers.getContractFactory("SSVNetworkViews_V2");
        const ssvNetworkViewsV2 = await upgrades.upgradeProxy(ssvNetworkViews.address, SSVNetworkViews_V2, { kind: 'uups' });
        await ssvNetworkViewsV2.deployed();

        expect(await ssvNetworkViewsV2.connect(DB.owners[0]).getOperatorOwnerdById(1)).to.equal(DB.owners[1].address);
    });

    it('Upgrade SSVNetworkViews contract with a new initializer', async () => {
        const SSVNetworkViews_V2_1 = await ethers.getContractFactory("SSVNetworkViews_V2_1");
        const ssvNetworkViewsV2_1 = await upgrades.upgradeProxy(ssvNetworkViews.address, SSVNetworkViews_V2_1, {
            kind: 'uups',
            call: {
                fn: 'initializeV2',
                args: [4000]
            }
        });
        await ssvNetworkViewsV2_1.deployed();

        expect((await ssvNetworkViewsV2_1.validatorsPerOperatorListed())).to.equal(4000);
    });

    it('Upgrade SSVNetworkViews contract reusing initializer version', async () => {
        const SSVNetworkViews_V2_1 = await ethers.getContractFactory("SSVNetworkViews_V2_1");
        let ssvNetworkViewsV2_1 = await upgrades.upgradeProxy(ssvNetworkViews.address, SSVNetworkViews_V2_1, {
            kind: 'uups',
            call: {
                fn: 'initializeV2',
                args: [4000]
            }
        });
        await ssvNetworkViewsV2_1.deployed();

        await expect(upgrades.upgradeProxy(ssvNetworkViews.address, SSVNetworkViews_V2_1, {
            kind: 'uups',
            call: {
                fn: 'initializeV2',
                args: [4000]
            }
        })).to.be.revertedWith('Initializable: contract is already initialized');

    });

    it('Update NetworkLib and updgrade SSVNetwork and SSVNetworkViews', async () => {
        const SSVNetwork_V2_2 = await ethers.getContractFactory("SSVNetwork_V2_2");
        const ssvNetworkV2_2 = await upgrades.upgradeProxy(ssvNetworkContract.address, SSVNetwork_V2_2, { kind: 'uups' });
        await ssvNetworkV2_2.deployed();

        const SSVNetworkViews_V2_2 = await ethers.getContractFactory("SSVNetworkViews_V2_2");
        const ssvNetworkViewsV2_2 = await upgrades.upgradeProxy(ssvNetworkViews.address, SSVNetworkViews_V2_2, { kind: 'uups' });
        await ssvNetworkViewsV2_2.deployed();

        expect(await ssvNetworkV2_2.connect(DB.owners[0]).getFixedNetworkRawBalance()).to.equal(100);
        expect(await ssvNetworkViewsV2_2.connect(DB.owners[0]).getFixedNetworkRawBalance()).to.equal(100);

    });
});

// Imports
import { CONFIG, DB, initializeContract, DataGenerator } from '../helpers/contract-helpers';
import { trackGas } from '../helpers/gas-usage';
import { ethers, upgrades } from 'hardhat';
import { expect } from 'chai';

describe('Deployment tests', () => {
    let ssvNetworkContract: any, ssvNetworkViews: any;

    beforeEach(async () => {
        const metadata = await initializeContract();
        ssvNetworkContract = metadata.contract;
        ssvNetworkViews = metadata.ssvViews;
    });

    it('Upgrade SSVNetwork contract. Check new function execution', async () => {
        await ssvNetworkContract.setRegisterAuth(DB.owners[1].address, true, false);

        await ssvNetworkContract.connect(DB.owners[1]).registerOperator(
            DataGenerator.publicKey(0),
            CONFIG.minimalOperatorFee);

        const BasicUpgrade = await ethers.getContractFactory("SSVNetworkBasicUpgrade");
        const ssvNetworkUpgrade = await upgrades.upgradeProxy(ssvNetworkContract.address, BasicUpgrade, {
            kind: 'uups',
            unsafeAllow: ['delegatecall']
        });
        await ssvNetworkUpgrade.deployed();

        await ssvNetworkUpgrade.resetNetworkFee(10000000);
        expect((await ssvNetworkViews.getNetworkFee())).to.equal(10000000);
    });

    it('Upgrade SSVNetwork contract. Deploy implemetation manually', async () => {
        const SSVNetwork = await ethers.getContractFactory("SSVNetwork");
        const BasicUpgrade = await ethers.getContractFactory("SSVNetworkBasicUpgrade");

        // Get current SSVNetwork proxy
        const ssvNetwork = SSVNetwork.attach(ssvNetworkContract.address);

        // Deploy a new implementation with another account
        const contractImpl = await BasicUpgrade.connect(DB.owners[1]).deploy();
        await contractImpl.deployed();

        const newNetworkFee = ethers.utils.parseUnits("10000000", "wei");
        const calldata = contractImpl.interface.encodeFunctionData('resetNetworkFee', [newNetworkFee]);

        // The owner of SSVNetwork contract peforms the upgrade
        await ssvNetwork.upgradeToAndCall(contractImpl.address, calldata);

        expect((await ssvNetworkViews.getNetworkFee())).to.equal(10000000);

    });

    it('Upgrade SSVNetwork contract. Check base contract is not re-initialized', async () => {
        const BasicUpgrade = await ethers.getContractFactory("SSVNetworkBasicUpgrade");
        const ssvNetworkUpgrade = await upgrades.upgradeProxy(ssvNetworkContract.address, BasicUpgrade, {
            kind: 'uups',
            unsafeAllow: ['delegatecall']
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
            2000)).to.be.revertedWith('Initializable: contract is already initialized');
    });

    it('Upgrade SSVNetwork contract. Check state is only changed from proxy contract', async () => {
        const BasicUpgrade = await ethers.getContractFactory("SSVNetworkBasicUpgrade");
        const ssvNetworkUpgrade = await upgrades.upgradeProxy(ssvNetworkContract.address, BasicUpgrade, {
            kind: 'uups',
            unsafeAllow: ['delegatecall']
        });
        await ssvNetworkUpgrade.deployed();

        const address = await upgrades.erc1967.getImplementationAddress(ssvNetworkUpgrade.address);
        const instance = await ssvNetworkUpgrade.attach(address);

        await trackGas(
            instance.connect(DB.owners[1]).resetNetworkFee(100000000000)
        );

        expect(await ssvNetworkViews.getNetworkFee()).to.be.equals(0);
    });

    it('Remove registerAuth from SSVNetwork contract', async () => {
        const publicKey = DataGenerator.publicKey(4);
        await ssvNetworkContract.setRegisterAuth(DB.owners[1].address, true, false);

        await ssvNetworkContract.connect(DB.owners[1]).registerOperator(
            publicKey,
            CONFIG.minimalOperatorFee);

        const SSVNetworkUpgrade = await ethers.getContractFactory("SSVNetworkUpgrade");
        const ssvNetworkUpgrade = await upgrades.upgradeProxy(ssvNetworkContract.address, SSVNetworkUpgrade, {
            kind: 'uups',
            unsafeAllow: ['delegatecall']
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

    it('Update a module (SSVOperators)', async () => {

        const ssvNetworkFactory = await ethers.getContractFactory('SSVNetwork');
        const ssvNetwork = await ssvNetworkFactory.attach(ssvNetworkContract.address);

        const ssvOperatorsFactory = await ethers.getContractFactory('SSVOperatorsUpdate');

        const operatorsImpl = await ssvOperatorsFactory.connect(DB.owners[1]).deploy();
        await operatorsImpl.deployed();

        await ssvNetwork.updateModule(0, operatorsImpl.address);

        await expect(ssvNetworkContract.declareOperatorFee(0, 0))
            .to.be.revertedWithCustomError(ssvNetworkContract, 'NoFeeDeclared');
    });
});

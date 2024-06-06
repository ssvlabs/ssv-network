// Imports
import {
  owners,
  initializeContract,
  DataGenerator,
  CONFIG,
  publicClient,
} from '../helpers/contract-helpers';
import { ethers, upgrades } from 'hardhat';
import { expect } from 'chai';

import hre from 'hardhat';
import { Address, encodeFunctionData } from 'viem';

describe('Deployment tests', () => {
  let ssvNetwork: any, ssvViews: any, ssvToken: any;

  beforeEach(async () => {
    // Initialize contract
    const metadata = await initializeContract();
    ssvNetwork = metadata.ssvNetwork;
    ssvViews = metadata.ssvNetworkViews;
    ssvToken = metadata.ssvToken;
  });

  it('Check default values after deploying', async () => {
    expect(await ssvViews.read.getNetworkValidatorsCount()).to.equal(0);
    expect(await ssvViews.read.getNetworkEarnings()).to.equal(0);
    expect(await ssvViews.read.getOperatorFeeIncreaseLimit()).to.equal(CONFIG.operatorMaxFeeIncrease);
    expect(await ssvViews.read.getOperatorFeePeriods()).to.deep.equal([
      CONFIG.declareOperatorFeePeriod,
      CONFIG.executeOperatorFeePeriod,
    ]);
    expect(await ssvViews.read.getLiquidationThresholdPeriod()).to.equal(CONFIG.minimalBlocksBeforeLiquidation);
    expect(await ssvViews.read.getMinimumLiquidationCollateral()).to.equal(CONFIG.minimumLiquidationCollateral);
    expect(await ssvViews.read.getValidatorsPerOperatorLimit()).to.equal(CONFIG.validatorsPerOperatorLimit);
    expect(await ssvViews.read.getOperatorFeeIncreaseLimit()).to.equal(CONFIG.operatorMaxFeeIncrease);
  });

  it('Upgrade SSVNetwork contract. Check new function execution', async () => {
    await ssvNetwork.write.registerOperator([DataGenerator.publicKey(0), CONFIG.minimalOperatorFee, false], {
      account: owners[1].account,
    });

    const BasicUpgrade = await ethers.getContractFactory('SSVNetworkBasicUpgrade');
    const ssvNetworkUpgrade = await upgrades.upgradeProxy(ssvNetwork.address, BasicUpgrade, {
      kind: 'uups',
      unsafeAllow: ['delegatecall'],
    });
    await ssvNetworkUpgrade.waitForDeployment();
    const ssvNetworkAddress = await ssvNetworkUpgrade.getAddress();

    ssvNetwork = await hre.viem.getContractAt('SSVNetworkBasicUpgrade', ssvNetworkAddress as Address);

    await ssvNetwork.write.resetNetworkFee([10000000]);
    expect(await ssvViews.read.getNetworkFee()).to.equal(10000000);
  });

  it('Upgrade SSVNetwork contract. Deploy implemetation manually', async () => {
    // Get current SSVNetwork proxy
    const deployedSSVNetwork = await hre.viem.getContractAt('SSVNetwork', ssvNetwork.address as Address);

    // Deploy a new implementation with another account
    const contractImpl = await hre.viem.deployContract('SSVNetworkBasicUpgrade', [], {
      client: owners[1].client,
    });

    const newNetworkFee = 10000000n;
    const calldata = encodeFunctionData({
      abi: contractImpl.abi,
      functionName: 'resetNetworkFee',
      args: [newNetworkFee],
    });

    // The owner of SSVNetwork contract peforms the upgrade
    await deployedSSVNetwork.write.upgradeToAndCall([contractImpl.address, calldata]);

    expect(await ssvViews.read.getNetworkFee()).to.equal(10000000);
  });

  it('Upgrade SSVNetwork contract. Check base contract is not re-initialized', async () => {
    const BasicUpgrade = await ethers.getContractFactory('SSVNetworkBasicUpgrade');
    const ssvNetworkUpgrade = await upgrades.upgradeProxy(ssvNetwork.address, BasicUpgrade, {
      kind: 'uups',
      unsafeAllow: ['delegatecall'],
    });
    await ssvNetworkUpgrade.waitForDeployment();

    const address = await upgrades.erc1967.getImplementationAddress(await ssvNetworkUpgrade.getAddress());

    const instance = await hre.viem.getContractAt('SSVNetworkBasicUpgrade', address as Address);

    await expect(
      instance.write.initialize(
        [
          '0x6471F70b932390f527c6403773D082A0Db8e8A9F',
          '0x6471F70b932390f527c6403773D082A0Db8e8A9F',
          '0x6471F70b932390f527c6403773D082A0Db8e8A9F',
          '0x6471F70b932390f527c6403773D082A0Db8e8A9F',
          '0x6471F70b932390f527c6403773D082A0Db8e8A9F',
          2000000n,
          2000000n,
          2000000,
          2000000n,
          2000000n,
          2000n,
        ],
        { account: owners[1].account },
      ),
    ).to.be.rejectedWith('Initializable: contract is already initialized');
  });

  it('Upgrade SSVNetwork contract. Check state is only changed from proxy contract', async () => {
    const BasicUpgrade = await ethers.getContractFactory('SSVNetworkBasicUpgrade');
    const ssvNetworkUpgrade = await upgrades.upgradeProxy(ssvNetwork.address, BasicUpgrade, {
      kind: 'uups',
      unsafeAllow: ['delegatecall'],
    });
    await ssvNetworkUpgrade.waitForDeployment();

    const address = await upgrades.erc1967.getImplementationAddress(await ssvNetworkUpgrade.getAddress());
    const instance = await hre.viem.getContractAt('SSVNetworkBasicUpgrade', address as Address);

    await instance.write.resetNetworkFee([100000000000n], { account: owners[1].account });

    expect(await ssvViews.read.getNetworkFee()).to.be.equals(0);
  });

  it('ETH can not be transferred to SSVNetwork / SSVNetwork views', async () => {
    const amount = 10000000n;

    await expect(
      owners[0].sendTransaction({
        to: ssvNetwork.address,
        value: amount,
      }),
    ).to.be.rejected;

    await expect(
      owners[0].sendTransaction({
        to: ssvViews.address,
        value: amount,
      }),
    ).to.be.rejected;

    expect(await publicClient.getBalance({ address: ssvNetwork.address })).to.be.equal(0);
    expect(await publicClient.getBalance({ address: ssvViews.address })).to.be.equal(0);
  });
});

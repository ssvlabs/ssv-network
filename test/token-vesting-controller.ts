import { ethers, upgrades } from 'hardhat';
import { solidity } from 'ethereum-waffle';

import * as chai from 'chai';
import * as chaiAsPromised from 'chai-as-promised';

declare var network: any;

before(() => {
  chai.should();
  chai.use(chaiAsPromised);
});

const { expect } = chai;

const DAY = 86400;
const YEAR = 365 * DAY;

const firstStartTime = Math.floor(Date.now() / 1000);

async function snapshot(time, func) {
  const snapshot = await network.provider.send("evm_snapshot");
  await network.provider.send("evm_increaseTime", [time]);
  await network.provider.send("evm_mine", []);
  await func();
  await network.provider.send("evm_revert", [snapshot]);
}

let ssvToken;
let tokenVestingController;
let owner, owner2, firstHolder, secondHolder, thirdHolder;
describe('TokenVestingController', function() {
  before(async function () {
    [owner, owner2, firstHolder, secondHolder, thirdHolder] = await ethers.getSigners();
    const ssvTokenFactory = await ethers.getContractFactory('SSVToken');
    ssvToken = await upgrades.deployProxy(ssvTokenFactory, []);
    await ssvToken.deployed();
    const tokenVestingControllerFactory = await ethers.getContractFactory('TokenVestingController');
    tokenVestingController = await upgrades.deployProxy(tokenVestingControllerFactory, [ssvToken.address, '10000']);
    await tokenVestingController.deployed();
  });

  it('mint tokens', async function () {
    await expect(ssvToken.mint(firstHolder.address, '1000000')).to.emit(ssvToken, 'Transfer').withArgs('0x0000000000000000000000000000000000000000', firstHolder.address, '1000000');
    expect(await ssvToken.balanceOf(firstHolder.address)).to.equal('1000000');
  });

  it('create vesting contract below minimum', async function() {
    await ssvToken.connect(firstHolder).approve(tokenVestingController.address, '1000000');
    await expect(tokenVestingController.connect(firstHolder).createVesting(secondHolder.address, '9000', firstStartTime, YEAR, 4 * YEAR, false)).to.be.revertedWith('amount less than minimum');
  });

  it('create vesting contract', async function() {
    await tokenVestingController.connect(firstHolder).createVesting(secondHolder.address, '10000', firstStartTime, YEAR, 4 * YEAR, false);
    expect(await tokenVestingController.totalVestingBalanceOf(secondHolder.address)).to.equal('10000');
    expect(await tokenVestingController.vestedBalanceOf(secondHolder.address)).to.equal('0');
    expect(await tokenVestingController.unvestedBalanceOf(secondHolder.address)).to.equal('10000');
    expect(await tokenVestingController.totalTokenBalanceOf(secondHolder.address)).to.equal('10000');
    expect(await ssvToken.balanceOf(firstHolder.address)).to.equal('990000');
    expect(await ssvToken.balanceOf((await tokenVestingController.vestings(secondHolder.address, 0)))).to.equal('10000');
    expect(await tokenVestingController.totalTokenBalanceOf((await tokenVestingController.vestings(secondHolder.address, 0)))).to.equal('0');

    await snapshot(2 * YEAR, async () => {
      expect(await tokenVestingController.totalVestingBalanceOf(secondHolder.address)).to.equal('10000');
      expect(await tokenVestingController.vestedBalanceOf(secondHolder.address)).to.equal('5000');
      expect(await tokenVestingController.unvestedBalanceOf(secondHolder.address)).to.equal('5000');
      expect(await tokenVestingController.totalTokenBalanceOf(secondHolder.address)).to.equal('10000');
    });
  });

  it('create another vesting contract for the same holder', async function() {
    await ssvToken.connect(firstHolder).approve(tokenVestingController.address, '1000000');
    await tokenVestingController.connect(firstHolder).createVesting(secondHolder.address, '10000', firstStartTime + YEAR, YEAR, 4 * YEAR, true);
    expect(await tokenVestingController.totalVestingBalanceOf(secondHolder.address)).to.equal('20000');
    expect(await tokenVestingController.vestedBalanceOf(secondHolder.address)).to.equal('0');
    expect(await tokenVestingController.unvestedBalanceOf(secondHolder.address)).to.equal('20000');
    expect(await tokenVestingController.totalTokenBalanceOf(secondHolder.address)).to.equal('20000');
    expect(await ssvToken.balanceOf(firstHolder.address)).to.equal('980000');

    await snapshot(2 * YEAR, async () => {
      expect(await tokenVestingController.totalVestingBalanceOf(secondHolder.address)).to.equal('20000');
      expect(await tokenVestingController.vestedBalanceOf(secondHolder.address)).to.equal('7500');
      expect(await tokenVestingController.unvestedBalanceOf(secondHolder.address)).to.equal('12500');
      expect(await tokenVestingController.totalTokenBalanceOf(secondHolder.address)).to.equal('20000');
    });
  });

  it('revoke a vesting contract by holder and index', async function() {
    await snapshot(0, async () => {
      await tokenVestingController.connect(firstHolder).revoke(secondHolder.address, 1);
      expect(await ssvToken.balanceOf(firstHolder.address)).to.equal('990000');
      expect(await tokenVestingController.totalVestingBalanceOf(secondHolder.address)).to.equal('10000');
      expect(await tokenVestingController.vestedBalanceOf(secondHolder.address)).to.equal('0');
      expect(await tokenVestingController.unvestedBalanceOf(secondHolder.address)).to.equal('10000');
      expect(await tokenVestingController.totalTokenBalanceOf(secondHolder.address)).to.equal('10000');
    });
  });

  it('revoke a vesting contract by holder and index twice', async function() {
    await snapshot(0, async () => {
      await tokenVestingController.connect(firstHolder).revoke(secondHolder.address, 1);
      await expect(tokenVestingController.connect(firstHolder).revoke(secondHolder.address, 1)).to.be.revertedWith('TokenVesting: token already revoked');

      expect(await ssvToken.balanceOf(firstHolder.address)).to.equal('990000');
      expect(await tokenVestingController.totalVestingBalanceOf(secondHolder.address)).to.equal('10000');
      expect(await tokenVestingController.vestedBalanceOf(secondHolder.address)).to.equal('0');
      expect(await tokenVestingController.unvestedBalanceOf(secondHolder.address)).to.equal('10000');
      expect(await tokenVestingController.totalTokenBalanceOf(secondHolder.address)).to.equal('10000');
    });
  });

  it('revoke all contracts for holder', async function() {
    await snapshot(0, async () => {
      await tokenVestingController.connect(firstHolder).revokeAll(secondHolder.address);

      expect(await ssvToken.balanceOf(firstHolder.address)).to.equal('990000');
      expect(await tokenVestingController.totalVestingBalanceOf(secondHolder.address)).to.equal('10000');
      expect(await tokenVestingController.vestedBalanceOf(secondHolder.address)).to.equal('0');
      expect(await tokenVestingController.unvestedBalanceOf(secondHolder.address)).to.equal('10000');
      expect(await tokenVestingController.totalTokenBalanceOf(secondHolder.address)).to.equal('10000');

      await tokenVestingController.connect(firstHolder).revokeAll(secondHolder.address);

      expect(await ssvToken.balanceOf(firstHolder.address)).to.equal('990000');
      expect(await tokenVestingController.totalVestingBalanceOf(secondHolder.address)).to.equal('10000');
      expect(await tokenVestingController.vestedBalanceOf(secondHolder.address)).to.equal('0');
      expect(await tokenVestingController.unvestedBalanceOf(secondHolder.address)).to.equal('10000');
      expect(await tokenVestingController.totalTokenBalanceOf(secondHolder.address)).to.equal('10000');
    });
  });

  it('revoke after vested tokens', async function() {
    await snapshot(2 * YEAR, async () => {
      await expect(tokenVestingController.connect(firstHolder).revokeAll(secondHolder.address)).to.emit(ssvToken, 'Transfer').withArgs(tokenVestingController.address, firstHolder.address, '7500');

      expect(await ssvToken.balanceOf(firstHolder.address)).to.equal('987500');
      expect(await tokenVestingController.totalVestingBalanceOf(secondHolder.address)).to.equal('12500');
      expect(await tokenVestingController.vestedBalanceOf(secondHolder.address)).to.equal('7500');
      expect(await tokenVestingController.unvestedBalanceOf(secondHolder.address)).to.equal('5000');
      expect(await tokenVestingController.totalTokenBalanceOf(secondHolder.address)).to.equal('12500');
    });
  });

  it('withdraw at middle', async function() {
    await snapshot(3 * YEAR, async () => {
      await expect(tokenVestingController.connect(secondHolder).withdraw()).to.emit(ssvToken, 'Transfer').withArgs((await tokenVestingController.vestings(secondHolder.address, 1)), secondHolder.address, '5000');

      expect(await ssvToken.balanceOf(secondHolder.address)).to.equal('12500');
      expect(await tokenVestingController.totalVestingBalanceOf(secondHolder.address)).to.equal('7500');
      expect(await tokenVestingController.vestedBalanceOf(secondHolder.address)).to.equal('0');
      expect(await tokenVestingController.unvestedBalanceOf(secondHolder.address)).to.equal('7500');
    });
  });

  it('withdraw at end', async function() {
    await snapshot(5 * YEAR, async () => {
      await expect(tokenVestingController.connect(secondHolder).withdraw()).to.emit(ssvToken, 'Transfer').withArgs((await tokenVestingController.vestings(secondHolder.address, 1)), secondHolder.address, '10000');

      expect(await ssvToken.balanceOf(secondHolder.address)).to.equal('20000');
      expect(await tokenVestingController.totalVestingBalanceOf(secondHolder.address)).to.equal('0');
      expect(await tokenVestingController.vestedBalanceOf(secondHolder.address)).to.equal('0');
      expect(await tokenVestingController.unvestedBalanceOf(secondHolder.address)).to.equal('0');
    });
  });

  it('withdraw for someone else', async function() {
    await snapshot(3 * YEAR, async () => {
      await expect(tokenVestingController.withdrawFor(secondHolder.address)).to.emit(ssvToken, 'Transfer').withArgs((await tokenVestingController.vestings(secondHolder.address, 1)), secondHolder.address, '5000');

      expect(await ssvToken.balanceOf(secondHolder.address)).to.equal('12500');
      expect(await tokenVestingController.totalVestingBalanceOf(secondHolder.address)).to.equal('7500');
      expect(await tokenVestingController.vestedBalanceOf(secondHolder.address)).to.equal('0');
      expect(await tokenVestingController.unvestedBalanceOf(secondHolder.address)).to.equal('7500');
    });
  });

  it('withdraw after revoke', async function() {
    await snapshot(2 * YEAR, async () => {
      await expect(tokenVestingController.connect(firstHolder).revokeAll(secondHolder.address)).to.emit(ssvToken, 'Transfer').withArgs(tokenVestingController.address, firstHolder.address, '7500');
      await snapshot(YEAR, async () => {
        await expect(tokenVestingController.connect(secondHolder).withdraw()).to.emit(ssvToken, 'Transfer').withArgs((await tokenVestingController.vestings(secondHolder.address, 1)), secondHolder.address, '2500');

        expect(await ssvToken.balanceOf(firstHolder.address)).to.equal('987500');
        expect(await tokenVestingController.totalVestingBalanceOf(secondHolder.address)).to.equal('2500');
        expect(await tokenVestingController.vestedBalanceOf(secondHolder.address)).to.equal('0');
        expect(await tokenVestingController.unvestedBalanceOf(secondHolder.address)).to.equal('2500');
      });
    });
  });

  it('withdraw several times immediately', async function() {
    await snapshot(3 * YEAR, async () => {
      await expect(tokenVestingController.connect(secondHolder).withdraw()).to.emit(ssvToken, 'Transfer').withArgs((await tokenVestingController.vestings(secondHolder.address, 1)), secondHolder.address, '5000');
      await tokenVestingController.connect(secondHolder).withdraw();
      await tokenVestingController.withdrawFor(secondHolder.address);

      expect(await ssvToken.balanceOf(secondHolder.address)).to.equal('12500');
      expect(await tokenVestingController.totalVestingBalanceOf(secondHolder.address)).to.equal('7500');
      expect(await tokenVestingController.vestedBalanceOf(secondHolder.address)).to.equal('0');
      expect(await tokenVestingController.unvestedBalanceOf(secondHolder.address)).to.equal('7500');
    });
  });

  it('withdraw several times until end', async function() {
    await snapshot(1 * YEAR, async () => {
      await expect(tokenVestingController.connect(secondHolder).withdraw()).to.emit(ssvToken, 'Transfer').withArgs((await tokenVestingController.vestings(secondHolder.address, 0)), secondHolder.address, '2500');
      expect(await ssvToken.balanceOf(secondHolder.address)).to.equal('2500');
      expect(await tokenVestingController.totalVestingBalanceOf(secondHolder.address)).to.equal('17500');
      expect(await tokenVestingController.vestedBalanceOf(secondHolder.address)).to.equal('0');
      expect(await tokenVestingController.unvestedBalanceOf(secondHolder.address)).to.equal('17500');
      await snapshot(3 * YEAR, async () => {
        await expect(tokenVestingController.connect(secondHolder).withdraw()).to.emit(ssvToken, 'Transfer').withArgs((await tokenVestingController.vestings(secondHolder.address, 0)), secondHolder.address, '7500');
        expect(await ssvToken.balanceOf(secondHolder.address)).to.equal('17500');
        expect(await tokenVestingController.totalVestingBalanceOf(secondHolder.address)).to.equal('2500');
        expect(await tokenVestingController.vestedBalanceOf(secondHolder.address)).to.equal('0');
        expect(await tokenVestingController.unvestedBalanceOf(secondHolder.address)).to.equal('2500');
        await snapshot(2 * YEAR, async () => {
          await expect(tokenVestingController.connect(secondHolder).withdraw()).to.emit(ssvToken, 'Transfer').withArgs((await tokenVestingController.vestings(secondHolder.address, 1)), secondHolder.address, '2500');
          expect(await ssvToken.balanceOf(secondHolder.address)).to.equal('20000');
          expect(await tokenVestingController.totalVestingBalanceOf(secondHolder.address)).to.equal('0');
          expect(await tokenVestingController.vestedBalanceOf(secondHolder.address)).to.equal('0');
          expect(await tokenVestingController.unvestedBalanceOf(secondHolder.address)).to.equal('0');
        });
      });
    });
  });
});

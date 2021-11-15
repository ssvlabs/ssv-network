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

let ssvToken;
let owner, owner2, firstHolder, secondHolder, thirdHolder;
describe('SSVToken', function() {
  before(async function () {
    [owner, owner2, firstHolder, secondHolder, thirdHolder] = await ethers.getSigners();
    const ssvTokenFactory = await ethers.getContractFactory('SSVToken');
    ssvToken = await ssvTokenFactory.deploy();
    await ssvToken.deployed();
  });

  it('check owner', async function () {
    expect(await ssvToken.owner()).to.equal(owner.address);
  });

  it('mint tokens', async function () {
    await expect(ssvToken.mint(firstHolder.address, '1000000')).to.emit(ssvToken, 'Transfer').withArgs('0x0000000000000000000000000000000000000000', firstHolder.address, '1000000');
    expect(await ssvToken.balanceOf(firstHolder.address)).to.equal('1000000');
  });

  it('try to mint from non-admin', async function() {
    await expect(ssvToken.connect(owner2).mint(firstHolder.address, '1000000')).to.be.revertedWith('caller is not the owner');
  });

  it('transfer', async function() {
    await expect(ssvToken.connect(firstHolder).transfer(secondHolder.address, '300000')).to.emit(ssvToken, 'Transfer').withArgs(firstHolder.address, secondHolder.address, '300000');
    expect(await ssvToken.balanceOf(firstHolder.address)).to.equal('700000');
    expect(await ssvToken.balanceOf(secondHolder.address)).to.equal('300000');
  });

  it('transfer more than balance', async function () {
    await expect(ssvToken.connect(firstHolder).transfer(secondHolder.address, '800000')).to.be.revertedWith('ERC20: transfer amount exceeds balance');
  });

  it('transfer from another account without approval', async function () {
    await expect(ssvToken.connect(firstHolder).transferFrom(secondHolder.address, firstHolder.address, '100000')).to.be.revertedWith('ERC20: transfer amount exceeds allowance');
  });

  it('approve', async function () {
    await expect(ssvToken.connect(secondHolder).approve(firstHolder.address, '200000')).to.emit(ssvToken, 'Approval').withArgs(secondHolder.address, firstHolder.address, '200000');
    expect(await ssvToken.allowance(secondHolder.address, firstHolder.address)).to.equal('200000');
  });

  it('valid transfer from another account', async function () {
    await expect(ssvToken.connect(firstHolder).transferFrom(secondHolder.address, thirdHolder.address, '100000')).to.emit(ssvToken, 'Transfer').withArgs(secondHolder.address, thirdHolder.address, '100000');
    expect(await ssvToken.balanceOf(firstHolder.address)).to.equal('700000');
    expect(await ssvToken.balanceOf(secondHolder.address)).to.equal('200000');
    expect(await ssvToken.balanceOf(thirdHolder.address)).to.equal('100000');
    expect(await ssvToken.allowance(secondHolder.address, firstHolder.address)).to.equal('100000');
  });

  it('burn tokens', async function () {
    await expect(ssvToken.connect(secondHolder).burn('100000')).to.emit(ssvToken, 'Transfer').withArgs(secondHolder.address, '0x0000000000000000000000000000000000000000', '100000');
    expect(await ssvToken.balanceOf(secondHolder.address)).to.equal('100000');
  });

  it('burn more than balance', async function () {
    await expect(ssvToken.connect(secondHolder).burn('200000')).to.be.revertedWith('ERC20: burn amount exceeds balance');
  });

  it('burn from another account without approval', async function() {
    await expect(ssvToken.connect(thirdHolder).burnFrom(secondHolder.address, '10000')).to.be.revertedWith('ERC20: burn amount exceeds allowance');
  });

  it('valid burn from another account', async function() {
    await expect(ssvToken.connect(firstHolder).burnFrom(secondHolder.address, '10000')).to.emit(ssvToken, 'Transfer').withArgs(secondHolder.address, '0x0000000000000000000000000000000000000000', '10000');
    expect(await ssvToken.balanceOf(firstHolder.address)).to.equal('700000');
    expect(await ssvToken.balanceOf(secondHolder.address)).to.equal('90000');
    expect(await ssvToken.allowance(secondHolder.address, firstHolder.address)).to.equal('90000');
  });

  it('Change Owner', async function () {
    await expect(ssvToken.transferOwnership(owner2.address)).to.emit(ssvToken, 'OwnershipTransferred').withArgs(owner.address, owner2.address);
    expect(await ssvToken.owner()).to.equal(owner2.address);
  });

  it('Change Owner from non owner', async function () {
    await expect(ssvToken.transferOwnership(owner.address)).to.be.revertedWith('caller is not the owner');
    expect(await ssvToken.owner()).to.equal(owner2.address);
  });
});

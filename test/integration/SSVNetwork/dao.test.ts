import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import { ssvNetworkFullFixture } from '../../setup/fixtures.ts';
import type { NetworkHelpersType } from '../../common/types.ts';
import { STAKE_AMOUNT } from '../../common/constants.ts';
import { Events } from '../../common/events.ts';
import type { HardhatEthersSigner } from '@nomicfoundation/hardhat-ethers/types';
import { Errors } from '../../common/errors.js';
import { ethers } from 'ethers';
import { setupTestContext } from '../../common/helpers.ts';

describe("SSVNetwork Integration - DAO Oracle Quorum", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let staker: HardhatEthersSigner;
  let oracles: HardhatEthersSigner[];

  const numberOfOracles = 4n;

  before(async function () {
    let signers: HardhatEthersSigner[];
    ({ connection, networkHelpers, signers } = await setupTestContext());
    staker = signers[2];
    oracles = signers.slice(10, 14);
  });

  const deployFullSSVNetworkFixture = async () => {
    return ssvNetworkFullFixture(connection);
  };


  const setupOraclesAndStake = async (network: any, ssvToken: any) => {
    for (let i = 0; i < oracles.length; i++) {
      await network.replaceOracle(i + 1, oracles[i].address);
    }
    await ssvToken.mint(staker.address, STAKE_AMOUNT);
    await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
    await network.connect(staker).stake(STAKE_AMOUNT);
    return { weight: STAKE_AMOUNT / numberOfOracles };
  };

  describe("Oracle Quorum — 100% threshold (quorumBps = 10000)", async function () {
    it("First three oracle votes emit WeightedRootProposed; fourth vote commits the root", async function () {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const { weight } = await setupOraclesAndStake(network, ssvToken);

      await network.setQuorumBps(10000);
      expect(await views.getQuorumBps()).to.equal(10000n);

      const root = ethers.keccak256(ethers.toUtf8Bytes("100pct-quorum"));
      const blockNum = await connection.ethers.provider.getBlockNumber();
      const threshold = STAKE_AMOUNT;

      const tx1 = await network.connect(oracles[0]).commitRoot(root, blockNum);
      await expect(tx1).to.emit(network, Events.WEIGHTED_ROOT_PROPOSED)
        .withArgs(root, blockNum, weight, threshold, 1, oracles[0].address);
      expect(await views.getCommittedRoot(blockNum)).to.equal(ethers.ZeroHash);

      const tx2 = await network.connect(oracles[1]).commitRoot(root, blockNum);
      await expect(tx2).to.emit(network, Events.WEIGHTED_ROOT_PROPOSED)
        .withArgs(root, blockNum, weight * 2n, threshold, 2, oracles[1].address);
      expect(await views.getCommittedRoot(blockNum)).to.equal(ethers.ZeroHash);

      const tx3 = await network.connect(oracles[2]).commitRoot(root, blockNum);
      await expect(tx3).to.emit(network, Events.WEIGHTED_ROOT_PROPOSED)
        .withArgs(root, blockNum, weight * 3n, threshold, 3, oracles[2].address);
      expect(await views.getCommittedRoot(blockNum)).to.equal(ethers.ZeroHash);

      const tx4 = await network.connect(oracles[3]).commitRoot(root, blockNum);
      await expect(tx4).to.emit(network, Events.ROOT_COMMITTED).withArgs(root, blockNum);
      expect(await views.getCommittedRoot(blockNum)).to.equal(root);
    });
  });

  describe("Oracle Quorum — 1 bps minimum threshold (quorumBps = 1)", async function () {
    it("Single oracle vote immediately commits root when quorumBps is 1", async function () {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      await setupOraclesAndStake(network, ssvToken);

      await network.setQuorumBps(1);
      expect(await views.getQuorumBps()).to.equal(1n);

      const root = ethers.keccak256(ethers.toUtf8Bytes("1bps-quorum"));
      const blockNum = await connection.ethers.provider.getBlockNumber();

      const tx = await network.connect(oracles[0]).commitRoot(root, blockNum);
      await expect(tx).to.emit(network, Events.ROOT_COMMITTED).withArgs(root, blockNum);
      expect(await views.getCommittedRoot(blockNum)).to.equal(root);
    });
  });

  describe("Oracle Quorum — oracle replaced between votes", async function () {
    it("Pre-replacement vote still counts; old oracle loses rights, new oracle gets AlreadyVoted for reused slot", async function () {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      await setupOraclesAndStake(network, ssvToken);

      const root = ethers.keccak256(ethers.toUtf8Bytes("mid-replace"));
      const blockNum = await connection.ethers.provider.getBlockNumber();

      const newOracle = (await connection.ethers.getSigners())[7];

      await network.connect(oracles[0]).commitRoot(root, blockNum);
      expect(await views.getCommittedRoot(blockNum)).to.equal(ethers.ZeroHash);

      await network.replaceOracle(1, newOracle.address);
      expect(await views.getOracle(1)).to.equal(newOracle.address);

      await expect(network.connect(oracles[0]).commitRoot(root, blockNum))
        .to.be.revertedWithCustomError(network, Errors.NOT_ORACLE);

      await expect(network.connect(newOracle).commitRoot(root, blockNum))
        .to.be.revertedWithCustomError(network, Errors.ALREADY_VOTED);

      await network.connect(oracles[1]).commitRoot(root, blockNum);
      const finalTx = await network.connect(oracles[2]).commitRoot(root, blockNum);
      await expect(finalTx).to.emit(network, Events.ROOT_COMMITTED).withArgs(root, blockNum);
      expect(await views.getCommittedRoot(blockNum)).to.equal(root);
    });
  });

  describe("Oracle Quorum — completely new address replaces oracle slot", async function () {
    it("New oracle is blocked from the in-flight vote but has full slot ownership for subsequent blocks", async function () {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const { weight } = await setupOraclesAndStake(network, ssvToken);

      const brandNewOracle = (await connection.ethers.getSigners())[8];

      const root = ethers.keccak256(ethers.toUtf8Bytes("brand-new-replacement"));
      const blockNum = await connection.ethers.provider.getBlockNumber();
      const threshold = (STAKE_AMOUNT * 7500n) / 10000n;

      await network.connect(oracles[0]).commitRoot(root, blockNum);
      expect(await views.getCommittedRoot(blockNum)).to.equal(ethers.ZeroHash);

      await network.replaceOracle(1, brandNewOracle.address);
      expect(await views.getOracle(1)).to.equal(brandNewOracle.address);

      await expect(network.connect(oracles[0]).commitRoot(root, blockNum))
        .to.be.revertedWithCustomError(network, Errors.NOT_ORACLE);

      await expect(network.connect(brandNewOracle).commitRoot(root, blockNum))
        .to.be.revertedWithCustomError(network, Errors.ALREADY_VOTED);

      const root2 = ethers.keccak256(ethers.toUtf8Bytes("brand-new-replacement-round2"));
      const blockNum2 = await connection.ethers.provider.getBlockNumber();

      const tx = await network.connect(brandNewOracle).commitRoot(root2, blockNum2);
      await expect(tx).to.emit(network, Events.WEIGHTED_ROOT_PROPOSED)
        .withArgs(root2, blockNum2, weight, threshold, 1, brandNewOracle.address);

      await network.connect(oracles[1]).commitRoot(root2, blockNum2);
      const finalTx = await network.connect(oracles[2]).commitRoot(root2, blockNum2);
      await expect(finalTx).to.emit(network, Events.ROOT_COMMITTED).withArgs(root2, blockNum2);
      expect(await views.getCommittedRoot(blockNum2)).to.equal(root2);
    });
  });

  describe("Oracle Quorum — quorumBps changed between votes", async function () {
    it("Lowering quorumBps between two votes causes the second vote to cross the new, lower threshold", async function () {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const { weight } = await setupOraclesAndStake(network, ssvToken);

      const root = ethers.keccak256(ethers.toUtf8Bytes("mid-quorum-change"));
      const blockNum = await connection.ethers.provider.getBlockNumber();

      const initialThreshold = (STAKE_AMOUNT * 7500n) / 10000n; // 75%

      const tx1 = await network.connect(oracles[0]).commitRoot(root, blockNum);
      await expect(tx1).to.emit(network, Events.WEIGHTED_ROOT_PROPOSED)
        .withArgs(root, blockNum, weight, initialThreshold, 1, oracles[0].address);
      expect(await views.getCommittedRoot(blockNum)).to.equal(ethers.ZeroHash);

      await network.setQuorumBps(5000);
      expect(await views.getQuorumBps()).to.equal(5000n);

      const tx2 = await network.connect(oracles[1]).commitRoot(root, blockNum);
      await expect(tx2).to.emit(network, Events.ROOT_COMMITTED).withArgs(root, blockNum);
      expect(await views.getCommittedRoot(blockNum)).to.equal(root);
    });
  });

  describe("Oracle Quorum — conflicting roots for same block", async function () {
    it("First root to reach quorum is committed; further votes on the losing root revert with StaleBlockNumber", async function () {
      const { network, views, ssvToken } = await networkHelpers.loadFixture(deployFullSSVNetworkFixture);
      const { weight } = await setupOraclesAndStake(network, ssvToken);

      await network.setQuorumBps(5000); // 50%

      const rootA = ethers.keccak256(ethers.toUtf8Bytes("rootA"));
      const rootB = ethers.keccak256(ethers.toUtf8Bytes("rootB"));
      const blockNum = await connection.ethers.provider.getBlockNumber();

      const threshold = (STAKE_AMOUNT * 5000n) / 10000n;

      const txA1 = await network.connect(oracles[0]).commitRoot(rootA, blockNum);
      await expect(txA1).to.emit(network, Events.WEIGHTED_ROOT_PROPOSED)
        .withArgs(rootA, blockNum, weight, threshold, 1, oracles[0].address);

      const txB2 = await network.connect(oracles[1]).commitRoot(rootB, blockNum);
      await expect(txB2).to.emit(network, Events.WEIGHTED_ROOT_PROPOSED)
        .withArgs(rootB, blockNum, weight, threshold, 2, oracles[1].address);

      expect(await views.getCommittedRoot(blockNum)).to.equal(ethers.ZeroHash);

      const txA3 = await network.connect(oracles[2]).commitRoot(rootA, blockNum);
      await expect(txA3).to.emit(network, Events.ROOT_COMMITTED).withArgs(rootA, blockNum);

      expect(await views.getCommittedRoot(blockNum)).to.equal(rootA);

      await expect(network.connect(oracles[3]).commitRoot(rootB, blockNum))
        .to.be.revertedWithCustomError(network, Errors.STALE_BLOCK_NUMBER);
    });
  });
});

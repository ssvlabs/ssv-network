import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";
import {
  STAKE_AMOUNT,
} from "../../common/constants.ts";
import {
  mineBlocks,
  getBlockNumber,
} from "../helpers/index.ts";

describe("Oracle Commits", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let oracle1: HardhatEthersSigner;
  let oracle2: HardhatEthersSigner;
  let oracle3: HardhatEthersSigner;
  let oracle4: HardhatEthersSigner;
  let staker: HardhatEthersSigner;
  let nonOracle: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    const signers = await connection.ethers.getSigners();
    [oracle1, oracle2, oracle3, oracle4, staker, nonOracle] = signers;
  });

  const deployFixture = async () => {
    const { network, views, cssvToken, ssvToken } =
      await ssvNetworkFullFixture(connection);

    const provider = connection.ethers.provider;

    await network.replaceOracle(1, oracle1.address);
    await network.replaceOracle(2, oracle2.address);
    await network.replaceOracle(3, oracle3.address);
    await network.replaceOracle(4, oracle4.address);

    await ssvToken.transfer(staker.address, STAKE_AMOUNT);
    await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
    await network.connect(staker).stake(STAKE_AMOUNT);

    const cssvSupply = await cssvToken.totalSupply();
    expect(cssvSupply).to.be.greaterThan(0n);

    return { network, views, cssvToken, ssvToken, provider };
  };

  describe("Single Oracle Commit — Below Quorum", () => {
    it("Stores weight but does not commit root when 1 of 4 oracles votes", async function () {
      const { network, views, cssvToken, provider } =
        await networkHelpers.loadFixture(deployFixture);

      const blockNum = await getBlockNumber(provider);
      const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));

      const tx = await network.connect(oracle1).commitRoot(rootA, blockNum);
      await tx.wait();

      await expect(tx).to.emit(network, Events.WEIGHTED_ROOT_PROPOSED);
      await expect(tx).to.not.emit(network, Events.ROOT_COMMITTED);

      const cssvSupply = await cssvToken.totalSupply();
      const weight = cssvSupply / 4n;
      const threshold = (cssvSupply * 7500n) / 10000n;

      await expect(tx)
        .to.emit(network, Events.WEIGHTED_ROOT_PROPOSED)
        .withArgs(rootA, blockNum, weight, threshold, 1, oracle1.address);
    });
  });

  describe("Quorum Reached — 3 of 4 Oracles Agree", () => {
    it("Commits root when 3 of 4 oracles vote for the same root", async function () {
      const { network, provider } =
        await networkHelpers.loadFixture(deployFixture);

      const blockNum = await getBlockNumber(provider);
      const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));

      const tx1 = await network.connect(oracle1).commitRoot(rootA, blockNum);
      await expect(tx1).to.emit(network, Events.WEIGHTED_ROOT_PROPOSED);
      await expect(tx1).to.not.emit(network, Events.ROOT_COMMITTED);

      const tx2 = await network.connect(oracle2).commitRoot(rootA, blockNum);
      await expect(tx2).to.emit(network, Events.WEIGHTED_ROOT_PROPOSED);
      await expect(tx2).to.not.emit(network, Events.ROOT_COMMITTED);

      const tx3 = await network.connect(oracle3).commitRoot(rootA, blockNum);
      await expect(tx3).to.emit(network, Events.ROOT_COMMITTED).withArgs(rootA, blockNum);
      await expect(tx3).to.not.emit(network, Events.WEIGHTED_ROOT_PROPOSED);
    });

    it("Prevents Oracle4 from voting for same block after quorum (StaleBlockNumber)", async function () {
      const { network, provider } =
        await networkHelpers.loadFixture(deployFixture);

      const blockNum = await getBlockNumber(provider);
      const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));

      await network.connect(oracle1).commitRoot(rootA, blockNum);
      await network.connect(oracle2).commitRoot(rootA, blockNum);
      await network.connect(oracle3).commitRoot(rootA, blockNum);

      await expect(
        network.connect(oracle4).commitRoot(rootA, blockNum),
      ).to.be.revertedWithCustomError(network, Errors.STALE_BLOCK_NUMBER);
    });
  });

  describe("Conflicting Roots — Separate Weight Tracking", () => {
    it("tracks weight separately for different roots at the same block", async function () {
      const { network, provider, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const blockNum = await getBlockNumber(provider);
      const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));
      const rootB = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootB"));

      const cssvSupply = await cssvToken.totalSupply();
      const weight = cssvSupply / 4n;

      const tx1 = await network.connect(oracle1).commitRoot(rootA, blockNum);
      await expect(tx1)
        .to.emit(network, Events.WEIGHTED_ROOT_PROPOSED)
        .withArgs(rootA, blockNum, weight, (cssvSupply * 7500n) / 10000n, 1, oracle1.address);

      const tx2 = await network.connect(oracle2).commitRoot(rootB, blockNum);
      await expect(tx2)
        .to.emit(network, Events.WEIGHTED_ROOT_PROPOSED)
        .withArgs(rootB, blockNum, weight, (cssvSupply * 7500n) / 10000n, 2, oracle2.address);

      const tx3 = await network.connect(oracle3).commitRoot(rootA, blockNum);
      await expect(tx3).to.emit(network, Events.WEIGHTED_ROOT_PROPOSED);
      await expect(tx3).to.not.emit(network, Events.ROOT_COMMITTED);

      const tx4 = await network.connect(oracle4).commitRoot(rootA, blockNum);
      await expect(tx4).to.emit(network, Events.ROOT_COMMITTED).withArgs(rootA, blockNum);
    });
  });

  describe("ES-4: Oracle Replacement Mid-Vote", () => {
    it("Replacement oracle inherits same oracleId and cannot re-vote", async function () {
      const { network, provider } =
        await networkHelpers.loadFixture(deployFixture);

      const blockNum = await getBlockNumber(provider);
      const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));

      await network.connect(oracle1).commitRoot(rootA, blockNum);

      await network.replaceOracle(1, nonOracle.address);

      await mineBlocks(provider, 5);
      const newBlockNum = await getBlockNumber(provider);
      const rootC = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootC"));
      await expect(
        network.connect(oracle1).commitRoot(rootC, newBlockNum),
      ).to.be.revertedWithCustomError(network, Errors.NOT_ORACLE);

      await expect(
        network.connect(nonOracle).commitRoot(rootA, blockNum),
      ).to.be.revertedWithCustomError(network, Errors.ALREADY_VOTED);
    });

    it("Old vote's weight still counts toward quorum after replacement", async function () {
      const { network, provider } =
        await networkHelpers.loadFixture(deployFixture);

      const blockNum = await getBlockNumber(provider);
      const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));

      await network.connect(oracle1).commitRoot(rootA, blockNum);

      await network.replaceOracle(1, nonOracle.address);

      await network.connect(oracle2).commitRoot(rootA, blockNum);
      const tx3 = await network.connect(oracle3).commitRoot(rootA, blockNum);

      await expect(tx3).to.emit(network, Events.ROOT_COMMITTED).withArgs(rootA, blockNum);
    });
  });

  describe("Oracle Edge Cases — Reverts", () => {
    describe("Stale block number", () => {
      it("Reverts when blockNum equals latestCommittedBlock", async function () {
        const { network, provider } =
          await networkHelpers.loadFixture(deployFixture);

        const blockNum = await getBlockNumber(provider);
        const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));

        await network.connect(oracle1).commitRoot(rootA, blockNum);
        await network.connect(oracle2).commitRoot(rootA, blockNum);
        await network.connect(oracle3).commitRoot(rootA, blockNum);

        const rootB = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootB"));
        await expect(
          network.connect(oracle1).commitRoot(rootB, blockNum),
        ).to.be.revertedWithCustomError(network, Errors.STALE_BLOCK_NUMBER);
      });

      it("Reverts when blockNum is less than latestCommittedBlock", async function () {
        const { network, provider } =
          await networkHelpers.loadFixture(deployFixture);

        const blockNum = await getBlockNumber(provider);
        const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));

        await network.connect(oracle1).commitRoot(rootA, blockNum);
        await network.connect(oracle2).commitRoot(rootA, blockNum);
        await network.connect(oracle3).commitRoot(rootA, blockNum);

        const rootC = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootC"));
        await expect(
          network.connect(oracle1).commitRoot(rootC, blockNum - 1),
        ).to.be.revertedWithCustomError(network, Errors.STALE_BLOCK_NUMBER);
      });

      it("Succeeds when blockNum is greater than latestCommittedBlock", async function () {
        const { network, provider } =
          await networkHelpers.loadFixture(deployFixture);

        const blockNum = await getBlockNumber(provider);
        const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));

        await network.connect(oracle1).commitRoot(rootA, blockNum);
        await network.connect(oracle2).commitRoot(rootA, blockNum);
        await network.connect(oracle3).commitRoot(rootA, blockNum);

        await mineBlocks(provider, 5);
        const newBlockNum = await getBlockNumber(provider);
        const rootB = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootB"));

        await expect(
          network.connect(oracle1).commitRoot(rootB, newBlockNum),
        ).to.emit(network, Events.WEIGHTED_ROOT_PROPOSED);
      });
    });

    describe("Future block number", () => {
      it("Reverts when blockNum > block.number", async function () {
        const { network, provider } =
          await networkHelpers.loadFixture(deployFixture);

        const blockNum = await getBlockNumber(provider);
        const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));

        await expect(
          network.connect(oracle1).commitRoot(rootA, blockNum + 100),
        ).to.be.revertedWithCustomError(network, Errors.FUTURE_BLOCK_NUMBER);
      });

      it("Succeeds when blockNum == block.number (equality OK)", async function () {
        const { network, provider } =
          await networkHelpers.loadFixture(deployFixture);

        await mineBlocks(provider, 5);
        const blockNum = await getBlockNumber(provider);
        const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));

        await expect(
          network.connect(oracle1).commitRoot(rootA, blockNum),
        ).to.emit(network, Events.WEIGHTED_ROOT_PROPOSED);
      });
    });

    describe("Zero cSSV supply", () => {
      it("Reverts when cSSV totalSupply is 0", async function () {
        const { network } = await ssvNetworkFullFixture(connection);

        await network.replaceOracle(1, oracle1.address);

        const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));

        await expect(
          network.connect(oracle1).commitRoot(rootA, 1),
        ).to.be.revertedWithCustomError(network, Errors.ZERO_CSSV_SUPPLY);
      });
    });

    describe("Double vote", () => {
      it("Reverts when same oracle votes twice for same (root, blockNum)", async function () {
        const { network, provider } =
          await networkHelpers.loadFixture(deployFixture);

        const blockNum = await getBlockNumber(provider);
        const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));

        await network.connect(oracle1).commitRoot(rootA, blockNum);

        await expect(
          network.connect(oracle1).commitRoot(rootA, blockNum),
        ).to.be.revertedWithCustomError(network, Errors.ALREADY_VOTED);
      });

      it("Allows same oracle to vote for different root at same block", async function () {
        const { network, provider } =
          await networkHelpers.loadFixture(deployFixture);

        const blockNum = await getBlockNumber(provider);
        const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));
        const rootB = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootB"));

        await network.connect(oracle1).commitRoot(rootA, blockNum);

        await expect(
          network.connect(oracle1).commitRoot(rootB, blockNum),
        ).to.emit(network, Events.WEIGHTED_ROOT_PROPOSED);
      });

      it("Reverts when non-oracle calls commitRoot", async function () {
        const { network, provider } =
          await networkHelpers.loadFixture(deployFixture);

        const blockNum = await getBlockNumber(provider);
        const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));

        await expect(
          network.connect(nonOracle).commitRoot(rootA, blockNum),
        ).to.be.revertedWithCustomError(network, Errors.NOT_ORACLE);
      });
    });
  });
});

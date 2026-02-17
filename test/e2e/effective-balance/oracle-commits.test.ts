/**
 * ES-1 to ES-5: Oracle commit system scenario tests.
 *
 * Covers: single oracle commit (below quorum), quorum reached,
 * conflicting roots, oracle replacement mid-vote, and edge-case reverts.
 */

import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvNetworkFullFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import {
  registerOperators,
  makePublicKey,
  whitelistAddresses,
} from "../../common/helpers.ts";
import { Errors } from "../../common/errors.ts";
import { Events } from "../../common/events.ts";
import {
  DEFAULT_ETH_REGISTER_VALUE,
  DEFAULT_SHARES,
  EMPTY_CLUSTER,
  MINIMAL_OPERATOR_ETH_FEE,
  STAKE_AMOUNT,
} from "../../common/constants.ts";
import {
  mineBlocks,
  getBlockNumber,
} from "../helpers/index.ts";

describe("E2E: Oracle Commits (ES-1 to ES-5)", () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;
  let oracle1: HardhatEthersSigner;
  let oracle2: HardhatEthersSigner;
  let oracle3: HardhatEthersSigner;
  let oracle4: HardhatEthersSigner;
  let staker: HardhatEthersSigner;
  let nonOracle: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());
    const signers = await connection.ethers.getSigners();
    [owner, oracle1, oracle2, oracle3, oracle4, staker, nonOracle] = signers;
  });

  const deployFixture = async () => {
    const { network, views, cssvToken, ssvToken } =
      await ssvNetworkFullFixture(connection);

    const provider = connection.ethers.provider;

    // Register oracles: replaceOracle(oracleId, address) — owner-only
    await network.replaceOracle(1, oracle1.address);
    await network.replaceOracle(2, oracle2.address);
    await network.replaceOracle(3, oracle3.address);
    await network.replaceOracle(4, oracle4.address);

    // Staker stakes SSV so cSSV supply > 0 (required for oracle weight)
    // Fund staker with SSV tokens
    await ssvToken.transfer(staker.address, STAKE_AMOUNT);
    await ssvToken.connect(staker).approve(await network.getAddress(), STAKE_AMOUNT);
    await network.connect(staker).stake(STAKE_AMOUNT);

    const cssvSupply = await cssvToken.totalSupply();
    expect(cssvSupply).to.be.greaterThan(0n);

    return { network, views, cssvToken, ssvToken, provider };
  };

  // ----------------------------------------------------------------
  // ES-1: Single Oracle Commit — Below Quorum
  // ----------------------------------------------------------------
  describe("ES-1: Single Oracle Commit — Below Quorum", () => {
    it("stores weight but does not commit root when 1 of 4 oracles votes", async function () {
      const { network, views, cssvToken, provider } =
        await networkHelpers.loadFixture(deployFixture);

      const blockNum = await getBlockNumber(provider);
      const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));

      const tx = await network.connect(oracle1).commitRoot(rootA, blockNum);
      const receipt = await tx.wait();

      // Should emit WeightedRootProposed, NOT RootCommitted
      await expect(tx).to.emit(network, Events.WEIGHTED_ROOT_PROPOSED);
      await expect(tx).to.not.emit(network, Events.ROOT_COMMITTED);

      // Verify: latestCommittedBlock should still be 0
      // (no direct getter but we can verify by trying to commit at same blockNum — should not revert with StaleBlockNumber)

      // Verify the event args
      const cssvSupply = await cssvToken.totalSupply();
      const weight = cssvSupply / 4n;
      const threshold = (cssvSupply * 7500n) / 10000n;

      await expect(tx)
        .to.emit(network, Events.WEIGHTED_ROOT_PROPOSED)
        .withArgs(rootA, blockNum, weight, threshold, 1, oracle1.address);
    });
  });

  // ----------------------------------------------------------------
  // ES-2: Quorum Reached — 3 of 4 Oracles Agree
  // ----------------------------------------------------------------
  describe("ES-2: Quorum Reached — 3 of 4 Oracles Agree", () => {
    it("commits root when 3 of 4 oracles vote for the same root", async function () {
      const { network, views, cssvToken, provider } =
        await networkHelpers.loadFixture(deployFixture);

      const blockNum = await getBlockNumber(provider);
      const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));

      const cssvSupply = await cssvToken.totalSupply();
      const weight = cssvSupply / 4n;
      const threshold = (cssvSupply * 7500n) / 10000n;

      // Oracle1 votes — below quorum
      const tx1 = await network.connect(oracle1).commitRoot(rootA, blockNum);
      await expect(tx1).to.emit(network, Events.WEIGHTED_ROOT_PROPOSED);
      await expect(tx1).to.not.emit(network, Events.ROOT_COMMITTED);

      // Oracle2 votes — still below quorum
      const tx2 = await network.connect(oracle2).commitRoot(rootA, blockNum);
      await expect(tx2).to.emit(network, Events.WEIGHTED_ROOT_PROPOSED);
      await expect(tx2).to.not.emit(network, Events.ROOT_COMMITTED);

      // Oracle3 votes — quorum reached (3 * weight = 75% of supply)
      const tx3 = await network.connect(oracle3).commitRoot(rootA, blockNum);
      await expect(tx3).to.emit(network, Events.ROOT_COMMITTED).withArgs(rootA, blockNum);
      // When quorum is reached, WeightedRootProposed is NOT emitted (function returns early)
      await expect(tx3).to.not.emit(network, Events.WEIGHTED_ROOT_PROPOSED);
    });

    it("prevents Oracle4 from voting for same block after quorum (StaleBlockNumber)", async function () {
      const { network, provider } =
        await networkHelpers.loadFixture(deployFixture);

      const blockNum = await getBlockNumber(provider);
      const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));

      // 3 oracles commit — quorum reached
      await network.connect(oracle1).commitRoot(rootA, blockNum);
      await network.connect(oracle2).commitRoot(rootA, blockNum);
      await network.connect(oracle3).commitRoot(rootA, blockNum);

      // Oracle4 tries same block — latestCommittedBlock is now blockNum, so blockNum <= latestCommittedBlock
      await expect(
        network.connect(oracle4).commitRoot(rootA, blockNum),
      ).to.be.revertedWithCustomError(network, Errors.STALE_BLOCK_NUMBER);
    });
  });

  // ----------------------------------------------------------------
  // ES-3: Conflicting Roots — Separate Weight Tracking
  // ----------------------------------------------------------------
  describe("ES-3: Conflicting Roots — Separate Weight Tracking", () => {
    it("tracks weight separately for different roots at the same block", async function () {
      const { network, provider, cssvToken } =
        await networkHelpers.loadFixture(deployFixture);

      const blockNum = await getBlockNumber(provider);
      const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));
      const rootB = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootB"));

      const cssvSupply = await cssvToken.totalSupply();
      const weight = cssvSupply / 4n;

      // Oracle1 votes rootA
      const tx1 = await network.connect(oracle1).commitRoot(rootA, blockNum);
      await expect(tx1)
        .to.emit(network, Events.WEIGHTED_ROOT_PROPOSED)
        .withArgs(rootA, blockNum, weight, (cssvSupply * 7500n) / 10000n, 1, oracle1.address);

      // Oracle2 votes rootB (different root, different commitment key)
      const tx2 = await network.connect(oracle2).commitRoot(rootB, blockNum);
      await expect(tx2)
        .to.emit(network, Events.WEIGHTED_ROOT_PROPOSED)
        .withArgs(rootB, blockNum, weight, (cssvSupply * 7500n) / 10000n, 2, oracle2.address);

      // Oracle3 votes rootA — now rootA has 2 votes
      const tx3 = await network.connect(oracle3).commitRoot(rootA, blockNum);
      await expect(tx3).to.emit(network, Events.WEIGHTED_ROOT_PROPOSED);
      await expect(tx3).to.not.emit(network, Events.ROOT_COMMITTED);

      // Oracle4 votes rootA — quorum for rootA (3 * weight = 75%)
      const tx4 = await network.connect(oracle4).commitRoot(rootA, blockNum);
      await expect(tx4).to.emit(network, Events.ROOT_COMMITTED).withArgs(rootA, blockNum);

      // rootB's weight (1 vote) is stale but persists — no mechanism to clean up
      // Verify by checking that any future commit for block=blockNum would revert StaleBlockNumber
      // (rootB can never reach quorum for this block)
    });
  });

  // ----------------------------------------------------------------
  // ES-4: Oracle Replacement Mid-Vote
  // ----------------------------------------------------------------
  describe("ES-4: Oracle Replacement Mid-Vote", () => {
    it("replacement oracle inherits same oracleId and cannot re-vote", async function () {
      const { network, provider } =
        await networkHelpers.loadFixture(deployFixture);

      const blockNum = await getBlockNumber(provider);
      const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));

      // Oracle1 votes for rootA
      await network.connect(oracle1).commitRoot(rootA, blockNum);

      // Owner replaces oracle1 (oracleId=1) with nonOracle
      await network.replaceOracle(1, nonOracle.address);

      // Old oracle (oracle1) can no longer call commitRoot (oracleIdOf = 0)
      // Use a new blockNum to avoid StaleBlockNumber
      await mineBlocks(provider, 5);
      const newBlockNum = await getBlockNumber(provider);
      const rootC = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootC"));
      await expect(
        network.connect(oracle1).commitRoot(rootC, newBlockNum),
      ).to.be.revertedWithCustomError(network, Errors.NOT_ORACLE);

      // New oracle (nonOracle, now oracleId=1) cannot re-vote for same commitment
      await expect(
        network.connect(nonOracle).commitRoot(rootA, blockNum),
      ).to.be.revertedWithCustomError(network, Errors.ALREADY_VOTED);
    });

    it("old vote's weight still counts toward quorum after replacement", async function () {
      const { network, provider } =
        await networkHelpers.loadFixture(deployFixture);

      const blockNum = await getBlockNumber(provider);
      const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));

      // Oracle1 votes for rootA (weight 10e9)
      await network.connect(oracle1).commitRoot(rootA, blockNum);

      // Replace oracle1 with nonOracle
      await network.replaceOracle(1, nonOracle.address);

      // Oracle2 and Oracle3 vote — total = 3 votes including oracle1's preserved weight
      await network.connect(oracle2).commitRoot(rootA, blockNum);
      const tx3 = await network.connect(oracle3).commitRoot(rootA, blockNum);

      // Quorum should be reached (3 out of 4 = 75%)
      await expect(tx3).to.emit(network, Events.ROOT_COMMITTED).withArgs(rootA, blockNum);
    });
  });

  // ----------------------------------------------------------------
  // ES-5: Oracle Edge Cases — Reverts
  // ----------------------------------------------------------------
  describe("ES-5: Oracle Edge Cases — Reverts", () => {
    // ES-5a: Stale block number
    describe("ES-5a: Stale block number", () => {
      it("reverts when blockNum equals latestCommittedBlock", async function () {
        const { network, provider } =
          await networkHelpers.loadFixture(deployFixture);

        const blockNum = await getBlockNumber(provider);
        const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));

        // Reach quorum to commit a root
        await network.connect(oracle1).commitRoot(rootA, blockNum);
        await network.connect(oracle2).commitRoot(rootA, blockNum);
        await network.connect(oracle3).commitRoot(rootA, blockNum);
        // latestCommittedBlock is now blockNum

        // Try same blockNum
        const rootB = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootB"));
        await expect(
          network.connect(oracle1).commitRoot(rootB, blockNum),
        ).to.be.revertedWithCustomError(network, Errors.STALE_BLOCK_NUMBER);
      });

      it("reverts when blockNum is less than latestCommittedBlock", async function () {
        const { network, provider } =
          await networkHelpers.loadFixture(deployFixture);

        const blockNum = await getBlockNumber(provider);
        const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));

        // Commit root at blockNum
        await network.connect(oracle1).commitRoot(rootA, blockNum);
        await network.connect(oracle2).commitRoot(rootA, blockNum);
        await network.connect(oracle3).commitRoot(rootA, blockNum);

        // Try a lower blockNum
        const rootC = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootC"));
        await expect(
          network.connect(oracle1).commitRoot(rootC, blockNum - 1),
        ).to.be.revertedWithCustomError(network, Errors.STALE_BLOCK_NUMBER);
      });

      it("succeeds when blockNum is greater than latestCommittedBlock", async function () {
        const { network, provider } =
          await networkHelpers.loadFixture(deployFixture);

        const blockNum = await getBlockNumber(provider);
        const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));

        // Commit root
        await network.connect(oracle1).commitRoot(rootA, blockNum);
        await network.connect(oracle2).commitRoot(rootA, blockNum);
        await network.connect(oracle3).commitRoot(rootA, blockNum);

        // Mine blocks to advance past the committed block
        await mineBlocks(provider, 5);
        const newBlockNum = await getBlockNumber(provider);
        const rootB = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootB"));

        // Should succeed
        await expect(
          network.connect(oracle1).commitRoot(rootB, newBlockNum),
        ).to.emit(network, Events.WEIGHTED_ROOT_PROPOSED);
      });
    });

    // ES-5b: Future block number
    describe("ES-5b: Future block number", () => {
      it("reverts when blockNum > block.number", async function () {
        const { network, provider } =
          await networkHelpers.loadFixture(deployFixture);

        const blockNum = await getBlockNumber(provider);
        const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));

        // Future block: current + 100
        await expect(
          network.connect(oracle1).commitRoot(rootA, blockNum + 100),
        ).to.be.revertedWithCustomError(network, Errors.FUTURE_BLOCK_NUMBER);
      });

      it("succeeds when blockNum == block.number (equality OK)", async function () {
        const { network, provider } =
          await networkHelpers.loadFixture(deployFixture);

        // Mine a few blocks to ensure we have room
        await mineBlocks(provider, 5);
        const blockNum = await getBlockNumber(provider);
        const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));

        // blockNum is current block. The tx will execute at blockNum+1, so blockNum <= block.number passes.
        await expect(
          network.connect(oracle1).commitRoot(rootA, blockNum),
        ).to.emit(network, Events.WEIGHTED_ROOT_PROPOSED);
      });
    });

    // ES-5c: Zero cSSV supply
    describe("ES-5c: Zero cSSV supply", () => {
      it("reverts when cSSV totalSupply is 0", async function () {
        // Deploy without staking — cSSV supply = 0
        const { network } = await ssvNetworkFullFixture(connection);

        // Register oracles
        await network.replaceOracle(1, oracle1.address);

        const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));

        await expect(
          network.connect(oracle1).commitRoot(rootA, 1),
        ).to.be.revertedWithCustomError(network, Errors.ORACLE_HAS_ZERO_WEIGHT);
      });
    });

    // ES-5d: Double vote
    describe("ES-5d: Double vote", () => {
      it("reverts when same oracle votes twice for same (root, blockNum)", async function () {
        const { network, provider } =
          await networkHelpers.loadFixture(deployFixture);

        const blockNum = await getBlockNumber(provider);
        const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));

        await network.connect(oracle1).commitRoot(rootA, blockNum);

        await expect(
          network.connect(oracle1).commitRoot(rootA, blockNum),
        ).to.be.revertedWithCustomError(network, Errors.ALREADY_VOTED);
      });

      it("allows same oracle to vote for different root at same block", async function () {
        const { network, provider } =
          await networkHelpers.loadFixture(deployFixture);

        const blockNum = await getBlockNumber(provider);
        const rootA = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootA"));
        const rootB = connection.ethers.keccak256(connection.ethers.toUtf8Bytes("rootB"));

        await network.connect(oracle1).commitRoot(rootA, blockNum);

        // Different root → different commitment key → should pass
        await expect(
          network.connect(oracle1).commitRoot(rootB, blockNum),
        ).to.emit(network, Events.WEIGHTED_ROOT_PROPOSED);
      });

      it("reverts when non-oracle calls commitRoot", async function () {
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

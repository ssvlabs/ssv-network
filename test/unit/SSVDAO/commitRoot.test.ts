import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvDAOHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { ethers } from "ethers";

describe("SSVDAO function `commitRoot()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;
  let oracle1: HardhatEthersSigner;
  let oracle2: HardhatEthersSigner;
  let oracle3: HardhatEthersSigner;
  let nonOracle: HardhatEthersSigner;

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [owner, oracle1, oracle2, oracle3, nonOracle] = await connection.ethers.getSigners();
  });

  const deployDAOWithOraclesFixture = async () => {
    const { dao } = await ssvDAOHarnessFixture(connection);

    // Deploy a mock cSSV token for total supply
    const mockCSSV = await connection.ethers.deployContract("MockToken", []);
    await mockCSSV.waitForDeployment();

    // Mint some tokens to simulate total supply
    const totalSupply = ethers.parseEther("1000");
    await mockCSSV.mint(owner.address, totalSupply);

    // Set the cSSV token
    await dao.mockSetCSSVToken(await mockCSSV.getAddress());

    // Set up oracles with IDs 1, 2, 3
    await dao.mockSetOracle(1, oracle1.address);
    await dao.mockSetOracle(2, oracle2.address);
    await dao.mockSetOracle(3, oracle3.address);

    // Set oracle weights (each has 400 tokens worth of weight = 40% each)
    const oracleWeight = ethers.parseEther("400");
    await dao.mockSetOracleWeight(1, oracleWeight);
    await dao.mockSetOracleWeight(2, oracleWeight);
    await dao.mockSetOracleWeight(3, oracleWeight);

    // Set quorum to 75% (7500 bps)
    await dao.mockSetQuorumBps(7500);

    return { dao, mockCSSV, totalSupply };
  };

  it("Is reverted with 'NotOracle' when caller is not an oracle", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);

    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test"));
    const currentBlock = await connection.ethers.provider.getBlockNumber();

    await expect(dao.connect(nonOracle).commitRoot(merkleRoot, currentBlock))
      .to.be.revertedWithCustomError(dao, Errors.NOT_ORACLE);
  });

  it("Is reverted with 'StaleBlockNumber' when block number is not greater than last committed", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);

    // Set a previous committed block
    await dao.mockSetLatestCommittedBlock(100);

    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test"));

    await expect(dao.connect(oracle1).commitRoot(merkleRoot, 100))
      .to.be.revertedWithCustomError(dao, Errors.STALE_BLOCK_NUMBER);

    await expect(dao.connect(oracle1).commitRoot(merkleRoot, 50))
      .to.be.revertedWithCustomError(dao, Errors.STALE_BLOCK_NUMBER);
  });

  it("Is reverted with 'FutureBlockNumber' when block number is in the future", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);

    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test"));
    const currentBlock = await connection.ethers.provider.getBlockNumber();
    const futureBlock = currentBlock + 1000;

    await expect(dao.connect(oracle1).commitRoot(merkleRoot, futureBlock))
      .to.be.revertedWithCustomError(dao, Errors.FUTURE_BLOCK_NUMBER);
  });

  it("Is reverted with 'AlreadyVoted' when oracle tries to vote twice", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);

    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test"));
    const currentBlock = await connection.ethers.provider.getBlockNumber();

    // First vote
    await dao.connect(oracle1).commitRoot(merkleRoot, currentBlock);

    // Second vote should fail
    await expect(dao.connect(oracle1).commitRoot(merkleRoot, currentBlock))
      .to.be.revertedWithCustomError(dao, Errors.ALREADY_VOTED);
  });

  it("Emits WeightedRootProposed when quorum is not reached", async function () {
    const { dao, totalSupply } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);

    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test"));
    const currentBlock = await connection.ethers.provider.getBlockNumber();
    const oracleWeight = ethers.parseEther("400");
    const threshold = (totalSupply * 7500n) / 10000n;

    const tx = await dao.connect(oracle1).commitRoot(merkleRoot, currentBlock);

    await expect(tx)
      .to.emit(dao, Events.WEIGHTED_ROOT_PROPOSED)
      .withArgs(merkleRoot, currentBlock, oracleWeight, threshold, 1, oracle1.address);
  });

  it("Commits root and emits RootCommitted when quorum is reached", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);

    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test"));
    const currentBlock = await connection.ethers.provider.getBlockNumber();

    // Oracle 1 votes (40% - not enough for 75% quorum)
    await dao.connect(oracle1).commitRoot(merkleRoot, currentBlock);

    // Oracle 2 votes (now 80% - enough for 75% quorum)
    const tx = await dao.connect(oracle2).commitRoot(merkleRoot, currentBlock);

    await expect(tx)
      .to.emit(dao, Events.ROOT_COMMITTED)
      .withArgs(merkleRoot, currentBlock);

    // Verify root is stored
    const storedRoot = await dao.getEBRoot(currentBlock);
    expect(storedRoot).to.equal(merkleRoot);

    // Verify latest committed block is updated
    const latestBlock = await dao.getLatestCommittedBlock();
    expect(latestBlock).to.equal(currentBlock);
  });

  it("Accumulates weight across multiple oracle votes", async function () {
    const { dao } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);

    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test"));
    const currentBlock = await connection.ethers.provider.getBlockNumber();
    const oracleWeight = ethers.parseEther("400");

    // First oracle votes
    await dao.connect(oracle1).commitRoot(merkleRoot, currentBlock);

    // Check accumulated weight
    const commitmentKey = ethers.keccak256(
      ethers.solidityPacked(["uint64", "bytes32"], [currentBlock, merkleRoot])
    );
    const weight1 = await dao.getRootCommitmentWeight(commitmentKey);
    expect(weight1).to.equal(oracleWeight);

    // Second oracle votes
    await dao.connect(oracle2).commitRoot(merkleRoot, currentBlock);

    // After quorum is reached, rootCommitments is deleted, so it should be 0
    const weight2 = await dao.getRootCommitmentWeight(commitmentKey);
    expect(weight2).to.equal(0n);
  });
});


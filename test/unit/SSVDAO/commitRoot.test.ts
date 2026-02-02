import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { getTestConnection } from "../../setup/connection.ts";
import { ssvDAOHarnessFixture } from "../../setup/fixtures.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { Events } from "../../common/events.ts";
import { Errors } from "../../common/errors.ts";
import { ethers } from "ethers";
import { trackGasFromReceipt, GasGroup } from "../../helpers/gas-usage.ts";

describe("SSVDAO function `commitRoot()`", async () => {
  let connection: NetworkConnection<"generic">;
  let networkHelpers: NetworkHelpersType;

  let owner: HardhatEthersSigner;
  let oracle1: HardhatEthersSigner;
  let oracle2: HardhatEthersSigner;
  let oracle3: HardhatEthersSigner;
  let nonOracle: HardhatEthersSigner;

  const totalSupply = ethers.parseEther("1000");

  before(async function () {
    ({ connection, networkHelpers } = await getTestConnection());

    [owner, oracle1, oracle2, oracle3, nonOracle] = await connection.ethers.getSigners();
  });

  const deployDAOWithOraclesFixture = async () => {
    const { dao } = await ssvDAOHarnessFixture(connection);

    const mockCSSV = await connection.ethers.deployContract("MockToken", []);
    await mockCSSV.waitForDeployment();

    await dao.mockSetCSSVToken(await mockCSSV.getAddress());

    await dao.mockSetOracle(1, oracle1.address);
    await dao.mockSetOracle(2, oracle2.address);
    await dao.mockSetOracle(3, oracle3.address);

    const oracleWeight = ethers.parseEther("400");
    await dao.mockSetOracleWeight(1, oracleWeight);
    await dao.mockSetOracleWeight(2, oracleWeight);
    await dao.mockSetOracleWeight(3, oracleWeight);

    await dao.mockSetQuorumBps(7500);

    return { dao, mockCSSV };
  };

  const getCommitmentKey = (blockNum: number | bigint, merkleRoot: string) => {
    return ethers.keccak256(
      ethers.solidityPacked(["uint64", "bytes32"], [blockNum, merkleRoot])
    );
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

  it("Is reverted with 'OracleHasZeroWeight' if the oracle`s weight is zero", async function() {
    const { dao } =
      await networkHelpers.loadFixture(deployDAOWithOraclesFixture);

    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test"));
    const currentBlock = await connection.ethers.provider.getBlockNumber();

    dao.mockSetOracleWeight(1, 0);
    await expect(dao.connect(oracle1).commitRoot(merkleRoot, currentBlock))
      .to.be.revertedWithCustomError(dao, Errors.ORACLE_HAS_ZERO_WEIGHT);
  });

  it("Is reverted with 'AlreadyVoted' when oracle tries to vote twice", async function () {
    const { dao, mockCSSV } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);
    await mockCSSV.mint(owner.address, totalSupply);
    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test"));
    const currentBlock = await connection.ethers.provider.getBlockNumber();

    await dao.connect(oracle1).commitRoot(merkleRoot, currentBlock);

    await expect(dao.connect(oracle1).commitRoot(merkleRoot, currentBlock))
      .to.be.revertedWithCustomError(dao, Errors.ALREADY_VOTED);
  });

  it("Emits WeightedRootProposed when quorum is not reached", async function () {
    const { dao, mockCSSV } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);
    await mockCSSV.mint(owner.address, totalSupply);

    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test"));
    const currentBlock = await connection.ethers.provider.getBlockNumber();
    const oracleWeight = ethers.parseEther("400");
    const threshold = (totalSupply * 7500n) / 10000n;

    const tx = await dao.connect(oracle1).commitRoot(merkleRoot, currentBlock);

    await expect(tx)
      .to.emit(dao, Events.WEIGHTED_ROOT_PROPOSED)
      .withArgs(merkleRoot, currentBlock, oracleWeight, threshold, 1, oracle1.address);

    const commitmentKey = getCommitmentKey(currentBlock, merkleRoot);
    expect(await dao.hasOracleVoted(commitmentKey, 1)).to.equal(true);
    expect(await dao.getRootCommitmentWeight(commitmentKey)).to.equal(oracleWeight);
    expect(await dao.getEBRoot(currentBlock)).to.equal(ethers.ZeroHash);
  });

  it("Emits WeightedRootProposed repeatedly and accumulates weight when quorum is still not reached", async function () {
    const { dao, mockCSSV } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);
    await mockCSSV.mint(owner.address, totalSupply);

    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test"));
    const blockNum = await connection.ethers.provider.getBlockNumber();

    const oracleWeight = ethers.parseEther("300");
    await dao.mockSetOracleWeight(1, oracleWeight);
    await dao.mockSetOracleWeight(2, oracleWeight);
    await dao.mockSetOracleWeight(3, oracleWeight);

    const threshold = (totalSupply * 7500n) / 10000n;
    const commitmentKey = getCommitmentKey(blockNum, merkleRoot);

    const tx1 = await dao.connect(oracle1).commitRoot(merkleRoot, blockNum);
    await expect(tx1)
      .to.emit(dao, Events.WEIGHTED_ROOT_PROPOSED)
      .withArgs(merkleRoot, blockNum, oracleWeight, threshold, 1, oracle1.address);

    const tx2 = await dao.connect(oracle2).commitRoot(merkleRoot, blockNum);
    await expect(tx2)
      .to.emit(dao, Events.WEIGHTED_ROOT_PROPOSED)
      .withArgs(merkleRoot, blockNum, oracleWeight * 2n, threshold, 2, oracle2.address);

    expect(await dao.hasOracleVoted(commitmentKey, 1)).to.equal(true);
    expect(await dao.hasOracleVoted(commitmentKey, 2)).to.equal(true);
    expect(await dao.getRootCommitmentWeight(commitmentKey)).to.equal(oracleWeight * 2n);
    expect(await dao.getEBRoot(blockNum)).to.equal(ethers.ZeroHash);
    expect(await dao.getLatestCommittedBlock()).to.equal(0n);
  });

  it("Commits root and emits RootCommitted when quorum is reached", async function () {
    const { dao, mockCSSV } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);
    await mockCSSV.mint(owner.address, totalSupply);

    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test"));
    const currentBlock = await connection.ethers.provider.getBlockNumber();

    await dao.connect(oracle1).commitRoot(merkleRoot, currentBlock);

    const tx = await dao.connect(oracle2).commitRoot(merkleRoot, currentBlock);
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.COMMIT_ROOT]);

    await expect(tx)
      .to.emit(dao, Events.ROOT_COMMITTED)
      .withArgs(merkleRoot, currentBlock);

    const storedRoot = await dao.getEBRoot(currentBlock);
    expect(storedRoot).to.equal(merkleRoot);

    const latestBlock = await dao.getLatestCommittedBlock();
    expect(latestBlock).to.equal(currentBlock);
  });

  it("Commits root on the first vote when accumulated weight meets the quorum threshold", async function () {
    const { dao, mockCSSV } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);
    await mockCSSV.mint(owner.address, totalSupply);

    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test"));
    const blockNum = await connection.ethers.provider.getBlockNumber();

    const threshold = (totalSupply * 7500n) / 10000n;
    await dao.mockSetOracleWeight(1, threshold);

    const commitmentKey = getCommitmentKey(blockNum, merkleRoot);

    const tx = await dao.connect(oracle1).commitRoot(merkleRoot, blockNum);
    const receipt = await tx.wait();
    await trackGasFromReceipt(receipt, [GasGroup.COMMIT_ROOT]);

    await expect(tx)
      .to.emit(dao, Events.ROOT_COMMITTED)
      .withArgs(merkleRoot, blockNum);

    expect(await dao.getEBRoot(blockNum)).to.equal(merkleRoot);
    expect(await dao.getLatestCommittedBlock()).to.equal(blockNum);
    expect(await dao.getRootCommitmentWeight(commitmentKey)).to.equal(0n);
    expect(await dao.hasOracleVoted(commitmentKey, 1)).to.equal(true);
  });

  it("Is reverted with 'StaleBlockNumber' when trying to propose the same block after it was committed", async function () {
    const { dao, mockCSSV } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);
    await mockCSSV.mint(owner.address, totalSupply);

    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test"));
    const blockNum = await connection.ethers.provider.getBlockNumber();

    await dao.connect(oracle1).commitRoot(merkleRoot, blockNum);
    await dao.connect(oracle2).commitRoot(merkleRoot, blockNum);

    await expect(dao.connect(oracle3).commitRoot(merkleRoot, blockNum))
      .to.be.revertedWithCustomError(dao, Errors.STALE_BLOCK_NUMBER);
  });

  it("Accumulates weight across multiple oracle votes", async function () {
    const { dao, mockCSSV } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);
    await mockCSSV.mint(owner.address, totalSupply);

    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test"));
    const currentBlock = await connection.ethers.provider.getBlockNumber();
    const oracleWeight = ethers.parseEther("400");

    await dao.connect(oracle1).commitRoot(merkleRoot, currentBlock);

    const commitmentKey = ethers.keccak256(
      ethers.solidityPacked(["uint64", "bytes32"], [currentBlock, merkleRoot])
    );
    const weight1 = await dao.getRootCommitmentWeight(commitmentKey);
    expect(weight1).to.equal(oracleWeight);

    await dao.connect(oracle2).commitRoot(merkleRoot, currentBlock);

    const weight2 = await dao.getRootCommitmentWeight(commitmentKey);
    expect(weight2).to.equal(0n);
  });
});

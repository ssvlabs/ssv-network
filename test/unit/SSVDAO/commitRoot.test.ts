import { expect } from "chai";
import type { NetworkConnection } from "hardhat/types/network";
import type { HardhatEthersSigner } from "@nomicfoundation/hardhat-ethers/types";
import { defaultDAOFixture } from "../../helpers/fixture-presets.ts";
import type { NetworkHelpersType } from "../../common/types.ts";
import { setupTestContext } from "../../common/helpers.ts";
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
  let oracle4: HardhatEthersSigner;
  let nonOracle: HardhatEthersSigner;

  const totalSupply = ethers.parseEther("1000");
  const numberOfOracles = 4n;

  before(async function () {
    ({ connection, networkHelpers, signers: [owner, oracle1, oracle2, oracle3, oracle4, nonOracle] } = await setupTestContext());
  });

  const deployDAOWithOraclesFixture = async () => {
    const { dao, cssv } = await defaultDAOFixture(connection);

    await dao.mockSetOracle(1, oracle1.address);
    await dao.mockSetOracle(2, oracle2.address);
    await dao.mockSetOracle(3, oracle3.address);
    await dao.mockupdateQuorumBps(7500);

    return { dao, cssv };
  };

  const deployDAOWithFourOraclesFixture = async () => {
    const { dao, cssv } = await defaultDAOFixture(connection);

    await dao.mockSetOracle(1, oracle1.address);
    await dao.mockSetOracle(2, oracle2.address);
    await dao.mockSetOracle(3, oracle3.address);
    await dao.mockSetOracle(4, oracle4.address);
    await dao.mockupdateQuorumBps(7500);

    return { dao, cssv };
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

    await expect(dao.connect(oracle1).commitRoot(merkleRoot, currentBlock))
      .to.be.revertedWithCustomError(dao, Errors.ORACLE_HAS_ZERO_WEIGHT);
  });

  it("Is reverted with 'AlreadyVoted' when oracle tries to vote twice", async function () {
    const { dao, cssv } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);
    await cssv.mint(owner.address, totalSupply);
    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test"));
    const currentBlock = await connection.ethers.provider.getBlockNumber();

    await dao.connect(oracle1).commitRoot(merkleRoot, currentBlock);

    await expect(dao.connect(oracle1).commitRoot(merkleRoot, currentBlock))
      .to.be.revertedWithCustomError(dao, Errors.ALREADY_VOTED);
  });

  it("Emits WeightedRootProposed when quorum is not reached", async function () {
    const { dao, cssv } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);
    await cssv.mint(owner.address, totalSupply);

    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test"));
    const currentBlock = await connection.ethers.provider.getBlockNumber();
    const threshold = (totalSupply * 7500n) / 10000n;

    const tx = await dao.connect(oracle1).commitRoot(merkleRoot, currentBlock);

    await expect(tx)
      .to.emit(dao, Events.WEIGHTED_ROOT_PROPOSED)
      .withArgs(merkleRoot, currentBlock, (totalSupply / numberOfOracles), threshold, 1, oracle1.address);

    const commitmentKey = getCommitmentKey(currentBlock, merkleRoot);
    expect(await dao.hasOracleVoted(commitmentKey, 1)).to.equal(true);
    expect(await dao.getRootCommitmentWeight(commitmentKey)).to.equal(totalSupply / numberOfOracles);
    expect(await dao.getEBRoot(currentBlock)).to.equal(ethers.ZeroHash);
  });

  it("Emits WeightedRootProposed repeatedly and accumulates weight when quorum is still not reached", async function () {
    const { dao, cssv } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);
    await cssv.mint(owner.address, totalSupply);

    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test"));
    const blockNum = await connection.ethers.provider.getBlockNumber();

    const threshold = (totalSupply * 7500n) / 10000n;
    const commitmentKey = getCommitmentKey(blockNum, merkleRoot);

    const tx1 = await dao.connect(oracle1).commitRoot(merkleRoot, blockNum);
    await expect(tx1)
      .to.emit(dao, Events.WEIGHTED_ROOT_PROPOSED)
      .withArgs(merkleRoot, blockNum, totalSupply / numberOfOracles, threshold, 1, oracle1.address);

    const tx2 = await dao.connect(oracle2).commitRoot(merkleRoot, blockNum);
    await expect(tx2)
      .to.emit(dao, Events.WEIGHTED_ROOT_PROPOSED)
      .withArgs(merkleRoot, blockNum, (totalSupply / numberOfOracles) * 2n, threshold, 2, oracle2.address);

    expect(await dao.hasOracleVoted(commitmentKey, 1)).to.equal(true);
    expect(await dao.hasOracleVoted(commitmentKey, 2)).to.equal(true);
    expect(await dao.getEBRoot(blockNum)).to.equal(ethers.ZeroHash);
    expect(await dao.getLatestCommittedBlock()).to.equal(0n);
  });

  it("Commits root and emits RootCommitted when quorum is reached", async function () {
    const { dao, cssv } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);
    await cssv.mint(owner.address, totalSupply);

    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test"));
    const currentBlock = await connection.ethers.provider.getBlockNumber();
    await dao.mockupdateQuorumBps(5000);

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
    const { dao, cssv } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);
    await cssv.mint(owner.address, totalSupply);

    await dao.mockupdateQuorumBps(100);
    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test"));
    const blockNum = await connection.ethers.provider.getBlockNumber();

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
    const { dao, cssv } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);
    await cssv.mint(owner.address, totalSupply);

    await dao.mockupdateQuorumBps(5000);

    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test"));
    const blockNum = await connection.ethers.provider.getBlockNumber();

    await dao.connect(oracle1).commitRoot(merkleRoot, blockNum);
    await dao.connect(oracle2).commitRoot(merkleRoot, blockNum);

    await expect(dao.connect(oracle3).commitRoot(merkleRoot, blockNum))
      .to.be.revertedWithCustomError(dao, Errors.STALE_BLOCK_NUMBER);
  });

  it("Accumulates weight across multiple oracle votes", async function () {
    const { dao, cssv } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);
    await cssv.mint(owner.address, totalSupply);

    const merkleRoot = ethers.keccak256(ethers.toUtf8Bytes("test"));
    const currentBlock = await connection.ethers.provider.getBlockNumber();
    const oracleWeight = totalSupply / numberOfOracles;

    await dao.connect(oracle1).commitRoot(merkleRoot, currentBlock);

    const commitmentKey = ethers.keccak256(
      ethers.solidityPacked(["uint64", "bytes32"], [currentBlock, merkleRoot])
    );
    const weight1 = await dao.getRootCommitmentWeight(commitmentKey);
    expect(weight1).to.equal(oracleWeight);

    await dao.connect(oracle2).commitRoot(merkleRoot, currentBlock);

    const weight2 = await dao.getRootCommitmentWeight(commitmentKey);
    expect(weight2).to.equal(oracleWeight * 2n);
  });

  it("Requires all 4 oracle votes when quorumBps is 10000 (100%)", async function () {
    const { dao, cssv } = await networkHelpers.loadFixture(deployDAOWithFourOraclesFixture);
    await cssv.mint(owner.address, totalSupply);

    await dao.mockupdateQuorumBps(10000);

    const root = ethers.keccak256(ethers.toUtf8Bytes("100-quorum"));
    const blockNum = await connection.ethers.provider.getBlockNumber();
    const commitmentKey = getCommitmentKey(blockNum, root);

    const weight = totalSupply / numberOfOracles;
    const threshold = totalSupply;

    const tx1 = await dao.connect(oracle1).commitRoot(root, blockNum);
    await expect(tx1).to.emit(dao, Events.WEIGHTED_ROOT_PROPOSED)
      .withArgs(root, blockNum, weight, threshold, 1, oracle1.address);
    expect(await dao.getEBRoot(blockNum)).to.equal(ethers.ZeroHash);

    const tx2 = await dao.connect(oracle2).commitRoot(root, blockNum);
    await expect(tx2).to.emit(dao, Events.WEIGHTED_ROOT_PROPOSED)
      .withArgs(root, blockNum, weight * 2n, threshold, 2, oracle2.address);
    expect(await dao.getEBRoot(blockNum)).to.equal(ethers.ZeroHash);

    const tx3 = await dao.connect(oracle3).commitRoot(root, blockNum);
    await expect(tx3).to.emit(dao, Events.WEIGHTED_ROOT_PROPOSED)
      .withArgs(root, blockNum, weight * 3n, threshold, 3, oracle3.address);
    expect(await dao.getEBRoot(blockNum)).to.equal(ethers.ZeroHash);
    expect(await dao.getLatestCommittedBlock()).to.equal(0n);

    const tx4 = await dao.connect(oracle4).commitRoot(root, blockNum);
    await expect(tx4).to.emit(dao, Events.ROOT_COMMITTED).withArgs(root, blockNum);

    expect(await dao.getEBRoot(blockNum)).to.equal(root);
    expect(await dao.getLatestCommittedBlock()).to.equal(blockNum);
    expect(await dao.getRootCommitmentWeight(commitmentKey)).to.equal(0n);
  });

  it("Single oracle vote commits root when quorumBps is 1 (1 bps = 0.01%)", async function () {
    const { dao, cssv } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);
    await cssv.mint(owner.address, totalSupply);

    await dao.mockupdateQuorumBps(1);

    const root = ethers.keccak256(ethers.toUtf8Bytes("1-quorum"));
    const blockNum = await connection.ethers.provider.getBlockNumber();
    const commitmentKey = getCommitmentKey(blockNum, root);

    const tx = await dao.connect(oracle1).commitRoot(root, blockNum);
    await expect(tx).to.emit(dao, Events.ROOT_COMMITTED).withArgs(root, blockNum);

    expect(await dao.getEBRoot(blockNum)).to.equal(root);
    expect(await dao.getLatestCommittedBlock()).to.equal(blockNum);
    expect(await dao.getRootCommitmentWeight(commitmentKey)).to.equal(0n);
    expect(await dao.hasOracleVoted(commitmentKey, 1)).to.equal(true);
  });

  it("Oracle replaced mid-vote: old oracle loses voting rights, new oracle gets AlreadyVoted for reused slot", async function () {
    const { dao, cssv } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);
    await cssv.mint(owner.address, totalSupply);

    const root = ethers.keccak256(ethers.toUtf8Bytes("mid-replace"));
    const blockNum = await connection.ethers.provider.getBlockNumber();
    const commitmentKey = getCommitmentKey(blockNum, root);

    const weight = totalSupply / numberOfOracles;

    await dao.connect(oracle1).commitRoot(root, blockNum);
    expect(await dao.hasOracleVoted(commitmentKey, 1)).to.equal(true);
    expect(await dao.getRootCommitmentWeight(commitmentKey)).to.equal(weight);

    await dao.replaceOracle(1, oracle4.address);
    expect(await dao.getOracleId(oracle1.address)).to.equal(0n);
    expect(await dao.getOracleId(oracle4.address)).to.equal(1n);

    await expect(dao.connect(oracle1).commitRoot(root, blockNum))
      .to.be.revertedWithCustomError(dao, Errors.NOT_ORACLE);

    await expect(dao.connect(oracle4).commitRoot(root, blockNum))
      .to.be.revertedWithCustomError(dao, Errors.ALREADY_VOTED);

    await dao.connect(oracle2).commitRoot(root, blockNum);
    const finalTx = await dao.connect(oracle3).commitRoot(root, blockNum);
    await expect(finalTx).to.emit(dao, Events.ROOT_COMMITTED).withArgs(root, blockNum);

    expect(await dao.getEBRoot(blockNum)).to.equal(root);
    expect(await dao.getLatestCommittedBlock()).to.equal(blockNum);
  });

  it("Oracle replaced with a completely new address: new oracle inherits the slot and can vote on subsequent blocks", async function () {
    const { dao, cssv } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);
    await cssv.mint(owner.address, totalSupply);

    const brandNewOracle = (await connection.ethers.getSigners())[6];

    const root = ethers.keccak256(ethers.toUtf8Bytes("brand-new-replacement"));
    const blockNum = await connection.ethers.provider.getBlockNumber();
    const weight = totalSupply / numberOfOracles;
    const threshold = (totalSupply * 7500n) / 10000n;

    await dao.connect(oracle1).commitRoot(root, blockNum);

    await dao.replaceOracle(1, brandNewOracle.address);
    expect(await dao.getOracleAddress(1)).to.equal(brandNewOracle.address);
    expect(await dao.getOracleId(brandNewOracle.address)).to.equal(1n);
    expect(await dao.getOracleId(oracle1.address)).to.equal(0n);

    await expect(dao.connect(brandNewOracle).commitRoot(root, blockNum))
      .to.be.revertedWithCustomError(dao, Errors.ALREADY_VOTED);

    const root2 = ethers.keccak256(ethers.toUtf8Bytes("brand-new-replacement-round2"));
    const blockNum2 = await connection.ethers.provider.getBlockNumber();
    const commitmentKey2 = getCommitmentKey(blockNum2, root2);

    const tx = await dao.connect(brandNewOracle).commitRoot(root2, blockNum2);
    await expect(tx).to.emit(dao, Events.WEIGHTED_ROOT_PROPOSED)
      .withArgs(root2, blockNum2, weight, threshold, 1, brandNewOracle.address);
    expect(await dao.hasOracleVoted(commitmentKey2, 1)).to.equal(true);

    await dao.connect(oracle2).commitRoot(root2, blockNum2);
    const finalTx2 = await dao.connect(oracle3).commitRoot(root2, blockNum2);
    await expect(finalTx2).to.emit(dao, Events.ROOT_COMMITTED).withArgs(root2, blockNum2);
    expect(await dao.getEBRoot(blockNum2)).to.equal(root2);
  });

  it("Lowering quorumBps between votes causes the next vote to evaluate against the new threshold", async function () {
    const { dao, cssv } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);
    await cssv.mint(owner.address, totalSupply);

    const root = ethers.keccak256(ethers.toUtf8Bytes("mid-quorum-change"));
    const blockNum = await connection.ethers.provider.getBlockNumber();

    const weight = totalSupply / numberOfOracles;
    const initialThreshold = (totalSupply * 7500n) / 10000n;
    const tx1 = await dao.connect(oracle1).commitRoot(root, blockNum);
    await expect(tx1).to.emit(dao, Events.WEIGHTED_ROOT_PROPOSED)
      .withArgs(root, blockNum, weight, initialThreshold, 1, oracle1.address);
    expect(await dao.getEBRoot(blockNum)).to.equal(ethers.ZeroHash);
    await dao.mockupdateQuorumBps(5000);
    const tx2 = await dao.connect(oracle2).commitRoot(root, blockNum);
    await expect(tx2).to.emit(dao, Events.ROOT_COMMITTED).withArgs(root, blockNum);

    expect(await dao.getEBRoot(blockNum)).to.equal(root);
    expect(await dao.getLatestCommittedBlock()).to.equal(blockNum);
  });

  it("Raising quorumBps between votes requires additional votes to reach new threshold", async function () {
    const { dao, cssv } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);
    await cssv.mint(owner.address, totalSupply);
    await dao.mockupdateQuorumBps(5000);

    const root = ethers.keccak256(ethers.toUtf8Bytes("mid-quorum-raise"));
    const blockNum = await connection.ethers.provider.getBlockNumber();

    const weight = totalSupply / numberOfOracles;
    const initialThreshold = (totalSupply * 5000n) / 10000n;
    const tx1 = await dao.connect(oracle1).commitRoot(root, blockNum);
    await expect(tx1).to.emit(dao, Events.WEIGHTED_ROOT_PROPOSED)
      .withArgs(root, blockNum, weight, initialThreshold, 1, oracle1.address);
    expect(await dao.getEBRoot(blockNum)).to.equal(ethers.ZeroHash);
    await dao.mockupdateQuorumBps(7500);

    const newThreshold = (totalSupply * 7500n) / 10000n;
    const tx2 = await dao.connect(oracle2).commitRoot(root, blockNum);
    await expect(tx2).to.emit(dao, Events.WEIGHTED_ROOT_PROPOSED)
      .withArgs(root, blockNum, weight * 2n, newThreshold, 2, oracle2.address);
    expect(await dao.getEBRoot(blockNum)).to.equal(ethers.ZeroHash);
    const tx3 = await dao.connect(oracle3).commitRoot(root, blockNum);
    await expect(tx3).to.emit(dao, Events.ROOT_COMMITTED).withArgs(root, blockNum);

    expect(await dao.getEBRoot(blockNum)).to.equal(root);
    expect(await dao.getLatestCommittedBlock()).to.equal(blockNum);
  });

  it("Conflicting roots for same block: first root to reach quorum is committed, further votes on the losing root revert", async function () {
    const { dao, cssv } = await networkHelpers.loadFixture(deployDAOWithOraclesFixture);
    await cssv.mint(owner.address, totalSupply);

    await dao.mockupdateQuorumBps(5000);

    const rootA = ethers.keccak256(ethers.toUtf8Bytes("rootA"));
    const rootB = ethers.keccak256(ethers.toUtf8Bytes("rootB"));
    const blockNum = await connection.ethers.provider.getBlockNumber();

    const weight = totalSupply / numberOfOracles;
    const threshold = (totalSupply * 5000n) / 10000n;

    const txA1 = await dao.connect(oracle1).commitRoot(rootA, blockNum);
    await expect(txA1).to.emit(dao, Events.WEIGHTED_ROOT_PROPOSED)
      .withArgs(rootA, blockNum, weight, threshold, 1, oracle1.address);

    const txB2 = await dao.connect(oracle2).commitRoot(rootB, blockNum);
    await expect(txB2).to.emit(dao, Events.WEIGHTED_ROOT_PROPOSED)
      .withArgs(rootB, blockNum, weight, threshold, 2, oracle2.address);

    expect(await dao.getEBRoot(blockNum)).to.equal(ethers.ZeroHash);

    const txA3 = await dao.connect(oracle3).commitRoot(rootA, blockNum);
    await expect(txA3).to.emit(dao, Events.ROOT_COMMITTED).withArgs(rootA, blockNum);

    expect(await dao.getEBRoot(blockNum)).to.equal(rootA);
    expect(await dao.getLatestCommittedBlock()).to.equal(blockNum);

    await expect(dao.connect(oracle1).commitRoot(rootB, blockNum))
      .to.be.revertedWithCustomError(dao, Errors.STALE_BLOCK_NUMBER);
  });
});
